import { createMemo, createSignal, onMount } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useToast } from "../ui/toast"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useRoute } from "../context/route"
import { KibanaClient } from "@/elastic/client"
import { AbAgent } from "@/elastic/ab-agent"
import type { Config } from "@opencode-ai/sdk/v2"

function rows(raw: unknown): { id: string; title: string }[] {
  const out: { id: string; title: string }[] = []
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? ((raw as Record<string, unknown>).agents ??
          (raw as Record<string, unknown>).results ??
          (raw as Record<string, unknown>).data)
      : undefined
  if (!Array.isArray(list)) return out
  for (const x of list) {
    if (!x || typeof x !== "object") continue
    const o = x as Record<string, unknown>
    const id = o.id
    if (typeof id !== "string" || !id) continue
    const name = typeof o.name === "string" ? o.name : id
    out.push({ id, title: name })
  }
  return out
}

export function DialogKibanaAb() {
  const dialog = useDialog()
  const toast = useToast()
  const sdk = useSDK()
  const sync = useSync()
  const route = useRoute()
  const [loading, setLoading] = createSignal(true)
  const [api, setApi] = createSignal<{ id: string; title: string }[]>([])

  onMount(async () => {
    dialog.setSize("large")
    try {
      const raw = await KibanaClient.agents().list()
      setApi(rows(raw))
    } catch (err) {
      toast.show({
        variant: "error",
        message: err instanceof Error ? err.message : "Could not list Agent Builder agents",
        duration: 6000,
      })
    } finally {
      setLoading(false)
    }
  })

  const options = createMemo(() => {
    if (loading()) return [{ title: "Loading…", value: "", disabled: true }]
    const seen = new Set<string>()
    const opts: { title: string; value: string; footer?: string; disabled?: boolean }[] = []
    opts.push({
      title: `Built-in (${AbAgent.builtin})`,
      value: AbAgent.builtin,
      footer: "Default Agent Builder assistant",
    })
    seen.add(AbAgent.builtin)
    for (const r of api()) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      opts.push({ title: r.title, value: r.id, footer: r.id })
    }
    const saved = sync.data.config.kibana?.agent_builder_agent_id
    if (saved && saved !== AbAgent.builtin && !seen.has(saved)) {
      seen.add(saved)
      opts.push({ title: saved, value: saved, footer: "In elastic_ramen config" })
    }
    return opts
  })

  const selected = () => sync.data.config.kibana?.agent_builder_agent_id ?? AbAgent.builtin

  return (
    <DialogSelect
      title="Agent Builder agent (Kibana sync)"
      options={options()}
      current={selected()}
      onSelect={async (opt) => {
        if (!opt.value) return
        dialog.clear()
        if (opt.value === selected()) return
        const cur = sync.data.config
        const body = {
          ...cur,
          kibana: { ...cur.kibana, agent_builder_agent_id: opt.value },
        } as Config
        try {
          await sdk.client.config.update({ config: body }, { throwOnError: true })
          await sync.bootstrap()
          const workspaceID =
            route.data.type === "session" ? sync.session.get(route.data.sessionID)?.workspaceID : undefined
          route.navigate({ type: "home", workspaceID })
          toast.show({
            variant: "success",
            message: `Switched Agent Builder agent to ${opt.value}. Started a fresh session context.`,
            duration: 4000,
          })
        } catch (err) {
          toast.show({
            variant: "error",
            message: err instanceof Error ? err.message : "Failed to save config",
            duration: 5000,
          })
        }
      }}
    />
  )
}
