// Copyright (c) 2026-present, Elastic NV
import { ElasticAuth } from "./auth"
import { runCommand } from "@elastic/cli/runner"
import type { ResolvedConfig } from "@elastic/cli/config/types"

export namespace ElasticCli {
  function cfg(ctx: ElasticAuth.Context): ResolvedConfig {
    const auth = ctx.api_key
      ? { api_key: ctx.api_key }
      : ctx.username && ctx.password
        ? { username: ctx.username, password: ctx.password }
        : undefined
    return {
      context: {
        ...(ctx.elasticsearch_url ? { elasticsearch: { url: ctx.elasticsearch_url, ...(auth && { auth }) } } : {}),
        ...(ctx.kibana_url ? { kibana: { url: ctx.kibana_url, ...(auth && { auth }) } } : {}),
      },
    }
  }

  /**
   * Run an `elastic` CLI command in-process, returning captured stdout.
   * Args should not include the "elastic" program name itself.
   * The shorthands `es` / `kb` are accepted and redirected to `stack es` / `stack kb`.
   */
  export async function run(argv: string[]): Promise<{ output: string; code: number }> {
    const status = await ElasticAuth.check()
    if (!status.configured || !status.context) return { output: "elastic CLI: not configured", code: 1 }
    return runCommand(argv, cfg(status.context))
  }
}
