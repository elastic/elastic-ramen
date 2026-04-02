import { KibanaClient, type ConversationRound, type Conversation } from "./client"
import { Log } from "@/util/log"
import { Storage } from "@/storage/storage"

export namespace Handover {
  const log = Log.create({ service: "handover" })

  function conversations() {
    return KibanaClient.conversations()
  }

  const mapping = new Map<string, string>()

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

  export async function sync(sessionID: string, title: string, conversationRounds: ConversationRound[]) {
    if (!conversationRounds.length) return
    const existing = await resolve(sessionID)
    if (existing) {
      log.info("updating elasticsearch conversation", { sessionID, conversationID: existing })
      const api = conversations()
      await api.update(existing, {
        title: `RAMEN: ${title}`,
        conversation_rounds: conversationRounds,
      })
      return
    }
    log.info("creating elasticsearch conversation", { sessionID })
    const api = conversations()
    const res = await api.create({
      agent_id: "elastic-ai-agent",
      title: `RAMEN: ${title}`,
      conversation_rounds: conversationRounds,
    })
    link(sessionID, res.id)
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
