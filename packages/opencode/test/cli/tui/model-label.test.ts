import { describe, expect, test } from "bun:test"
import { resolveModelLabel } from "../../../src/cli/cmd/tui/util/model-label"

describe("resolveModelLabel", () => {
  test("returns model.name when the lookup hits", () => {
    const providers = [
      {
        id: "kibana",
        models: {
          ".anthropic-claude-4.6-sonnet-chat_completion": { name: "Anthropic Claude 4.6 Sonnet" },
        },
      },
    ]
    expect(resolveModelLabel(providers, "kibana", ".anthropic-claude-4.6-sonnet-chat_completion")).toBe(
      "Anthropic Claude 4.6 Sonnet",
    )
  })

  test("beautifies the raw connector id for kibana when the lookup misses", () => {
    // Reproduces the kibana/default path: message is stamped with the
    // resolved connector id, but provider.models only has the "default" key.
    const providers = [
      {
        id: "kibana",
        models: {
          default: { name: "Default Connector" },
        },
      },
    ]
    expect(resolveModelLabel(providers, "kibana", ".anthropic-claude-4.6-opus-chat_completion")).toBe(
      "Anthropic Claude 4.6 Opus",
    )
  })

  test("falls back to raw modelID for non-kibana providers when the lookup misses", () => {
    const providers = [{ id: "anthropic", models: {} }]
    expect(resolveModelLabel(providers, "anthropic", "claude-sonnet-4-5")).toBe("claude-sonnet-4-5")
  })

  test("returns raw modelID when the provider is unknown", () => {
    expect(resolveModelLabel([], "anthropic", "claude-sonnet-4-5")).toBe("claude-sonnet-4-5")
  })
})
