// Copyright (c) 2026-present, Elastic NV
// This file is derived from opencode (https://github.com/anomalyco/opencode)
// and has been modified by Elastic NV. Changes: updated Kibana app path to elasticRamen, switched to JSON-based manual auth input, added kibana-url mode and multi-step setup flow
import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { Link } from "@tui/ui/link"
import { ElasticAuth } from "@/elastic/auth"
import { ElasticBin } from "@/elastic/bin"
import { ElasticCallback } from "@/elastic/callback"
import { KibanaGateway } from "@/elastic/kibana-gateway"
import { Process } from "@/util/process"
import open from "open"

export function DialogElasticSetup(props: { kibanaBase?: string; onComplete: () => void; onEscape?: () => void }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [error, setError] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [mode, setMode] = createSignal<"kibana-url" | "kibana-callback" | "manual-json">(
    props.kibanaBase ? "kibana-callback" : "kibana-url",
  )
  const [kibanaUrl, setKibanaUrl] = createSignal("")

  let jsonInput: TextareaRenderable
  let urlInput: TextareaRenderable
  let cb: ElasticCallback.Handle | undefined

  const base = () => (props.kibanaBase || kibanaUrl())?.replace(/\/+$/, "")
  const link = () => {
    if (!base()) return undefined
    const target = base() + "/app/elasticRamen"
    if (!cb) return target
    return target + "?callback=" + encodeURIComponent(cb.url)
  }
  const settingsLink = () => {
    if (!base()) return undefined
    return base() + "/app/management/kibana/settings?query=ramen"
  }

  async function save(input: ElasticAuth.SaveInput) {
    if (!input.elasticsearch_url && !input.cloud_id) {
      setError("Enter a Cloud ID or Elasticsearch URL")
      return
    }
    if (!input.api_key) {
      setError("Enter an API key")
      return
    }

    setSaving(true)
    setError("")

    const ctx = ElasticAuth.profileNameFromSetup(input.kibana_url, input.elasticsearch_url)
    await ElasticAuth.save({ ...input, context: ctx }).catch((e: Error) => {
      setError("Failed to save config: " + e.message)
      setSaving(false)
    })

    if (error()) return

    const bin = await ElasticBin.resolve()
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

  async function submitManual() {
    const raw = jsonInput?.plainText?.trim() ?? ""
    if (!raw) {
      setError("Paste the JSON from the Kibana onboarding page")
      return
    }

    let parsed: Record<string, any>
    try {
      parsed = JSON.parse(raw)
    } catch {
      setError("Invalid JSON — paste the full JSON object from Kibana")
      return
    }

    const esUrl = parsed.elasticsearchUrl || parsed.elasticsearch_url || parsed.es_url
    const key = parsed.apiKey || parsed.api_key
    const kibUrl = parsed.kibanaUrl || parsed.kibana_url

    if (!esUrl && !parsed.cloud_id) {
      setError("JSON is missing an Elasticsearch URL or Cloud ID")
      return
    }
    if (!key) {
      setError("JSON is missing an API key")
      return
    }

    const input: ElasticAuth.SaveInput = { api_key: key }
    if (parsed.cloud_id) input.cloud_id = parsed.cloud_id
    else input.elasticsearch_url = esUrl

    if (kibUrl) {
      input.kibana_url = kibUrl
      input.auth_mode = "kibana"
      try {
        input.provider = await KibanaGateway.buildProvider(kibUrl, key)
      } catch (e) {
        setError("Could not reach Kibana to load connectors: " + (e as Error).message)
        return
      }
      input.model = "kibana/default"
    }

    await save(input)
  }

  function submitKibanaUrl() {
    const raw = urlInput?.plainText?.trim() ?? ""
    if (!raw) {
      setError("Enter your Kibana URL")
      return
    }
    // Validate it looks like a URL
    if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
      setError("Enter a valid URL starting with http:// or https://")
      return
    }
    let url: string
    try {
      const parsed = new URL(raw)
      // Keep the full URL including base path (e.g. http://host:5601/oiy)
      // but strip any trailing slash
      url = raw.replace(/\/+$/, "")
      // Basic sanity check
      if (!parsed.hostname) throw new Error("no hostname")
    } catch {
      setError("Invalid URL")
      return
    }
    setError("")
    setKibanaUrl(url)
    setMode("kibana-callback")
    startCallback(url)
  }

  function startCallback(base: string) {
    cb?.stop()
    cb = ElasticCallback.start()
    const target = base + "/app/elasticRamen?callback=" + encodeURIComponent(cb.url)
    open(target).catch(() => {})
    cb.promise.then(async (payload) => {
      const parsed = payload as Record<string, any>
      const es = parsed.es_url || parsed.elasticsearch_url
      const key = parsed.api_key
      const kb = parsed.kibana_url
      // Prefer the --kibana-base / user-entered URL over what the callback reports,
      // since the callback may return the internal port without the base path.
      const effectiveKb = base || kb
      const input: ElasticAuth.SaveInput = { api_key: key, elasticsearch_url: es, auth_mode: "kibana" }
      if (effectiveKb) input.kibana_url = effectiveKb
      // Always construct provider ourselves to ensure correct baseURL and headers
      if (effectiveKb && key) {
        try {
          input.provider = await KibanaGateway.buildProvider(effectiveKb, key)
        } catch (e) {
          setError("Could not reach Kibana to load connectors: " + (e as Error).message)
          return
        }
      }
      if (parsed.model && typeof parsed.model === "string") input.model = parsed.model
      else if (input.provider) input.model = "kibana/default"
      await save(input)
    }).catch((e: Error) => {
      setError("Setup failed: " + e.message)
    })
  }

  useKeyboard((evt) => {
    if ((evt.name === "escape" || (evt.ctrl && evt.name === "c")) && props.onEscape) {
      props.onEscape()
      evt.preventDefault()
      evt.stopPropagation()
    }
  })

  onMount(() => {
    dialog.setSize("large")

    if (props.kibanaBase) {
      startCallback(props.kibanaBase)
    } else {
      setTimeout(() => urlInput && !urlInput.isDestroyed && urlInput.focus(), 1)
    }
  })

  onCleanup(() => cb?.stop())

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Elastic RAMEN Setup
        </text>
      </box>

      {/* Step 1: Ask for Kibana URL if not passed via --kibana-base */}
      <Show when={mode() === "kibana-url"}>
        <text fg={theme.textMuted}>
          {"Enter your Kibana URL to connect:"}
        </text>

        <textarea
          height={1}
          ref={(val: TextareaRenderable) => { urlInput = val }}
          placeholder={"https://my-kibana.example.com:5601"}
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.primary}
          keyBindings={[{ name: "return", action: "submit" }]}
          onSubmit={() => submitKibanaUrl()}
        />

        <Show when={error()}>
          <text fg={"#ff6b6b"}>{error()}</text>
        </Show>

        <box paddingBottom={1} flexDirection="column" gap={0}>
          <text fg={theme.text}>
            enter <span style={{ fg: theme.textMuted }}>connect</span>
          </text>
          <Show when={!!props.onEscape}>
            <text fg={theme.textMuted}>escape / ctrl+c  quit</text>
          </Show>
        </box>

        <box paddingTop={1}>
          <text
            fg={theme.textMuted}
            onMouseUp={() => {
              setMode("manual-json")
              setTimeout(() => jsonInput && !jsonInput.isDestroyed && jsonInput.focus(), 1)
            }}
          >
            {"Or paste credentials JSON manually ↓"}
          </text>
        </box>
      </Show>

      {/* Step 2: Waiting for Kibana callback */}
      <Show when={mode() === "kibana-callback"}>
        <box flexDirection="row" gap={0}>
          <text fg={theme.textMuted}>Requires </text>
          <text fg={theme.text}>elasticRamen:enabled</text>
          <text fg={theme.textMuted}> in Kibana </text>
          <Link href={settingsLink() ?? "#"} fg={theme.primary}><b>Advanced Settings</b></Link>
        </box>
        <text fg={theme.textMuted}>
          {"Open the Kibana onboarding page — credentials will be sent here automatically."}
        </text>

        <Show when={link()}>
          <Link href={link()!} fg={theme.primary} wrapMode="char"><b>Open onboarding page</b></Link>
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
              setMode("manual-json")
              setTimeout(() => jsonInput && !jsonInput.isDestroyed && jsonInput.focus(), 1)
            }}
          >
            {"Or paste credentials JSON ↓"}
          </text>
        </box>
      </Show>

      {/* Manual JSON paste mode */}
      <Show when={mode() === "manual-json"}>
        <text fg={theme.textMuted}>
          {"Paste the JSON from the Kibana onboarding page:"}
        </text>

        <textarea
          height={5}
          ref={(val: TextareaRenderable) => { jsonInput = val }}
          placeholder={'{"kibanaUrl": "...", "elasticsearchUrl": "...", "apiKey": "..."}'}
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.primary}
          keyBindings={[{ name: "return", action: "submit" }]}
          onSubmit={() => submitManual().catch((e: Error) => setError("Setup failed: " + e.message))}
        />

        <Show when={error()}>
          <text fg={"#ff6b6b"}>{error()}</text>
        </Show>

        <box paddingBottom={1}>
          <Show when={!saving()} fallback={<text fg={theme.textMuted}>connecting...</text>}>
            <text fg={theme.text}>
              enter <span style={{ fg: theme.textMuted }}>connect</span>
            </text>
          </Show>
        </box>
      </Show>
    </box>
  )
}
