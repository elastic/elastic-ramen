// Copyright (c) 2026-present, Elastic NV
import path from "path"
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser"
import { Filesystem } from "@/util/filesystem"
import { Global } from "@/global"
import { Config } from "@/config/config"
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
    const home = Global.Path.home
    if (process.platform === "win32")
      return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "elastic")
    if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "elastic")
    const xdg = process.env.XDG_CONFIG_HOME
    if (xdg) return path.join(xdg, "elastic")
    return path.join(home, ".config", "elastic")
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

  function isEnoent(e: unknown): boolean {
    return !!e && typeof e === "object" && "code" in e && (e as { code: string }).code === "ENOENT"
  }

  /**
   * Read a `.json` or `.jsonc` config. Returns `undefined` if the file is missing.
   * Throws on malformed content so we don't silently overwrite a corrupt file.
   */
  async function readConfigFile(fp: string): Promise<Record<string, unknown> | undefined> {
    const text = await Filesystem.readText(fp).catch((e: unknown) => {
      if (isEnoent(e)) return undefined
      throw e
    })
    if (text === undefined) return undefined
    if (!text.trim()) return {}
    const data = parseJsonc(text)
    if (data == null || typeof data !== "object" || Array.isArray(data)) return {}
    return data as Record<string, unknown>
  }

  type ConfigPatch = { path: string[]; value: unknown }

  function setDeep(obj: Record<string, unknown>, p: string[], value: unknown) {
    let cur = obj
    for (let i = 0; i < p.length - 1; i++) {
      const k = p[i]
      if (!cur[k] || typeof cur[k] !== "object" || Array.isArray(cur[k])) cur[k] = {}
      cur = cur[k] as Record<string, unknown>
    }
    const last = p[p.length - 1]
    if (value === undefined) delete cur[last]
    else cur[last] = value
  }

  /**
   * Apply `patches` to a config file. `value: undefined` deletes that key.
   * For `.jsonc`, uses `jsonc-parser` edits per patch to preserve comments and formatting
   * around untouched keys. For `.json`, reads → mutates → writes plain JSON.
   */
  async function patchConfigFile(fp: string, patches: ConfigPatch[]) {
    const before = await Filesystem.readText(fp).catch((e: unknown) => {
      if (isEnoent(e)) return ""
      throw e
    })

    if (fp.endsWith(".jsonc") && before.trim()) {
      let next = before
      for (const { path: p, value } of patches) {
        const edits = modify(next, p, value, { formattingOptions: { insertSpaces: true, tabSize: 2 } })
        next = applyEdits(next, edits)
      }
      await Filesystem.write(fp, next)
      return
    }

    const merged: Record<string, unknown> = before.trim() ? ((parseJsonc(before) as Record<string, unknown>) ?? {}) : {}
    for (const { path: p, value } of patches) setDeep(merged, p, value)
    await Filesystem.writeJson(fp, merged)
  }

  /** Strip `provider`/`model` from any project-local config left over from old setups. */
  async function stripProjectProviderModel() {
    const cwd = process.cwd()
    const candidates = [
      path.join(cwd, "elastic_ramen.json"),
      path.join(cwd, "elastic_ramen.jsonc"),
      path.join(cwd, ".elastic-ramen", "elastic_ramen.json"),
      path.join(cwd, ".elastic-ramen", "elastic_ramen.jsonc"),
    ]
    for (const fp of candidates) {
      const json = await readConfigFile(fp).catch(() => undefined)
      if (!json) continue
      if (!("provider" in json) && !("model" in json)) continue
      await patchConfigFile(fp, [
        { path: ["provider"], value: undefined },
        { path: ["model"], value: undefined },
      ])
    }
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

  function remoteEabMatches(eab: Record<string, unknown> | undefined, kibana: { url: string; apiKey: string }) {
    if (!eab || eab.type !== "remote" || typeof eab.url !== "string") return false
    const want = kibana.url.replace(/\/+$/, "") + "/api/agent_builder/mcp"
    if (eab.url !== want) return false
    const h = eab.headers
    if (!h || typeof h !== "object" || Array.isArray(h)) return false
    return (h as Record<string, string>).Authorization === "ApiKey " + kibana.apiKey
  }

  function pushEabMcpPatches(
    patches: ConfigPatch[],
    existing: Record<string, unknown>,
    kibana?: { url: string; apiKey: string },
  ) {
    const mcp = existing.mcp as Record<string, unknown> | undefined
    const eab = mcp?.eab as Record<string, unknown> | undefined
    const hadEab = !!(eab && typeof eab === "object")
    const legacy =
      hadEab &&
      eab!.type === "local" &&
      Array.isArray(eab!.command) &&
      (eab!.command as unknown[])[0] === "elastic"

    if (legacy) patches.push({ path: ["mcp", "eab"], value: undefined })

    if (kibana) {
      const gap = !hadEab || legacy
      const needsRemote = gap || !remoteEabMatches(eab, kibana)
      if (needsRemote) {
        patches.push({
          path: ["mcp", "eab"],
          value: {
            type: "remote",
            url: kibana.url.replace(/\/+$/, "") + "/api/agent_builder/mcp",
            headers: { Authorization: "ApiKey " + kibana.apiKey },
          },
        })
      }
    }

    const permission = existing.permission as Record<string, unknown> | undefined
    if (!permission || !permission["eab_*"]) {
      patches.push({ path: ["permission", "eab_*"], value: "allow" })
    }
  }

  /**
   * Build the EAB `Config.Mcp` entry from a pre-resolved auth result.
   * Returns `undefined` when Kibana credentials are absent.
   */
  export function eabMcpFromAuth(auth: Awaited<ReturnType<typeof check>>): Config.Mcp | undefined {
    if (!auth.configured || !auth.context?.kibana_url || !auth.context?.api_key) return undefined
    return {
      type: "remote",
      url: auth.context.kibana_url.replace(/\/+$/, "") + "/api/agent_builder/mcp",
      headers: { Authorization: "ApiKey " + auth.context.api_key },
    }
  }

  /** Remote Agent Builder MCP derived from the active Elastic CLI profile (when Kibana + API key exist). */
  export async function remoteEabMcp(): Promise<Config.Mcp | undefined> {
    return eabMcpFromAuth(await check())
  }

  /**
   * Persist `mcp.eab` + `permission.eab_*` to global config when auth has Kibana credentials
   * and the file is missing or stale. Does not dispose Instance (safe during MCP init).
   *
   * Accepts a pre-resolved auth result to avoid a redundant `check()` call when the
   * caller already holds one (e.g. `resolvedMcpConfig`).
   */
  export async function ensureEabMcpOnDisk(auth?: Awaited<ReturnType<typeof check>>) {
    const resolved = auth ?? (await check())
    if (!resolved.configured || !resolved.context?.kibana_url || !resolved.context?.api_key) return
    const kibana = { url: resolved.context.kibana_url, apiKey: resolved.context.api_key }
    const cfgPath = Config.globalConfigFile()
    const existing = (await readConfigFile(cfgPath)) ?? {}
    const patches: ConfigPatch[] = []
    pushEabMcpPatches(patches, existing, kibana)
    if (patches.length === 0) return
    await patchConfigFile(cfgPath, patches)
  }

  /**
   * Write `provider` (and optionally `model`) into the global `elastic_ramen.json`,
   * ensure the eab MCP entry when Kibana credentials are known, and strip any leftover
   * provider/model from project-local configs so global is the single source of truth.
   *
   * `preserveModelIfKibana` keeps an existing `kibana/<connector>` choice — but only if
   * `<connector>` exists in the new provider's models map (see {@link shouldKeepKibanaModel}).
   */
  async function writeGlobalConfig(opts: {
    provider: unknown
    model?: string
    preserveModelIfKibana?: boolean
    kibana?: { url: string; apiKey: string }
  }) {
    const cfg = Config.globalConfigFile()
    const existing = (await readConfigFile(cfg)) ?? {}

    const patches: ConfigPatch[] = []
    if (existing.$schema === undefined) patches.push({ path: ["$schema"], value: "https://elastic.co/config.json" })
    patches.push({ path: ["provider"], value: opts.provider })
    if (opts.model) {
      const keep = (opts.preserveModelIfKibana ?? false) && shouldKeepKibanaModel(existing.model, opts.provider)
      if (!keep) patches.push({ path: ["model"], value: opts.model })
    }

    pushEabMcpPatches(patches, existing, opts.kibana)

    await patchConfigFile(cfg, patches)
    await stripProjectProviderModel()
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
    const kibana = ctx?.kibana_url && ctx.api_key ? { url: ctx.kibana_url, apiKey: ctx.api_key } : undefined
    if (provider)
      await writeGlobalConfig({ provider, model: "kibana/default", preserveModelIfKibana: true, kibana })
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

    const cfg = Config.globalConfigFile()
    const existing = await readConfigFile(cfg).catch(() => undefined)
    if (existing && ("provider" in existing || "model" in existing)) {
      await patchConfigFile(cfg, [
        { path: ["provider"], value: undefined },
        { path: ["model"], value: undefined },
      ])
    }
    await stripProjectProviderModel()
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

    if (input.provider) {
      const kibana = input.kibana_url && input.api_key ? { url: input.kibana_url, apiKey: input.api_key } : undefined
      await writeGlobalConfig({ provider: input.provider, model: input.model, kibana })
    }
  }
}
