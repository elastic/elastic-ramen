import { createContext, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import type { ElasticAlerts } from "@/elastic/alerts"

function init() {
  const [store, set] = createStore({
    alerts: [] as ElasticAlerts.Alert[],
  })

  return {
    get alerts() {
      return store.alerts
    },
    set(alerts: ElasticAlerts.Alert[]) {
      set("alerts", alerts)
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
