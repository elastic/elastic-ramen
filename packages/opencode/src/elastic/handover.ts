// Copyright (c) 2026-present, Elastic NV
import { KibanaClient, type ConversationRound, type Conversation } from "./client"
import { ElasticAuth } from "./auth"
import { Log } from "@/util/log"
import { Storage } from "@/storage/storage"

/** Kibana SSE wraps chat payloads as `{"data":{...}}` on the `data:` line. */
function chatPayloadConversationId(j: unknown): string | undefined {
  if (!j || typeof j !== "object") return
  const o = j as Record<string, unknown>
  if (typeof o.conversation_id === "string") return o.conversation_id
  const inner = o.data
  if (!inner || typeof inner !== "object") return
  const d = inner as Record<string, unknown>
  if (typeof d.conversation_id === "string") return d.conversation_id
  const nested = d.data
  if (nested && typeof nested === "object") {
    const c = (nested as Record<string, unknown>).conversation_id
    if (typeof c === "string") return c
  }
  return
}

/** After `round_complete`, persistence emits this — DELETE must wait until then. */
function parsePersistedConversationSseBlock(block: string): string | undefined {
  let ev = ""
  const lines: string[] = []
  for (const ln of block.split("\n")) {
    if (ln.startsWith("event:")) ev = ln.slice(6).trim()
    if (ln.startsWith("data:")) lines.push(ln.slice(5).trimStart())
  }
  if (ev !== "conversation_created" && ev !== "conversation_updated") return
  if (!lines.length) return
  let parsed: unknown
  try {
    parsed = JSON.parse(lines.join("\n"))
  } catch {
    return
  }
  return chatPayloadConversationId(parsed)
}

async function conversationIdFromSse(body: ReadableStream<Uint8Array>): Promise<{ id: string; close: () => void } | undefined> {
  const reader = body.getReader()
  const close = () => reader.cancel().catch(() => {})
  const dec = new TextDecoder()
  let buf = ""
  const feed = (chunk: string) => {
    buf += chunk.replace(/\r\n/g, "\n")
    while (true) {
      const i = buf.indexOf("\n\n")
      if (i === -1) return undefined
      const id = parsePersistedConversationSseBlock(buf.slice(0, i))
      buf = buf.slice(i + 2)
      if (id) return id
    }
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (value) {
        const id = feed(dec.decode(value, { stream: true }))
        if (id) return { id, close }
      }
      if (done) break
    }
    const id = feed(dec.decode())
    if (id) return { id, close }
    close()
    return undefined
  } catch {
    close()
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
   * Run async converse until Kibana persists the conversation (`conversation_created`
   * / `conversation_updated` in SSE), then DELETE it. Waits for persistence — not
   * `conversation_id_set`, which fires before the document exists. Parses nested
   * `data: {"data":{"conversation_id":...}}` wire encoding. Mitigates 503 "not yet
   * initialized" when Agent Builder has never been used in this deployment.
   */
  export async function kickstart() {
    const auth = await ElasticAuth.check()
    if (!auth.configured || !auth.context?.kibana_url || !auth.context.api_key) return
    const base = auth.context.kibana_url.replace(/\/$/, "")
    const key = auth.context.api_key
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 120_000)
    const h = {
      "kbn-xsrf": "true",
      "x-elastic-internal-origin": "kibana",
      "elastic-api-version": "2023-10-31",
      "Content-Type": "application/json",
      Authorization: `ApiKey ${key}`,
    } as const
    try {
      const res = await fetch(`${base}/api/agent_builder/converse/async`, {
        method: "POST",
        signal: ctrl.signal,
        headers: h,
        body: JSON.stringify({
          agent_id: "elastic-ai-agent",
          input: "Test conversation for making sure everything works.",
        }),
      })
      if (!res.ok || !res.body) return
      const hit = await conversationIdFromSse(res.body)
      if (!hit) return
      try {
        const del = await fetch(`${base}/api/agent_builder/conversations/${encodeURIComponent(hit.id)}`, {
          method: "DELETE",
          headers: h,
        })
        if (!del.ok) log.warn("kickstart could not delete scratch conversation", { status: del.status })
      } finally {
        hit.close()
      }
    } finally {
      clearTimeout(timer)
    }
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
