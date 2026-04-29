// Copyright (c) 2026-present, Elastic NV

/** YAML-safe profile key (Elastic config context name). */
function safeProfileKey(raw: string): string {
  const t = raw
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
  if (!t) return "default"
  return t.length > 64 ? t.slice(0, 64) : t
}

/**
 * Profile name from Kibana URL: Elastic Cloud `name-hash.kb.<region>...` → `name`;
 * otherwise first hostname label (e.g. kibana.example.com → kibana).
 */
export function profileNameFromKibanaUrl(url: string): string {
  try {
    const u = new URL(url.trim().replace(/\/+$/, ""))
    const host = u.hostname
    const kb = host.match(/^([^.]+)\.kb\.[^.]+\./)
    if (kb?.[1]) {
      const id = kb[1]
      const i = id.indexOf("-")
      const base = i > 0 ? id.slice(0, i) : id
      return safeProfileKey(base)
    }
    const first = host.split(".")[0] ?? ""
    if (first) return safeProfileKey(first)
  } catch {}
  return "default"
}

/** When there is no Kibana URL, derive from Elasticsearch URL (Cloud `name-hash.es.<region>...` → `name`). */
export function profileNameFromElasticsearchUrl(url: string): string {
  try {
    const u = new URL(url.trim().replace(/\/+$/, ""))
    const host = u.hostname
    const es = host.match(/^([^.]+)\.es\.[^.]+\./)
    if (es?.[1]) {
      const id = es[1]
      const i = id.indexOf("-")
      const base = i > 0 ? id.slice(0, i) : id
      return safeProfileKey(base)
    }
    const first = host.split(".")[0] ?? ""
    if (first) return safeProfileKey(first)
  } catch {}
  return "default"
}

export function profileNameFromSetup(kibanaUrl?: string, elasticsearchUrl?: string): string {
  if (kibanaUrl) return profileNameFromKibanaUrl(kibanaUrl)
  if (elasticsearchUrl) return profileNameFromElasticsearchUrl(elasticsearchUrl)
  return "default"
}

/** OpenCode provider block for the Kibana LLM gateway (same shape as onboarding JSON). */
export function kibanaProvider(kibanaUrl: string, apiKey: string) {
  const baseURL = kibanaUrl.replace(/\/+$/, "") + "/internal/elastic_ramen/v1"
  return {
    kibana: {
      name: "Kibana LLM Gateway",
      id: "kibana",
      npm: "@ai-sdk/openai-compatible",
      env: [],
      models: {
        default: {
          id: "default",
          name: "Default Connector",
          attachment: false,
          reasoning: false,
          temperature: true,
          tool_call: true,
          release_date: "2025-01-01",
          cost: { input: 0, output: 0 },
          limit: { context: 128000, output: 8192 },
        },
      },
      options: {
        baseURL,
        apiKey: "ignored",
        headers: {
          Authorization: `ApiKey ${apiKey}`,
          "kbn-xsrf": "true",
          "x-elastic-internal-origin": "kibana",
          "elastic-api-version": "2023-10-31",
        },
      },
    },
  }
}
