import { KibanaClient } from "./client"
import { Log } from "@/util/log"
import { Storage } from "@/storage/storage"

export namespace Handover {
  const log = Log.create({ service: "handover" })

  const mapping = new Map<string, string>()

  export interface Pending {
    id: string
    title: string
    conversation: KibanaClient.Conversation
  }

  export function format(conv: KibanaClient.Conversation): string {
    const lines = [`Continuing from Kibana Agent Builder session: "${conv.title}"`, "", "Previous conversation:", "---"]
    for (const round of conv.rounds) {
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

  export function rounds(conv: KibanaClient.Conversation) {
    return conv.rounds.map((r) => ({
      input: r.input.message,
      output: r.response.message,
      started: r.started_at,
    }))
  }

  export function round(input: { id: string; user: string; assistant: string; started?: string; steps?: KibanaClient.ConversationRound["steps"] }): KibanaClient.ConversationRound {
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

  export function link(sessionID: string, conversationID: string) {
    mapping.set(sessionID, conversationID)
    Storage.write(["kibana_link", sessionID], conversationID).catch(() => {})
  }

  export async function resolve(sessionID: string): Promise<string | undefined> {
    const cached = mapping.get(sessionID)
    if (cached) return cached
    const stored = await Storage.read<string>(["kibana_link", sessionID]).catch(() => undefined)
    if (stored) mapping.set(sessionID, stored)
    return stored
  }

  export async function sync(sessionID: string, title: string, rounds: KibanaClient.ConversationRound[]) {
    if (!rounds.length) return
    const existing = await resolve(sessionID)
    if (existing) {
      log.info("updating kibana conversation", { sessionID, conversationID: existing })
      await KibanaClient.conversations().update(existing, {
        title: `Elastic Console: ${title}`,
        rounds,
      })
      return
    }
    log.info("creating kibana conversation", { sessionID })
    const res = await KibanaClient.conversations().create({
      agent_id: "elastic-ai-agent",
      title: `Elastic Console: ${title}`,
      rounds,
    })
    link(sessionID, res.conversation.id)
  }

  export async function list(opts?: { agent_id?: string; handover_requested?: boolean }) {
    return KibanaClient.conversations().list(opts)
  }

  export async function get(id: string) {
    return KibanaClient.conversations().get(id)
  }

  export async function clear(id: string) {
    return KibanaClient.conversations().handover(id, false)
  }

  export function poller(interval = 5_000) {
    let timer: ReturnType<typeof setInterval> | undefined
    let cb: ((items: Pending[]) => void | Promise<void>) | undefined
    let running = false
    const seen = new Set<string>()

    const tick = async () => {
      if (running) return
      running = true
      try {
        const res = await KibanaClient.conversations().list({ handover_requested: true })
        if (!res.results.length) return

        const fresh: Pending[] = []
        for (const summary of res.results) {
          if (seen.has(summary.id)) continue
          try {
            const conv = await KibanaClient.conversations().get(summary.id)
            seen.add(summary.id)
            fresh.push({ id: summary.id, title: summary.title, conversation: conv })
          } catch (err) {
            log.warn("handover pickup failed", { id: summary.id, error: err instanceof Error ? err.message : String(err) })
          }
        }
        if (fresh.length) await cb?.(fresh)
      } catch (err) {
        log.warn("handover poll failed", { error: err instanceof Error ? err.message : String(err) })
      } finally {
        running = false
      }
    }

    return {
      on(handler: (items: Pending[]) => void | Promise<void>) {
        cb = handler
        return this
      },
      start() {
        if (timer) return this
        tick()
        timer = setInterval(tick, interval)
        return this
      },
      stop() {
        if (timer) clearInterval(timer)
        timer = undefined
      },
    }
  }
}
