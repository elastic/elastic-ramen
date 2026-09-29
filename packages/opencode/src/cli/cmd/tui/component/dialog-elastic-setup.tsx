// Copyright (c) 2026-present, Elastic NV
// This file is derived from opencode (https://github.com/anomalyco/opencode)
// and has been modified by Elastic NV. Changes: updated Kibana app path to elasticRamen, switched to JSON-based manual auth input
import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { createSignal, onMount, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { Link } from "@tui/ui/link"
import { ElasticAuth } from "@/elastic/auth"
import { ElasticCli } from "@/elastic/cli"
import { KibanaGateway } from "@/elastic/kibana-gateway"
import { Spinner } from "./spinner"

export function DialogElasticSetup(props: { kibanaBase?: string; onComplete: () => Promise<void>; onEscape?: () => void }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [error, setError] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [step, setStep] = createSignal("")

  let jsonInput: TextareaRenderable

  const base = () => props.kibanaBase?.replace(/\/+$/, "")
  const link = () => {
    if (!base()) return undefined
    return base() + "/app/elasticRamen"
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
    setStep("Saving credentials…")

    const ctx = ElasticAuth.profileNameFromSetup(input.kibana_url, input.elasticsearch_url)
    await ElasticAuth.save({ ...input, context: ctx }).catch((e: Error) => {
      setError("Failed to save config: " + e.message)
      setSaving(false)
    })

    if (error()) return

    setStep("Verifying connection…")
    const health = await ElasticCli.run(["es", "cluster", "health"]).catch(() => ({ output: "", code: 1 }))

    if (health.code !== 0 && health.output?.includes("error")) {
      setSaving(false)
      setError("Saved, but could not connect. Check your credentials and try again.")
      return
    }

    setStep("Starting session…")
    await props.onComplete().finally(() => setSaving(false))
    dialog.clear()
  }

  async function submit() {
    const raw = jsonInput?.plainText?.trim() ?? ""
    if (!raw) {
      setError("Paste the JSON from the Kibana onboarding page")
      return
    }

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(raw)
    } catch {
      setError("Invalid JSON — paste the full JSON object from Kibana")
      return
    }

    const str = (...keys: string[]) => {
      for (const key of keys) {
        const val = parsed[key]
        if (typeof val === "string" && val) return val
      }
    }

    const es = str("elasticsearchUrl", "elasticsearch_url", "es_url")
    const key = str("apiKey", "api_key")
    const kib = str("kibanaUrl", "kibana_url")
    const cloud = str("cloud_id")

    if (!es && !cloud) {
      setError("JSON is missing an Elasticsearch URL or Cloud ID")
      return
    }
    if (!key) {
      setError("JSON is missing an API key")
      return
    }

    const input: ElasticAuth.SaveInput = { api_key: key }
    if (cloud) input.cloud_id = cloud
    else input.elasticsearch_url = es

    if (kib) {
      input.kibana_url = kib
      input.auth_mode = "kibana"
      try {
        input.provider = await KibanaGateway.buildProvider(kib, key)
      } catch (e) {
        setError("Could not reach Kibana to load connectors: " + (e as Error).message)
        return
      }
      input.model = "kibana/default"
    }

    await save(input)
  }

  useKeyboard((evt) => {
    if ((evt.name === "escape" || (evt.ctrl && evt.name === "c")) && props.onEscape) {
      props.onEscape()
      evt.preventDefault()
      evt.stopPropagation()
      return
    }
    if (evt.name === "return") {
      submit().catch((e: Error) => setError("Setup failed: " + e.message))
      evt.preventDefault()
      evt.stopPropagation()
    }
  })

  onMount(() => {
    dialog.setSize("large")
    setTimeout(() => jsonInput && !jsonInput.isDestroyed && jsonInput.focus(), 1)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Elastic RAMEN Setup
        </text>
      </box>

      <Show when={saving()}>
        <box flexDirection="column" gap={1} paddingTop={1} paddingBottom={1}>
          <Spinner color={theme.primary}>{step()}</Spinner>
        </box>
      </Show>

      <Show when={!saving()}>
        <Show when={!!settingsLink()}>
          <box flexDirection="row" gap={0}>
            <text fg={theme.textMuted}>Requires </text>
            <text fg={theme.text}>elasticRamen:enabled</text>
            <text fg={theme.textMuted}> in Kibana </text>
            <Link href={settingsLink()!} fg={theme.primary}><b>Advanced Settings</b></Link>
          </box>
        </Show>

        <text fg={theme.textMuted}>
          {"In Kibana, open /app/elasticRamen, create credentials, then paste the JSON here."}
        </text>

        <Show when={link()}>
          <text fg={theme.textMuted}>Create credentials: </text>
          <Link href={link()!} fg={theme.primary} wrapMode="char">{link()!}</Link>
        </Show>

        <textarea
          height={5}
          ref={(val: TextareaRenderable) => { jsonInput = val }}
          placeholder={'{"kibanaUrl": "...", "elasticsearchUrl": "...", "apiKey": "..."}'}
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.primary}
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
      </Show>
    </box>
  )
}
