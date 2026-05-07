import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Provider } from "@opencode-ai/sdk/v2"
import { computeContextInfo } from "../../../src/cli/cmd/tui/util/sidebar"

const baseTokens = { input: 1000, output: 500, reasoning: 0, cache: { read: 0, write: 0 } }

const assistant = (providerID: string, modelID = "model-x", tokens = baseTokens): AssistantMessage => ({
  id: "msg_1",
  sessionID: "ses_1",
  role: "assistant",
  agent: "build",
  modelID,
  providerID,
  mode: "",
  parentID: "msg_0",
  path: { cwd: "/", root: "/" },
  cost: 0,
  tokens,
  time: { created: 1000000 },
})

const provider = (id: string, contextLimit: number): Provider => ({
  id,
  name: id,
  source: "config",
  env: [],
  options: {},
  models: {
    "model-x": {
      id: "model-x",
      providerID: id,
      name: "Model X",
      api: { id: "model-x", url: "https://example.com", npm: "@ai-sdk/openai" },
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
      limit: { context: contextLimit, output: 8192 },
      status: "active",
      options: {},
      headers: {},
      release_date: "2025-01-01",
    },
  },
})

describe("computeContextInfo", () => {
  test("returns undefined when there are no messages", () => {
    expect(computeContextInfo([], [])).toBeUndefined()
  })

  test("returns undefined when no assistant message has output tokens", () => {
    const msg = assistant("anthropic", "model-x", { ...baseTokens, output: 0 })
    expect(computeContextInfo([msg], [])).toBeUndefined()
  })

  test("returns token count and percentage for non-kibana provider", () => {
    const msg = assistant("anthropic")
    const result = computeContextInfo([msg], [provider("anthropic", 10000)])
    expect(result).toBeDefined()
    expect(result!.tokens).toBe("1,500")
    expect(result!.percentage).toBe(15)
    expect(result!.isKibana).toBe(false)
  })

  test("sets isKibana=true when providerID is 'kibana'", () => {
    const msg = assistant("kibana")
    const result = computeContextInfo([msg], [provider("kibana", 128000)])
    expect(result).toBeDefined()
    expect(result!.isKibana).toBe(true)
  })

  test("percentage is null when provider model has no context limit", () => {
    const msg = assistant("anthropic")
    const result = computeContextInfo([msg], [])
    expect(result).toBeDefined()
    expect(result!.percentage).toBeNull()
  })

  test("uses the last assistant message with output tokens", () => {
    const first = assistant("anthropic", "model-x", { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } })
    const second = assistant("kibana", "model-x", { input: 2000, output: 1000, reasoning: 0, cache: { read: 0, write: 0 } })
    const result = computeContextInfo([first, second], [provider("kibana", 128000)])
    expect(result!.isKibana).toBe(true)
    expect(result!.tokens).toBe("3,000")
  })
})
