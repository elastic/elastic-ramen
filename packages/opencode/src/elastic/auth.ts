import path from "path"
import os from "os"
import { Filesystem } from "@/util/filesystem"

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
  }

  function dir() {
    const xdg = process.env.XDG_CONFIG_HOME
    if (xdg) return path.join(xdg, "elastic")
    // Match Go's os.UserConfigDir() which the elastic CLI uses
    if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "elastic")
    if (process.platform === "win32") return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "elastic")
    return path.join(os.homedir(), ".config", "elastic")
  }

  function filepath() {
    return path.join(dir(), "config.yaml")
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

  async function configJson(): Promise<string | undefined> {
    const cwd = process.cwd()
    // Prefer elastic_console.json, fall back to opencode.json
    for (const name of ["elastic_console.json", "elastic_console.jsonc", "opencode.json", "opencode.jsonc"]) {
      const fp = path.join(cwd, name)
      if (await Filesystem.exists(fp)) return fp
    }
    return undefined
  }

  export async function reset() {
    const { unlink } = await import("fs/promises")
    await unlink(filepath()).catch(() => {})

    const cfg = await configJson()
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

    const ctx: Context = {}
    if (input.cloud_id) ctx.cloud_id = input.cloud_id
    if (input.elasticsearch_url) ctx.elasticsearch_url = input.elasticsearch_url
    if (input.kibana_url) ctx.kibana_url = input.kibana_url
    if (input.api_key) ctx.api_key = input.api_key
    if (input.auth_mode) ctx.auth_mode = input.auth_mode

    const yaml = toYaml({ current: "default", contexts: { default: ctx } })
    await Bun.write(fp, yaml, { mode: 0o600 } as any)

    if (input.provider) {
      let cfg = await configJson()
      if (!cfg) cfg = path.join(process.cwd(), "elastic_console.json")
      const json = await Filesystem.readJson(cfg).catch(() => ({ $schema: "https://opencode.ai/config.json" }))
      json.provider = input.provider
      if (input.model) json.model = input.model

      // Ensure MCP config for eab is present
      if (!json.mcp) json.mcp = {}
      if (!json.mcp["eab"]) {
        json.mcp["eab"] = {
          type: "local",
          command: ["elastic", "ab", "mcp", "proxy"],
          enabled: true,
        }
      }
      // Auto-allow MCP tools
      if (!json.permission) json.permission = {}
      if (!json.permission["eab_*"]) {
        json.permission["eab_*"] = "allow"
      }

      await Filesystem.writeJson(cfg, json)

      // Also clear provider/model overrides from .opencode/opencode.jsonc so they don't
      // take precedence over the project-level config we just wrote
      for (const name of ["elastic_console.jsonc", "elastic_console.json", "opencode.jsonc", "opencode.json"]) {
        const override = path.join(process.cwd(), ".opencode", name)
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
  }
}
