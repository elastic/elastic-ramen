// Copyright (c) 2026-present, Elastic NV
import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { ElasticAuth } from "../../elastic/auth"
import { KibanaSkillsSync } from "../../elastic/kibana-skills-sync"
import { UI } from "../ui"

export const SyncCommand = cmd({
  command: "sync",
  describe: "pull Kibana Agent Builder skills for the active profile",
  builder: (yargs: Argv) =>
    yargs.option("force", {
      type: "boolean",
      default: false,
      describe: "ignore the 1h TTL and re-pull immediately",
    }),
  async handler(args: { force: boolean }) {
    const status = await ElasticAuth.check()
    if (!status.configured) {
      UI.println("No active Elastic profile. Run the TUI to configure, or use `elastic-context use <name>`.")
      process.exit(1)
    }
    await KibanaSkillsSync.sync({ force: args.force })
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Synced skills for profile: ${status.name ?? "default"}` + UI.Style.TEXT_NORMAL)
    process.exit(0)
  },
})
