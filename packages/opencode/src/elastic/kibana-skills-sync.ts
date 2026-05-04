// Copyright (c) 2026-present, Elastic NV
import path from "path"
import { readdir, rm } from "fs/promises"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import { ElasticAuth } from "./auth"
import { KibanaGateway } from "./kibana-gateway"

const log = Log.create({ service: "kibana-skills" })
const ttlMs = 60 * 60 * 1000

function slug(id: string) {
  const s = id.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "")
  return s.length > 0 ? s : "skill"
}

function markdown(d: KibanaGateway.AgentBuilderSkillDetail) {
  const lines = [
    "---",
    `name: ${JSON.stringify(d.name)}`,
    `description: ${JSON.stringify(d.description)}`,
    "---",
    "",
    d.content,
  ]
  const r = d.referenced_content
  if (r?.length) {
    for (const x of r) {
      lines.push("", `## ${x.name}`, "", x.content)
    }
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

  async function fresh(key: string, force: boolean) {
    if (force) return true
    const m = await Filesystem.readJson<{ k?: string; t?: number }>(stampPath()).catch(() => undefined)
    if (!m || m.k !== key || typeof m.t !== "number") return true
    return Date.now() - m.t > ttlMs
  }

  /**
   * Pull Agent Builder skills from Kibana into `~/.config/elastic-ramen/skill/kibana/<id>/SKILL.md`
   * so they load with other Ramen skills. Best-effort; logs on failure.
   */
  export async function sync(opts?: { force?: boolean }) {
    if (process.env.OPENCODE_TEST_HOME) return
    const status = await ElasticAuth.check()
    if (!status.configured || !status.context?.kibana_url || !status.context.api_key) return
    const kb = status.context.kibana_url
    const key = status.context.api_key
    const stamp = `${status.name ?? "default"}|${kb}`
    if (!(await fresh(stamp, opts?.force ?? false))) return

    const list = await KibanaGateway.tryFetchAgentBuilderSkillList(kb, key, { includePlugins: true })
    if (list === undefined) {
      log.warn("could not list Kibana skills — check API key and Agent Builder access")
      return
    }

    const root = syncRoot()
    const keep = new Set<string>()
    const size = 10
    for (let i = 0; i < list.length; i += size) {
      const pack = list.slice(i, i + size)
      await Promise.all(
        pack.map(async (row) => {
          const d = await KibanaGateway.tryFetchAgentBuilderSkill(kb, key, row.id)
          if (!d) {
            log.warn("skipped Kibana skill", { id: row.id })
            return
          }
          const id = slug(d.id)
          keep.add(id)
          await Filesystem.write(path.join(root, id, "SKILL.md"), markdown(d))
        }),
      )
    }

    if (await Filesystem.isDir(root)) {
      for (const name of await readdir(root)) {
        if (keep.has(name)) continue
        await rm(path.join(root, name), { recursive: true, force: true })
      }
    }

    await Filesystem.writeJson(stampPath(), { k: stamp, t: Date.now() })
  }
}
