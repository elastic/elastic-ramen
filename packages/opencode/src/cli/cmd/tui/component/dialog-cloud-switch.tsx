import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useToast } from "../ui/toast"
import { useRenderer } from "@opentui/solid"
import { createSignal, createMemo, onMount } from "solid-js"
import { ElasticAuth } from "@/elastic/auth"
import { ElasticCloud } from "@/elastic/cloud"
import { spawnSync } from "child_process"

const STRIP_FLAGS = ["--kibana-base", "--cloud-api-key", "--reset-auth"]

function filterArgs(argv: string[]): string[] {
  const result: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (STRIP_FLAGS.some((f) => arg === f || arg.startsWith(f + "="))) {
      // If it's --flag value (no =), skip the next arg too
      if (!arg.includes("=") && arg !== "--reset-auth" && i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        i++
      }
      continue
    }
    result.push(arg)
  }
  return result
}

export function DialogCloudSwitch() {
  const dialog = useDialog()
  const toast = useToast()
  const renderer = useRenderer()

  const [projects, setProjects] = createSignal<ElasticCloud.Project[]>()
  const [cachedContexts, setCachedContexts] = createSignal<Record<string, ElasticAuth.Context>>({})
  const [loading, setLoading] = createSignal(true)

  onMount(async () => {
    dialog.setSize("large")
    try {
      const key = await ElasticAuth.cloudApiKey()
      if (!key) {
        toast.show({ variant: "error", message: "No Cloud API key configured. Start with --cloud-api-key flag.", duration: 5000 })
        dialog.clear()
        return
      }
      const [items, contexts] = await Promise.all([
        ElasticCloud.listProjects(key),
        ElasticAuth.listContexts(),
      ])
      setProjects(items)
      setCachedContexts(contexts)
    } catch (err) {
      toast.show({ variant: "error", message: err instanceof Error ? err.message : "Failed to list projects", duration: 5000 })
    } finally {
      setLoading(false)
    }
  })

  const options = createMemo(() => {
    if (loading()) return [{ title: "Loading projects…", value: "", disabled: true }]
    const items = projects()
    if (!items?.length) return [{ title: "No projects found", value: "", disabled: true }]
    const contexts = cachedContexts()
    return items.map((p) => {
      const cached = !!contexts[p.name]
      return {
        title: p.name,
        value: p.id,
        description: `${p.type} · ${p.region_id}${cached ? " · cached" : ""}`,
      }
    })
  })

  function restart() {
    renderer.destroy()
    const result = spawnSync(process.execPath, process.argv.slice(2), { stdio: "inherit" })
    process.exit(result.status ?? 0)
  }

  return (
    <DialogSelect
      title="Switch Cloud Project"
      options={options()}
      onSelect={async (option) => {
        if (!option.value) return
        dialog.clear()

        const project = projects()?.find((p) => p.id === option.value)
        if (!project) return

        const contexts = cachedContexts()
        const cached = contexts[project.name]

        if (cached?.api_key && cached?.elasticsearch_url) {
          // We have cached credentials — verify they still work
          const res = await fetch(cached.elasticsearch_url, {
            headers: { Authorization: `ApiKey ${cached.api_key}` },
          }).catch(() => null)

          if (res?.ok) {
            // Switch to cached context and restart
            await ElasticAuth.switchContext(project.name)
            restart()
            return
          }
        }

        // No cached credentials — open Kibana onboarding page
        const kibanaUrl = project.endpoints.kibana
        if (!kibanaUrl) {
          toast.show({ variant: "error", message: "Project has no Kibana endpoint", duration: 5000 })
          return
        }

        // Save cloud_api_key and project info, then restart with kibana-base pointing at the project
        const key = await ElasticAuth.cloudApiKey()
        if (key) {
          await ElasticAuth.save({ cloud_api_key: key, project_name: project.name })
        }

        // Restart with --kibana-base pointing at this project's Kibana
        renderer.destroy()
        const args = filterArgs(process.argv.slice(2))
        args.push(`--kibana-base=${kibanaUrl}`)
        const result = spawnSync(process.execPath, args, { stdio: "inherit" })
        process.exit(result.status ?? 0)
      }}
    />
  )
}
