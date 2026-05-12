#!/usr/bin/env bun
/** One-off: read project elastic_ramen.json path from argv or /tmp/elastic_ramen.json; dump Agent Builder agent + skill tool shapes. */
import fs from "fs"
import { KibanaGateway } from "../src/elastic/kibana-gateway"

const path = process.argv[2] ?? "/tmp/elastic_ramen.json"
const raw = JSON.parse(fs.readFileSync(path, "utf8"))
const headersIn = raw.provider?.kibana?.options?.headers
const baseURL = raw.provider?.kibana?.options?.baseURL
if (!headersIn?.Authorization || !baseURL) {
  console.log("missing auth or baseURL")
  process.exit(1)
}
const origin = String(baseURL).replace(/\/internal\/elastic_ramen\/v1\/?$/i, "")
const agentId = raw.kibana?.agent_builder_agent_id ?? "elastic-ai-agent"
const h: Record<string, string> = {
  Authorization: headersIn.Authorization,
  "kbn-xsrf": "true",
  "x-elastic-internal-origin": "kibana",
  "elastic-api-version": "2023-10-31",
  "Content-Type": "application/json",
}

async function main() {
  console.log("config:", path)
  console.log("origin:", origin)
  console.log("agent_builder_agent_id:", agentId)

  const agentUrl = `${origin}/api/agent_builder/agents/${encodeURIComponent(agentId)}`
  const ar = await fetch(agentUrl, { headers: h })
  console.log("\nGET agent status:", ar.status)
  const agent = (await ar.json().catch(() => null)) as Record<string, unknown> | null
  if (!agent) {
    console.log("no agent json")
    return
  }
  const cfg = agent.configuration as Record<string, unknown> | undefined
  console.log("agent.name:", agent.name)
  console.log("configuration.skill_ids:", cfg?.skill_ids)
  console.log("configuration.tools:", JSON.stringify(cfg?.tools)?.slice(0, 1500))

  const skillsUrl = `${origin}/api/agent_builder/skills?include_plugins=true`
  const sr = await fetch(skillsUrl, { headers: h })
  console.log("\nGET skills list status:", sr.status)
  const slist = (await sr.json().catch(() => ({}))) as { results?: unknown[] }
  const results = Array.isArray(slist.results) ? slist.results : []
  console.log("skills count:", results.length)
  const bee = results.filter((x: unknown) => typeof x === "object" && x && /bee/i.test(String((x as Record<string, unknown>).name ?? "")))
  console.log(
    "skills with bee in name:",
    bee.map((x) => ({ id: (x as Record<string, unknown>).id, name: (x as Record<string, unknown>).name })),
  )

  const ids: string[] = Array.isArray(cfg?.skill_ids) ? (cfg.skill_ids as unknown[]).map(String) : []
  console.log("\n--- GET each skill_ids entry ---")
  for (const sid of ids) {
    const u = `${origin}/api/agent_builder/skills/${encodeURIComponent(sid)}`
    const r = await fetch(u, { headers: h })
    const j = (await r.json().catch(() => null)) as Record<string, unknown> | null
    console.log("\nskill_id:", sid, "HTTP:", r.status)
    if (!j) continue
    console.log("  name:", j.name)
    console.log("  top keys:", Object.keys(j))
    const conf = j.configuration
    console.log(
      "  configuration keys:",
      conf && typeof conf === "object" ? Object.keys(conf as object) : conf,
    )
    const parsed = KibanaGateway.skillJsonToolIds(j)
    console.log("  skillJsonToolIds:", parsed)
    if (parsed.length === 0) console.log("  configuration JSON (trunc):", JSON.stringify(j.configuration)?.slice(0, 3500))
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
