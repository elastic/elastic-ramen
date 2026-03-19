import { KibanaClient, type KibanaClient as KibanaClientNS } from "./client"
import { Log } from "@/util/log"
import { Storage } from "@/storage/storage"
import { BusEvent } from "@/bus/bus-event"
import z from "zod"

export namespace KibanaAttachments {
  const log = Log.create({ service: "kibana.attachments" })

  interface SessionState {
    kibanaSessionId: string
    attachments: KibanaClientNS.AttachmentSummary[]
  }

  const sessions = new Map<string, SessionState>()
  const pending = new Map<string, Promise<string>>()

  export const Event = {
    Updated: BusEvent.define(
      "kibana.attachments.updated",
      z.object({
        sessionID: z.string(),
        attachments: z.array(
          z.object({
            id: z.string(),
            type: z.string(),
            description: z.string().optional(),
            active: z.boolean(),
            current_version: z.number(),
          }),
        ),
      }),
    ),
  }

  function ensureSession(sessionID: string, skillId: string): Promise<string> {
    const cached = sessions.get(sessionID)
    if (cached) return Promise.resolve(cached.kibanaSessionId)

    // Deduplicate concurrent calls for the same session
    const inflight = pending.get(sessionID)
    if (inflight) return inflight

    const promise = (async () => {
      // Check persistent storage
      const stored = await Storage.read<string>(["kibana_session", sessionID]).catch(() => undefined)
      if (stored) {
        sessions.set(sessionID, { kibanaSessionId: stored, attachments: [] })
        return stored
      }

      // Create new Kibana session
      log.info("creating kibana session", { sessionID, skillId })
      const res = await KibanaClient.sessions().create(skillId)
      const kibanaSessionId = res.session_id

      sessions.set(sessionID, { kibanaSessionId, attachments: [] })
      await Storage.write(["kibana_session", sessionID], kibanaSessionId).catch(() => {})

      return kibanaSessionId
    })().finally(() => {
      pending.delete(sessionID)
    })

    pending.set(sessionID, promise)
    return promise
  }

  export async function executeTool(
    sessionID: string,
    skillId: string,
    toolId: string,
    toolParams: Record<string, unknown>,
  ): Promise<{ results: unknown[]; attachments: KibanaClientNS.AttachmentSummary[] }> {
    const kibanaSessionId = await ensureSession(sessionID, skillId)

    log.info("executing tool in session", { sessionID, kibanaSessionId, skillId, toolId })
    const res = await KibanaClient.sessions().executeToolInSession(kibanaSessionId, skillId, toolId, toolParams)

    // Cache attachments
    const state = sessions.get(sessionID)
    if (state) {
      state.attachments = res.attachments ?? []
    }

    return { results: res.results, attachments: res.attachments ?? [] }
  }

  export async function getAttachments(sessionID: string): Promise<KibanaClientNS.AttachmentSummary[]> {
    const state = sessions.get(sessionID)
    if (state?.attachments.length) return state.attachments

    const kibanaSessionId = state?.kibanaSessionId
    if (!kibanaSessionId) return []

    const res = await KibanaClient.sessions().getAttachments(kibanaSessionId)
    if (state) state.attachments = res.attachments ?? []
    return res.attachments ?? []
  }

  export async function getKibanaSessionId(sessionID: string): Promise<string | undefined> {
    const state = sessions.get(sessionID)
    if (state) return state.kibanaSessionId

    const stored = await Storage.read<string>(["kibana_session", sessionID]).catch(() => undefined)
    if (stored) {
      sessions.set(sessionID, { kibanaSessionId: stored, attachments: [] })
    }
    return stored
  }

  export async function cleanup(sessionID: string): Promise<void> {
    const state = sessions.get(sessionID)
    if (!state) return

    log.info("cleaning up kibana session", { sessionID, kibanaSessionId: state.kibanaSessionId })
    sessions.delete(sessionID)
    await KibanaClient.sessions().del(state.kibanaSessionId).catch((err) => {
      log.warn("failed to delete kibana session", { error: String(err) })
    })
  }
}
