import { describe, expect, test } from "bun:test"
import { resolveModelLabel } from "../../src/util/model-label"

describe("resolveModelLabel", () => {
  test("beautifies the raw connector id for kibana when the lookup misses", () => {
    // The kibana/default path: KibanaGateway.buildProvider stores models["default"]
    // with id = apiId (the resolved connector), so session/prompt.ts:590 stamps the
    // assistant message with modelID = apiId. The provider.models dict is keyed by
    // "default", not apiId, so the lookup misses. Without the kibana fallback the
    // footer would render the raw `.anthropic-claude-...-chat_completion` id.
    const providers = [
      {
        id: "kibana",
        models: {
          default: { name: "Default Connector" },
        },
      },
    ]
    expect(resolveModelLabel("kibana", ".anthropic-claude-4.6-opus-chat_completion", providers)).toBe(
      "Anthropic Claude 4.6 Opus",
    )
  })
})
