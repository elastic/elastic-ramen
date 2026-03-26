import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { Link } from "@tui/ui/link"
import { ElasticAuth } from "@/elastic/auth"
import { ElasticBin } from "@/elastic/bin"
import { ElasticCallback } from "@/elastic/callback"
import { Process } from "@/util/process"

function buildProvider(kibanaUrl: string, apiKey: string) {
  const baseURL = kibanaUrl.replace(/\/+$/, "") + "/internal/elastic_console/v1"
  return {
    kibana: {
      name: "Kibana LLM Gateway",
      id: "kibana",
      npm: "@ai-sdk/openai-compatible",
      env: [],
      models: {
        default: {
          id: "default",
          name: "Default Connector",
          attachment: false,
          reasoning: false,
          temperature: true,
          tool_call: true,
          release_date: "2025-01-01",
          cost: { input: 0, output: 0 },
          limit: { context: 128000, output: 8192 },
        },
      },
      options: {
        baseURL,
        apiKey: "ignored",
        headers: {
          Authorization: `ApiKey ${apiKey}`,
          "kbn-xsrf": "true",
          "x-elastic-internal-origin": "kibana",
          "elastic-api-version": "2023-10-31",
        },
      },
    },
  }
}

export function DialogElasticSetup(props: { kibanaBase?: string; onComplete: () => void }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [error, setError] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [showManual, setShowManual] = createSignal(!props.kibanaBase)

  let jsonInput: TextareaRenderable
  let cb: ElasticCallback.Handle | undefined

  const link = () => {
    const base = props.kibanaBase?.replace(/\/+$/, "")
    if (!base) return undefined
    return base + "/app/elasticConsole"
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

    await ElasticAuth.save(input).catch((e: Error) => {
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

  function submitManual() {
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
    const kibanaUrl = parsed.kibanaUrl || parsed.kibana_url

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

    if (kibanaUrl) {
      input.kibana_url = kibanaUrl
      input.auth_mode = "kibana"
      input.provider = buildProvider(kibanaUrl, key)
      input.model = "kibana/default"
    }

    save(input)
  }

  useKeyboard((evt) => {
    if (!showManual()) return
    if (evt.name === "return" && (evt.ctrl || evt.meta)) {
      submitManual()
      evt.preventDefault()
      evt.stopPropagation()
    }
  })

  onMount(() => {
    dialog.setSize("large")

    if (props.kibanaBase) {
      cb = ElasticCallback.start()
      cb.promise.then((payload) => {
        const parsed = payload as Record<string, any>
        const es = parsed.es_url || parsed.elasticsearch_url
        const key = parsed.api_key
        const kb = parsed.kibana_url
        const input: ElasticAuth.SaveInput = { api_key: key, elasticsearch_url: es, auth_mode: "kibana" }
        if (kb) input.kibana_url = kb
        // Always construct provider ourselves to ensure correct baseURL and headers
        if (kb && key) {
          input.provider = buildProvider(kb, key)
        }
        if (parsed.model && typeof parsed.model === "string") input.model = parsed.model
        else if (input.provider) input.model = "kibana/default"
        save(input)
      })
    } else {
      setTimeout(() => jsonInput && !jsonInput.isDestroyed && jsonInput.focus(), 1)
    }
  })

  onCleanup(() => cb?.stop())

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Elastic Console Setup{props.kibanaBase ? " (experimental: Kibana onboarding)" : ""}
        </text>
      </box>

      <Show when={props.kibanaBase && !showManual()}>
        <text fg={theme.textMuted}>
          {"Open the Kibana onboarding page — credentials will be sent here automatically."}
        </text>

        <Show when={link()}>
          <Link href={link()!} fg={theme.primary} wrapMode="none">{link()}</Link>
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
              setShowManual(true)
              setTimeout(() => jsonInput && !jsonInput.isDestroyed && jsonInput.focus(), 1)
            }}
          >
            {"Or paste credentials JSON ↓"}
          </text>
        </box>
      </Show>

      <Show when={showManual()}>
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
        />

        <Show when={error()}>
          <text fg={"#ff6b6b"}>{error()}</text>
        </Show>

        <box paddingBottom={1}>
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
