import type { AssistantMessage, Message, Provider } from "@opencode-ai/sdk/v2"
import { KibanaGateway } from "@/elastic/kibana-gateway"

export function computeContextInfo(messages: Message[], providers: Provider[]) {
  const last = messages.findLast(
    (x): x is AssistantMessage => x.role === "assistant" && (x as AssistantMessage).tokens.output > 0,
  )
  if (!last) return undefined
  const total =
    last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
  const prov = providers.find((x) => x.id === last.providerID)
  const model =
    last.providerID === "kibana"
      ? KibanaGateway.resolveKibanaModel(prov?.models, last.modelID)
      : prov?.models[last.modelID]
  return {
    tokens: total.toLocaleString("en-US"),
    percentage: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
    isKibana: last.providerID === "kibana",
  }
}
