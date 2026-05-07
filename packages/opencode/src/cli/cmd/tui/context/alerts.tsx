import { createContext, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import type { ElasticAlerts } from "@/elastic/alerts"

function init() {
  const [store, set] = createStore({
    alerts: [] as ElasticAlerts.Alert[],
    kibanaUrl: undefined as string | undefined,
  })

  return {
    get alerts() {
      return store.alerts
    },
    get kibanaUrl() {
      return store.kibanaUrl
    },
    set(alerts: ElasticAlerts.Alert[]) {
      set("alerts", alerts)
    },
    setKibanaUrl(url: string | undefined) {
      set("kibanaUrl", url)
    },
  }
}

export type AlertsContext = ReturnType<typeof init>

const ctx = createContext<AlertsContext>()

export function AlertsProvider(props: ParentProps) {
  return <ctx.Provider value={init()}>{props.children}</ctx.Provider>
}

export function useAlerts() {
  const value = useContext(ctx)
  if (!value) throw new Error("useAlerts must be used within AlertsProvider")
  return value
}
