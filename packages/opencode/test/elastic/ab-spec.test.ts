import { test, expect } from "bun:test"
import path from "path"
import { AbSpec } from "../../src/elastic/ab-spec"
import { KibanaGateway } from "../../src/elastic/kibana-gateway"

test("skillJsonToolIds parses nested configuration.tools objects", () => {
  const ids = KibanaGateway.skillJsonToolIds({
    configuration: {
      tools: [{ id: "helloworld" }, { tool_ids: ["other_tool"] }],
    },
  })
  expect(ids).toContain("helloworld")
  expect(ids).toContain("other_tool")
})

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

test("mcpToolAllows — eab_ tools follow the same tool_ids list as kibana_*", () => {
  const sel = { tools: [{ tool_ids: ["only_one"] }] }
  expect(AbSpec.mcpToolAllows(sel, "eab_only_one")).toBe(true)
  expect(AbSpec.mcpToolAllows(sel, "eab_other")).toBe(false)
  expect(AbSpec.mcpToolAllows(sel, "chrome_my_tool")).toBe(true)
})

test("mcpToolAllows — cfg null is permissive", () => {
  expect(AbSpec.mcpToolAllows(null, "eab_anything")).toBe(true)
})

test("tool + mcp allowlist: skill_tools; deferred until loaded in session", () => {
  const cfg = {
    tools: [] as { tool_ids: string[] }[],
    skill_ids: ["sk1"],
    skill_tools: { sk1: ["from_skill", "kibana_get_tool"] },
  }
  expect(AbSpec.mcpToolAllows(cfg, "eab_from_skill")).toBe(true)
  expect(AbSpec.toolAllows(cfg, "kibana_get_tool")).toBe(true)
  expect(AbSpec.mcpToolAllows(cfg, "eab_from_skill", new Set())).toBe(false)
  expect(AbSpec.mcpToolAllows(cfg, "eab_from_skill", new Set(["sk1"]))).toBe(true)
  expect(AbSpec.mcpToolAllows(cfg, "eab_not_listed")).toBe(false)
})

test("mcp suffix matches Kibana tool ids containing dots (MCP sanitization)", () => {
  const cfg = {
    tools: [] as { tool_ids: string[] }[],
    skill_ids: ["bee"],
    skill_tools: { bee: ["mytool.hello_world"] },
  }
  expect(AbSpec.mcpToolAllows(cfg, "eab_mytool_hello_world", new Set(["bee"]))).toBe(true)
  expect(AbSpec.mcpToolAllows(cfg, "eab_mytool_hello_world", new Set())).toBe(false)
})

test("direct agent tool_ids still allowed before any skill load", () => {
  const cfg = {
    tools: [{ tool_ids: ["kibana_direct"] }],
    skill_tools: { sk1: ["kibana_only_skill"] },
  }
  expect(AbSpec.toolAllows(cfg, "kibana_direct", new Set())).toBe(true)
  expect(AbSpec.toolAllows(cfg, "kibana_only_skill", new Set())).toBe(false)
  expect(AbSpec.toolAllows(cfg, "kibana_only_skill", new Set(["sk1"]))).toBe(true)
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
