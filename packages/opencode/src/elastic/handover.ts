// Copyright (c) 2026-present, Elastic NV
import { KibanaClient, type ConversationRound, type Conversation } from "./client"
import { ElasticAuth } from "./auth"
import { Log } from "@/util/log"
import { Storage } from "@/storage/storage"

function parseSseBlock(block: string): string | undefined {
  let ev = ""
  const lines: string[] = []
  for (const ln of block.split("\n")) {
    if (ln.startsWith("event:")) ev = ln.slice(6).trim()
    if (ln.startsWith("data:")) lines.push(ln.slice(5).trimStart())
  }
  if (ev !== "conversation_id_set" && ev !== "conversation_created") return
  if (!lines.length) return
  let j: { conversation_id?: string }
  try {
    j = JSON.parse(lines.join("\n")) as { conversation_id?: string }
  } catch {
    return
  }
  return j.conversation_id
}

async function conversationIdFromSse(body: ReadableStream<Uint8Array>): Promise<string | undefined> {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ""
  const feed = (chunk: string) => {
    buf += chunk.replace(/\r\n/g, "\n")
    while (true) {
      const i = buf.indexOf("\n\n")
      if (i === -1) return undefined
      const id = parseSseBlock(buf.slice(0, i))
      buf = buf.slice(i + 2)
      if (id) return id
    }
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (value) {
        const id = feed(dec.decode(value, { stream: true }))
        if (id) {
          reader.cancel().catch(() => {})
          return id
        }
      }
      if (done) break
    }
    const id = feed(dec.decode())
    if (id) {
      reader.cancel().catch(() => {})
      return id
    }
    return undefined
  } catch {
    return undefined
  }
}

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

  /**
   * Start a dummy async converse so Agent Builder persists storage, read the new
   * conversation id from the first SSE lifecycle event, cancel the stream, then delete
   * that scratch conversation so nothing is left in the UI. Mitigates 503 "not yet
   * initialized" when Agent Builder has never been used in this deployment.
   */
  export async function kickstart() {
    const auth = await ElasticAuth.check()
    if (!auth.configured || !auth.context?.kibana_url || !auth.context.api_key) return
    const base = auth.context.kibana_url.replace(/\/$/, "")
    const key = auth.context.api_key
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15_000)
    const h = {
      "kbn-xsrf": "true",
      "x-elastic-internal-origin": "kibana",
      "elastic-api-version": "2023-10-31",
      "Content-Type": "application/json",
      Authorization: `ApiKey ${key}`,
    } as const
    const res = await fetch(`${base}/api/agent_builder/converse/async`, {
      method: "POST",
      signal: ctrl.signal,
      headers: h,
      body: JSON.stringify({
        agent_id: "elastic-ai-agent",
        input: "Test conversation for making sure everything works.",
      }),
    }).finally(() => clearTimeout(timer))
    if (!res.ok || !res.body) return
    const temp = await conversationIdFromSse(res.body)
    if (!temp) return
    const del = await fetch(`${base}/api/agent_builder/conversations/${encodeURIComponent(temp)}`, {
      method: "DELETE",
      headers: h,
    })
    if (!del.ok) log.warn("kickstart could not delete scratch conversation", { status: del.status })
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
