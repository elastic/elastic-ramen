import z from "zod"
import { Tool } from "./tool"
import { KibanaClient } from "@/elastic/client"

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
