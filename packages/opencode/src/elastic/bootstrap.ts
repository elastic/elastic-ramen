// Copyright (c) 2026-present, Elastic NV
import { KibanaClient } from "./client"
import { ElasticAuth } from "./auth"
import { Sse } from "./sse"
import { Log } from "@/util/log"

/**
 * Ensures Kibana's Agent Builder conversation storage is initialized.
 *
 * Without this, the first `POST /internal/elastic_ramen/conversations` returns
 * 503 "not yet initialized" until someone opens Agent Builder in the Kibana UI.
 *
 * Strategy:
 *   1. Probe the list endpoint. 200 ⇒ storage already exists, done.
 *   2. Only on 503 fall through to a converse round and DELETE the scratch
 *      conversation. This is the only path that costs an LLM turn, and it
 *      runs at most once per Kibana URL per process.
 *
 * Single-flight per Kibana URL: concurrent callers share the same promise.
 * On failure the cached promise is cleared so the next caller can retry.
 */
export namespace Bootstrap {
  const log = Log.create({ service: "bootstrap" })
  const AGENT_ID = "elastic-ai-agent"
  const PROBE_INPUT = "Initialization probe — please ignore."
  const KICKSTART_TIMEOUT_MS = 30_000

  const inflight = new Map<string, Promise<void>>()

  export interface Options {
    /** Called once if the LLM-cost kickstart path is about to run. */
    onKickstart?: () => void
  }

  export async function ensureStorage(opts?: Options): Promise<void> {
    const auth = await ElasticAuth.check()
    if (!auth.configured || !auth.context?.kibana_url) return
    const url = auth.context.kibana_url
    const existing = inflight.get(url)
    if (existing) return existing
    const p = run(opts).catch((err) => {
      inflight.delete(url)
      throw err
    })
    inflight.set(url, p)
    return p
  }

  async function run(opts?: Options) {
    if (await probe()) return
    opts?.onKickstart?.()
    await kickstart()
  }

  /** Returns true if storage is already initialized; false on the documented 503. */
  async function probe(): Promise<boolean> {
    try {
      await KibanaClient.conversations().list({ agent_id: AGENT_ID })
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes("503") && msg.includes("not yet initialized")) return false
      throw err
    }
  }

  async function kickstart() {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), KICKSTART_TIMEOUT_MS)
    try {
      const res = await KibanaClient.agentBuilder().converseAsync(
        { agent_id: AGENT_ID, input: PROBE_INPUT },
        { signal: ctrl.signal },
      )
      if (!res.body) return
      const id = await readConversationId(res.body)
      if (!id) {
        log.warn("kickstart finished without a conversation id")
        return
      }
      await KibanaClient.agentBuilder()
        .conversations.del(id)
        .catch((err) => log.warn("could not delete scratch conversation", { id, error: String(err) }))
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Reads the SSE stream until a persistence event (`conversation_created` or
   * `conversation_updated`) carries a conversation id. `conversation_id_set`
   * fires earlier but before the document is durable, so we don't trust it.
   */
  async function readConversationId(body: ReadableStream<Uint8Array>): Promise<string | undefined> {
    for await (const ev of Sse.events(body)) {
      if (ev.event !== "conversation_created" && ev.event !== "conversation_updated") continue
      const id = extractConversationId(ev.data)
      if (id) return id
    }
    return undefined
  }

  /** Kibana wraps SSE payloads as `{"data":{...}}` and sometimes one level deeper. */
  function extractConversationId(raw: string): string | undefined {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return undefined
    }
    return walk(parsed)
  }

  function walk(node: unknown, depth = 0): string | undefined {
    if (!node || typeof node !== "object" || depth > 4) return undefined
    const o = node as Record<string, unknown>
    if (typeof o.conversation_id === "string") return o.conversation_id
    return walk(o.data, depth + 1)
  }
}
