// Copyright (c) 2026-present, Elastic NV
import { createHash } from "node:crypto"
import path from "path"
import { readdir, rm } from "fs/promises"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import { ElasticAuth } from "./auth"
import { KibanaGateway } from "./kibana-gateway"

const log = Log.create({ service: "kibana-skills" })
const TTL_MS = 60 * 60 * 1000
const BATCH_SIZE = 10

function slug(raw: string) {
  const trimmed = raw.trim()
  const sanitized = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "")
  if (sanitized.length > 0 && sanitized !== "." && sanitized !== "..") return sanitized
  return `skill-${createHash("sha256").update(trimmed).digest("hex").slice(0, 16)}`
}

function markdown(detail: KibanaGateway.AgentBuilderSkillDetail) {
  const lines = [
    "---",
    `name: ${JSON.stringify(detail.name)}`,
    `description: ${JSON.stringify(detail.description)}`,
    "---",
    "",
    detail.content,
  ]
  for (const ref of detail.referenced_content) {
    lines.push("", `## ${ref.name}`, "", ref.content)
  }
  return lines.join("\n")
}

export namespace KibanaSkillsSync {
  function syncRoot() {
    return path.join(Global.Path.config, "skill", "kibana")
  }

  function stampPath() {
    return path.join(Global.Path.state, "kibana-skills-sync.json")
  }

  async function fresh(cacheKey: string, force: boolean) {
    if (force) return true
    const stamp = await Filesystem.readJson<{ k?: string; t?: number }>(stampPath()).catch(() => undefined)
    if (!stamp || stamp.k !== cacheKey || typeof stamp.t !== "number") return true
    return Date.now() - stamp.t > TTL_MS
  }

  /**
   * Pull Agent Builder skills from Kibana into `~/.config/elastic-ramen/skill/kibana/<id>/SKILL.md`
   * so they load with other Ramen skills. Best-effort; logs on failure.
   */
  export async function sync(opts?: { force?: boolean }) {
    if (process.env.OPENCODE_TEST_HOME) return
    const status = await ElasticAuth.check()
    if (!status.configured || !status.context?.kibana_url || !status.context.api_key) return
    const kibanaUrl = status.context.kibana_url
    const apiKey = status.context.api_key
    const cacheKey = `${status.name ?? "default"}|${kibanaUrl}`
    if (!(await fresh(cacheKey, opts?.force ?? false))) return

    const list = await KibanaGateway.tryFetchAgentBuilderSkillList(kibanaUrl, apiKey, { includePlugins: true })
    if (list === undefined) {
      log.warn("could not list Kibana skills — check API key and Agent Builder access")
      return
    }

    const root = path.resolve(syncRoot())
    const keep = new Set<string>()
    let partial = false
    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      const batch = list.slice(i, i + BATCH_SIZE)
      await Promise.all(
        batch.map(async (row) => {
          const detail = await KibanaGateway.tryFetchAgentBuilderSkill(kibanaUrl, apiKey, row.id)
          if (!detail) {
            partial = true
            log.warn("skipped Kibana skill", { id: row.id })
            return
          }
          const id = slug(detail.id)
          const dest = path.resolve(path.join(root, id, "SKILL.md"))
          if (!Filesystem.contains(root, dest)) {
            partial = true
            log.warn("rejected Kibana skill path", { id: row.id, slug: id })
            return
          }
          keep.add(id)
          await Filesystem.write(dest, markdown(detail))
        }),
      )
    }

    if (partial) {
      log.warn("Kibana skills sync incomplete — keeping previous tree and stamp until all skills fetch")
      return
    }

    if (await Filesystem.isDir(root)) {
      for (const name of await readdir(root)) {
        if (keep.has(name)) continue
        await rm(path.join(root, name), { recursive: true, force: true })
      }
    }

    await Filesystem.writeJson(stampPath(), { k: cacheKey, t: Date.now() })
  }
}
