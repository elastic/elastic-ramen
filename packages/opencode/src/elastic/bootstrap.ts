// Copyright (c) 2026-present, Elastic NV
import { KibanaClient } from "./client"
import { Sse } from "./sse"
import { Log } from "@/util/log"

/**
 * Forces Agent Builder conversation storage to initialize by running one
 * converse round and deleting the scratch conversation. Used as recovery
 * when a sync fails with 503 "not yet initialized".
 */
export namespace Bootstrap {
  const log = Log.create({ service: "bootstrap" })
  const AGENT_ID = "elastic-ai-agent"
  const PROBE_INPUT = "Initialization probe — please ignore."
  const TIMEOUT_MS = 30_000

  export function isNotInitializedError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err)
    return msg.includes("503") && msg.includes("not yet initialized")
  }

  export async function kickstart() {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await KibanaClient.agentBuilder().converseAsync(
        { agent_id: AGENT_ID, input: PROBE_INPUT },
        { signal: ctrl.signal },
      )
      if (!res.body) throw new Error("kickstart: empty response body")
      const id = await readConversationId(res.body)
      if (!id) throw new Error("kickstart: SSE stream ended without a conversation id; storage may still be uninitialized")
      // Fire-and-forget: best-effort cleanup, must not block the sync retry
      // path. Worst case we leak one scratch conversation in Kibana.
      void KibanaClient.agentBuilder()
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
