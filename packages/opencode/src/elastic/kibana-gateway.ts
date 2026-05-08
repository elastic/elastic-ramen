// Copyright (c) 2026-present, Elastic NV
/** Kibana elastic_ramen internal routes: list connectors as OpenAI-style models, chat uses `model` = connector id. */

/** Same feature id as {@link AGENT_BUILDER_INFERENCE_FEATURE_ID} in Kibana `@kbn/agent-builder-common`. */
const agentBuilderFeature = "agent_builder"

const template = {
  attachment: false,
  reasoning: false,
  temperature: true,
  tool_call: true,
  release_date: "2025-01-01",
  cost: { input: 0, output: 0 },
  limit: { context: 128000, output: 8192 },
} as const

/** GET → parsed JSON, or `undefined` on network error / non-2xx / invalid JSON. Callers do their own shape validation. */
async function tryFetchJson<T = unknown>(
  url: string | URL,
  headers: Record<string, string>,
): Promise<T | undefined> {
  try {
    const res = await fetch(url, { headers })
    if (!res.ok) return undefined
    return (await res.json()) as T
  } catch {
    return undefined
  }
}

export namespace KibanaGateway {
  /**
   * Fallback context-window map for older Kibana versions whose `/models` route does not
   * return `context_window_size`. Mirrors `knownModels` in Kibana `@kbn/inference-common`;
   * IDs use Elastic's version-first format (e.g. `claude-4.5-sonnet`, `gpt-4.1-mini`).
   * Order matters: specific before general.
   */
  const FALLBACK_CONTEXT_LIMITS: Array<[RegExp, number]> = [
    [/claude-4(?:\.\d+)?-sonnet/, 1_000_000],
    [/claude-(?:3|4)(?:\.\d+)?-(?:sonnet|opus|haiku)/, 200_000],
    [/gpt-4\.1(?:[-.]\w+)?/, 1_000_000],
    [/gpt-4o|gpt-4(?![\.-]?\d)/, 128_000],
    [/(?:^|[-.])o[34](?:-mini|-pro)?(?:[-.]|$)/, 200_000],
    [/gemini-2\.0-pro/, 2_000_000],
    [/gemini-(?:1\.5|2\.5)-pro/, 1_000_000],
    [/gemini-(?:1\.5|2\.0)-flash/, 1_000_000],
    [/gemini-2\.5-flash/, 128_000],
  ]

  export type ConnectorRow = { id: string; owned_by?: string; context_window_size?: number }

  export function connectorContextLimit(id: string): number | undefined {
    const lower = id.toLowerCase()
    for (const [re, ctx] of FALLBACK_CONTEXT_LIMITS) if (re.test(lower)) return ctx
    return undefined
  }

  /**
   * Context window for a connector row: API value, then static fallback by id, then template
   * default. Always returns a concrete number — never `undefined` — so refresh paths reset
   * `limit.context` instead of carrying forward whatever the previous default had set
   * (e.g. an unknown connector cloned from a 1M Sonnet default would otherwise inherit 1M).
   */
  function rowContextLimit(row: ConnectorRow | undefined, id: string): number {
    return row?.context_window_size ?? connectorContextLimit(id) ?? template.limit.context
  }

  function withContext<L extends { context: number }>(limit: L, ctx: number): L {
    return { ...limit, context: ctx }
  }

  /** Inference connector ids look like `.anthropic-claude-4.5-haiku-chat_completion` — shorten for UI labels. */
  export function connectorDisplayName(id: string) {
    let base = id.replace(/^\./, "").replace(/(?:-chat_completion|_chat_completion)$/i, "")
    base = base.replace(/_/g, "-")
    return base
      .split("-")
      .filter((w) => w.length > 0)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  }

  /**
   * Resolve a model entry when `modelID` is either the catalog key (`default`) or the inference
   * connector id (`api.id`). The gateway omits a duplicate row for the Agent Builder default
   * connector, so only `models.default` exists while messages may still carry the resolved id.
   */
  export function resolveKibanaModel<M extends { api?: { id?: string } }>(
    models: Record<string, M> | undefined,
    modelID: string,
  ): M | undefined {
    if (!models) return undefined
    const direct = models[modelID]
    if (direct) return direct
    const def = models["default"]
    if (def?.api?.id === modelID) return def
    return undefined
  }

  export function authHeaders(apiKey: string) {
    return {
      Authorization: `ApiKey ${apiKey}`,
      "kbn-xsrf": "true",
      "x-elastic-internal-origin": "kibana",
      "elastic-api-version": "2023-10-31",
    }
  }

  /** Kibana origin + the elastic_ramen v1 prefix; trailing slash on origin is stripped. */
  export function gatewayBaseUrl(kibanaUrl: string) {
    return kibanaUrl.replace(/\/+$/, "") + "/internal/elastic_ramen/v1"
  }

  /** Public Agent Builder API root (`/api/agent_builder`), same as Kibana `publicApiPath`. */
  export function agentBuilderApiRoot(kibanaUrl: string) {
    return kibanaUrl.replace(/\/+$/, "") + "/api/agent_builder"
  }

  export type AgentBuilderSkillListItem = {
    id: string
    name: string
    description: string
  }

  /** Full skill from GET /api/agent_builder/skills/{id} (public API body). */
  export type AgentBuilderSkillDetail = AgentBuilderSkillListItem & {
    content: string
    referenced_content: { name: string; relativePath: string; content: string }[]
  }

  /** List skills (built-in, user, and optionally plugin skills). */
  export async function tryFetchAgentBuilderSkillList(
    kibanaUrl: string,
    apiKey: string,
    opts?: { includePlugins?: boolean },
  ) {
    const include = opts?.includePlugins ?? true
    const url = new URL(`${agentBuilderApiRoot(kibanaUrl)}/skills`)
    url.searchParams.set("include_plugins", include ? "true" : "false")
    const json = await tryFetchJson<{ results?: unknown }>(url, authHeaders(apiKey))
    if (!json || !Array.isArray(json.results)) return undefined
    const out: AgentBuilderSkillListItem[] = []
    for (const row of json.results) {
      if (!row || typeof row !== "object") continue
      const o = row as Record<string, unknown>
      const id = o.id
      const name = o.name
      const description = o.description
      if (typeof id !== "string" || id.length === 0) continue
      if (typeof name !== "string" || typeof description !== "string") continue
      out.push({ id, name, description })
    }
    return out
  }

  /** Full skill definition for local sync (markdown source). */
  export async function tryFetchAgentBuilderSkill(
    kibanaUrl: string,
    apiKey: string,
    skillId: string,
  ) {
    const json = await tryFetchJson<Record<string, unknown>>(
      `${agentBuilderApiRoot(kibanaUrl)}/skills/${encodeURIComponent(skillId)}`,
      authHeaders(apiKey),
    )
    if (!json) return undefined
    const id = json.id
    const name = json.name
    const description = json.description
    const content = json.content
    if (typeof id !== "string" || typeof name !== "string" || typeof description !== "string") return undefined
    if (typeof content !== "string") return undefined
    const ref = json.referenced_content
    const referenced: AgentBuilderSkillDetail["referenced_content"] = []
    if (Array.isArray(ref)) {
      for (const r of ref) {
        if (!r || typeof r !== "object") continue
        const x = r as Record<string, unknown>
        const n = x.name
        const rel = x.relativePath
        const c = x.content
        if (typeof n === "string" && typeof rel === "string" && typeof c === "string") {
          referenced.push({ name: n, relativePath: rel, content: c })
        }
      }
    }
    return {
      id,
      name,
      description,
      content,
      referenced_content: referenced,
    } satisfies AgentBuilderSkillDetail
  }

  function parseConnectorRow(row: Record<string, unknown>): ConnectorRow | undefined {
    if (typeof row.id !== "string" || row.id.length === 0) return undefined
    return {
      id: row.id,
      owned_by: typeof row.owned_by === "string" ? row.owned_by : undefined,
      context_window_size:
        typeof row.context_window_size === "number" && row.context_window_size > 0
          ? row.context_window_size
          : undefined,
    }
  }

  export async function fetchConnectors(kibanaUrl: string, apiKey: string) {
    const res = await fetch(`${gatewayBaseUrl(kibanaUrl)}/models`, {
      headers: authHeaders(apiKey),
    })
    if (!res.ok) return [] as ConnectorRow[]
    const json = (await res.json()) as { data?: Record<string, unknown>[] }
    const rows = json.data
    if (!Array.isArray(rows)) return []
    const out: ConnectorRow[] = []
    for (const row of rows) {
      const parsed = parseConnectorRow(row)
      if (parsed) out.push(parsed)
    }
    return out
  }

  /**
   * First connector for the agent_builder feature — matches Kibana `resolveModelsForFeature` ordering
   * (Gen AI default connector setting, then feature endpoints, then catalog). Used so Ramen's
   * `kibana/default` sends the same connector id Agent Builder would pick.
   */
  export async function tryFetchAgentBuilderDefaultConnectorId(kibanaUrl: string, apiKey: string) {
    const base = kibanaUrl.replace(/\/+$/, "")
    const q = new URLSearchParams({ featureId: agentBuilderFeature })
    const json = await tryFetchJson<{ connectors?: { connectorId?: string }[] }>(
      `${base}/internal/search_inference_endpoints/connectors?${q}`,
      { ...authHeaders(apiKey), "elastic-api-version": "1" },
    )
    if (!json || !Array.isArray(json.connectors) || json.connectors.length === 0) return undefined
    const id = json.connectors[0]?.connectorId
    if (typeof id !== "string" || id.length === 0) return undefined
    return id
  }

  /** Like `fetchConnectors`, but returns `undefined` when the request fails so callers can keep existing models. */
  export async function tryFetchConnectors(kibanaUrl: string, apiKey: string) {
    const json = await tryFetchJson<{ data?: Record<string, unknown>[] }>(
      `${gatewayBaseUrl(kibanaUrl)}/models`,
      authHeaders(apiKey),
    )
    if (!json || !Array.isArray(json.data)) return undefined
    const out: ConnectorRow[] = []
    for (const row of json.data) {
      const parsed = parseConnectorRow(row)
      if (parsed) out.push(parsed)
    }
    return out
  }

  /**
   * Replace `provider.models` with live inference connectors from Kibana.
   * No-op if baseURL / ApiKey header are missing or the models request fails.
   */
  export async function refreshKibanaProviderModels(provider: {
    options: Record<string, unknown>
    models: Record<string, any>
  }) {
    const raw = provider.options["baseURL"]
    if (typeof raw !== "string") return
    const origin = raw.replace(/\/+$/, "").replace(/\/internal\/elastic_ramen\/v1$/i, "")
    const headers = provider.options["headers"] as Record<string, string> | undefined
    const auth = headers?.Authorization
    if (typeof auth !== "string" || !auth.startsWith("ApiKey ")) return
    const key = auth.slice("ApiKey ".length).trim()
    const [rows, resolved] = await Promise.all([
      tryFetchConnectors(origin, key),
      tryFetchAgentBuilderDefaultConnectorId(origin, key),
    ])
    if (rows === undefined) return
    const ids = Object.keys(provider.models)
    const baseKey = ids.includes("default") ? "default" : ids[0]
    if (!baseKey) return
    const base = provider.models[baseKey]
    if (!base) return
    const apiId = resolved ?? "default"
    const next: Record<string, any> = {}
    const prev = (provider.models["default"] ?? structuredClone(base)) as Record<string, any>
    next.default = {
      ...prev,
      id: apiId,
      name: resolved ? `${connectorDisplayName(resolved)} (default)` : "Default Connector",
      api: { ...(prev.api as object), id: apiId },
      limit: withContext(prev.limit, rowContextLimit(rows.find((r) => r.id === apiId), apiId)),
    }
    for (const row of rows) {
      if (row.id === "default" || row.id === apiId) continue
      const copy = structuredClone(base)
      copy.id = row.id
      copy.name = connectorDisplayName(row.id)
      copy.api = { ...copy.api, id: row.id }
      copy.providerID = "kibana"
      copy.limit = withContext(copy.limit, rowContextLimit(row, row.id))
      next[row.id] = copy
    }
    provider.models = next
  }

  /** OpenAI-compatible provider block for `elastic_ramen.json`; merges inference connectors from GET …/v1/models. */
  export async function buildProvider(kibanaUrl: string, apiKey: string) {
    const baseURL = gatewayBaseUrl(kibanaUrl)
    const [connectors, resolved] = await Promise.all([
      fetchConnectors(kibanaUrl, apiKey),
      tryFetchAgentBuilderDefaultConnectorId(kibanaUrl, apiKey),
    ])
    const apiId = resolved ?? "default"
    const models: Record<string, Record<string, unknown>> = {
      default: {
        id: apiId,
        name: resolved ? `${connectorDisplayName(resolved)} (default)` : "Default Connector",
        ...template,
        limit: withContext(template.limit, rowContextLimit(connectors.find((r) => r.id === apiId), apiId)),
      },
    }
    for (const row of connectors) {
      if (row.id === "default" || row.id === apiId) continue
      models[row.id] = {
        id: row.id,
        name: connectorDisplayName(row.id),
        ...template,
        limit: withContext(template.limit, rowContextLimit(row, row.id)),
      }
    }
    return {
      kibana: {
        name: "Kibana LLM Gateway",
        id: "kibana",
        npm: "@ai-sdk/openai-compatible",
        env: [],
        models,
        options: {
          baseURL,
          apiKey: "ignored",
          headers: { ...authHeaders(apiKey) },
        },
      },
    }
  }
}
