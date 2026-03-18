import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
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
  const [activeField, setActiveField] = createSignal<"host" | "key">("host")

  let hostInput: TextareaRenderable
  let keyInput: TextareaRenderable
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
    const host = hostInput?.plainText?.trim() ?? ""
    const key = keyInput?.plainText?.trim() ?? ""
    if (!host) {
      setError("Enter a Cloud ID or Elasticsearch URL")
      return
    }
    if (!key) {
      setError("Enter an API key")
      return
    }

    const input: ElasticAuth.SaveInput = { api_key: key }
    if (host.includes("://")) input.elasticsearch_url = host
    else input.cloud_id = host

    // Derive Kibana URL and set up LLM gateway provider
    let kibanaUrl: string | undefined
    if (input.cloud_id) {
      const decoded = ElasticAuth.decodeCloudId(input.cloud_id)
      if (decoded?.kibana_url) {
        input.kibana_url = decoded.kibana_url
        kibanaUrl = decoded.kibana_url
      }
    }
    if (kibanaUrl && key) {
      input.auth_mode = "kibana"
      input.provider = buildProvider(kibanaUrl, key)
      input.model = "kibana/default"
    }

    save(input)
  }

  useKeyboard((evt) => {
    if (!showManual()) return
    if (evt.name === "tab") {
      evt.preventDefault()
      evt.stopPropagation()
      if (activeField() === "host") {
        setActiveField("key")
        setTimeout(() => keyInput && !keyInput.isDestroyed && keyInput.focus(), 1)
      } else {
        setActiveField("host")
        setTimeout(() => hostInput && !hostInput.isDestroyed && hostInput.focus(), 1)
      }
      return
    }
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
      setTimeout(() => hostInput && !hostInput.isDestroyed && hostInput.focus(), 1)
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
          <text fg={theme.primary}>{link()}</text>
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
              setTimeout(() => hostInput && !hostInput.isDestroyed && hostInput.focus(), 1)
            }}
          >
            {"Or enter credentials manually ↓"}
          </text>
        </box>
      </Show>

      <Show when={showManual()}>
        <text fg={theme.textMuted}>
          {"Enter your Elasticsearch credentials to connect."}
        </text>

        <box gap={1}>
          <box>
            <text fg={theme.text}>
              {"Cloud ID or Elasticsearch URL *"}
            </text>
          </box>
          <textarea
            height={1}
            ref={(val: TextareaRenderable) => { hostInput = val }}
            placeholder={"my-deployment:dXMtY2Vud..."}
            textColor={theme.text}
            focusedTextColor={theme.text}
            cursorColor={theme.primary}
          />
        </box>

        <box gap={1}>
          <box>
            <text fg={theme.text}>
              {"API Key *"}
            </text>
          </box>
          <textarea
            height={1}
            ref={(val: TextareaRenderable) => { keyInput = val }}
            placeholder={"your-api-key"}
            textColor={theme.text}
            focusedTextColor={theme.text}
            cursorColor={theme.primary}
          />
        </box>

        <Show when={error()}>
          <text fg={"#ff6b6b"}>{error()}</text>
        </Show>

        <box paddingBottom={1} gap={1} flexDirection="row">
          <Show when={!saving()} fallback={<text fg={theme.textMuted}>connecting...</text>}>
            <text fg={theme.text}>
              tab <span style={{ fg: theme.textMuted }}>switch field</span>{"  "}ctrl+enter <span style={{ fg: theme.textMuted }}>connect</span>
            </text>
          </Show>
        </box>
      </Show>
    </box>
  )
}
