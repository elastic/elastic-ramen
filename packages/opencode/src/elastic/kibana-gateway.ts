// Copyright (c) 2026-present, Elastic NV
/** Kibana elastic_ramen internal routes: list connectors as OpenAI-style models, chat uses `model` = connector id. */

const template = {
  attachment: false,
  reasoning: false,
  temperature: true,
  tool_call: true,
  release_date: "2025-01-01",
  cost: { input: 0, output: 0 },
  limit: { context: 128000, output: 8192 },
} as const

export namespace KibanaGateway {
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

  export function authHeaders(apiKey: string) {
    return {
      Authorization: `ApiKey ${apiKey}`,
      "kbn-xsrf": "true",
      "x-elastic-internal-origin": "kibana",
      "elastic-api-version": "2023-10-31",
    }
  }

  export async function fetchConnectors(kibanaUrl: string, apiKey: string) {
    const base = kibanaUrl.replace(/\/+$/, "")
    const res = await fetch(`${base}/internal/elastic_ramen/v1/models`, {
      headers: authHeaders(apiKey),
    })
    if (!res.ok) return [] as { id: string; owned_by?: string }[]
    const json = (await res.json()) as { data?: { id?: string; owned_by?: string }[] }
    const rows = json.data
    if (!Array.isArray(rows)) return []
    const out: { id: string; owned_by?: string }[] = []
    for (const row of rows) {
      if (typeof row.id !== "string" || row.id.length === 0) continue
      out.push({
        id: row.id,
        owned_by: typeof row.owned_by === "string" ? row.owned_by : undefined,
      })
    }
    return out
  }

  /** Like `fetchConnectors`, but returns `undefined` when the request fails so callers can keep existing models. */
  export async function tryFetchConnectors(kibanaUrl: string, apiKey: string) {
    const base = kibanaUrl.replace(/\/+$/, "")
    const res = await fetch(`${base}/internal/elastic_ramen/v1/models`, {
      headers: authHeaders(apiKey),
    })
    if (!res.ok) return undefined
    const json = (await res.json()) as { data?: { id?: string; owned_by?: string }[] }
    const rows = json.data
    if (!Array.isArray(rows)) return undefined
    const out: { id: string; owned_by?: string }[] = []
    for (const row of rows) {
      if (typeof row.id !== "string" || row.id.length === 0) continue
      out.push({
        id: row.id,
        owned_by: typeof row.owned_by === "string" ? row.owned_by : undefined,
      })
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
    const rows = await tryFetchConnectors(origin, key)
    if (rows === undefined) return
    const ids = Object.keys(provider.models)
    const baseKey = ids.includes("default") ? "default" : ids[0]
    if (!baseKey) return
    const base = provider.models[baseKey]
    if (!base) return
    const next: Record<string, any> = {}
    if (provider.models["default"]) next.default = provider.models["default"]
    else {
      const copy = structuredClone(base)
      next.default = {
        ...copy,
        id: "default",
        name: "Default Connector",
        api: { ...copy.api, id: "default" },
      }
    }
    for (const row of rows) {
      if (row.id === "default") continue
      const copy = structuredClone(base)
      copy.id = row.id
      copy.name = connectorDisplayName(row.id)
      copy.api = { ...copy.api, id: row.id }
      copy.providerID = "kibana"
      next[row.id] = copy
    }
    provider.models = next
  }

  /** OpenAI-compatible provider block for `elastic_ramen.json`; merges inference connectors from GET …/v1/models. */
  export async function buildProvider(kibanaUrl: string, apiKey: string) {
    const baseURL = kibanaUrl.replace(/\/+$/, "") + "/internal/elastic_ramen/v1"
    const connectors = await fetchConnectors(kibanaUrl, apiKey)
    const models: Record<string, Record<string, unknown>> = {
      default: {
        id: "default",
        name: "Default Connector",
        ...template,
      },
    }
    for (const row of connectors) {
      if (row.id === "default") continue
      models[row.id] = {
        id: row.id,
        name: connectorDisplayName(row.id),
        ...template,
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
