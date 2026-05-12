// Copyright (c) 2026-present, Elastic NV
import path from "path"
import { Config } from "@/config/config"
import { KibanaClient } from "./client"
import { Handover } from "./handover"
import { AbAgent } from "./ab-agent"
import { kibanaSkillSlug } from "./kibana-skills-sync"

const KIBANA_TOOL_PREFIX = "kibana_"
const CACHE_MS = 120_000

/** Subset of Kibana {@link AgentConfiguration} from GET /api/agent_builder/agents/:id */
export type Cfg = {
  tools: { tool_ids: string[] }[]
  skill_ids?: string[]
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
   * Configured Agent Builder agent for RAMEN tools/skills/prompts.
   *
   * Order: explicit `kibana.agent_builder_agent_id` in merged config (from `/kibana-agent`) wins over
   * {@link Handover} link metadata — otherwise user switches agent but a prior mirror link still
   * carries `elastic-ai-agent`. If neither is set, {@link AbAgent.preferred()} (builtin default).
   */
  export async function effectiveAgentId(sessionID: string): Promise<string> {
    try {
      const cfg = await Config.get()
      const raw = cfg.kibana?.agent_builder_agent_id
      if (typeof raw === "string" && raw.trim()) return raw.trim()
    } catch {
      /* no Instance — fall through */
    }
    const link = await Handover.resolve(sessionID)
    if (link?.agentID) return link.agentID
    return AbAgent.preferred()
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
    cache.set(agentId, { at: now, cfg, name })
    return { cfg, name }
  }

  export async function getConfiguration(agentId: string): Promise<Cfg | null> {
    return (await getAgentMeta(agentId)).cfg
  }

  /** When `cfg` is null (fetch failed), do not strip Kibana tools. */
  export function toolAllows(cfg: Cfg | null, toolId: string): boolean {
    if (!toolId.startsWith(KIBANA_TOOL_PREFIX)) return true
    if (!cfg) return true
    if (!cfg.tools.length) return false
    const flat = cfg.tools.flatMap((x) => x.tool_ids)
    if (flat.includes("*")) return true
    return flat.includes(toolId)
  }

  export async function toolPredicate(sessionID: string): Promise<(id: string) => boolean> {
    const aid = await effectiveAgentId(sessionID)
    const c = await getConfiguration(aid)
    return (id: string) => toolAllows(c, id)
  }

  const KIBANA_SKILL_MARKER = `${path.sep}skill${path.sep}kibana${path.sep}`

  function kibanaSlugFromLocation(loc: string): string | undefined {
    const idx = loc.indexOf(KIBANA_SKILL_MARKER)
    if (idx === -1) return undefined
    const tail = loc.slice(idx + KIBANA_SKILL_MARKER.length)
    const parts = tail.split(/[/\\]+/).filter(Boolean)
    if (parts.length < 2) return undefined
    return parts[1]
  }

  /**
   * When `skill_ids` is unset (Kibana default: all skills), do not filter.
   * When set to `[]`, no Kibana-synced skills are advertised.
   */
  export function skillAllows(cfg: Cfg | null, skillLocation: string): boolean {
    if (!cfg || cfg.skill_ids === undefined) return true
    const slug = kibanaSlugFromLocation(skillLocation)
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
   * Always returns a block so the model knows which Kibana Agent Builder agent applies — even when
   * the agent has no custom `instructions` text (tools/skills may still be scoped in Kibana).
   */
  export async function instructionBlock(sessionID: string): Promise<string> {
    try {
      const aid = await effectiveAgentId(sessionID)
      const { cfg, name } = await getAgentMeta(aid)
      const sections: string[] = []
      sections.push(
        `The active Kibana Agent Builder agent for this RAMEN session is **${name ?? aid}** (agent id: \`${aid}\`). ` +
          `If the user asks which Agent Builder agent is in use, state this id and name. ` +
          `Native \`kibana_*\` tools and Kibana-synced skills follow this agent's configuration in Kibana.`,
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
