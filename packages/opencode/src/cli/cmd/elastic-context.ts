// Copyright (c) 2026-present, Elastic NV
import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { ElasticAuth } from "../../elastic/auth"
import { UI } from "../ui"

export const ElasticContextCommand = cmd({
  command: "elastic-context",
  describe: "manage saved Elastic / Kibana profiles (config.yaml contexts)",
  builder: (yargs: Argv) =>
    yargs.command(ElasticContextListCommand).command(ElasticContextUseCommand).command(ElasticContextDeleteCommand).demandCommand(),
  async handler() {},
})

const ElasticContextListCommand = cmd({
  command: "list",
  describe: "list profiles and show the active one",
  async handler() {
    const p = await ElasticAuth.profiles()
    if (p.names.length === 0) {
      UI.println("No profiles configured")
      process.exit(0)
    }
    for (const n of p.names) {
      UI.println(n === p.current ? `* ${n}` : `  ${n}`)
    }
    process.exit(0)
  },
})

const ElasticContextUseCommand = cmd({
  command: "use <name>",
  describe: "switch active profile (updates current-context and project elastic_ramen provider)",
  builder: (yargs: Argv) =>
    yargs.positional("name", { describe: "profile name", type: "string", demandOption: true }),
  async handler(args: { name: string }) {
    await ElasticAuth.setCurrent(args.name)
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Active profile: ${args.name}` + UI.Style.TEXT_NORMAL)
    process.exit(0)
  },
})

const ElasticContextDeleteCommand = cmd({
  command: "delete <name>",
  describe: "remove a profile",
  builder: (yargs: Argv) =>
    yargs.positional("name", { describe: "profile name", type: "string", demandOption: true }),
  async handler(args: { name: string }) {
    await ElasticAuth.removeContext(args.name)
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Removed profile: ${args.name}` + UI.Style.TEXT_NORMAL)
    process.exit(0)
  },
})
