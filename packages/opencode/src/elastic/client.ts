import { ElasticAuth } from "./auth"

export interface ConversationRound {
  id: string
  status: "in_progress" | "completed" | "awaiting_prompt"
  input: { message: string }
  steps: Array<
    | { type: "tool_call"; tool_call_id: string; tool_id: string; params: unknown; results: Array<{ type: "text"; tool_result_id: string; value: string }> }
    | { type: "reasoning"; reasoning: string }
  >
  response: { message: string }
  started_at: string
  time_to_first_token: number
  time_to_last_token: number
  model_usage: {
    connector_id: string
    llm_calls: number
    input_tokens: number
    output_tokens: number
  }
}

export interface Conversation {
  id: string
  agent_id: string
  user_name: string
  space: string
  title: string
  created_at: string
  updated_at: string
  conversation_rounds: ConversationRound[]
  attachments?: unknown[]
  state?: unknown
}

export type ConversationSummary = Omit<Conversation, "conversation_rounds">

export namespace KibanaClient {
  function api(base: string, suffix: string, space?: string) {
    const prefix = space && space !== "default" ? `/s/${space}` : ""
    return `${prefix}${base}${suffix}`
  }

  async function resolve() {
    const auth = await ElasticAuth.check()
    if (!auth.configured || !auth.context) throw new Error("Elastic auth not configured")
    const url = auth.context.kibana_url
    const key = auth.context.api_key
    if (!url) throw new Error("kibana_url not configured")
    if (!key) throw new Error("api_key not configured")
    return { base: url.replace(/\/$/, ""), key }
  }

  async function request<T = unknown>(endpoint: string, opts?: { method?: string; body?: unknown }): Promise<T> {
    const { base, key } = await resolve()

    // base already includes any Kibana base path (e.g. http://host:5603/mypath)
    // endpoint is an API path like /api/workflows or /s/{space}/api/...
    const res = await fetch(`${base}${endpoint}`, {
      method: opts?.method ?? "GET",
      headers: {
        "kbn-xsrf": "true",
        "x-elastic-internal-origin": "kibana",
        "elastic-api-version": "2023-10-31",
        "Content-Type": "application/json",
        Authorization: `ApiKey ${key}`,
      },
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`Kibana ${res.status}: ${text}`)
    }
    return res.json() as Promise<T>
  }

  // Workflows

  export function workflows(space?: string) {
    return {
      list(opts?: { query?: string; page?: number; limit?: number }) {
        return request(api("/api/workflows", "/search", space), {
          method: "POST",
          body: { page: opts?.page ?? 1, limit: opts?.limit ?? 100, query: opts?.query ?? "" },
        })
      },
      get(id: string) {
        return request(api("/api/workflows", `/${id}`, space))
      },
      create(yaml: string, id?: string) {
        return request(api("/api/workflows", "", space), {
          method: "POST",
          body: { yaml, id },
        })
      },
      update(id: string, yaml: string) {
        return request(api("/api/workflows", `/${id}`, space), {
          method: "PUT",
          body: { yaml },
        })
      },
      del(ids: string[]) {
        return Promise.all(ids.map((id) => request(api("/api/workflows", `/${id}`, space), { method: "DELETE" })))
      },
      run(id: string, inputs?: Record<string, unknown>) {
        return request(api("/api/workflows", `/${id}/run`, space), {
          method: "POST",
          body: { inputs: inputs ?? {} },
        })
      },
      validate(yaml: string) {
        return request(api("/internal/workflows", "/_validate", space), {
          method: "POST",
          body: { yaml },
        })
      },
    }
  }

  // Executions

  export function executions(space?: string) {
    return {
      get(id: string) {
        return request(api("/api/workflowExecutions", `/${id}`, space))
      },
      list(workflowId: string, opts?: { page?: number; perPage?: number }) {
        const params = new URLSearchParams({ workflowId })
        if (opts?.page) params.set("page", String(opts.page - 1))
        if (opts?.perPage) params.set("perPage", String(opts.perPage))
        return request(api("/api/workflowExecutions", `?${params}`, space))
      },
    }
  }

  // Agent Builder tools

  export function tools(space?: string) {
    return {
      list() {
        return request(api("/api/agent_builder/tools", "", space))
      },
      get(id: string) {
        return request(api("/api/agent_builder/tools", `/${id}`, space))
      },
      create(body: { id: string; type: string; description: string; tags: string[]; configuration: unknown }) {
        return request(api("/api/agent_builder/tools", "", space), { method: "POST", body })
      },
      update(id: string, body: { description?: string; tags?: string[]; configuration?: unknown }) {
        return request(api("/api/agent_builder/tools", `/${id}`, space), { method: "PUT", body })
      },
      del(id: string, force?: boolean) {
        const suffix = force ? `/${id}?force=true` : `/${id}`
        return request(api("/api/agent_builder/tools", suffix, space), { method: "DELETE" })
      },
    }
  }

  // Agent Builder agents

  export function agents(space?: string) {
    return {
      list() {
        return request(api("/api/agent_builder/agents", "", space))
      },
      get(id: string) {
        return request(api("/api/agent_builder/agents", `/${id}`, space))
      },
      create(body: {
        id: string
        name: string
        description: string
        labels?: string[]
        configuration: { instructions?: string; tools: Array<{ tool_ids: string[] }> }
      }) {
        return request(api("/api/agent_builder/agents", "", space), { method: "POST", body })
      },
      update(
        id: string,
        body: {
          name?: string
          description?: string
          labels?: string[]
          instructions?: string
          tool_ids?: string[]
        },
      ) {
        return request(api("/api/agent_builder/agents", `/${id}`, space), { method: "PUT", body })
      },
      del(id: string) {
        return request(api("/api/agent_builder/agents", `/${id}`, space), { method: "DELETE" })
      },
    }
  }

  // Connectors

  export function connectors(space?: string) {
    return {
      list() {
        return request(api("/api/actions/connectors", "", space))
      },
    }
  }

  // Conversations

  export function conversations(space?: string) {
    return {
      async list(opts?: { agent_id?: string }): Promise<{ results: ConversationSummary[] }> {
        const params = new URLSearchParams()
        if (opts?.agent_id) params.set("agent_id", opts.agent_id)
        const qs = params.toString()
        return request(api("/internal/elastic_console/conversations", qs ? "?" + qs : "", space))
      },
      async get(id: string): Promise<Conversation> {
        return request(api("/internal/elastic_console/conversations", `/${encodeURIComponent(id)}`, space))
      },
      async create(body: { agent_id: string; title: string; conversation_rounds: ConversationRound[]; user_name?: string; attachments?: unknown[] }): Promise<{ id: string }> {
        return request(api("/internal/elastic_console/conversations", "", space), { method: "POST", body })
      },
      async update(id: string, body: { title?: string; conversation_rounds?: ConversationRound[] }): Promise<void> {
        await request(api("/internal/elastic_console/conversations", `/${encodeURIComponent(id)}`, space), { method: "PUT", body })
      },
      async locate(id: string): Promise<{ fork_context: string; conversation_rounds?: ConversationRound[] }> {
        return request(api("/internal/elastic_console/conversations", `/${encodeURIComponent(id)}/locate`, space), { method: "POST", body: { location: "cli" } })
      },
      async handoff(id: string, body: { summary: string }): Promise<void> {
        await request(api("/internal/elastic_console/conversations", `/${encodeURIComponent(id)}/handoff`, space), { method: "POST", body })
      },
    }
  }

}

