// Copyright (c) 2026-present, Elastic NV
import path from "path"
import os from "os"
import { Filesystem } from "@/util/filesystem"
import { KibanaGateway } from "./kibana-gateway"

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

  /**
   * Normalize a profile name into a YAML-safe context key.
   * Replaces invalid chars with `_`, collapses runs, trims, caps at 64. Empty → `"default"`.
   */
  export function canon(raw: string | undefined): string {
    const t = (raw ?? "")
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
    if (!t) return "default"
    return t.length > 64 ? t.slice(0, 64) : t
  }

  /** First hostname label, or `undefined` if the URL is unparseable. */
  function hostHead(url: string): string | undefined {
    try {
      const u = new URL(url.trim().replace(/\/+$/, ""))
      const first = u.hostname.split(".")[0]
      return first && first.length > 0 ? first : undefined
    } catch {
      return undefined
    }
  }

  /** Cloud deployment URLs match `<id>.<service>.<region>...`; keep the part before the last hyphen as the name. */
  function cloudDeploymentName(url: string, service: "kb" | "es"): string | undefined {
    try {
      const host = new URL(url.trim().replace(/\/+$/, "")).hostname
      const m = host.match(new RegExp(`^([^.]+)\\.${service}\\.[^.]+\\.`))
      const id = m?.[1]
      if (!id) return undefined
      const i = id.lastIndexOf("-")
      return i > 0 ? id.slice(0, i) : id
    } catch {
      return undefined
    }
  }

  /** Profile name from Kibana URL. Cloud `name-hash.kb...` → `name`; otherwise first hostname label. */
  export function profileNameFromKibanaUrl(url: string): string {
    return canon(cloudDeploymentName(url, "kb") ?? hostHead(url))
  }

  /** Profile name from Elasticsearch URL. Cloud `name-hash.es...` → `name`; otherwise first hostname label. */
  export function profileNameFromElasticsearchUrl(url: string): string {
    return canon(cloudDeploymentName(url, "es") ?? hostHead(url))
  }

  export function profileNameFromSetup(kibanaUrl?: string, elasticsearchUrl?: string): string {
    if (kibanaUrl) return profileNameFromKibanaUrl(kibanaUrl)
    if (elasticsearchUrl) return profileNameFromElasticsearchUrl(elasticsearchUrl)
    return "default"
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

  /**
   * True when `currentModel` is `kibana/<connector>` and `<connector>` exists in the new
   * provider's models map. Used to decide whether to preserve the user's connector pick
   * across a profile switch, or fall back to the default.
   */
  export function shouldKeepKibanaModel(currentModel: unknown, provider: unknown): boolean {
    if (typeof currentModel !== "string" || !currentModel.startsWith("kibana/")) return false
    const connector = currentModel.slice("kibana/".length)
    if (!connector) return false
    const models = (provider as { kibana?: { models?: Record<string, unknown> } })?.kibana?.models ?? {}
    return connector in models
  }

  /**
   * Write `provider` (and optionally `model`) into the project's `elastic_ramen.json`,
   * ensure the eab MCP entry, and clear any provider/model overrides under `.elastic-ramen/`.
   *
   * `preserveModelIfKibana` keeps an existing `kibana/<connector>` choice — but only if
   * `<connector>` exists in the new provider's models map (see {@link shouldKeepKibanaModel}).
   */
  async function writeProjectConfig(opts: { provider: unknown; model?: string; preserveModelIfKibana?: boolean }) {
    let cfg = await configJsonPath()
    if (!cfg) cfg = path.join(process.cwd(), "elastic_ramen.json")
    const json = (await Filesystem.readJson(cfg).catch(() => ({ $schema: "https://elastic.co/config.json" }))) as Record<string, unknown>
    json.provider = opts.provider
    if (opts.model) {
      const keep = (opts.preserveModelIfKibana ?? false) && shouldKeepKibanaModel(json.model, opts.provider)
      if (!keep) json.model = opts.model
    }
    ensureEab(json)
    await Filesystem.writeJson(cfg, json)
    for (const name of ["elastic_ramen.jsonc", "elastic_ramen.json"]) {
      const override = path.join(process.cwd(), ".elastic-ramen", name)
      if (!(await Filesystem.exists(override))) continue
      const overrideJson = await Filesystem.readJson(override).catch(() => undefined)
      if (overrideJson && (overrideJson.provider || overrideJson.model)) {
        delete overrideJson.provider
        delete overrideJson.model
        await Filesystem.writeJson(override, overrideJson)
      }
    }
  }

  /**
   * Pre-flight a profile switch: build the provider against the target context, then write
   * YAML and project config. If buildProvider throws (network/auth), nothing on disk changes.
   */
  async function commitSwitch(currentName: string, contexts: Record<string, Context>) {
    const ctx = contexts[currentName]
    let provider: Awaited<ReturnType<typeof KibanaGateway.buildProvider>> | undefined
    if (ctx?.kibana_url && ctx.api_key) {
      provider = await KibanaGateway.buildProvider(ctx.kibana_url, ctx.api_key)
    }
    await Bun.write(filepath(), toYaml({ current: currentName, contexts }), { mode: 0o600 } as any)
    if (provider) await writeProjectConfig({ provider, model: "kibana/default", preserveModelIfKibana: true })
  }

  export async function setCurrent(name: string) {
    const key = canon(name)
    const raw = await readRaw()
    if (!raw || !raw.contexts[key]) throw new Error(`Unknown profile "${key}"`)
    await commitSwitch(key, raw.contexts)
  }

  export async function removeContext(name: string) {
    const key = canon(name)
    const raw = await readRaw()
    if (!raw || !raw.contexts[key]) return
    const keys = Object.keys(raw.contexts)
    if (keys.length <= 1) throw new Error("Cannot remove the only profile")

    const next = { ...raw.contexts }
    delete next[key]

    if (raw.current === key) {
      const newCurrent = keys.filter((k) => k !== key).toSorted()[0]!
      await commitSwitch(newCurrent, next)
    } else {
      await Bun.write(filepath(), toYaml({ current: raw.current, contexts: next }), { mode: 0o600 } as any)
    }
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

    if (input.provider) await writeProjectConfig({ provider: input.provider, model: input.model })
  }
}
