import { describe, expect, test, afterEach } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Global } from "../../src/global"
import { KibanaSkillsSync } from "../../src/elastic/kibana-skills-sync"
import { Skill } from "../../src/skill"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const kibanaTree = path.join(Global.Path.config, "skill", "kibana")
const userTree = path.join(Global.Path.config, "skill")

afterEach(async () => {
  // Tests under this file write into the shared Global.Path.config/skill tree —
  // clean it between tests so cases don't bleed into each other.
  await fs.rm(path.join(Global.Path.config, "skill"), { recursive: true, force: true })
})

describe("KibanaSkillsSync.inactiveProfileFilter", () => {
  test("passes through non-kibana paths regardless of profile state", async () => {
    const filter = await KibanaSkillsSync.inactiveProfileFilter()
    expect(filter(path.join(userTree, "user-skill", "SKILL.md"))).toBe(false)
    expect(filter("/some/project/.elastic-ramen/skill/x/SKILL.md")).toBe(false)
    expect(filter("/var/empty/SKILL.md")).toBe(false)
  })

  test("rejects every kibana path when no Elastic profile is active", async () => {
    // The bun:test environment doesn't write an Elastic config, so check() returns
    // not-configured → every file under the kibana tree counts as inactive.
    const filter = await KibanaSkillsSync.inactiveProfileFilter()
    expect(filter(path.join(kibanaTree, "profile-a", "skill-x", "SKILL.md"))).toBe(true)
    expect(filter(path.join(kibanaTree, "profile-b", "skill-y", "SKILL.md"))).toBe(true)
  })
})

describe("Skill.state with synced kibana skills", () => {
  test("Skill.all drops synced kibana skills when no profile is active, keeps user skills", async () => {
    const syncedDir = path.join(kibanaTree, "demo-profile", "synced-skill")
    await fs.mkdir(syncedDir, { recursive: true })
    await Bun.write(
      path.join(syncedDir, "SKILL.md"),
      `---
name: synced-skill
description: Synced from Kibana — should not load without an active profile.
---

# Synced
`,
    )

    const userDir = path.join(userTree, "user-skill")
    await fs.mkdir(userDir, { recursive: true })
    await Bun.write(
      path.join(userDir, "SKILL.md"),
      `---
name: user-skill
description: Hand-authored — should always load.
---

# User
`,
    )

    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const skills = await Skill.all()
        const names = skills.map((s) => s.name)
        expect(names).toContain("user-skill")
        expect(names).not.toContain("synced-skill")
      },
    })
  })
})
