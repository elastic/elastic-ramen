import { KibanaGateway } from "@/elastic/kibana-gateway"

type ProviderEntry = { id: string; models: Record<string, { name?: string }> }

/**
 * Resolve the display label for a (providerID, modelID) pair.
 *
 * The kibana provider's `default` entry stores the resolved connector id under
 * `model.id`, which is what gets stamped onto the message at send time. The
 * model dict is keyed by `"default"`, so the lookup misses for that path.
 * Beautify the raw connector id via `connectorDisplayName` for kibana to avoid
 * showing identifiers like `.anthropic-claude-4.6-opus-chat_completion`.
 */
export function resolveModelLabel(providerID: string, modelID: string, providers?: ProviderEntry[]): string {
  const model = providers?.find((x) => x.id === providerID)?.models[modelID]
  if (model?.name) return model.name
  if (providerID === "kibana") return KibanaGateway.connectorDisplayName(modelID)
  return modelID
}
