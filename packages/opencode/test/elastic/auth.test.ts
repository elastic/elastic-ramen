import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { ElasticAuth } from "../../src/elastic/auth"
import { Global } from "../../src/global"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"
import { KibanaGateway } from "../../src/elastic/kibana-gateway"

describe("ElasticAuth.canon", () => {
  test("falls back to `default` for empty, whitespace-only, and all-invalid input", () => {
    expect(ElasticAuth.canon(undefined)).toBe("default")
    expect(ElasticAuth.canon("")).toBe("default")
    expect(ElasticAuth.canon("   ")).toBe("default")
    expect(ElasticAuth.canon("@@@")).toBe("default")
  })

  test("normalizes invalid chars to `_`, collapses runs, trims edges", () => {
    expect(ElasticAuth.canon("prod.us east")).toBe("prod_us_east")
    expect(ElasticAuth.canon("...foo...")).toBe("foo")
    expect(ElasticAuth.canon("us-east_2")).toBe("us-east_2")
  })

  test("caps at 64 chars", () => {
    expect(ElasticAuth.canon("a".repeat(100))).toHaveLength(64)
  })

  test("strips path-traversal segments — name flows into filesystem paths", () => {
    expect(ElasticAuth.canon("../../tmp/x")).toBe("tmp_x")
    expect(ElasticAuth.canon("..")).toBe("default")
    expect(ElasticAuth.canon("/etc/passwd")).toBe("etc_passwd")
    expect(ElasticAuth.canon("a/b\\c")).toBe("a_b_c")
  })
})

describe("ElasticAuth.profileNameFromKibanaUrl", () => {
  test("Cloud `name-hash.kb.region...` → name (last hyphen splits the hash)", () => {
    expect(
      ElasticAuth.profileNameFromKibanaUrl("https://acme-abc123def.kb.us-east-1.aws.elastic-cloud.com"),
    ).toBe("acme")
    expect(
      ElasticAuth.profileNameFromKibanaUrl("https://my-cool-project-abc123.kb.us-east-1.aws.elastic-cloud.com"),
    ).toBe("my-cool-project")
  })

  test("non-Cloud URL → first hostname label", () => {
    expect(ElasticAuth.profileNameFromKibanaUrl("https://kibana.example.com:5601")).toBe("kibana")
  })

  test("invalid input → default", () => {
    expect(ElasticAuth.profileNameFromKibanaUrl("not a url")).toBe("default")
  })
})

describe("ElasticAuth.profileNameFromElasticsearchUrl", () => {
  test("Cloud `name-hash.es.region...` → name", () => {
    expect(
      ElasticAuth.profileNameFromElasticsearchUrl("https://acme-abc123.es.us-east-1.aws.elastic-cloud.com"),
    ).toBe("acme")
  })
})

describe("ElasticAuth.shouldKeepKibanaModel", () => {
  const provider = { kibana: { models: { default: {}, "openai-gpt-5": {} } } }

  test("keeps kibana/<connector> when the connector exists in the new provider", () => {
    expect(ElasticAuth.shouldKeepKibanaModel("kibana/openai-gpt-5", provider)).toBe(true)
    expect(ElasticAuth.shouldKeepKibanaModel("kibana/default", provider)).toBe(true)
  })

  test("drops kibana/<connector> when the connector is missing from the new provider", () => {
    expect(ElasticAuth.shouldKeepKibanaModel("kibana/azure-deprecated", provider)).toBe(false)
    expect(ElasticAuth.shouldKeepKibanaModel("kibana/openai-gpt-5", { kibana: { models: {} } })).toBe(false)
  })

  test("returns false for non-kibana, empty, or non-string models", () => {
    expect(ElasticAuth.shouldKeepKibanaModel("anthropic/claude-opus-4", provider)).toBe(false)
    expect(ElasticAuth.shouldKeepKibanaModel("kibana/", provider)).toBe(false)
    expect(ElasticAuth.shouldKeepKibanaModel(undefined, provider)).toBe(false)
  })

  test("tolerates malformed provider shapes", () => {
    expect(ElasticAuth.shouldKeepKibanaModel("kibana/default", undefined)).toBe(false)
    expect(ElasticAuth.shouldKeepKibanaModel("kibana/default", {})).toBe(false)
    expect(ElasticAuth.shouldKeepKibanaModel("kibana/default", { kibana: {} })).toBe(false)
  })
})

describe("ElasticAuth.profileNameFromSetup", () => {
  test("prefers Kibana URL when both are present", () => {
    expect(
      ElasticAuth.profileNameFromSetup(
        "https://acme-kib123.kb.us-east-1.aws.elastic-cloud.com",
        "https://other-es456.es.us-east-1.aws.elastic-cloud.com",
      ),
    ).toBe("acme")
  })

  test("falls back to ES URL when Kibana is missing", () => {
    expect(ElasticAuth.profileNameFromSetup(undefined, "https://acme-es123.es.us-east-1.aws.elastic-cloud.com")).toBe(
      "acme",
    )
  })
})

describe("ElasticAuth.save → global config", () => {
  // Each test gets its own Global.Path.config and cwd so filesystem effects don't leak.
  let originalGlobalConfig: string
  let originalCwd: string
  let globalDir: Awaited<ReturnType<typeof tmpdir>>
  let projectDir: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(async () => {
    originalGlobalConfig = Global.Path.config
    originalCwd = process.cwd()
    globalDir = await tmpdir()
    projectDir = await tmpdir()
    ;(Global.Path as { config: string }).config = globalDir.path
    process.chdir(projectDir.path)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    ;(Global.Path as { config: string }).config = originalGlobalConfig
    await globalDir[Symbol.asyncDispose]()
    await projectDir[Symbol.asyncDispose]()
  })

  test("writes provider/model/eab to global, not to cwd", async () => {
    await ElasticAuth.save({
      kibana_url: "https://kibana.example.com:5601",
      api_key: "test-key",
      provider: { kibana: { models: { default: { id: "x" } } } },
      model: "kibana/default",
      activate: true,
    })

    const globalCfg = path.join(globalDir.path, "elastic_ramen.json")
    const localCfg = path.join(projectDir.path, "elastic_ramen.json")

    expect(await Filesystem.exists(globalCfg)).toBe(true)
    expect(await Filesystem.exists(localCfg)).toBe(false)

    const json = (await Filesystem.readJson(globalCfg)) as Record<string, any>
    expect(json.model).toBe("kibana/default")
    expect(json.provider.kibana.models.default.id).toBe("x")
    expect(json.mcp.eab.type).toBe("remote")
    expect(json.mcp.eab.url).toBe("https://kibana.example.com:5601/api/agent_builder/mcp")
    expect(json.mcp.eab.headers.Authorization).toBe("ApiKey test-key")
    expect(json.permission["eab_*"]).toBe("allow")
  })

  test("strips provider/model from a stale project-local config but preserves other keys", async () => {
    const localCfg = path.join(projectDir.path, "elastic_ramen.json")
    await Filesystem.writeJson(localCfg, {
      $schema: "https://elastic.co/config.json",
      provider: { kibana: { models: { stale: {} } } },
      model: "kibana/stale",
      agents: { foo: { description: "keep me" } },
    })

    await ElasticAuth.save({
      kibana_url: "https://kibana.example.com:5601",
      api_key: "test-key",
      provider: { kibana: { models: { default: {} } } },
      model: "kibana/default",
      activate: true,
    })

    const after = (await Filesystem.readJson(localCfg)) as Record<string, any>
    expect(after.provider).toBeUndefined()
    expect(after.model).toBeUndefined()
    expect(after.agents.foo.description).toBe("keep me")
    expect(after.$schema).toBe("https://elastic.co/config.json")
  })

  test("strips provider/model from .elastic-ramen overrides too", async () => {
    const overrideCfg = path.join(projectDir.path, ".elastic-ramen", "elastic_ramen.json")
    await Filesystem.writeJson(overrideCfg, {
      provider: { kibana: { models: { stale: {} } } },
      model: "kibana/stale",
      agents: { bar: {} },
    })

    await ElasticAuth.save({
      kibana_url: "https://kibana.example.com:5601",
      api_key: "test-key",
      provider: { kibana: { models: { default: {} } } },
      model: "kibana/default",
    })

    const after = (await Filesystem.readJson(overrideCfg)) as Record<string, any>
    expect(after.provider).toBeUndefined()
    expect(after.model).toBeUndefined()
    expect(after.agents.bar).toEqual({})
  })

  test("preserves comments and other keys in a project-local .jsonc when stripping", async () => {
    const localCfg = path.join(projectDir.path, "elastic_ramen.jsonc")
    const before = `// User-edited project config
{
  // We want to keep this comment
  "agents": { "foo": {} },
  "provider": { "kibana": { "models": { "stale": {} } } },
  "model": "kibana/stale"
}
`
    await Filesystem.write(localCfg, before)

    await ElasticAuth.save({
      kibana_url: "https://kibana.example.com:5601",
      api_key: "test-key",
      provider: { kibana: { models: { default: {} } } },
      model: "kibana/default",
    })

    const after = await Filesystem.readText(localCfg)
    expect(after).toContain("User-edited project config")
    expect(after).toContain("We want to keep this comment")
    expect(after).toContain("agents")
    expect(after).not.toContain("kibana/stale")
    expect(after).not.toMatch(/"provider"\s*:/)
    expect(after).not.toMatch(/"model"\s*:/)
  })

  test("reset clears provider/model from global and project-local", async () => {
    await ElasticAuth.save({
      kibana_url: "https://kibana.example.com:5601",
      api_key: "test-key",
      provider: { kibana: { models: { default: {} } } },
      model: "kibana/default",
    })
    const localCfg = path.join(projectDir.path, "elastic_ramen.json")
    await Filesystem.writeJson(localCfg, {
      provider: { kibana: {} },
      model: "kibana/x",
      agents: { keep: {} },
    })

    await ElasticAuth.reset()

    const globalAfter = (await Filesystem.readJson(path.join(globalDir.path, "elastic_ramen.json"))) as Record<string, any>
    expect(globalAfter.provider).toBeUndefined()
    expect(globalAfter.model).toBeUndefined()

    const localAfter = (await Filesystem.readJson(localCfg)) as Record<string, any>
    expect(localAfter.provider).toBeUndefined()
    expect(localAfter.model).toBeUndefined()
    expect(localAfter.agents.keep).toEqual({})
  })
})

describe("ElasticAuth.bootstrapFromEnv", () => {
  let originalGlobalConfig: string
  let originalCwd: string
  let originalCloudId: string | undefined
  let originalApiKey: string | undefined
  let globalDir: Awaited<ReturnType<typeof tmpdir>>
  let projectDir: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(async () => {
    originalGlobalConfig = Global.Path.config
    originalCwd = process.cwd()
    originalCloudId = process.env["ELASTIC_RAMEN_CLOUD_ID"]
    originalApiKey = process.env["ELASTIC_RAMEN_API_KEY"]
    globalDir = await tmpdir()
    projectDir = await tmpdir()
    ;(Global.Path as { config: string }).config = globalDir.path
    await fs.rm(path.dirname(ElasticAuth.configPath()), { recursive: true, force: true }).catch(() => {})
    process.chdir(projectDir.path)
  })

  afterEach(async () => {
    mock.restore()
    if (originalCloudId === undefined) delete process.env["ELASTIC_RAMEN_CLOUD_ID"]
    else process.env["ELASTIC_RAMEN_CLOUD_ID"] = originalCloudId
    if (originalApiKey === undefined) delete process.env["ELASTIC_RAMEN_API_KEY"]
    else process.env["ELASTIC_RAMEN_API_KEY"] = originalApiKey
    await fs.rm(path.dirname(ElasticAuth.configPath()), { recursive: true, force: true }).catch(() => {})
    process.chdir(originalCwd)
    ;(Global.Path as { config: string }).config = originalGlobalConfig
    await globalDir[Symbol.asyncDispose]()
    await projectDir[Symbol.asyncDispose]()
  })

  test("creates Elastic and global RAMEN config from cloud env vars when auth config is absent", async () => {
    process.env["ELASTIC_RAMEN_CLOUD_ID"] =
      "acme:dXMtZWFzdC0xLmF3cy5lbGFzdGljLWNsb3VkLmNvbSRlc3V1aWQka2J1dWlk"
    process.env["ELASTIC_RAMEN_API_KEY"] = "env-key"
    const buildProvider = spyOn(KibanaGateway, "buildProvider").mockResolvedValue({
      kibana: {
        models: { default: { id: "default" } },
      },
    } as never)

    expect(await ElasticAuth.bootstrapFromEnv()).toBe(true)
    expect(buildProvider).toHaveBeenCalledWith("https://kbuuid.us-east-1.aws.elastic-cloud.com", "env-key")

    const status = await ElasticAuth.check()
    expect(status.configured).toBe(true)
    expect(status.name).toBe("kbuuid")
    expect(status.context?.cloud_id).toBe(process.env["ELASTIC_RAMEN_CLOUD_ID"])
    expect(status.context?.elasticsearch_url).toBe("https://esuuid.us-east-1.aws.elastic-cloud.com")
    expect(status.context?.kibana_url).toBe("https://kbuuid.us-east-1.aws.elastic-cloud.com")
    expect(status.context?.api_key).toBe("env-key")

    const globalCfg = (await Filesystem.readJson(path.join(globalDir.path, "elastic_ramen.json"))) as Record<string, any>
    expect(globalCfg.model).toBe("kibana/default")
    expect(globalCfg.provider.kibana.models.default.id).toBe("default")
    expect(globalCfg.mcp.eab.url).toBe("https://kbuuid.us-east-1.aws.elastic-cloud.com/api/agent_builder/mcp")
    expect(globalCfg.mcp.eab.headers.Authorization).toBe("ApiKey env-key")
    expect(globalCfg.permission["eab_*"]).toBe("allow")
  })

  test("does not overwrite an existing Elastic config", async () => {
    process.env["ELASTIC_RAMEN_CLOUD_ID"] =
      "acme:dXMtZWFzdC0xLmF3cy5lbGFzdGljLWNsb3VkLmNvbSRlc3V1aWQka2J1dWlk"
    process.env["ELASTIC_RAMEN_API_KEY"] = "env-key"
    const existing = `current-context: default
contexts:
  default:
    elasticsearch_url: "https://existing-es.example.com"
    kibana_url: "https://existing-kb.example.com"
    api_key: "existing-key"
`
    await Filesystem.write(ElasticAuth.configPath(), existing)
    const buildProvider = spyOn(KibanaGateway, "buildProvider")

    expect(await ElasticAuth.bootstrapFromEnv()).toBe(false)
    expect(buildProvider).not.toHaveBeenCalled()
    expect(await Bun.file(ElasticAuth.configPath()).text()).toBe(existing)
    expect(await Filesystem.exists(path.join(globalDir.path, "elastic_ramen.json"))).toBe(false)
  })

  test("throws for an invalid cloud id", async () => {
    process.env["ELASTIC_RAMEN_CLOUD_ID"] = "not-a-valid-cloud-id"
    process.env["ELASTIC_RAMEN_API_KEY"] = "env-key"
    const buildProvider = spyOn(KibanaGateway, "buildProvider")

    await expect(ElasticAuth.bootstrapFromEnv()).rejects.toThrow(
      "ELASTIC_RAMEN_CLOUD_ID must decode to both Elasticsearch and Kibana URLs",
    )
    expect(buildProvider).not.toHaveBeenCalled()
    expect(await Filesystem.exists(ElasticAuth.configPath())).toBe(false)
  })
})
