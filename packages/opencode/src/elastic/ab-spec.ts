// Copyright (c) 2026-present, Elastic NV
import { Config } from "@/config/config"
import { KibanaClient } from "./client"
import { Handover } from "./handover"
import { AbAgent } from "./ab-agent"
import { ElasticAuth } from "./auth"
import { KibanaGateway } from "./kibana-gateway"
import { kibanaSkillSlug, kibanaSyncedSkillFolderSlug } from "./kibana-skills-sync"

const KIBANA_TOOL_PREFIX = "kibana_"
/** MCP registry keys from {@link MCP.tools}: `eab` × Agent Builder proxy × sanitized tool name. */
const EAB_MCP_PREFIX = "eab_"
const CACHE_MS = 120_000

/** Subset of Kibana {@link AgentConfiguration} from GET /api/agent_builder/agents/:id */
export type Cfg = {
  tools: { tool_ids: string[] }[]
  skill_ids?: string[]
  /** Per GET /api/agent_builder/skills/{id}: tools attached to that skill (may be deferred until skill load). */
  skill_tools?: Record<string, string[]>
  instructions?: string
  research?: string
  answer?: string
}

const cache = new Map<string, { at: number; cfg: Cfg | null; name?: string }>()

function parseAgent(raw: unknown): Cfg | null {
  if (!raw || typeof raw !== "object") return null
  const c = (raw as Record<string, unknown>).configuration
  if (!c || typeof c !== "object") return null
  const cfg = c as Record<string, unknown>
  const tools: { tool_ids: string[] }[] = []
  if (Array.isArray(cfg.tools)) {
    for (const t of cfg.tools) {
      if (!t || typeof t !== "object") continue
      const ids = (t as Record<string, unknown>).tool_ids
      if (!Array.isArray(ids)) continue
      tools.push({ tool_ids: ids.map((x) => String(x)) })
    }
  }
  const skill_ids = Array.isArray(cfg.skill_ids) ? cfg.skill_ids.map((x) => String(x)) : undefined
  const research =
    cfg.research && typeof cfg.research === "object"
      ? (cfg.research as Record<string, unknown>).instructions
      : undefined
  const answer =
    cfg.answer && typeof cfg.answer === "object" ? (cfg.answer as Record<string, unknown>).instructions : undefined
  return {
    tools,
    skill_ids,
    instructions: typeof cfg.instructions === "string" ? cfg.instructions : undefined,
    research: typeof research === "string" ? research : undefined,
    answer: typeof answer === "string" ? answer : undefined,
  }
}

function displayName(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const n = (raw as Record<string, unknown>).name
  return typeof n === "string" && n.trim() ? n.trim() : undefined
}

export namespace AbSpec {
  export function bust() {
    cache.clear()
  }

  /**
   * Agent Builder agent for RAMEN tools/skills/prompts for a given session.
   *
   * Order: {@link Handover} link metadata wins — it reflects the agent the Kibana conversation was
   * actually created under, which is the one {@link Handover.write} will keep updating. Falling back
   * to config first would scope prompts/tools to a different agent than the conversation in Kibana.
   * Unlinked/new sessions fall through to `kibana.agent_builder_agent_id` from merged config (set via
   * `/kibana-agent`), then the builtin default — same precedence {@link Handover.write} uses when
   * creating a fresh conversation.
   */
  export async function effectiveAgentId(sessionID: string): Promise<string> {
    const link = await Handover.resolve(sessionID)
    if (link?.agentID) return link.agentID
    try {
      const cfg = await Config.get()
      const raw = cfg.kibana?.agent_builder_agent_id
      if (typeof raw === "string" && raw.trim()) return raw.trim()
    } catch {
      /* no Instance — fall through */
    }
    return AbAgent.builtin
  }

  export async function getAgentMeta(agentId: string): Promise<{ cfg: Cfg | null; name?: string }> {
    const now = Date.now()
    const hit = cache.get(agentId)
    if (hit && now - hit.at < CACHE_MS) return { cfg: hit.cfg, name: hit.name }

    let cfg: Cfg | null = null
    let name: string | undefined
    try {
      const raw = await KibanaClient.agents().get(agentId)
      cfg = parseAgent(raw)
      name = displayName(raw)
    } catch {
      cfg = null
    }
    if (cfg?.skill_ids?.length) {
      const auth = await ElasticAuth.check().catch(() => undefined)
      const url = auth?.context?.kibana_url
      const key = auth?.context?.api_key
      if (auth?.configured && url && key) {
        const skill_tools: Record<string, string[]> = {}
        for (const sid of cfg.skill_ids) {
          const ids = await KibanaGateway.tryFetchAgentBuilderSkillToolIds(url, key, sid)
          if (ids?.length) skill_tools[sid] = ids
        }
        if (Object.keys(skill_tools).length > 0) cfg.skill_tools = skill_tools
      }
    }
    cache.set(agentId, { at: now, cfg, name })
    return { cfg, name }
  }

  export async function getConfiguration(agentId: string): Promise<Cfg | null> {
    return (await getAgentMeta(agentId)).cfg
  }

  /**
   * MCP registry suffix matches {@link MCP.tools}: `mcpTool.name` with non-[a-zA-Z0-9_-] replaced by `_`.
   * Kibana returns canonical ids that may contain `.` etc.; compare via sanitizing the Kibana id.
   */
  function kibanaToolIdMatchesMcpBare(mcpBareSuffix: string, kibanaToolId: string): boolean {
    if (kibanaToolId === mcpBareSuffix) return true
    return kibanaToolId.replace(/[^a-zA-Z0-9_-]/g, "_") === mcpBareSuffix
  }

  /**
   * @param loaded When provided, tool ids that appear only under {@link Cfg.skill_tools} require that
   *   Kibana skill to have been loaded via the `skill` tool. When omitted (e.g. batch/CLI), all
   *   skill-linked tools are allowed without a prior load.
   */
  function sessionToolAllowed(cfg: Cfg | null, bareId: string, loaded: Set<string> | undefined): boolean {
    if (!cfg) return true
    const direct = cfg.tools.flatMap((x) => x.tool_ids)
    if (direct.includes("*")) return true
    const directSet = new Set(direct.filter((x) => x !== "*"))
    if (directSet.has(bareId)) return true
    if ([...directSet].some((d) => kibanaToolIdMatchesMcpBare(bareId, d))) return true

    const st = cfg.skill_tools
    if (!st || Object.keys(st).length === 0) return false

    const owners = Object.entries(st)
      .filter(([, ids]) => ids.some((kid) => kibanaToolIdMatchesMcpBare(bareId, kid)))
      .map(([sid]) => sid)
    if (owners.length === 0) return false

    if (loaded === undefined) return true

    return owners.some((sid) => loaded.has(sid))
  }

  /** When `cfg` is null (fetch failed), do not strip Kibana registry or EAB MCP tools. */
  export function toolAllows(cfg: Cfg | null, toolId: string, loaded?: Set<string>) {
    if (!toolId.startsWith(KIBANA_TOOL_PREFIX)) return true
    return sessionToolAllowed(cfg, toolId, loaded)
  }

  /**
   * Agent Builder tools exposed via the `eab` MCP proxy use registry keys `eab_<toolName>` (see
   * {@link MCP.tools}). Same allow rules as {@link toolAllows}.
   */
  export function mcpToolAllows(cfg: Cfg | null, registryKey: string, loaded?: Set<string>) {
    if (!registryKey.startsWith(EAB_MCP_PREFIX)) return true
    return sessionToolAllowed(cfg, registryKey.slice(EAB_MCP_PREFIX.length), loaded)
  }

  export async function toolPredicate(sessionID: string): Promise<(id: string) => boolean> {
    const aid = await effectiveAgentId(sessionID)
    const c = await getConfiguration(aid)
    return (id: string) => toolAllows(c, id, undefined)
  }

  /**
   * When `skill_ids` is unset (Kibana default: all skills), do not filter.
   * When set to `[]`, no Kibana-synced skills are advertised.
   */
  export function skillAllows(cfg: Cfg | null, skillLocation: string): boolean {
    if (!cfg || cfg.skill_ids === undefined) return true
    const slug = kibanaSyncedSkillFolderSlug(skillLocation)
    if (!slug) return true
    if (cfg.skill_ids.length === 0) return false
    return cfg.skill_ids.some((id) => kibanaSkillSlug(id) === slug)
  }

  export async function skillPredicate(sessionID: string): Promise<(loc: string) => boolean> {
    const aid = await effectiveAgentId(sessionID)
    const c = await getConfiguration(aid)
    return (loc: string) => skillAllows(c, loc)
  }

  /**
   * Returns a block describing the active Kibana Agent Builder agent (so the model knows which one
   * applies even when the agent has no custom `instructions` text — tools/skills may still be scoped
   * in Kibana). Returns `""` when Elastic auth is not configured: callers should skip injection.
   */
  export async function instructionBlock(sessionID: string): Promise<string> {
    const auth = await ElasticAuth.check().catch(() => undefined)
    if (!auth?.configured) return ""
    try {
      const aid = await effectiveAgentId(sessionID)
      const { cfg, name } = await getAgentMeta(aid)
      const sections: string[] = []
      sections.push(
        `The active Kibana Agent Builder agent for this RAMEN session is **${name ?? aid}** (agent id: \`${aid}\`). ` +
          `If the user asks which Agent Builder agent is in use, state this id and name. ` +
          `Native \`kibana_*\` tools and \`eab_*\` MCP tools follow the agent's direct tool list in Kibana; tools that exist only on an assigned skill appear after the model loads that skill with the \`skill\` tool in this chat.`,
      )
      if (!cfg) {
        sections.push(
          "RAMEN could not load this agent's full configuration from Kibana (network, auth, or version mismatch). " +
            "Tool/skill filtering may be permissive until the API succeeds.",
        )
      }
      if (cfg?.instructions) sections.push(cfg.instructions)
      if (cfg?.research) sections.push(`### Agent Builder (research step)\n${cfg.research}`)
      if (cfg?.answer) sections.push(`### Agent Builder (answer step)\n${cfg.answer}`)
      return [
        `<kibana_agent_builder agent_id="${aid}">`,
        "",
        sections.join("\n\n"),
        "",
        "</kibana_agent_builder>",
      ].join("\n")
    } catch {
      return [
        "<kibana_agent_builder agent_id=\"unknown\">",
        "",
        "RAMEN could not resolve the Kibana Agent Builder agent for this session (storage or config unavailable).",
        "",
        "</kibana_agent_builder>",
      ].join("\n")
    }
  }
}
