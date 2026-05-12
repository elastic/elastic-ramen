// Copyright (c) 2026-present, Elastic NV
import { Config } from "@/config/config"

/** Default Agent Builder assistant id in Kibana — see `Handover` conversation sync. */
export namespace AbAgent {
  export const builtin = "elastic-ai-agent"

  export async function preferred(): Promise<string> {
    try {
      const cfg = await Config.get()
      const raw = cfg.kibana?.agent_builder_agent_id
      if (typeof raw === "string" && raw.trim()) return raw.trim()
    } catch {
      /* No project Instance context (unit tests, standalone tools). */
    }
    return builtin
  }
}
