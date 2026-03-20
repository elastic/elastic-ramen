import { KibanaClient } from "./client"
import { BusEvent } from "@/bus/bus-event"
import { Log } from "@/util/log"
import z from "zod"

export namespace WorkflowRuns {
  const log = Log.create({ service: "workflow.runs" })

  export interface Run {
    executionId: string
    workflowId: string
    workflowName?: string
    sessionID: string
    status: string
    startedAt: number
    finishedAt?: number
    error?: string
  }

  const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "timed_out", "skipped"])

  const runSchema = z.object({
    executionId: z.string(),
    workflowId: z.string(),
    workflowName: z.string().optional(),
    sessionID: z.string(),
    status: z.string(),
    startedAt: z.number(),
    finishedAt: z.number().optional(),
    error: z.string().optional(),
  })

  export const Event = {
    Updated: BusEvent.define(
      "workflow.runs.updated",
      z.object({
        sessionID: z.string(),
        runs: z.array(runSchema),
      }),
    ),
    Completed: BusEvent.define(
      "workflow.runs.completed",
      z.object({
        sessionID: z.string(),
        run: runSchema,
      }),
    ),
  }

  // In-memory map of active runs keyed by executionId
  const active = new Map<string, Run>()
  // Completed/failed runs kept for sidebar display
  const finished = new Map<string, Run>()

  export function track(run: Run): void {
    log.info("tracking workflow run", { executionId: run.executionId, workflowId: run.workflowId })
    active.set(run.executionId, run)
  }

  export function forSession(sessionID: string): Run[] {
    const runs: Run[] = []
    for (const run of active.values()) {
      if (run.sessionID === sessionID) runs.push(run)
    }
    for (const run of finished.values()) {
      if (run.sessionID === sessionID) runs.push(run)
    }
    return runs
  }

  export function poller(interval = 5_000) {
    let timer: ReturnType<typeof setInterval> | undefined
    let cb: ((run: Run) => void) | undefined
    let updateCb: ((runs: Run[]) => void) | undefined

    const tick = async () => {
      if (active.size === 0) return

      for (const [executionId, run] of active) {
        try {
          const result = (await KibanaClient.executions().get(executionId)) as Record<string, unknown>
          const status = (result.status as string) ?? run.status
          run.status = status

          if (TERMINAL_STATUSES.has(status)) {
            run.finishedAt = Date.now()
            if (result.error) run.error = String(result.error)
            active.delete(executionId)
            finished.set(executionId, run)
            log.info("workflow run completed", { executionId, status })
            cb?.(run)
          }
        } catch (err) {
          log.warn("failed to poll workflow execution", { executionId, error: String(err) })
        }
      }

      // Collect all runs for update callback
      const allRuns = [...active.values(), ...finished.values()]
      updateCb?.(allRuns)
    }

    return {
      onCompleted(handler: (run: Run) => void) {
        cb = handler
        return this
      },
      onUpdated(handler: (runs: Run[]) => void) {
        updateCb = handler
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

  export function clear(sessionID: string): void {
    for (const [id, run] of active) {
      if (run.sessionID === sessionID) active.delete(id)
    }
    for (const [id, run] of finished) {
      if (run.sessionID === sessionID) finished.delete(id)
    }
  }
}
