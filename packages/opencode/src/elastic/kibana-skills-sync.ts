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
const STAMP_FILE = ".sync-stamp.json"

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
  type Stamp = { lastSyncAt: number; kibanaUrl?: string }

  /**
   * Resolved active profile + auth context, or `null` if no profile is configured.
   *
   * The profile name is canonicalised through `ElasticAuth.canon` before it leaves this
   * function so all callers compose filesystem paths from a name guaranteed to match
   * `[a-zA-Z0-9_-]+` — `current-context` in `~/.config/elastic/config.yaml` is user-editable
   * and could otherwise carry path-traversal segments like `../../tmp/x`.
   */
  async function active(): Promise<{ profile: string; context: NonNullable<ElasticAuth.Status["context"]> } | null> {
    const status = await ElasticAuth.check().catch(() => undefined)
    if (!status?.configured || !status.context?.kibana_url || !status.context.api_key) return null
    return { profile: ElasticAuth.canon(status.name), context: status.context }
  }

  function syncRoot() {
    return path.join(Global.Path.config, "skill", "kibana")
  }

  function rootForProfile(profile: string) {
    return path.join(syncRoot(), profile)
  }

  function stampPath(profile: string) {
    return path.join(rootForProfile(profile), STAMP_FILE)
  }

  async function readStamp(profile: string): Promise<Stamp> {
    const s = await Filesystem.readJson<Stamp>(stampPath(profile)).catch(() => undefined)
    if (!s || typeof s !== "object") return { lastSyncAt: 0 }
    return {
      lastSyncAt: typeof s.lastSyncAt === "number" ? s.lastSyncAt : 0,
      kibanaUrl: typeof s.kibanaUrl === "string" ? s.kibanaUrl : undefined,
    }
  }

  function fresh(stamp: Stamp, kibanaUrl: string, force: boolean) {
    if (force) return true
    if (stamp.kibanaUrl && stamp.kibanaUrl !== kibanaUrl) return true
    if (!stamp.lastSyncAt) return true
    return Date.now() - stamp.lastSyncAt > TTL_MS
  }

  /** Outcome of a sync attempt — callers (e.g. the `/sync` slash command) branch on `status`. */
  export type Result =
    | { status: "synced"; count: number }
    | { status: "skipped"; reason: "test-env" | "no-profile" | "fresh" }
    | { status: "failed"; reason: "list" | "partial" | "escape" }

  /**
   * Pull Agent Builder skills from Kibana into
   * `~/.config/elastic-ramen/skill/kibana/<profile>/<id>/SKILL.md`. Always overwrites local
   * content — admin's version is authoritative; users can edit locally for ad-hoc tinkering
   * but their edits get replaced on the next sync. Best-effort; logs on failure and returns
   * a structured `Result` so the caller can show an honest toast.
   */
  export async function sync(opts?: { force?: boolean }): Promise<Result> {
    if (process.env.OPENCODE_TEST_HOME) return { status: "skipped", reason: "test-env" }
    const a = await active()
    if (!a) return { status: "skipped", reason: "no-profile" }
    const { profile, context } = a
    const kibanaUrl = context.kibana_url!
    const apiKey = context.api_key!
    const force = opts?.force ?? false

    const stamp = await readStamp(profile)
    if (!fresh(stamp, kibanaUrl, force)) return { status: "skipped", reason: "fresh" }

    const list = await KibanaGateway.tryFetchAgentBuilderSkillList(kibanaUrl, apiKey, { includePlugins: true })
    if (list === undefined) {
      log.warn("could not list Kibana skills — check API key and Agent Builder access")
      return { status: "failed", reason: "list" }
    }

    const root = path.resolve(rootForProfile(profile))
    const base = path.resolve(syncRoot())
    if (!Filesystem.contains(base, root)) {
      // Belt-and-braces: `active()` already canonicalises the profile name, so this
      // branch should be unreachable. Bail if a future refactor breaks that invariant —
      // we never want the destructive readdir/rm below pointed at a path outside our tree.
      log.error("refusing sync — resolved root escaped sync base", { profile, root, base })
      return { status: "failed", reason: "escape" }
    }
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
      return { status: "failed", reason: "partial" }
    }

    if (await Filesystem.isDir(root)) {
      for (const name of await readdir(root)) {
        if (name.startsWith(".")) continue
        if (keep.has(name)) continue
        await rm(path.join(root, name), { recursive: true, force: true })
      }
    }

    await Filesystem.writeJson(stampPath(profile), { lastSyncAt: Date.now(), kibanaUrl } satisfies Stamp)
    return { status: "synced", count: keep.size }
  }

  /**
   * Build a one-shot predicate that drops `SKILL.md` matches under inactive profiles' folders.
   *
   * Used by `Skill.state` so multi-profile users keep skills isolated per project: switching
   * `elastic-context` instantly swaps the surfaced set without a re-fetch. Files under unrelated
   * paths (the entire non-kibana skill tree) are passed through untouched.
   *
   * The predicate captures the active root once, so calling it many times during a scan is cheap.
   */
  export async function inactiveProfileFilter(): Promise<(file: string) => boolean> {
    const root = syncRoot()
    const a = await active()
    const activeRoot = a ? rootForProfile(a.profile) : null
    return (file: string) => {
      if (!Filesystem.contains(root, file)) return false
      if (!activeRoot) return true
      return !Filesystem.contains(activeRoot, file)
    }
  }
}
