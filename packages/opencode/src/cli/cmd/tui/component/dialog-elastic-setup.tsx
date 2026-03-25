import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { ElasticAuth } from "@/elastic/auth"
import { ElasticBin } from "@/elastic/bin"
import { ElasticCallback } from "@/elastic/callback"
import { ElasticCloud } from "@/elastic/cloud"
import { Process } from "@/util/process"
import { spawnSync } from "child_process"

const STRIP_FLAGS = ["--kibana-base", "--cloud-api-key", "--reset-auth"]

function filterArgs(argv: string[]): string[] {
  const result: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (STRIP_FLAGS.some((f) => arg === f || arg.startsWith(f + "="))) {
      if (!arg.includes("=") && arg !== "--reset-auth" && i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        i++
      }
      continue
    }
    result.push(arg)
  }
  return result
}

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

export function DialogElasticSetup(props: { kibanaBase?: string; cloudApiKey?: string; onComplete: () => void }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [error, setError] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [showManual, setShowManual] = createSignal(!props.kibanaBase && !props.cloudApiKey)
  const [cloudProjects, setCloudProjects] = createSignal<ElasticCloud.Project[]>([])
  const [cloudLoading, setCloudLoading] = createSignal(false)
  const [selectedProject, setSelectedProject] = createSignal(0)

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

  const renderer = useRenderer()

  async function selectCloudProject(project: ElasticCloud.Project) {
    if (!props.cloudApiKey) return
    setSaving(true)
    setError("")

    try {
      const kibanaUrl = project.endpoints.kibana

      // Check if we have cached credentials for this project
      const contexts = await ElasticAuth.listContexts()
      const cached = contexts[project.name]
      if (cached?.api_key && cached?.elasticsearch_url) {
        const res = await fetch(cached.elasticsearch_url, {
          headers: { Authorization: `ApiKey ${cached.api_key}` },
        }).catch(() => null)
        if (res?.ok) {
          await ElasticAuth.switchContext(project.name)
          renderer.destroy()
          const result = spawnSync(process.execPath, process.argv.slice(2), { stdio: "inherit" })
          process.exit(result.status ?? 0)
          return
        }
      }

      // No cached credentials — restart with --kibana-base to use Kibana onboarding
      await ElasticAuth.save({ cloud_api_key: props.cloudApiKey, project_name: project.name })
      renderer.destroy()
      const args = filterArgs(process.argv.slice(2))
      args.push(`--kibana-base=${kibanaUrl}`)
      const result = spawnSync(process.execPath, args, { stdio: "inherit" })
      process.exit(result.status ?? 0)
    } catch (e: any) {
      setError("Failed to connect: " + (e?.message ?? String(e)))
      setSaving(false)
    }
  }

  useKeyboard((evt) => {
    // Cloud project picker navigation
    if (props.cloudApiKey && cloudProjects().length > 0 && !showManual()) {
      if (evt.name === "up" || evt.name === "k") {
        setSelectedProject((i) => Math.max(0, i - 1))
        evt.preventDefault()
        evt.stopPropagation()
        return
      }
      if (evt.name === "down" || evt.name === "j") {
        setSelectedProject((i) => Math.min(cloudProjects().length - 1, i + 1))
        evt.preventDefault()
        evt.stopPropagation()
        return
      }
      if (evt.name === "return") {
        const project = cloudProjects()[selectedProject()]
        if (project) selectCloudProject(project)
        evt.preventDefault()
        evt.stopPropagation()
        return
      }
    }

    if (!showManual()) return
    if (evt.name === "return" && (evt.ctrl || evt.meta)) {
      submitManual()
      evt.preventDefault()
      evt.stopPropagation()
    }
  })

  onMount(() => {
    dialog.setSize("large")

    if (props.cloudApiKey) {
      // Save the cloud API key immediately so tools can use it
      ElasticAuth.save({ cloud_api_key: props.cloudApiKey }).catch(() => {})
      setCloudLoading(true)
      ElasticCloud.listProjects(props.cloudApiKey)
        .then((projects) => {
          setCloudProjects(projects)
          setCloudLoading(false)
        })
        .catch((e) => {
          setError("Failed to list projects: " + (e instanceof Error ? e.message : String(e)))
          setCloudLoading(false)
          setShowManual(true)
        })
    } else if (props.kibanaBase) {
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
          Elastic Console Setup{props.cloudApiKey ? " (Cloud)" : props.kibanaBase ? " (experimental: Kibana onboarding)" : ""}
        </text>
      </box>

      <Show when={props.cloudApiKey && !showManual()}>
        <Show when={cloudLoading()}>
          <text fg={theme.textMuted}>Loading projects...</text>
        </Show>
        <Show when={!cloudLoading() && cloudProjects().length > 0}>
          <text fg={theme.textMuted}>Select a project (↑/↓ to navigate, Enter to connect):</text>
          <box flexDirection="column" gap={0}>
            <For each={cloudProjects()}>
              {(project, index) => (
                <text
                  fg={index() === selectedProject() ? theme.primary : theme.text}
                  onMouseUp={() => selectCloudProject(project)}
                >
                  {index() === selectedProject() ? "▸ " : "  "}
                  {project.name}
                  <span style={{ fg: theme.textMuted }}> ({project.region_id})</span>
                </text>
              )}
            </For>
          </box>
        </Show>
        <Show when={!cloudLoading() && cloudProjects().length === 0 && !error()}>
          <text fg={theme.textMuted}>No serverless projects found.</text>
          <text fg={theme.textMuted}>Cloud API key saved — use the cloud_create_project tool to create a project.</text>
        </Show>
        <Show when={error()}>
          <text fg={"#ff6b6b"}>{error()}</text>
        </Show>
        <Show when={saving()}>
          <text fg={theme.textMuted}>connecting...</text>
        </Show>
      </Show>

      <Show when={!props.cloudApiKey && props.kibanaBase && !showManual()}>
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
