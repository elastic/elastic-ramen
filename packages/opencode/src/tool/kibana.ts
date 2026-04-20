import z from "zod"
import { Tool } from "./tool"
import { KibanaClient, ElasticClient } from "@/elastic/client"
import type { EsqlResponse, ESFlamegraphData } from "@/elastic/client"

function json(data: unknown) {
  return JSON.stringify(data, null, 2)
}

// ── Workflows ──────────────────────────────────────────────────────────

export const KibanaListWorkflows = Tool.define("kibana_list_workflows", {
  description:
    "List workflows from the connected Kibana instance. Use to discover available automation workflows. Returns workflow names, IDs, descriptions, and enabled status.",
  parameters: z.object({
    query: z.string().optional().describe("Search query to filter workflows by name or description"),
    page: z.number().optional().describe("Page number (1-based)"),
    limit: z.number().optional().describe("Results per page (default 100)"),
  }),
  async execute(params) {
    const result = await KibanaClient.workflows().list(params)
    return { title: "List workflows", metadata: {}, output: json(result) }
  },
})

export const KibanaGetWorkflow = Tool.define("kibana_get_workflow", {
  description:
    "Get details of a specific Kibana workflow by ID, including its YAML definition, enabled status, and validation state.",
  parameters: z.object({
    id: z.string().describe("Workflow ID"),
  }),
  async execute(params) {
    const result = await KibanaClient.workflows().get(params.id)
    return { title: params.id, metadata: {}, output: json(result) }
  },
})

export const KibanaCreateWorkflow = Tool.define("kibana_create_workflow", {
  description: "Create a new Kibana workflow from a YAML definition string.",
  parameters: z.object({
    yaml: z.string().describe("Workflow YAML definition"),
    id: z.string().optional().describe("Optional custom workflow ID"),
  }),
  async execute(params) {
    const result = await KibanaClient.workflows().create(params.yaml, params.id)
    return { title: "Create workflow", metadata: {}, output: json(result) }
  },
})

export const KibanaUpdateWorkflow = Tool.define("kibana_update_workflow", {
  description: "Update an existing Kibana workflow with a new YAML definition.",
  parameters: z.object({
    id: z.string().describe("Workflow ID to update"),
    yaml: z.string().describe("Updated workflow YAML definition"),
  }),
  async execute(params) {
    const result = await KibanaClient.workflows().update(params.id, params.yaml)
    return { title: `Update ${params.id}`, metadata: {}, output: json(result) }
  },
})

export const KibanaDeleteWorkflow = Tool.define("kibana_delete_workflow", {
  description: "Delete one or more Kibana workflows by ID.",
  parameters: z.object({
    ids: z.array(z.string()).describe("Array of workflow IDs to delete"),
  }),
  async execute(params) {
    await KibanaClient.workflows().del(params.ids)
    return { title: "Delete workflows", metadata: {}, output: `Deleted ${params.ids.length} workflow(s): ${params.ids.join(", ")}` }
  },
})

export const KibanaValidateWorkflow = Tool.define("kibana_validate_workflow", {
  description:
    "Validate a workflow YAML definition using Kibana server-side validation. Returns whether the workflow is valid and any diagnostics.",
  parameters: z.object({
    yaml: z.string().describe("Workflow YAML string to validate"),
  }),
  async execute(params) {
    const result = await KibanaClient.workflows().validate(params.yaml)
    return { title: "Validate workflow", metadata: {}, output: json(result) }
  },
})

export const KibanaRunWorkflow = Tool.define("kibana_run_workflow", {
  description:
    "Execute a Kibana workflow. Returns an execution ID that can be used to check status with kibana_get_execution.",
  parameters: z.object({
    id: z.string().describe("Workflow ID to execute"),
    inputs: z.record(z.string(), z.unknown()).optional().describe("Input parameters for the workflow"),
  }),
  async execute(params) {
    const result = await KibanaClient.workflows().run(params.id, params.inputs)
    return { title: `Run ${params.id}`, metadata: {}, output: json(result) }
  },
})

// ── Executions ─────────────────────────────────────────────────────────

export const KibanaGetExecution = Tool.define("kibana_get_execution", {
  description:
    "Get the status and details of a workflow execution by execution ID. Shows status (running, completed, failed), outputs, errors, and step details.",
  parameters: z.object({
    id: z.string().describe("Execution ID returned from kibana_run_workflow"),
  }),
  async execute(params) {
    const result = await KibanaClient.executions().get(params.id)
    return { title: params.id, metadata: {}, output: json(result) }
  },
})

export const KibanaListExecutions = Tool.define("kibana_list_executions", {
  description:
    "List recent executions for a specific workflow. Shows execution history with status, timing, and results.",
  parameters: z.object({
    workflow_id: z.string().describe("Workflow ID to list executions for"),
    page: z.number().optional().describe("Page number (1-based)"),
    per_page: z.number().optional().describe("Results per page"),
  }),
  async execute(params) {
    const result = await KibanaClient.executions().list(params.workflow_id, {
      page: params.page,
      perPage: params.per_page,
    })
    return { title: `Executions for ${params.workflow_id}`, metadata: {}, output: json(result) }
  },
})

// ── Agent Builder Tools ────────────────────────────────────────────────

export const KibanaListTools = Tool.define("kibana_list_tools", {
  description:
    "List all Agent Builder tools from the connected Kibana instance. These are Kibana-side tools like ES|QL queries, index searches, and workflow-backed tools.",
  parameters: z.object({}),
  async execute() {
    const result = await KibanaClient.tools().list()
    return { title: "List tools", metadata: {}, output: json(result) }
  },
})

export const KibanaGetTool = Tool.define("kibana_get_tool", {
  description: "Get details of a specific Agent Builder tool by ID, including its type, configuration, and schema.",
  parameters: z.object({
    id: z.string().describe("Tool ID"),
  }),
  async execute(params) {
    const result = await KibanaClient.tools().get(params.id)
    return { title: params.id, metadata: {}, output: json(result) }
  },
})

export const KibanaCreateTool = Tool.define("kibana_create_tool", {
  description:
    "Create a new Agent Builder tool in Kibana. Supports types: workflow (backed by a workflow), esql (ES|QL query), and index_search (index search).",
  parameters: z.object({
    id: z.string().describe("Unique tool identifier"),
    type: z.enum(["workflow", "esql", "index_search"]).describe("Tool type"),
    description: z.string().describe("Tool description"),
    tags: z.array(z.string()).optional().describe("Categorization tags"),
    configuration: z.record(z.string(), z.unknown()).describe("Tool-specific configuration (e.g. workflow_id for workflow tools, query for esql tools)"),
  }),
  async execute(params) {
    const result = await KibanaClient.tools().create({
      id: params.id,
      type: params.type,
      description: params.description,
      tags: params.tags ?? [],
      configuration: params.configuration,
    })
    return { title: `Create tool ${params.id}`, metadata: {}, output: json(result) }
  },
})

export const KibanaUpdateTool = Tool.define("kibana_update_tool", {
  description: "Update an existing Agent Builder tool. Can change description, tags, or configuration.",
  parameters: z.object({
    id: z.string().describe("Tool ID to update"),
    description: z.string().optional().describe("New description"),
    tags: z.array(z.string()).optional().describe("New tags"),
    configuration: z.record(z.string(), z.unknown()).optional().describe("Updated configuration"),
  }),
  async execute(params) {
    const result = await KibanaClient.tools().update(params.id, {
      description: params.description,
      tags: params.tags,
      configuration: params.configuration,
    })
    return { title: `Update tool ${params.id}`, metadata: {}, output: json(result) }
  },
})

export const KibanaDeleteTool = Tool.define("kibana_delete_tool", {
  description: "Delete an Agent Builder tool by ID.",
  parameters: z.object({
    id: z.string().describe("Tool ID to delete"),
    force: z.boolean().optional().describe("Force deletion even if tool is used by agents"),
  }),
  async execute(params) {
    await KibanaClient.tools().del(params.id, params.force)
    return { title: `Delete tool ${params.id}`, metadata: {}, output: `Deleted tool: ${params.id}` }
  },
})

// ── Agent Builder Agents ───────────────────────────────────────────────

export const KibanaListAgents = Tool.define("kibana_list_agents", {
  description:
    "List all Agent Builder agents from the connected Kibana instance. Shows agent names, descriptions, tools, and configuration.",
  parameters: z.object({}),
  async execute() {
    const result = await KibanaClient.agents().list()
    return { title: "List agents", metadata: {}, output: json(result) }
  },
})

export const KibanaGetAgent = Tool.define("kibana_get_agent", {
  description: "Get details of a specific Agent Builder agent by ID, including instructions, tools, and configuration.",
  parameters: z.object({
    id: z.string().describe("Agent ID"),
  }),
  async execute(params) {
    const result = await KibanaClient.agents().get(params.id)
    return { title: params.id, metadata: {}, output: json(result) }
  },
})

export const KibanaCreateAgent = Tool.define("kibana_create_agent", {
  description: "Create a new Agent Builder agent in Kibana with a name, description, instructions, and tool IDs.",
  parameters: z.object({
    id: z.string().describe("Unique agent identifier"),
    name: z.string().describe("Agent display name"),
    description: z.string().describe("Agent description"),
    labels: z.array(z.string()).optional().describe("Agent labels"),
    instructions: z.string().optional().describe("System instructions for the agent"),
    tool_ids: z.array(z.string()).optional().describe("IDs of tools to assign to the agent"),
  }),
  async execute(params) {
    const result = await KibanaClient.agents().create({
      id: params.id,
      name: params.name,
      description: params.description,
      labels: params.labels,
      configuration: {
        instructions: params.instructions,
        tools: [{ tool_ids: params.tool_ids ?? [] }],
      },
    })
    return { title: `Create agent ${params.id}`, metadata: {}, output: json(result) }
  },
})

export const KibanaUpdateAgent = Tool.define("kibana_update_agent", {
  description: "Update an existing Agent Builder agent. Can change name, description, labels, instructions, or tools.",
  parameters: z.object({
    id: z.string().describe("Agent ID to update"),
    name: z.string().optional().describe("New name"),
    description: z.string().optional().describe("New description"),
    labels: z.array(z.string()).optional().describe("New labels"),
    instructions: z.string().optional().describe("New system instructions"),
    tool_ids: z.array(z.string()).optional().describe("New tool IDs"),
  }),
  async execute(params) {
    const result = await KibanaClient.agents().update(params.id, {
      name: params.name,
      description: params.description,
      labels: params.labels,
      instructions: params.instructions,
      tool_ids: params.tool_ids,
    })
    return { title: `Update agent ${params.id}`, metadata: {}, output: json(result) }
  },
})

export const KibanaDeleteAgent = Tool.define("kibana_delete_agent", {
  description: "Delete an Agent Builder agent by ID.",
  parameters: z.object({
    id: z.string().describe("Agent ID to delete"),
  }),
  async execute(params) {
    await KibanaClient.agents().del(params.id)
    return { title: `Delete agent ${params.id}`, metadata: {}, output: `Deleted agent: ${params.id}` }
  },
})

// ── Connectors ─────────────────────────────────────────────────────────

export const KibanaListConnectors = Tool.define("kibana_list_connectors", {
  description: "List all action connectors configured in Kibana (email, Slack, PagerDuty, webhooks, etc.).",
  parameters: z.object({}),
  async execute() {
    const result = await KibanaClient.connectors().list()
    return { title: "List connectors", metadata: {}, output: json(result) }
  },
})

// ── Profiling ──────────────────────────────────────────────────────────

function validateFilterString(input: string, fieldName: string): void {
  if (!input || input !== input.trim()) {
    throw new Error(`Invalid ${fieldName}: empty or contains whitespace`)
  }
  if (input !== input.replaceAll(/[^a-zA-Z0-9\-_.:]/g, "")) {
    throw new Error(`Invalid ${fieldName}: contains invalid characters`)
  }
}

interface Frame {
  function_name?: string
  function_offset?: number
  source_file_name?: string
  line_number?: number
  count_inclusive?: number
  count_exclusive?: number
}

interface Stacktrace {
  count?: number
  service_name?: string
  host_name?: string
  frames: Frame[]
}

interface Stacktraces {
  stacktraces: Stacktrace[]
}

export const KibanaProfilingStacktraces = Tool.define("kibana_profiling_stacktraces", {
  description:
    "Retrieve symbolized stacktraces from Elastic Universal Profiling. Returns recent CPU/memory profile stacktraces with function names, source files, and line numbers. Filter by time window and optionally by process name or executable.",
  parameters: z.object({
    last: z.string().describe("Time window for profiles (e.g., '7 days', '2 hours', '30 minutes')"),
    limit: z.number().int().positive().optional().describe("Maximum number of stacktraces to return (default: unlimited)"),
    comm: z.string().optional().describe("Filter by process/thread name (mutually exclusive with exec)"),
    exec: z.string().optional().describe("Filter by executable name (mutually exclusive with comm)"),
  }),
  async execute(params) {
    if (params.comm && params.exec) {
      throw new Error("'comm' and 'exec' are mutually exclusive")
    }

    if (params.comm) validateFilterString(params.comm, "comm")
    if (params.exec) validateFilterString(params.exec, "exec")

    let eventFilter = ""
    if (params.comm) {
      eventFilter = `| WHERE process.thread.name == "${params.comm}"`
    } else if (params.exec) {
      eventFilter = `| WHERE process.executable.name == "${params.exec}"`
    }
    eventFilter += ` AND @timestamp >= NOW() - ${params.last}`

    const limitClause = params.limit ? `| LIMIT ${params.limit}` : ""

    // Query 1: Get stacktrace IDs and metadata from events
    const eventsQuery = `FROM profiling-events-all ${eventFilter} ${limitClause}`
    const eventsData = await ElasticClient.esqlQuery(eventsQuery)

    // Extract stacktrace IDs and metadata
    const stackIds = new Map<string, { count: number; service: string; host: string }>()
    const stackIdCol = eventsData.columns.findIndex((c) => c.name === "Stacktrace.id")
    const countCol = eventsData.columns.findIndex((c) => c.name === "Stacktrace.count")
    const serviceCol = eventsData.columns.findIndex((c) => c.name === "service.name")
    const hostCol = eventsData.columns.findIndex((c) => c.name === "host.name")

    if (stackIdCol === -1) throw new Error("Missing Stacktrace.id column in events response")

    eventsData.values.forEach((row) => {
      const id = String(row[stackIdCol])
      stackIds.set(id, {
        count: countCol !== -1 ? (row[countCol] as number) : 0,
        service: serviceCol !== -1 ? String(row[serviceCol] ?? "") : "",
        host: hostCol !== -1 ? String(row[hostCol] ?? "") : "",
      })
    })

    if (stackIds.size === 0) {
      return { title: "Get stacktraces", metadata: {}, output: json({ stacktraces: [] }) }
    }

    // Query 2: Get frame IDs for each stacktrace
    const inClause = Array.from(stackIds.keys())
      .map((id) => `"${id}"`)
      .join(", ")
    const tracesQuery = `FROM profiling-stacktraces METADATA _id | WHERE _id IN (${inClause})`
    const tracesData = await ElasticClient.esqlQuery(tracesQuery)

    const frameIds = new Map<string, string[]>()
    const traceIdCol = tracesData.columns.findIndex((c) => c.name === "_id")
    const frameIdsCol = tracesData.columns.findIndex((c) => c.name === "Stacktrace.frame.ids")

    if (frameIdsCol === -1) throw new Error("Missing Stacktrace.frame.ids column in stacktraces response")

    tracesData.values.forEach((row) => {
      const traceId = String(row[traceIdCol])
      const frameStr = String(row[frameIdsCol] ?? "")

      // Split into 32-char chunks and replace _ with -
      const frames: string[] = []
      for (let i = 0; i < frameStr.length; i += 32) {
        frames.push(frameStr.substring(i, i + 32).replace(/_/g, "-"))
      }
      frameIds.set(traceId, frames)
    })

    // Query 3: Get symbol info for each frame
    const allFrameIds = Array.from(frameIds.values()).flat()
    const uniqueFrameIds = Array.from(new Set(allFrameIds))
    const frameInClause = uniqueFrameIds.map((id) => `"${id}"`).join(", ")

    const framesQuery = `FROM profiling-stackframes METADATA _id | WHERE _id IN (${frameInClause})`
    const framesData = await ElasticClient.esqlQuery(framesQuery)

    const frameSymbols = new Map<
      string,
      { file: string; function: string; offset: number; line: number }
    >()
    const frameIdFrameCol = framesData.columns.findIndex((c) => c.name === "_id")
    const fileCol = framesData.columns.findIndex((c) => c.name === "Stackframe.file.name")
    const funcCol = framesData.columns.findIndex((c) => c.name === "Stackframe.function.name")
    const offsetCol = framesData.columns.findIndex((c) => c.name === "Stackframe.function.offset")
    const lineCol = framesData.columns.findIndex((c) => c.name === "Stackframe.line.number")

    framesData.values.forEach((row) => {
      frameSymbols.set(String(row[frameIdFrameCol]), {
        file: fileCol !== -1 ? String(row[fileCol] ?? "") : "",
        function: funcCol !== -1 ? String(row[funcCol] ?? "") : "",
        offset: offsetCol !== -1 ? (row[offsetCol] as number) : 0,
        line: lineCol !== -1 ? (row[lineCol] as number) : 0,
      })
    })

    // Merge all into result
    const result: Stacktraces = { stacktraces: [] }
    stackIds.forEach((meta, stackId) => {
      const frames: Frame[] = (frameIds.get(stackId) ?? []).map((frameId) => {
        const symbol = frameSymbols.get(frameId) ?? {
          file: "",
          function: "",
          offset: 0,
          line: 0,
        }
        return {
          function_name: symbol.function,
          function_offset: symbol.offset,
          source_file_name: symbol.file,
          line_number: symbol.line,
        }
      })

      result.stacktraces.push({
        count: meta.count,
        service_name: meta.service,
        host_name: meta.host,
        frames,
      })
    })

    return { title: "Get stacktraces", metadata: {}, output: json(result) }
  },
})

export const KibanaProfilingFlamegraph = Tool.define("kibana_profiling_flamegraph", {
  description:
    "Get a flamegraph from Elastic Universal Profiling. Returns call-path visualization as nested stacktraces, useful for identifying hot code paths. Requires time range and sample size.",
  parameters: z.object({
    sample_size: z.number().int().positive().describe("Number of samples to include in the flamegraph (1-100000)"),
    timestamp_gte: z.string().describe("Start time in ISO format (e.g., '2026-04-20T10:00:00')"),
    timestamp_lt: z.string().describe("End time in ISO format (e.g., '2026-04-20T11:00:00')"),
    exec: z.string().optional().describe("Filter by executable name"),
  }),
  async execute(params) {
    if (params.exec) validateFilterString(params.exec, "exec")

    const body: any = {
      sample_size: params.sample_size,
      query: {
        bool: {
          filter: [
            {
              range: {
                "@timestamp": {
                  gte: params.timestamp_gte,
                  lt: params.timestamp_lt,
                  format: "yyyy-MM-dd'T'HH:mm:ss",
                },
              },
            },
          ],
        },
      },
    }

    if (params.exec) {
      body.query.bool.filter.unshift({
        term: { "process.executable.name": params.exec },
      })
    }

    const data = await ElasticClient.profilingFlamegraph(body)

    // Transform ESFlamegraphData tree to stacktraces via DFS
    const result = transformFlamegraphToStacktraces(data)

    return { title: "Get flamegraph", metadata: {}, output: json(result) }
  },
})

function transformFlamegraphToStacktraces(data: ESFlamegraphData): Stacktraces {
  if (data.Size === 0) {
    return { stacktraces: [] }
  }

  if (data.Edges.length !== data.Size) {
    throw new Error("Invalid flamegraph data: size mismatch")
  }

  const stacktraces: Stacktrace[] = []

  function traverseEdge(idx: number, currentPath: Frame[]): void {
    currentPath.push({
      function_name: data.FunctionName[idx],
      function_offset: data.FunctionOffset[idx],
      source_file_name: data.SourceFilename[idx],
      line_number: data.SourceLine[idx],
      count_inclusive: data.CountInclusive[idx],
      count_exclusive: data.CountExclusive[idx],
    })

    if (data.Edges[idx].length === 0) {
      // Leaf node: save the path as a stacktrace
      stacktraces.push({
        frames: [...currentPath],
      })
    } else {
      // Internal node: recurse to children
      for (const childIdx of data.Edges[idx]) {
        traverseEdge(childIdx, currentPath)
      }
    }

    currentPath.pop()
  }

  if (data.Size > 0) {
    traverseEdge(0, [])
  }

  return { stacktraces }
}

export const KibanaProfilingTopFunctions = Tool.define("kibana_profiling_top_functions", {
  description:
    "Get the most-sampled functions from Elastic Universal Profiling. Returns the hottest functions in a time window, sorted by sample count.",
  parameters: z.object({
    limit: z.number().int().positive().describe("Maximum number of functions to return (1-10000)"),
    timestamp_gte: z.string().describe("Start time in ISO format (e.g., '2026-04-20T10:00:00')"),
    timestamp_lt: z.string().describe("End time in ISO format (e.g., '2026-04-20T11:00:00')"),
    exec: z.string().optional().describe("Filter by executable name"),
  }),
  async execute(params) {
    if (params.exec) validateFilterString(params.exec, "exec")

    const body: any = {
      limit: params.limit,
      query: {
        bool: {
          filter: [
            {
              range: {
                "@timestamp": {
                  gte: params.timestamp_gte,
                  lt: params.timestamp_lt,
                  format: "yyyy-MM-dd'T'HH:mm:ss",
                },
              },
            },
          ],
        },
      },
    }

    if (params.exec) {
      body.query.bool.filter.unshift({
        term: { "process.executable.name": params.exec },
      })
    }

    const result = await ElasticClient.profilingTopFunctions(body)
    return { title: "Get top functions", metadata: {}, output: json(result) }
  },
})
