import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import os from "node:os"
import { ElasticAuth } from "../../src/elastic/auth"
import { KibanaClient } from "../../src/elastic/client"
import { Installation } from "../../src/installation"

describe("KibanaClient headers", () => {
  let checkSpy: ReturnType<typeof spyOn<typeof ElasticAuth, "check">>
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>

  beforeEach(() => {
    checkSpy = spyOn(ElasticAuth, "check")
    checkSpy.mockResolvedValue({
      configured: true,
      context: { kibana_url: "https://kb.example.com", api_key: "test-key" },
    } as Awaited<ReturnType<typeof ElasticAuth.check>>)

    fetchSpy = spyOn(globalThis, "fetch")
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
  })

  afterEach(() => {
    checkSpy.mockRestore()
    fetchSpy.mockRestore()
  })

  test("sets user-agent with ramen version and platform", async () => {
    await KibanaClient.conversations().list()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>

    expect(headers["user-agent"]).toBe(
      `elastic-ramen/${Installation.VERSION} (${os.platform()} ${os.arch()})`,
    )
  })
})
