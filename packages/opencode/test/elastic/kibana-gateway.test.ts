import { describe, expect, test } from "bun:test"
import { KibanaGateway } from "../../src/elastic/kibana-gateway"

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
        if (!req.url.includes("/internal/elastic_ramen/v1/models")) {
          return new Response("not found", { status: 404 })
        }
        return Response.json({
          object: "list",
          data: [{ id: "my-inference", owned_by: ".inference", object: "model" }],
        })
      },
    })
    try {
      const base = `http://127.0.0.1:${server.port}`
      const p = await KibanaGateway.buildProvider(base, "Zm9v")
      expect(p.kibana.models.default).toBeDefined()
      expect(p.kibana.models["my-inference"]).toBeDefined()
      expect((p.kibana.models["my-inference"] as { id: string; name: string }).id).toBe("my-inference")
      expect((p.kibana.models["my-inference"] as { name: string }).name).toBe("My Inference")
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
        if (!req.url.includes("/internal/elastic_ramen/v1/models")) return new Response("no", { status: 404 })
        return Response.json({ data: [{ id: "conn-b" }] })
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
      expect(Object.keys(models).sort()).toEqual(["conn-b", "default"])
      expect(models["conn-b"].api.id).toBe("conn-b")
      expect(models["conn-b"].name).toBe("Conn B")
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
})
