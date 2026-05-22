// Copyright (c) 2026-present, Elastic NV
import z from "zod"
import { Tool } from "./tool"
import { ElasticCli, CLI_TIMEOUT_MS } from "@/elastic/cli"

export const ElasticCliTool = Tool.define("elastic_cli", {
  description:
    "Run an elastic CLI command directly. Use this instead of the bash tool for all elastic CLI operations — " +
    "it is faster, handles authentication automatically, and returns structured output. " +
    "Pass argv as an array of strings after `elastic`, e.g. " +
    '`["stack","es","cluster","health","--json"]` or `["es","esql","query","--query","FROM logs-* | LIMIT 1","--json"]`. ' +
    "Shorthands `es`/`kb` are accepted. Always include `--json` for machine-readable output. " +
    `Commands time out after ${CLI_TIMEOUT_MS / 1000}s.`,
  parameters: z.object({
    argv: z
      .array(z.string())
      .min(1)
      .describe('elastic CLI argv without the leading "elastic", e.g. ["es","cluster","health","--json"]'),
  }),
  async execute(params) {
    const result = await ElasticCli.run(params.argv)
    return {
      title: `elastic ${params.argv.join(" ")}`,
      metadata: { code: result.code },
      output: result.output || (result.code === 0 ? "(no output)" : `exit code ${result.code}`),
    }
  },
})
