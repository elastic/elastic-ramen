// Copyright (c) 2026-present, Elastic NV
import { KibanaClient, type ConversationRound, type Conversation } from "./client"
import { Bootstrap } from "./bootstrap"
import { Log } from "@/util/log"
import { Storage } from "@/storage/storage"
import { SessionProfile } from "./session-profile"

export namespace Handover {
  const log = Log.create({ service: "handover" })

  /**
   * Kibana client throws `Error("Kibana <status>: …")` from `client.ts:77`.
   * Match the prefix to detect a stale conversation ID after the user switches
   * profiles on a legacy session whose `kibana_link` was issued by another cluster.
   */
  function isNotFound(err: unknown): boolean {
    return err instanceof Error && err.message.startsWith("Kibana 404")
  }

  function unlink(sessionID: string) {
    mapping.delete(sessionID)
    Storage.remove(["kibana_link", sessionID]).catch(() => {})
  }

  function conversations() {
    return KibanaClient.conversations()
  }

  const DEFAULT_AGENT_ID = "elastic-ai-agent"

  export interface Link {
    conversationID: string
    agentID: string
  }

  const mapping = new Map<string, Link>()

  function normalize(stored: unknown): Link | undefined {
    if (!stored) return undefined
    if (typeof stored === "string") return { conversationID: stored, agentID: DEFAULT_AGENT_ID }
    if (typeof stored === "object" && "conversationID" in stored && typeof (stored as Link).conversationID === "string") {
      const s = stored as Link
      return { conversationID: s.conversationID, agentID: s.agentID || DEFAULT_AGENT_ID }
    }
    return undefined
  }

  export function format(conv: Conversation): string {
    const lines = [`Continuing from Kibana Agent Builder conversation: "${conv.title}"`, "", "Previous conversation:", "---"]
    for (const round of conv.conversation_rounds) {
      lines.push(`User: ${round.input.message}`)
      for (const step of round.steps) {
        if (step.type === "tool_call") {
          lines.push(`[Tool: ${step.tool_id}]`)
          for (const r of step.results) if (r.value) lines.push(`  Result: ${r.value.slice(0, 500)}`)
        }
        if (step.type === "reasoning") lines.push(`[Thinking: ${step.reasoning.slice(0, 300)}]`)
      }
      lines.push(`Assistant: ${round.response.message}`)
      lines.push("---")
    }
    return lines.join("\n")
  }

  export function rounds(conv: Conversation) {
    return conv.conversation_rounds.map((r) => ({
      input: r.input.message,
      output: r.response.message,
      started: r.started_at,
    }))
  }

  export function round(input: { id: string; user: string; assistant: string; started?: string; steps?: ConversationRound["steps"] }): ConversationRound {
    return {
      id: input.id,
      status: "completed",
      input: { message: input.user },
      steps: input.steps ?? [],
      response: { message: input.assistant },
      started_at: input.started ?? new Date().toISOString(),
      time_to_first_token: 0,
      time_to_last_token: 0,
      model_usage: { connector_id: "opencode", llm_calls: 1, input_tokens: 0, output_tokens: 0 },
    }
  }

  export function link(sessionID: string, conversationID: string, agentID: string = DEFAULT_AGENT_ID) {
    const record: Link = { conversationID, agentID }
    mapping.set(sessionID, record)
    Storage.write(["kibana_link", sessionID], record).catch(() => {})
  }

  export function url(base: string, link: Link): string {
    return `${base.replace(/\/+$/, "")}/app/agent_builder/agents/${encodeURIComponent(link.agentID)}/conversations/${encodeURIComponent(link.conversationID)}`
  }

  export async function resolve(sessionID: string): Promise<Link | undefined> {
    const cached = mapping.get(sessionID)
    if (cached) return cached
    const stored = await Storage.read<unknown>(["kibana_link", sessionID]).catch(() => undefined)
    const record = normalize(stored)
    if (record) mapping.set(sessionID, record)
    return record
  }

  export interface SyncOptions {
    /** Called once if a 503 forces a kickstart. */
    onKickstart?: () => void
    /** Called when a session is stamped to a different active Elastic profile. */
    onProfileMismatch?: (info: { stamp: string; active: string }) => void
  }

  export async function sync(
    sessionID: string,
    title: string,
    conversationRounds: ConversationRound[],
    opts?: SyncOptions,
  ) {
    if (!conversationRounds.length) return
    try {
      await write(sessionID, title, conversationRounds, opts)
    } catch (err) {
      if (!Bootstrap.isNotInitializedError(err)) throw err
      log.info("storage not initialized, kickstarting")
      opts?.onKickstart?.()
      await Bootstrap.kickstart()
      await write(sessionID, title, conversationRounds, opts)
    }
  }

  async function write(sessionID: string, title: string, conversationRounds: ConversationRound[], opts?: SyncOptions) {
    // Bind legacy (pre-stamp) sessions to whichever profile is active right now,
    // and refuse to write if the session belongs to a different profile —
    // entry points like `--session=<id>` or `/sessions` selection on a legacy
    // session can otherwise route a write to the wrong cluster.
    const stamp = await SessionProfile.ensureStamp(sessionID)
    const active = await SessionProfile.active()
    if (stamp && active && stamp !== active) {
      log.info("skipping conversation sync — session belongs to another profile", { sessionID, stamp, active })
      opts?.onProfileMismatch?.({ stamp, active })
      return
    }

    const existing = await resolve(sessionID)
    const api = conversations()
    if (existing) {
      log.info("updating elasticsearch conversation", { sessionID, conversationID: existing.conversationID })
      try {
        await api.update(existing.conversationID, {
          title: `RAMEN: ${title}`,
          conversation_rounds: conversationRounds,
        })
        return
      } catch (err) {
        if (!isNotFound(err)) throw err
        // Stale link: the conversation lived in another cluster (legacy session
        // first synced before stamping shipped) or was deleted server-side.
        // Drop the link and fall through to create a fresh conversation here.
        log.info("kibana_link stale, recreating conversation", { sessionID, conversationID: existing.conversationID })
        unlink(sessionID)
      }
    }
    log.info("creating elasticsearch conversation", { sessionID })
    const res = await api.create({
      agent_id: DEFAULT_AGENT_ID,
      title: `RAMEN: ${title}`,
      conversation_rounds: conversationRounds,
    })
    link(sessionID, res.id, DEFAULT_AGENT_ID)
  }

  export async function list(opts?: { agent_id?: string }) {
    const api = conversations()
    return api.list(opts)
  }

  export async function get(id: string) {
    const api = conversations()
    return api.get(id)
  }
}
