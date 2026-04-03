// Copyright (c) 2026-present, Elastic NV
import { ElasticAuth } from "./auth"

export namespace ElasticAlerts {
  export interface Alert {
    id: string
    name: string
    tags: string[]
    status: string
    reason?: string
    start?: string
  }

  export interface Result {
    alerts: Alert[]
    error?: string
  }

  const QUERY = JSON.stringify({
    query: { term: { "kibana.alert.status": "active" } },
    size: 100,
    _source: [
      "kibana.alert.uuid",
      "kibana.alert.rule.name",
      "kibana.alert.rule.tags",
      "kibana.alert.status",
      "kibana.alert.start",
      "kibana.alert.reason",
    ],
  })

  export async function query(url: string, key: string): Promise<Result> {
    const endpoint = `${url.replace(/\/$/, "")}/.alerts-*/_search`

    try {
      const res = await globalThis.fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `ApiKey ${key}`,
        },
        body: QUERY,
      })
      if (!res.ok) return { alerts: [], error: `HTTP ${res.status}` }

      const body = (await res.json()) as Record<string, unknown>
      const hits = ((body.hits as Record<string, unknown>)?.hits ?? []) as Record<string, unknown>[]

      return {
        alerts: hits.map((hit) => {
          const src = hit._source as Record<string, unknown>
          const rule = src["kibana.alert.rule.name"]
          return {
            id: (src["kibana.alert.uuid"] as string) ?? (hit._id as string),
            name: (rule as string) ?? "Unknown rule",
            tags: ((src["kibana.alert.rule.tags"] as string[]) ?? []),
            status: (src["kibana.alert.status"] as string) ?? "unknown",
            reason: src["kibana.alert.reason"] as string | undefined,
            start: src["kibana.alert.start"] as string | undefined,
          }
        }),
      }
    } catch (err) {
      return { alerts: [], error: err instanceof Error ? err.message : String(err) }
    }
  }

  export function poller(url: string, key: string, interval = 60_000) {
    const seen = new Set<string>()
    let timer: ReturnType<typeof setInterval> | undefined
    let cb: ((fresh: Alert[], all: Alert[]) => void) | undefined

    const tick = async () => {
      const result = await ElasticAlerts.query(url, key)
      if (result.error) return

      const fresh = result.alerts.filter((a) => !seen.has(a.id))

      seen.clear()
      for (const a of result.alerts) seen.add(a.id)

      cb?.(fresh, result.alerts)
    }

    return {
      on(handler: (fresh: Alert[], all: Alert[]) => void) {
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

  export async function resolve(): Promise<{ url: string; key: string } | undefined> {
    const status = await ElasticAuth.check()
    if (!status.configured || !status.context) return
    const url = status.context.elasticsearch_url
    const key = status.context.api_key
    if (!url || !key) return
    return { url, key }
  }
}
