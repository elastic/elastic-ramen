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
})
