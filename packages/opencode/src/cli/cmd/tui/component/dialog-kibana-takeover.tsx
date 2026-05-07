import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSDK } from "../context/sdk"
import { useLocal } from "../context/local"
import { useToast } from "../ui/toast"
import { createSignal, createMemo, onMount } from "solid-js"
import { Locale } from "@/util/locale"
import { Handover } from "@/elastic/handover"
import { SessionProfile } from "@/elastic/session-profile"
import type { ConversationSummary } from "@/elastic/client"

export function DialogKibanaTakeover() {
  const dialog = useDialog()
  const route = useRoute()
  const sdk = useSDK()
  const local = useLocal()
  const toast = useToast()

  const [conversations, setConversations] = createSignal<ConversationSummary[]>()
  const [loading, setLoading] = createSignal(true)

  onMount(async () => {
    dialog.setSize("large")
    try {
      const res = await Handover.list()
      setConversations(res.results)
    } catch (err) {
      toast.show({ variant: "error", message: err instanceof Error ? err.message : "Failed to list Kibana conversations", duration: 5000 })
    } finally {
      setLoading(false)
    }
  })

  const options = createMemo(() => {
    if (loading()) return [{ title: "Loading…", value: "", disabled: true }]
    const items = conversations()
    if (!items?.length) return [{ title: "No conversations found", value: "", disabled: true }]
    return items.map((c) => ({
      title: c.title,
      value: c.id,
      footer: Locale.time(new Date(c.updated_at).getTime()),
    }))
  })

  return (
    <DialogSelect
      title="Take over Kibana conversation"
      options={options()}
      onSelect={async (option) => {
        if (!option.value) return
        dialog.clear()
        try {
          const conv = await Handover.get(option.value)
          const res = await sdk.client.session.create({})
          if (res.error || !res.data) {
            toast.show({ variant: "error", message: "Failed to create session", duration: 5000 })
            return
          }
          const sessionID = res.data.id
          await SessionProfile.stamp(sessionID)
          Handover.link(sessionID, option.value)
          await sdk.client.session.update({ sessionID, title: `Kibana: ${conv.title}` }).catch(() => {})

          const model = local.model.current()
          if (model) {
            await sdk.fetch(`${sdk.url}/session/${sessionID}/seed`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                rounds: Handover.rounds(conv),
                model,
                agent: local.agent.current().name,
              }),
            })
          }

          toast.show({ variant: "info", title: "Kibana Takeover", message: `Picked up: ${conv.title}`, duration: 5000 })
          route.navigate({ type: "session", sessionID })
        } catch (err) {
          toast.show({ variant: "error", message: err instanceof Error ? err.message : "Failed to take over conversation", duration: 5000 })
        }
      }}
    />
  )
}
