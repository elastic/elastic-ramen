// Copyright (c) 2026-present, Elastic NV
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { createMemo, createSignal, onMount } from "solid-js"
import { useKeybind } from "../context/keybind"
import { useTheme } from "../context/theme"
import { ElasticAuth } from "@/elastic/auth"
import { useToast } from "../ui/toast"

export function DialogKibanaContext(props: {
  onReload: (opts?: { resetSession?: boolean }) => Promise<void>
}) {
  const dialog = useDialog()
  const toast = useToast()
  const keybind = useKeybind()
  const { theme } = useTheme()
  const [toDelete, setToDelete] = createSignal<string>()
  const [snap, setSnap] = createSignal<Awaited<ReturnType<typeof ElasticAuth.profiles>> | undefined>()

  onMount(async () => {
    dialog.setSize("large")
    setSnap(await ElasticAuth.profiles())
  })

  const options = createMemo(() => {
    const p = snap()
    if (!p) return []
    return p.names.map((n) => ({
      title: toDelete() === n ? `Press ${keybind.print("session_delete")} again to remove` : n === p.current ? `${n} (active)` : n,
      value: n,
      category: "Profiles",
      bg: toDelete() === n ? theme.error : undefined,
    }))
  })

  return (
    <DialogSelect
      title="Kibana profiles"
      options={options()}
      skipFilter={true}
      current={snap()?.current}
      onMove={() => setToDelete(undefined)}
      onSelect={async (opt) => {
        if (toDelete() === opt.value) {
          try {
            const wasActive = snap()?.current === opt.value
            await ElasticAuth.removeContext(opt.value)
            await props.onReload({ resetSession: wasActive })
            const next = await ElasticAuth.profiles()
            if (next.names.length === 0) {
              dialog.clear()
            } else {
              setSnap(next)
            }
            toast.show({ variant: "success", message: `Removed profile ${opt.value}`, duration: 3000 })
          } catch (e) {
            toast.show({ variant: "error", message: e instanceof Error ? e.message : String(e), duration: 5000 })
          }
          setToDelete(undefined)
          return
        }
        if (opt.value === snap()?.current) {
          dialog.clear()
          return
        }
        try {
          await ElasticAuth.setCurrent(opt.value)
          await props.onReload({ resetSession: true })
          dialog.clear()
          toast.show({ variant: "success", message: `Active profile: ${opt.value}`, duration: 2500 })
        } catch (e) {
          toast.show({ variant: "error", message: e instanceof Error ? e.message : String(e), duration: 5000 })
        }
      }}
      keybind={[
        {
          keybind: keybind.all.session_delete?.[0],
          title: "remove",
          onTrigger: (option) => setToDelete(option.value),
        },
      ]}
    />
  )
}
