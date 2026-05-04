// Copyright (c) 2026-present, Elastic NV
import { createContext, useContext, type ParentProps, onMount, type Accessor, createSignal } from "solid-js"
import { ElasticAuth } from "@/elastic/auth"

type Value = {
  label: Accessor<string | undefined>
  refresh: () => Promise<void>
}

const ctx = createContext<Value>()

export function ElasticProfileProvider(props: ParentProps) {
  const [label, setLabel] = createSignal<string | undefined>(undefined)
  const refresh = async () => {
    const s = await ElasticAuth.check()
    setLabel(s.name)
  }
  onMount(() => {
    void refresh()
  })
  return <ctx.Provider value={{ label, refresh }}>{props.children}</ctx.Provider>
}

export function useElasticProfile() {
  const v = useContext(ctx)
  if (!v) throw new Error("useElasticProfile must be used within ElasticProfileProvider")
  return v
}
