// Copyright (c) 2026-present, Elastic NV
import z from "zod"
import { Tool } from "./tool"
import { ElasticCli } from "@/elastic/cli"

export const ElasticCliTool = Tool.define("elastic_cli", {
  description:
    "Run an elastic CLI command directly. Use this instead of the bash tool for all elastic CLI operations — it is faster, handles authentication automatically, and returns structured output. " +
    "Pass the full command after `elastic`, e.g. `stack es cluster health --json` or `stack kb agent-builder agents list --json`. " +
    "The shorthands `es` and `kb` are also accepted (e.g. `es cluster health`). " +
    "Always append `--json` when you need machine-readable output.",
  parameters: z.object({
    command: z
      .string()
      .describe(
        "The elastic CLI arguments (without the leading `elastic`). Example: `stack es cluster health --json`",
      ),
  }),
  async execute(params) {
    const args = params.command.trim().split(/\s+/).filter(Boolean)
    const result = await ElasticCli.run(args)
    return {
      title: `elastic ${params.command}`,
      metadata: { code: result.code },
      output: result.output || (result.code === 0 ? "(no output)" : `exit code ${result.code}`),
    }
  },
})
