import { test, expect } from "bun:test"
import path from "path"
import { AbSpec } from "../../src/elastic/ab-spec"

test("toolAllows — non-kibana tools always allowed", () => {
  expect(AbSpec.toolAllows({ tools: [] }, "read")).toBe(true)
  expect(AbSpec.toolAllows(null, "bash")).toBe(true)
})

test("toolAllows — kibana tools follow Agent Builder selection", () => {
  const sel = { tools: [{ tool_ids: ["kibana_list_workflows", "kibana_get_workflow"] }] }
  expect(AbSpec.toolAllows(sel, "kibana_list_workflows")).toBe(true)
  expect(AbSpec.toolAllows(sel, "kibana_list_tools")).toBe(false)
})

test("toolAllows — wildcard * enables all kibana_* tools", () => {
  const w = { tools: [{ tool_ids: ["*"] }] }
  expect(AbSpec.toolAllows(w, "kibana_delete_agent")).toBe(true)
})

test("skillAllows — undefined skill_ids does not filter Kibana-synced paths", () => {
  const cfg = { tools: [{ tool_ids: ["*"] }] }
  const p = path.join("x", "skill", "kibana", "profile", "myslug", "SKILL.md")
  expect(AbSpec.skillAllows(cfg, p)).toBe(true)
})

test("skillAllows — empty skill_ids blocks Kibana tree", () => {
  const cfg = { tools: [{ tool_ids: ["*"] }], skill_ids: [] }
  const p = path.join("x", "skill", "kibana", "profile", "z", "SKILL.md")
  expect(AbSpec.skillAllows(cfg, p)).toBe(false)
})
