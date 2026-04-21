// Copyright (c) 2026-present, Elastic NV
import { cmd } from "./cmd"
import { resolveConfigPath, addMcpToConfig } from "./mcp"
import { Config } from "../../config/config"
import { Instance } from "../../project/instance"
import { Global } from "../../global"
import { Filesystem } from "../../util/filesystem"
import { UI } from "../ui"
import { modify, applyEdits, parse as parseJsonc } from "jsonc-parser"
import * as prompts from "@clack/prompts"
import fs from "fs"
import os from "os"
import path from "path"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiscoveredMcp {
  name: string
  config: Config.Mcp
  source: string
}

interface DiscoveredInstruction {
  instruction: string
  source: string
}

interface DiscoveredSkillPath {
  skillPath: string
  source: string
  skills: string[]
}

interface HarnessDescriptor {
  name: string
  mcpConfigPaths: () => string[]
  parseMcp: (data: any) => Record<string, Config.Mcp>
  discoverInstructions: () => Promise<DiscoveredInstruction[]>
  discoverSkillPaths: () => Promise<DiscoveredSkillPath[]>
}

interface ScanResult {
  mcpServers: DiscoveredMcp[]
  instructions: DiscoveredInstruction[]
  skillPaths: DiscoveredSkillPath[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function home(...parts: string[]) {
  return path.join(os.homedir(), ...parts)
}

function tildify(p: string) {
  return p.startsWith(os.homedir()) ? "~/" + path.relative(os.homedir(), p) : p
}

// ---------------------------------------------------------------------------
// Parsers (exported for testing)
// ---------------------------------------------------------------------------

/** Convert external {command, args, env, url} format to Config.Mcp */
export function normalizeServer(raw: Record<string, any>): Config.Mcp | undefined {
  // type: "sse" is VS Code's remote server marker
  if (typeof raw.url === "string" || (raw.type === "sse" && raw.url)) {
    const cfg: Config.Mcp = { type: "remote" as const, url: raw.url }
    if (raw.headers && Object.keys(raw.headers).length > 0) cfg.headers = raw.headers
    return cfg
  }
  if (typeof raw.command === "string") {
    const command = [raw.command, ...(Array.isArray(raw.args) ? raw.args : [])]
    const cfg: Config.Mcp = { type: "local" as const, command }
    const env = raw.env ?? raw.environment
    if (env && typeof env === "object" && Object.keys(env).length > 0) cfg.environment = env
    return cfg
  }
  return undefined
}

export function parseMcpServers(data: any, key = "mcpServers"): Record<string, Config.Mcp> {
  const servers = data?.[key]
  if (!servers || typeof servers !== "object") return {}
  const result: Record<string, Config.Mcp> = {}
  for (const [name, raw] of Object.entries(servers)) {
    const cfg = normalizeServer(raw as Record<string, any>)
    if (cfg) result[name] = cfg
  }
  return result
}

/** Parse ~/.claude.json: global mcpServers + per-project overrides for cwd */
export function parseClaudeMcp(data: any): Record<string, Config.Mcp> {
  const result = parseMcpServers(data)
  const projectServers = data?.projects?.[process.cwd()]?.mcpServers
  if (projectServers && typeof projectServers === "object") {
    Object.assign(result, parseMcpServers({ mcpServers: projectServers }))
  }
  return result
}

// ---------------------------------------------------------------------------
// Discovery helpers
// ---------------------------------------------------------------------------

async function discoverInstructionFiles(
  patterns: { dir: string; file: string; source: string }[],
): Promise<DiscoveredInstruction[]> {
  const results: DiscoveredInstruction[] = []
  for (const { dir, file, source } of patterns) {
    const isGlob = file.includes("*")
    if (isGlob) {
      const globDir = path.dirname(path.join(dir, file))
      if (await Filesystem.exists(globDir)) {
        results.push({ instruction: tildify(path.join(dir, file)), source })
      }
    } else {
      const full = path.join(dir, file)
      if (await Filesystem.exists(full)) {
        const rel = path.relative(process.cwd(), full)
        results.push({ instruction: rel.startsWith("..") ? full : rel, source })
      }
    }
  }
  return results
}

async function discoverSkillsInDir(dir: string, source: string): Promise<DiscoveredSkillPath[]> {
  if (!(await Filesystem.exists(dir))) return []
  try {
    const skills: string[] = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && await Filesystem.exists(path.join(dir, entry.name, "SKILL.md"))) {
        skills.push(entry.name)
      }
    }
    if (skills.length === 0) return []
    return [{ skillPath: tildify(dir), source, skills }]
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Harness registry
// ---------------------------------------------------------------------------

const HARNESSES: HarnessDescriptor[] = [
  {
    name: "Claude",
    mcpConfigPaths: () => [home(".claude.json"), path.join(process.cwd(), ".mcp.json")],
    parseMcp: (data) => (data?.projects ? parseClaudeMcp(data) : parseMcpServers(data)),
    discoverInstructions: async () => [],
    discoverSkillPaths: async () => [],
  },
  {
    name: "Cursor",
    mcpConfigPaths: () => [home(".cursor", "mcp.json")],
    parseMcp: (data) => parseMcpServers(data),
    discoverInstructions: () =>
      discoverInstructionFiles([
        { dir: home(".cursor"), file: "rules/*.mdc", source: "Cursor" },
        { dir: process.cwd(), file: ".cursorrules", source: "Cursor" },
      ]),
    discoverSkillPaths: async () => [
      ...await discoverSkillsInDir(home(".cursor", "skills"), "Cursor"),
      ...await discoverSkillsInDir(path.join(process.cwd(), ".cursor", "skills"), "Cursor"),
    ],
  },
  {
    name: "Windsurf",
    mcpConfigPaths: () => [home(".codeium", "windsurf", "mcp_config.json")],
    parseMcp: (data) => parseMcpServers(data),
    discoverInstructions: () =>
      discoverInstructionFiles([{ dir: process.cwd(), file: ".windsurfrules", source: "Windsurf" }]),
    discoverSkillPaths: async () => [],
  },
  {
    name: "Claude Desktop",
    mcpConfigPaths: () => {
      if (process.platform === "darwin")
        return [home("Library", "Application Support", "Claude", "claude_desktop_config.json")]
      if (process.platform === "win32")
        return [path.join(process.env.APPDATA ?? home("AppData", "Roaming"), "Claude", "claude_desktop_config.json")]
      return []
    },
    parseMcp: (data) => parseMcpServers(data),
    discoverInstructions: async () => [],
    discoverSkillPaths: async () => [],
  },
  {
    name: "VS Code",
    mcpConfigPaths: () => [home(".vscode", "mcp.json")],
    parseMcp: (data) => parseMcpServers(data?.mcp ?? data, "servers"),
    discoverInstructions: () =>
      discoverInstructionFiles([
        { dir: process.cwd(), file: ".github/copilot-instructions.md", source: "VS Code / Copilot" },
      ]),
    discoverSkillPaths: async () => [],
  },
  {
    name: "Gemini CLI",
    mcpConfigPaths: () => [home(".gemini", "settings.json")],
    parseMcp: (data) => parseMcpServers(data),
    discoverInstructions: () =>
      discoverInstructionFiles([{ dir: process.cwd(), file: "GEMINI.md", source: "Gemini CLI" }]),
    discoverSkillPaths: async () => [],
  },
]

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

async function scanHarnesses(harnesses: HarnessDescriptor[]): Promise<ScanResult> {
  const mcpServers: DiscoveredMcp[] = []
  const instructions: DiscoveredInstruction[] = []
  const skillPaths: DiscoveredSkillPath[] = []

  for (const harness of harnesses) {
    for (const configPath of harness.mcpConfigPaths()) {
      if (!(await Filesystem.exists(configPath))) continue
      try {
        const data = await Filesystem.readJson(configPath)
        for (const [name, config] of Object.entries(harness.parseMcp(data))) {
          mcpServers.push({ name, config, source: harness.name })
        }
      } catch {
        // Corrupted config — skip
      }
    }
    try { instructions.push(...await harness.discoverInstructions()) } catch { /* skip */ }
    try { skillPaths.push(...await harness.discoverSkillPaths()) } catch { /* skip */ }
  }

  return { mcpServers, instructions, skillPaths }
}

// ---------------------------------------------------------------------------
// Config writer
// ---------------------------------------------------------------------------

/** Append string entries to a JSONC array at the given path, skipping duplicates. */
async function addToConfigArray(jsonPath: string[], entries: string[], configPath: string) {
  let text = "{}"
  if (await Filesystem.exists(configPath)) {
    text = await Filesystem.readText(configPath)
  }

  let existing: string[] = []
  try {
    let node: any = parseJsonc(text)
    for (const key of jsonPath) {
      if (node == null) break
      node = node[key]
    }
    if (Array.isArray(node)) existing = node
  } catch { /* ignore */ }

  const toAdd = entries.filter((e) => !existing.includes(e))
  if (toAdd.length === 0) return { added: 0, skipped: entries.length }

  let result = text
  for (const entry of toAdd) {
    const edits = modify(result, [...jsonPath, existing.length], entry, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    })
    result = applyEdits(result, edits)
    existing.push(entry)
  }

  await Filesystem.write(configPath, result)
  return { added: toAdd.length, skipped: entries.length - toAdd.length }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function displayMcpServers(mcpServers: DiscoveredMcp[], existingMcp: Record<string, unknown>) {
  if (mcpServers.length === 0) return
  const bySource = new Map<string, DiscoveredMcp[]>()
  for (const s of mcpServers) {
    const list = bySource.get(s.source) ?? []
    list.push(s)
    bySource.set(s.source, list)
  }
  prompts.log.info(`${UI.Style.TEXT_NORMAL_BOLD}MCP Servers`)
  for (const [source, servers] of bySource) {
    const lines = servers.map((s) => {
      const type = s.config.type === "remote" ? "remote" : "local"
      const suffix = s.name in existingMcp ? ` ${UI.Style.TEXT_DIM}(already configured)` : ""
      return `  - ${s.name} (${type})${suffix}`
    })
    prompts.log.info(`${source} (${servers.length}):\n${lines.join("\n")}`)
  }
}

function displayInstructions(instructions: DiscoveredInstruction[], existing: Set<string>) {
  if (instructions.length === 0) return
  prompts.log.info(`\n${UI.Style.TEXT_NORMAL_BOLD}Rules & Instructions`)
  for (const i of instructions) {
    const suffix = existing.has(i.instruction) ? ` ${UI.Style.TEXT_DIM}(already added)` : ""
    prompts.log.info(`  ${i.instruction} ${UI.Style.TEXT_DIM}(${i.source})${suffix}`)
  }
}

function displaySkillPaths(skillPaths: DiscoveredSkillPath[], existing: Set<string>) {
  if (skillPaths.length === 0) return
  prompts.log.info(`\n${UI.Style.TEXT_NORMAL_BOLD}Skills`)
  for (const sp of skillPaths) {
    const suffix = existing.has(sp.skillPath) ? ` ${UI.Style.TEXT_DIM}(already added)` : ""
    prompts.log.info(`  ${sp.skillPath} (${sp.skills.length} skill(s))${suffix}`)
    for (const name of sp.skills) {
      prompts.log.info(`    - ${name}`)
    }
  }
}

async function displayAutoLoaded() {
  const items: string[] = []
  if (await Filesystem.exists(path.join(process.cwd(), "CLAUDE.md"))) {
    items.push(`CLAUDE.md ${UI.Style.TEXT_DIM}(loaded as instructions)`)
  } else if (await Filesystem.exists(home(".claude", "CLAUDE.md"))) {
    items.push(`~/.claude/CLAUDE.md ${UI.Style.TEXT_DIM}(loaded as instructions)`)
  }
  if (await Filesystem.exists(home(".claude", "skills"))) {
    items.push(`.claude/skills/ ${UI.Style.TEXT_DIM}(auto-discovered)`)
  }
  items.push(`.agents/skills/ ${UI.Style.TEXT_DIM}(auto-discovered)`)
  prompts.log.info(`\n${UI.Style.TEXT_NORMAL_BOLD}Already auto-loaded by elastic-ramen`)
  for (const item of items) prompts.log.info(`  ${item}`)
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

const HARNESS_SLUGS = HARNESSES.map((h) => h.name.toLowerCase().replace(/\s+/g, "-"))

function resolveHarnesses(slug: string): HarnessDescriptor[] {
  if (slug === "all") return HARNESSES
  return HARNESSES.filter((h) => h.name.toLowerCase().replace(/\s+/g, "-") === slug)
}

export const HarnessImportCommand = cmd({
  command: "import-from <harness>",
  describe: "import MCP servers and rules from another AI tool",
  builder: (yargs) =>
    yargs
      .positional("harness", {
        describe: "tool to import from: " + [...HARNESS_SLUGS, "all"].join(", "),
        type: "string",
        demandOption: true,
      })
      .option("yes", {
        alias: "y",
        type: "boolean",
        describe: "skip confirmation prompts",
        default: false,
      })
      .option("global", {
        type: "boolean",
        describe: "write to global config instead of project config",
        default: false,
      }),
  async handler(args) {
    const harnesses = resolveHarnesses(args.harness)
    if (harnesses.length === 0) {
      const available = [...HARNESS_SLUGS, "all"].join(", ")
      process.stderr.write(`Unknown harness "${args.harness}". Available: ${available}\n`)
      process.exit(1)
    }

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        const label = args.harness === "all" ? "all tools" : harnesses[0].name
        prompts.intro(`Import from ${label}`)

        const scan = await scanHarnesses(harnesses)

        if (scan.mcpServers.length === 0 && scan.instructions.length === 0 && scan.skillPaths.length === 0) {
          prompts.log.warn(`No MCP servers, rules, or skills found in ${label}`)
          prompts.outro("Nothing to import")
          return
        }

        // Read existing config for duplicate detection
        const config = await Config.get()
        const existingMcp = config.mcp ?? {}
        const existingInstructions = new Set(config.instructions ?? [])
        const existingSkillPaths = new Set(config.skills?.paths ?? [])

        // Display what was found
        displayMcpServers(scan.mcpServers, existingMcp)
        displayInstructions(scan.instructions, existingInstructions)
        if (harnesses.some((h) => h.name === "Claude") || args.harness === "all") {
          await displayAutoLoaded()
        }
        displaySkillPaths(scan.skillPaths, existingSkillPaths)

        // Filter to importable (deduplicate MCP by name, first source wins)
        const seenNames = new Set<string>()
        const importableMcp = scan.mcpServers.filter((s) => {
          if (seenNames.has(s.name) || s.name in existingMcp) return false
          seenNames.add(s.name)
          return true
        })
        const importableInstructions = scan.instructions.filter((i) => !existingInstructions.has(i.instruction))
        const importableSkillPaths = scan.skillPaths.filter((sp) => !existingSkillPaths.has(sp.skillPath))

        if (importableMcp.length === 0 && importableInstructions.length === 0 && importableSkillPaths.length === 0) {
          prompts.outro("Everything is already configured")
          return
        }

        // --- Interactive selection ---
        let selectedMcp = importableMcp
        if (!args.yes && importableMcp.length > 0) {
          const selected = await prompts.multiselect({
            message: "Select MCP servers to import",
            options: importableMcp.map((s) => ({
              label: `${s.name} ${UI.Style.TEXT_DIM}(${s.source})`,
              value: s.name,
            })),
            initialValues: importableMcp.map((s) => s.name),
            required: false,
          })
          if (prompts.isCancel(selected)) throw new UI.CancelledError()
          const selectedSet = new Set(selected)
          selectedMcp = importableMcp.filter((s) => selectedSet.has(s.name))
        }

        let selectedInstructions = importableInstructions
        if (!args.yes && importableInstructions.length > 0) {
          const ok = await prompts.confirm({ message: `Add ${importableInstructions.length} instruction path(s) to config?` })
          if (prompts.isCancel(ok)) throw new UI.CancelledError()
          if (!ok) selectedInstructions = []
        }

        let selectedSkillPaths = importableSkillPaths
        if (!args.yes && importableSkillPaths.length > 0) {
          const total = importableSkillPaths.reduce((n, sp) => n + sp.skills.length, 0)
          const ok = await prompts.confirm({ message: `Add ${importableSkillPaths.length} skill path(s) (${total} skill(s)) to config?` })
          if (prompts.isCancel(ok)) throw new UI.CancelledError()
          if (!ok) selectedSkillPaths = []
        }

        if (selectedMcp.length === 0 && selectedInstructions.length === 0 && selectedSkillPaths.length === 0) {
          prompts.outro("Nothing selected")
          return
        }

        // --- Resolve config path ---
        let configPath = await resolveConfigPath(args.global ? Global.Path.config : Instance.worktree, args.global)

        if (!args.yes && !args.global) {
          const scope = await prompts.select({
            message: "Write to",
            options: [
              { label: "Project config", value: "project", hint: configPath },
              { label: "Global config", value: "global", hint: await resolveConfigPath(Global.Path.config, true) },
            ],
          })
          if (prompts.isCancel(scope)) throw new UI.CancelledError()
          if (scope === "global") configPath = await resolveConfigPath(Global.Path.config, true)
        }

        // --- Write ---
        for (const s of selectedMcp) await addMcpToConfig(s.name, s.config, configPath)
        if (selectedMcp.length > 0) {
          prompts.log.success(`Imported ${selectedMcp.length} MCP server(s) to ${configPath}`)
        }

        if (selectedInstructions.length > 0) {
          const { added, skipped } = await addToConfigArray(["instructions"], selectedInstructions.map((i) => i.instruction), configPath)
          if (added > 0) prompts.log.success(`Added ${added} instruction path(s) to ${configPath}`)
          if (skipped > 0) prompts.log.info(`  ${skipped} already present — skipped`)
        }

        if (selectedSkillPaths.length > 0) {
          const { added, skipped } = await addToConfigArray(["skills", "paths"], selectedSkillPaths.map((sp) => sp.skillPath), configPath)
          if (added > 0) prompts.log.success(`Added ${added} skill path(s) to ${configPath}`)
          if (skipped > 0) prompts.log.info(`  ${skipped} already present — skipped`)
        }

        prompts.outro("Done")
      },
    })
  },
})
