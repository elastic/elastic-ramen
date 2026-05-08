import { describe, expect, test } from "bun:test"
import { KibanaGateway } from "../../src/elastic/kibana-gateway"

describe("KibanaGateway.resolveKibanaModel", () => {
  test("maps connector id to default entry", () => {
    const id = ".anthropic-claude-4.6-sonnet-chat_completion"
    const models = {
      default: { api: { id }, name: "Anthropic Claude 4.6 Sonnet (default)", limit: { context: 1_000_000 } },
    }
    expect(KibanaGateway.resolveKibanaModel(models, id)?.limit?.context).toBe(1_000_000)
    expect(KibanaGateway.resolveKibanaModel(models, "default")?.name).toContain("default")
  })

  test("returns undefined when key missing and no default alias", () => {
    expect(KibanaGateway.resolveKibanaModel({ default: { api: { id: "a" } } }, "b")).toBeUndefined()
  })
})

describe("KibanaGateway.connectorDisplayName", () => {
  test("strips inference suffix and dot prefix", () => {
    expect(KibanaGateway.connectorDisplayName(".anthropic-claude-4.5-haiku-chat_completion")).toBe(
      "Anthropic Claude 4.5 Haiku",
    )
    expect(KibanaGateway.connectorDisplayName(".google-gemini-2.5-flash-chat_completion")).toBe(
      "Google Gemini 2.5 Flash",
    )
  })
})

describe("KibanaGateway", () => {
  test("buildProvider merges connectors from /models", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.url.includes("/internal/search_inference_endpoints/connectors")) {
          return Response.json({
            connectors: [{ connectorId: "preferred-inference" }],
            soEntryFound: false,
          })
        }
        if (!req.url.includes("/internal/elastic_ramen/v1/models")) {
          return new Response("not found", { status: 404 })
        }
        return Response.json({
          object: "list",
          data: [
            { id: "preferred-inference", owned_by: ".inference", object: "model" },
            { id: "my-inference", owned_by: ".inference", object: "model" },
          ],
        })
      },
    })
    try {
      const base = `http://127.0.0.1:${server.port}`
      const p = await KibanaGateway.buildProvider(base, "Zm9v")
      expect(p.kibana.models.default).toBeDefined()
      expect((p.kibana.models.default as { id: string }).id).toBe("preferred-inference")
      expect((p.kibana.models.default as { name: string }).name).toBe("Preferred Inference (default)")
      expect(p.kibana.models["my-inference"]).toBeDefined()
      expect((p.kibana.models["my-inference"] as { id: string; name: string }).id).toBe("my-inference")
      expect((p.kibana.models["my-inference"] as { name: string }).name).toBe("My Inference")
      expect(p.kibana.models["preferred-inference"]).toBeUndefined()
      expect(p.kibana.options.baseURL).toBe(`${base}/internal/elastic_ramen/v1`)
    } finally {
      server.stop(true)
    }
  })

  test("buildProvider keeps only default when models request fails", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("err", { status: 503 })
      },
    })
    try {
      const base = `http://127.0.0.1:${server.port}`
      const p = await KibanaGateway.buildProvider(base, "Zm9v")
      expect(Object.keys(p.kibana.models)).toEqual(["default"])
    } finally {
      server.stop(true)
    }
  })

  test("tryFetchAgentBuilderDefaultConnectorId returns undefined when connectors route fails", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("", { status: 502 }) })
    try {
      const base = `http://127.0.0.1:${server.port}`
      expect(await KibanaGateway.tryFetchAgentBuilderDefaultConnectorId(base, "k")).toBeUndefined()
    } finally {
      server.stop(true)
    }
  })

  test("tryFetchAgentBuilderSkillList maps results and includes include_plugins", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (!url.pathname.endsWith("/api/agent_builder/skills")) return new Response("no", { status: 404 })
        expect(url.searchParams.get("include_plugins")).toBe("true")
        expect(req.headers.get("elastic-api-version")).toBe("2023-10-31")
        return Response.json({
          results: [
            { id: "a", name: "A", description: "d1" },
            { id: "b", name: "B", description: "d2" },
          ],
        })
      },
    })
    try {
      const base = `http://127.0.0.1:${server.port}`
      const list = await KibanaGateway.tryFetchAgentBuilderSkillList(base, "k", { includePlugins: true })
      expect(list).toEqual([
        { id: "a", name: "A", description: "d1" },
        { id: "b", name: "B", description: "d2" },
      ])
    } finally {
      server.stop(true)
    }
  })

  test("tryFetchAgentBuilderSkill returns detail with referenced_content", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname
        const ok =
          path.endsWith("/api/agent_builder/skills/x%2Fy") ||
          path.endsWith("/api/agent_builder/skills/x/y")
        if (!ok) return new Response("no", { status: 404 })
        return Response.json({
          id: "x/y",
          name: "N",
          description: "D",
          content: "# body",
          referenced_content: [{ name: "r1", relativePath: "./r.md", content: "rc" }],
        })
      },
    })
    try {
      const base = `http://127.0.0.1:${server.port}`
      const d = await KibanaGateway.tryFetchAgentBuilderSkill(base, "k", "x/y")
      expect(d?.content).toBe("# body")
      expect(d?.referenced_content?.[0]?.content).toBe("rc")
    } finally {
      server.stop(true)
    }
  })

  test("tryFetchAgentBuilderSkillList returns undefined when fetch throws", async () => {
    expect(await KibanaGateway.tryFetchAgentBuilderSkillList("http://127.0.0.1:1", "k")).toBeUndefined()
  })

  test("tryFetchConnectors returns undefined when response not ok", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("", { status: 502 }) })
    try {
      const base = `http://127.0.0.1:${server.port}`
      expect(await KibanaGateway.tryFetchConnectors(base, "k")).toBeUndefined()
    } finally {
      server.stop(true)
    }
  })

  test("refreshKibanaProviderModels replaces connector models on success", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.url.includes("/internal/search_inference_endpoints/connectors")) {
          return Response.json({ connectors: [{ connectorId: "conn-b" }], soEntryFound: false })
        }
        if (!req.url.includes("/internal/elastic_ramen/v1/models")) return new Response("no", { status: 404 })
        return Response.json({ data: [{ id: "conn-a" }, { id: "conn-b" }] })
      },
    })
    try {
      const base = `http://127.0.0.1:${server.port}`
      const provider = {
        options: {
          baseURL: `${base}/internal/elastic_ramen/v1`,
          headers: { Authorization: "ApiKey x" },
        },
        models: {
          default: {
            id: "default",
            name: "Default Connector",
            api: { id: "default", npm: "@ai-sdk/openai-compatible", url: `${base}/internal/elastic_ramen/v1` },
            capabilities: {
              temperature: true,
              reasoning: false,
              attachment: false,
              toolcall: true,
              input: { text: true, audio: false, image: false, video: false, pdf: false },
              output: { text: true, audio: false, image: false, video: false, pdf: false },
              interleaved: false,
            },
            cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
            limit: { context: 128000, output: 8192 },
            variants: {},
            providerID: "kibana",
            status: "active",
          },
        },
      }
      await KibanaGateway.refreshKibanaProviderModels(provider)
      const models = provider.models as Record<string, { api: { id: string }; name: string }>
      expect(Object.keys(models).sort()).toEqual(["conn-a", "default"])
      expect(models.default.api.id).toBe("conn-b")
      expect(models.default.name).toBe("Conn B (default)")
      expect(models["conn-a"].api.id).toBe("conn-a")
      expect(models["conn-a"].name).toBe("Conn A")
    } finally {
      server.stop(true)
    }
  })

  test("refreshKibanaProviderModels keeps models when request fails", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("", { status: 502 }) })
    try {
      const base = `http://127.0.0.1:${server.port}`
      const provider = {
        options: {
          baseURL: `${base}/internal/elastic_ramen/v1`,
          headers: { Authorization: "ApiKey x" },
        },
        models: { default: { id: "default", api: { id: "default", npm: "@ai-sdk/openai-compatible" } } },
      }
      await KibanaGateway.refreshKibanaProviderModels(provider)
      expect(Object.keys(provider.models)).toEqual(["default"])
    } finally {
      server.stop(true)
    }
  })

  test("refreshKibanaProviderModels keeps models when fetch throws (unreachable host)", async () => {
    // 127.0.0.1:1 is reliably closed, so fetch() rejects rather than returning a non-OK response.
    const base = "http://127.0.0.1:1"
    const provider = {
      options: {
        baseURL: `${base}/internal/elastic_ramen/v1`,
        headers: { Authorization: "ApiKey x" },
      },
      models: { default: { id: "default", api: { id: "default", npm: "@ai-sdk/openai-compatible" } } },
    }
    await KibanaGateway.refreshKibanaProviderModels(provider)
    expect(Object.keys(provider.models)).toEqual(["default"])
  })

  test("tryFetchConnectors returns undefined when fetch throws", async () => {
    expect(await KibanaGateway.tryFetchConnectors("http://127.0.0.1:1", "k")).toBeUndefined()
  })

  test("tryFetchAgentBuilderDefaultConnectorId returns undefined when fetch throws", async () => {
    expect(await KibanaGateway.tryFetchAgentBuilderDefaultConnectorId("http://127.0.0.1:1", "k")).toBeUndefined()
  })

  test("buildProvider prefers context_window_size from API over fallback", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.url.includes("/internal/search_inference_endpoints/connectors")) {
          return Response.json({ connectors: [], soEntryFound: false })
        }
        if (!req.url.includes("/internal/elastic_ramen/v1/models")) return new Response("no", { status: 404 })
        return Response.json({
          object: "list",
          data: [
            { id: ".anthropic-claude-4.5-sonnet-chat_completion", context_window_size: 750_000 },
            { id: ".openai-gpt-4.1-chat_completion" },
          ],
        })
      },
    })
    try {
      const base = `http://127.0.0.1:${server.port}`
      const p = await KibanaGateway.buildProvider(base, "Zm9v")
      const sonnet = p.kibana.models[".anthropic-claude-4.5-sonnet-chat_completion"] as {
        limit: { context: number }
      }
      const gpt = p.kibana.models[".openai-gpt-4.1-chat_completion"] as { limit: { context: number } }
      expect(sonnet.limit.context).toBe(750_000)
      expect(gpt.limit.context).toBe(1_000_000)
    } finally {
      server.stop(true)
    }
  })

  test("refreshKibanaProviderModels resets limit.context to template default for unknown connectors", async () => {
    // Regression: previously, an unknown connector cloned from a stale 1M default carried the
    // stale 1M forward instead of resetting to the 128k template default.
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.url.includes("/internal/search_inference_endpoints/connectors")) {
          return Response.json({ connectors: [{ connectorId: "unknown-default" }], soEntryFound: false })
        }
        if (!req.url.includes("/internal/elastic_ramen/v1/models")) return new Response("no", { status: 404 })
        return Response.json({ data: [{ id: "unknown-default" }, { id: "unknown-other" }] })
      },
    })
    try {
      const base = `http://127.0.0.1:${server.port}`
      const provider = {
        options: { baseURL: `${base}/internal/elastic_ramen/v1`, headers: { Authorization: "ApiKey x" } },
        models: {
          default: {
            id: "default",
            api: { id: "default" },
            limit: { context: 1_000_000, output: 8192 },
          },
        },
      }
      await KibanaGateway.refreshKibanaProviderModels(provider)
      const models = provider.models as Record<string, { limit: { context: number; output: number } }>
      expect(models.default.limit.context).toBe(128_000)
      expect(models["unknown-other"].limit.context).toBe(128_000)
      expect(models.default.limit.output).toBe(8192)
    } finally {
      server.stop(true)
    }
  })

  test("refreshKibanaProviderModels overrides limit.context per connector", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.url.includes("/internal/search_inference_endpoints/connectors")) {
          return Response.json({
            connectors: [{ connectorId: ".anthropic-claude-4.5-sonnet-chat_completion" }],
            soEntryFound: false,
          })
        }
        if (!req.url.includes("/internal/elastic_ramen/v1/models")) return new Response("no", { status: 404 })
        return Response.json({
          data: [
            { id: ".anthropic-claude-4.5-sonnet-chat_completion" },
            { id: ".openai-gpt-4o-chat_completion" },
            { id: "custom-user-connector" },
          ],
        })
      },
    })
    try {
      const base = `http://127.0.0.1:${server.port}`
      const provider = {
        options: { baseURL: `${base}/internal/elastic_ramen/v1`, headers: { Authorization: "ApiKey x" } },
        models: {
          default: {
            id: "default",
            api: { id: "default" },
            limit: { context: 128_000, output: 8192 },
          },
        },
      }
      await KibanaGateway.refreshKibanaProviderModels(provider)
      const models = provider.models as Record<string, { limit: { context: number; output: number } }>
      expect(models.default.limit.context).toBe(1_000_000)
      expect(models.default.limit.output).toBe(8192)
      expect(models[".openai-gpt-4o-chat_completion"].limit.context).toBe(128_000)
      expect(models["custom-user-connector"].limit.context).toBe(128_000)
    } finally {
      server.stop(true)
    }
  })
})

describe("KibanaGateway.connectorContextLimit", () => {
  test.each([
    [".anthropic-claude-4.5-sonnet-chat_completion", 1_000_000],
    [".anthropic-claude-4.6-sonnet-chat_completion", 1_000_000],
    [".anthropic-claude-3.5-sonnet-chat_completion", 200_000],
    [".anthropic-claude-3-haiku-chat_completion", 200_000],
    [".anthropic-claude-4.6-opus-chat_completion", 200_000],
    [".openai-gpt-4.1-chat_completion", 1_000_000],
    [".openai-gpt-4.1-mini-chat_completion", 1_000_000],
    [".openai-gpt-4o-chat_completion", 128_000],
    [".openai-o3-chat_completion", 200_000],
    [".google-gemini-2.5-pro-chat_completion", 1_000_000],
    [".google-gemini-2.5-flash-chat_completion", 128_000],
    [".google-gemini-2.0-flash-chat_completion", 1_000_000],
    [".google-gemini-2.0-pro-chat_completion", 2_000_000],
  ])("%s -> %i", (id, ctx) => {
    expect(KibanaGateway.connectorContextLimit(id)).toBe(ctx as number)
  })

  test("returns undefined for unknown patterns", () => {
    expect(KibanaGateway.connectorContextLimit("custom-user-connector")).toBeUndefined()
    expect(KibanaGateway.connectorContextLimit(".openai-gpt-5.4-chat_completion")).toBeUndefined()
    expect(KibanaGateway.connectorContextLimit(".google-gemini-3.1-pro-chat_completion")).toBeUndefined()
  })
})
