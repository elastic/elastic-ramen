import { describe, expect, test } from "bun:test"
import { ElasticAuth } from "../../src/elastic/auth"

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
