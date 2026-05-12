// Copyright (c) 2026-present, Elastic NV
import { Skill } from "@/skill/skill"
import type { MessageV2 } from "@/session/message-v2"
import type { Cfg } from "@/elastic/ab-spec"
import { kibanaSkillSlug, kibanaSyncedSkillFolderSlug } from "@/elastic/kibana-skills-sync"

/** Kibana skill ids (`GET /api/agent_builder/agents/:id` `skill_ids`) for which the session has a completed `skill` tool load. */
export async function loadedKibanaSkillIds(
  cfg: Cfg | null,
  messages: MessageV2.WithParts[],
): Promise<Set<string>> {
  const out = new Set<string>()
  if (!cfg?.skill_ids?.length) return out
  const allowed = new Set(cfg.skill_ids)
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type !== "tool" || part.tool !== "skill") continue
      if (part.state.status !== "completed") continue

      const mid = part.state.metadata["kibana_skill_id"]
      if (typeof mid === "string" && allowed.has(mid)) {
        out.add(mid)
        continue
      }

      const raw = part.state.input["name"]
      if (typeof raw !== "string") continue
      const skill = await Skill.get(raw)
      if (!skill) continue
      const slug = kibanaSyncedSkillFolderSlug(skill.location)
      if (!slug) continue
      for (const sid of cfg.skill_ids ?? []) {
        if (kibanaSkillSlug(sid) === slug) out.add(sid)
      }
    }
  }
  return out
}
