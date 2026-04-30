// Copyright (c) 2026-present, Elastic NV
import path from "path"
import os from "os"
import { Filesystem } from "@/util/filesystem"
import { kibanaProvider } from "./kibana-provider"

export namespace ElasticAuth {
  export interface Context {
    cloud_id?: string
    api_key?: string
    username?: string
    password?: string
    elasticsearch_url?: string
    kibana_url?: string
    auth_mode?: string
  }

  export interface Status {
    configured: boolean
    name?: string
    context?: Context
    missing?: string[]
  }

  export interface SaveInput {
    elasticsearch_url?: string
    cloud_id?: string
    kibana_url?: string
    api_key?: string
    auth_mode?: string
    provider?: Record<string, unknown>
    model?: string
    /** Profile name (YAML context key). Default `default`. */
    context?: string
    /** If true (default), make this profile active after save. */
    activate?: boolean
  }

  export interface ProfileList {
    names: string[]
    current: string
  }

  /** Same directory as the elastic Go CLI: filepath.Join(os.UserConfigDir(), "elastic") */
  function dir() {
    if (process.platform === "win32")
      return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "elastic")
    if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "elastic")
    const xdg = process.env.XDG_CONFIG_HOME
    if (xdg) return path.join(xdg, "elastic")
    return path.join(os.homedir(), ".config", "elastic")
  }

  function filepath() {
    return path.join(dir(), "config.yaml")
  }

  export function configPath(): string {
    return filepath()
  }

  /** Decode a Cloud ID into ES and Kibana URLs. Format: `name:base64(host$es_uuid$kibana_uuid)` */
  export function decodeCloudId(cloudId: string): { elasticsearch_url: string; kibana_url: string } | undefined {
    const parts = cloudId.split(":")
    if (parts.length < 2) return undefined
    try {
      const decoded = Buffer.from(parts.slice(1).join(":"), "base64").toString("utf-8")
      const [host, esUuid, kibanaUuid] = decoded.split("$")
      if (!host || !esUuid) return undefined
      return {
        elasticsearch_url: `https://${esUuid}.${host}`,
        kibana_url: kibanaUuid ? `https://${kibanaUuid}.${host}` : undefined!,
      }
    } catch {
      return undefined
    }
  }

  function parseYaml(raw: string): Record<string, any> {
    const result: Record<string, any> = {}
    let current: Record<string, any> | undefined
    let section: string | undefined
    let indent = 0

    for (const line of raw.split("\n")) {
      if (line.trimStart().startsWith("#") || line.trim() === "") continue

      const spaces = line.length - line.trimStart().length
      const trimmed = line.trim()
      const colon = trimmed.indexOf(":")
      if (colon === -1) continue

      const key = trimmed.slice(0, colon).trim()
      const val = trimmed.slice(colon + 1).trim().replace(/^["']|["']$/g, "")

      if (spaces === 0) {
        if (val === "" || val === "{}") {
          result[key] = val === "{}" ? {} : {}
          section = key
          current = undefined
          indent = 0
        } else {
          result[key] = val
        }
      } else if (section === "contexts" && spaces <= 4 && val === "") {
        current = {}
        result.contexts = result.contexts || {}
        result.contexts[key] = current
      } else if (current && spaces > indent) {
        current[key] = val
      }

      if (spaces > 0 && indent === 0) indent = spaces
    }

    return result
  }

  function toYaml(cfg: { current: string; contexts: Record<string, Context> }): string {
    const lines: string[] = []
    lines.push(`current-context: ${cfg.current}`)
    lines.push("contexts:")
    for (const [name, ctx] of Object.entries(cfg.contexts)) {
      lines.push(`  ${name}:`)
      if (ctx.cloud_id) lines.push(`    cloud_id: "${ctx.cloud_id}"`)
      if (ctx.elasticsearch_url) lines.push(`    elasticsearch_url: "${ctx.elasticsearch_url}"`)
      if (ctx.kibana_url) lines.push(`    kibana_url: "${ctx.kibana_url}"`)
      if (ctx.api_key) lines.push(`    api_key: "${ctx.api_key}"`)
      if (ctx.username) lines.push(`    username: "${ctx.username}"`)
      if (ctx.password) lines.push(`    password: "${ctx.password}"`)
      if (ctx.auth_mode) lines.push(`    auth_mode: "${ctx.auth_mode}"`)
    }
    lines.push("")
    return lines.join("\n")
  }

  function canon(raw: string | undefined): string {
    const t = (raw ?? "").trim()
    if (!t) return "default"
    if (!/^[a-zA-Z0-9_-]+$/.test(t)) {
      throw new Error("Profile name may only contain letters, digits, hyphen, and underscore")
    }
    return t
  }

  async function readRaw(): Promise<{ current: string; contexts: Record<string, Context> } | undefined> {
    const fp = filepath()
    if (!(await Filesystem.exists(fp))) return undefined
    const raw = await Bun.file(fp).text().catch(() => "")
    if (!raw.trim()) return undefined
    const cfg = parseYaml(raw)
    const cur = cfg["current-context"]
    const bag = cfg.contexts
    if (!cur || !bag || typeof bag !== "object") return undefined
    const contexts: Record<string, Context> = {}
    for (const [k, v] of Object.entries(bag)) {
      if (v && typeof v === "object") contexts[k] = { ...(v as Context) }
    }
    if (Object.keys(contexts).length === 0) return undefined
    return { current: String(cur), contexts }
  }

  export async function profiles(): Promise<ProfileList> {
    const raw = await readRaw()
    if (!raw) return { names: [], current: "default" }
    const names = Object.keys(raw.contexts).toSorted()
    return { names, current: raw.current }
  }

  export async function check(): Promise<Status> {
    const fp = filepath()
    if (!(await Filesystem.exists(fp))) return { configured: false, missing: ["config file"] }

    const raw = await Bun.file(fp).text().catch(() => "")
    if (!raw.trim()) return { configured: false, missing: ["config file"] }

    const cfg = parseYaml(raw)
    const name = cfg["current-context"]
    if (!name) return { configured: false, missing: ["current-context"] }

    const ctx = cfg.contexts?.[name] as Context | undefined
    if (!ctx) return { configured: false, missing: [`context "${name}"`] }

    // Derive ES/Kibana URLs from Cloud ID if not explicitly set
    if (ctx.cloud_id && (!ctx.elasticsearch_url || !ctx.kibana_url)) {
      const decoded = decodeCloudId(ctx.cloud_id)
      if (decoded) {
        if (!ctx.elasticsearch_url) ctx.elasticsearch_url = decoded.elasticsearch_url
        if (!ctx.kibana_url && decoded.kibana_url) ctx.kibana_url = decoded.kibana_url
      }
    }

    const missing: string[] = []
    if (!ctx.cloud_id && !ctx.elasticsearch_url) missing.push("elasticsearch_url or cloud_id")
    if (!ctx.api_key && !(ctx.username && ctx.password)) missing.push("api_key")

    if (missing.length) return { configured: false, name, context: ctx, missing }
    return { configured: true, name, context: ctx }
  }

  async function configJsonPath(): Promise<string | undefined> {
    const cwd = process.cwd()
    for (const name of ["elastic_ramen.json", "elastic_ramen.jsonc"]) {
      const fp = path.join(cwd, name)
      if (await Filesystem.exists(fp)) return fp
    }
    return undefined
  }

  function ensureEab(json: Record<string, unknown>) {
    if (!json.mcp) json.mcp = {}
    const m = json.mcp as Record<string, unknown>
    if (!m["eab"]) {
      m["eab"] = {
        type: "local",
        command: ["elastic", "ab", "mcp", "proxy"],
        enabled: true,
      }
    }
    if (!json.permission) json.permission = {}
    const p = json.permission as Record<string, unknown>
    if (!p["eab_*"]) p["eab_*"] = "allow"
  }

  async function clearOverrides() {
    for (const name of ["elastic_ramen.jsonc", "elastic_ramen.json"]) {
      const override = path.join(process.cwd(), ".elastic-ramen", name)
      if (await Filesystem.exists(override)) {
        const overrideJson = await Filesystem.readJson(override).catch(() => undefined)
        if (overrideJson && (overrideJson.provider || overrideJson.model)) {
          delete overrideJson.provider
          delete overrideJson.model
          await Filesystem.writeJson(override, overrideJson)
        }
      }
    }
  }

  /** Rewrite project `elastic_ramen` provider + model from the active YAML context (after profile switch). */
  export async function applyProjectProvider() {
    const status = await check()
    if (!status.configured || !status.context) return
    const kb = status.context.kibana_url
    const key = status.context.api_key
    if (!kb || !key) return

    const provider = kibanaProvider(kb, key)
    let cfg = await configJsonPath()
    if (!cfg) cfg = path.join(process.cwd(), "elastic_ramen.json")
    const json = (await Filesystem.readJson(cfg).catch(() => ({ $schema: "https://elastic.co/config.json" }))) as Record<string, unknown>
    json.provider = provider
    const m = json.model
    if (typeof m !== "string" || !m.startsWith("kibana/")) json.model = "kibana/default"
    ensureEab(json)
    await Filesystem.writeJson(cfg, json)
    await clearOverrides()
  }

  export async function setCurrent(name: string) {
    const key = canon(name)
    const raw = await readRaw()
    if (!raw || !raw.contexts[key]) throw new Error(`Unknown profile "${key}"`)

    const fp = filepath()
    await Bun.write(fp, toYaml({ current: key, contexts: raw.contexts }), { mode: 0o600 } as any)
    await applyProjectProvider()
  }

  export async function removeContext(name: string) {
    const key = canon(name)
    const raw = await readRaw()
    if (!raw || !raw.contexts[key]) return
    const keys = Object.keys(raw.contexts)
    if (keys.length <= 1) throw new Error("Cannot remove the only profile")

    const next = { ...raw.contexts }
    delete next[key]

    let current = raw.current
    if (current === key) {
      const rest = keys.filter((k) => k !== key).toSorted()
      current = rest[0]!
    }

    const fp = filepath()
    await Bun.write(fp, toYaml({ current, contexts: next }), { mode: 0o600 } as any)
    await applyProjectProvider()
  }

  async function writeElasticRamenFromSave(input: SaveInput) {
    if (!input.provider) return
    let cfg = await configJsonPath()
    if (!cfg) cfg = path.join(process.cwd(), "elastic_ramen.json")
    const json = (await Filesystem.readJson(cfg).catch(() => ({ $schema: "https://elastic.co/config.json" }))) as Record<string, unknown>
    json.provider = input.provider
    if (input.model) json.model = input.model
    ensureEab(json)
    await Filesystem.writeJson(cfg, json)
    await clearOverrides()
  }

  export async function reset() {
    const { unlink } = await import("fs/promises")
    await unlink(filepath()).catch(() => {})

    const cfg = await configJsonPath()
    if (cfg) {
      const json = await Filesystem.readJson(cfg).catch(() => ({}))
      delete json.provider
      delete json.model
      await Filesystem.writeJson(cfg, json)
    }
  }

  export async function save(input: SaveInput) {
    const fp = filepath()
    const d = dir()

    await Bun.write(d + "/.keep", "").catch(() => {})
    const { mkdir } = await import("fs/promises")
    await mkdir(d, { recursive: true, mode: 0o700 })

    const name = canon(input.context)
    const activate = input.activate !== false

    const ctx: Context = {}
    if (input.cloud_id) ctx.cloud_id = input.cloud_id
    if (input.elasticsearch_url) ctx.elasticsearch_url = input.elasticsearch_url
    if (input.kibana_url) ctx.kibana_url = input.kibana_url
    if (input.api_key) ctx.api_key = input.api_key
    if (input.auth_mode) ctx.auth_mode = input.auth_mode

    let merged: Record<string, Context> = {}
    let priorCurrent = name
    const existing = await readRaw()
    if (existing) {
      merged = { ...existing.contexts }
      priorCurrent = existing.current
      const prev = merged[name] ?? {}
      merged[name] = { ...prev, ...ctx }
    } else {
      merged[name] = ctx
    }

    const current = activate ? name : priorCurrent
    const yaml = toYaml({ current, contexts: merged })
    await Bun.write(fp, yaml, { mode: 0o600 } as any)

    await writeElasticRamenFromSave(input)
  }
}
