import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { ElasticAuth } from "@/elastic/auth"
import { ElasticBin } from "@/elastic/bin"
import { ElasticCallback } from "@/elastic/callback"
import { Process } from "@/util/process"

export function DialogElasticSetup(props: { kibanaBase?: string; onComplete: () => void }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [error, setError] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [manual, setManual] = createSignal(false)

  let input: TextareaRenderable
  let cb: ElasticCallback.Handle | undefined

  const link = () => {
    const base = props.kibanaBase?.replace(/\/+$/, "")
    if (!base) return undefined
    const target = base + "/app/observabilityOnboarding/elastic-console"
    if (cb) return target + "?callback=" + encodeURIComponent(cb.url)
    return target
  }

  async function save(parsed: Record<string, any>) {
    const es = parsed.es_url || parsed.elasticsearch_url
    const kb = parsed.kibana_url
    const key = parsed.api_key

    if (!es) {
      setError("Payload is missing es_url")
      return
    }
    if (!key) {
      setError("Payload is missing api_key")
      return
    }

    setSaving(true)
    setError("")

    const input: ElasticAuth.SaveInput = { api_key: key, elasticsearch_url: es }
    if (kb) input.kibana_url = kb
    if (parsed.provider && typeof parsed.provider === "object") input.provider = parsed.provider
    if (parsed.model && typeof parsed.model === "string") input.model = parsed.model

    await ElasticAuth.save(input).catch((e: Error) => {
      setError("Failed to save config: " + e.message)
      setSaving(false)
    })

    if (error()) return

    const bin = ElasticBin.resolve()
    const health = await Process.text([bin, "es", "cluster", "health"], { nothrow: true }).catch(() => ({
      text: "",
      code: 1,
    }))
    setSaving(false)

    if (health.code !== 0 && health.text?.includes("error")) {
      setError("Saved, but could not connect. Check your credentials and try again.")
      return
    }

    dialog.clear()
    props.onComplete()
  }

  function submit() {
    const raw = input?.plainText?.trim() ?? ""
    if (!raw) {
      setError("Paste the JSON from Kibana above")
      return
    }

    let parsed: Record<string, any>
    try {
      parsed = JSON.parse(raw)
    } catch {
      setError("Invalid JSON — paste the exact object from Kibana")
      return
    }

    save(parsed)
  }

  useKeyboard((evt) => {
    if (manual() && evt.name === "return" && (evt.ctrl || evt.meta)) {
      submit()
      evt.preventDefault()
      evt.stopPropagation()
    }
  })

  onMount(() => {
    dialog.setSize("large")

    cb = ElasticCallback.start()
    cb.promise.then((payload) => save(payload))
  })

  onCleanup(() => cb?.stop())

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Elastic Console Setup
        </text>
      </box>

      <Show when={!manual()}>
        <text fg={theme.textMuted}>
          {"Open the Kibana onboarding page — credentials will be sent here automatically."}
        </text>

        <Show when={link()}>
          <text fg={theme.primary}>{link()}</text>
        </Show>

        <Show when={!link()}>
          <text fg={theme.textMuted}>
            {`Open <your-kibana>/app/observabilityOnboarding/elastic-console?callback=http://localhost:${ElasticCallback.port()}`}
          </text>
          <text fg={theme.textMuted}>
            {"or pass --kibana-base=<URL> to get a clickable link here."}
          </text>
        </Show>

        <Show when={error()}>
          <text fg={"#ff6b6b"}>{error()}</text>
        </Show>

        <Show when={!saving()} fallback={<text fg={theme.textMuted}>connecting...</text>}>
          <text fg={theme.textMuted}>Waiting for Kibana...</text>
        </Show>

        <box paddingTop={1}>
          <text
            fg={theme.textMuted}
            onMouseUp={() => {
              setManual(true)
              setTimeout(() => input && !input.isDestroyed && input.focus(), 1)
            }}
          >
            {"Or paste credentials manually ↓"}
          </text>
        </box>
      </Show>

      <Show when={manual()}>
        <text fg={theme.textMuted}>
          {"Paste the JSON credentials from Kibana to connect."}
        </text>

        <Show when={error()}>
          <text fg={"#ff6b6b"}>{error()}</text>
        </Show>

        <box gap={1}>
          <box>
            <text fg={theme.text}>
              {"JSON credentials *"}
            </text>
          </box>
          <textarea
            height={7}
            ref={(val: TextareaRenderable) => { input = val }}
            placeholder={'{\n  "es_url": "https://...",\n  "kibana_url": "https://...",\n  "api_key": "...",\n  "provider": { ... },\n  "model": "..."\n}'}
            textColor={theme.text}
            focusedTextColor={theme.text}
            cursorColor={theme.primary}
          />
        </box>

        <box paddingBottom={1} gap={1} flexDirection="row">
          <Show when={!saving()} fallback={<text fg={theme.textMuted}>connecting...</text>}>
            <text fg={theme.text}>
              ctrl+enter <span style={{ fg: theme.textMuted }}>connect</span>
            </text>
          </Show>
        </box>
      </Show>
    </box>
  )
}
