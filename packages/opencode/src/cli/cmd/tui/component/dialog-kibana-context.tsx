// Copyright (c) 2026-present, Elastic NV
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { createMemo, createSignal, onMount } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useKeybind } from "../context/keybind"
import { useTheme } from "../context/theme"
import { ElasticAuth } from "@/elastic/auth"
import { useToast } from "../ui/toast"
import { Spinner } from "./spinner"

export function DialogKibanaContext(props: {
  onReload: (opts?: { resetSession?: boolean }) => Promise<void>
}) {
  const dialog = useDialog()
  const toast = useToast()
  const keybind = useKeybind()
  const { theme } = useTheme()
  const [toDelete, setToDelete] = createSignal<string>()
  const [switching, setSwitching] = createSignal<string>()
  const [deleting, setDeleting] = createSignal(false)
  const [snap, setSnap] = createSignal<Awaited<ReturnType<typeof ElasticAuth.profiles>> | undefined>()

  const spinnerEl = <Spinner />

  onMount(async () => {
    dialog.setSize("large")
    setSnap(await ElasticAuth.profiles())
  })

  // Intercept Escape to cancel a pending deletion instead of closing the dialog.
  // Only preventDefault when there's a mark to clear; otherwise let dialog.tsx handle it.
  useKeyboard((evt) => {
    if ((evt.name === "escape" || (evt.ctrl && evt.name === "c")) && toDelete()) {
      setToDelete(undefined)
      evt.preventDefault()
      evt.stopPropagation()
    }
  })

  const options = createMemo(() => {
    const target = switching()
    if (target) return [{ title: `Switching to ${target}…`, value: target, category: "Profiles", gutter: spinnerEl }]
    if (deleting()) return [{ title: "Removing profile…", value: "__deleting__", category: "Profiles", gutter: spinnerEl }]
    const p = snap()
    if (!p) return []
    return p.names.map((n) => ({
      title: toDelete() === n ? `${n} — enter to remove` : n === p.current ? `${n} (active)` : n,
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
      onSelect={async (opt) => {
        if (switching() || deleting()) return
        if (toDelete() === opt.value) {
          const profileToDelete = opt.value
          const wasActive = snap()?.current === profileToDelete
          setToDelete(undefined)
          setDeleting(true)
          try {
            await ElasticAuth.removeContext(profileToDelete)
            const next = await ElasticAuth.profiles()
            toast.show({ variant: "success", message: `Removed profile ${profileToDelete}`, duration: 3000 })
            if (wasActive) {
              await props.onReload({ resetSession: true })
              dialog.clear()
            } else if (next.names.length === 0) {
              dialog.clear()
            } else {
              setSnap(next)
            }
          } catch (e) {
            toast.show({ variant: "error", message: e instanceof Error ? e.message : String(e), duration: 5000 })
          } finally {
            setDeleting(false)
          }
          return
        }
        if (opt.value === snap()?.current) {
          dialog.clear()
          return
        }
        setSwitching(opt.value)
        try {
          await ElasticAuth.setCurrent(opt.value)
          await props.onReload({ resetSession: true })
          dialog.clear()
          toast.show({ variant: "success", message: `Active profile: ${opt.value}`, duration: 2500 })
        } catch (e) {
          setSwitching(undefined)
          toast.show({ variant: "error", message: e instanceof Error ? e.message : String(e), duration: 5000 })
        }
      }}
      keybind={[
        {
          keybind: keybind.all.session_delete?.[0],
          title: "remove",
          onTrigger: (option) => {
            if (switching() || deleting()) return
            setToDelete(option.value)
          },
        },
      ]}
    />
  )
}
