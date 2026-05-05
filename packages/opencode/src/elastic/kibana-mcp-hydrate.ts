// Copyright (c) 2026-present, Elastic NV
import { ElasticAuth } from "./auth"
import { KibanaGateway } from "./kibana-gateway"

/** Narrow shape merged config before full zod validation cycles. */
type Target = { mcp?: Record<string, unknown>; permission?: Record<string, unknown> }

/** Default Agent Builder MCP entry name in ramen config. */
export const agentBuilderMcpKey = "eab"

function isLegacyElasticCliProxy(m: unknown): boolean {
  if (!m || typeof m !== "object") return false
  const o = m as { type?: unknown; command?: unknown }
  if (o.type !== "local") return false
  if (!Array.isArray(o.command)) return false
  const parts = o.command.map((x) => String(x))
  if (parts[0] !== "elastic") return false
  return parts.includes("mcp") && parts.includes("proxy")
}

function agentBuilderApiRoot(kibanaUrl: string) {
  return kibanaUrl.replace(/\/+$/, "") + "/api/agent_builder"
}

function wantMcpUrl(kb: string) {
  return `${agentBuilderApiRoot(kb)}/mcp`
}

function isOurKibanaRemote(m: { type?: unknown; url?: unknown }, kb: string): boolean {
  if (m.type !== "remote" || typeof m.url !== "string") return false
  return m.url === wantMcpUrl(kb)
}

function ensureEabPermission(cfg: Target) {
  if (!cfg.permission) cfg.permission = {}
  if (cfg.permission["eab_*"] === undefined) cfg.permission["eab_*"] = "allow"
}

/**
 * Wire the default `eab` MCP to Kibana's Agent Builder HTTP MCP endpoint using
 * credentials from the Elastic CLI profile (`~/.../elastic/config.yaml`), instead of
 * spawning `elastic ab mcp proxy`.
 */
export async function hydrateKibanaAgentBuilderMcp(cfg: Target) {
  const eab = cfg.mcp?.[agentBuilderMcpKey]
  if (eab && typeof eab === "object" && "enabled" in eab && (eab as { enabled?: boolean }).enabled === false) return

  if (cfg.mcp?.[agentBuilderMcpKey] && isLegacyElasticCliProxy(cfg.mcp[agentBuilderMcpKey])) {
    const next = { ...cfg.mcp }
    delete next[agentBuilderMcpKey]
    if (Object.keys(next).length === 0) delete cfg.mcp
    else cfg.mcp = next
  }

  const st = await ElasticAuth.check()
  const kb = st.context?.kibana_url
  const key = st.context?.api_key
  if (!st.configured || !kb || !key) return

  const cur = cfg.mcp?.[agentBuilderMcpKey]
  if (cur && typeof cur === "object") {
    const o = cur as { type?: unknown; url?: unknown }
    if (o.type === "remote" && typeof o.url === "string" && !isOurKibanaRemote(o, kb)) return
    if (o.type === "local") return
  }

  cfg.mcp ??= {}
  ;(cfg.mcp as Record<string, unknown>)[agentBuilderMcpKey] = {
    type: "remote",
    url: wantMcpUrl(kb),
    oauth: false,
    enabled: true,
    headers: KibanaGateway.authHeaders(key),
    timeout: 60_000,
  }
  ensureEabPermission(cfg)
}
