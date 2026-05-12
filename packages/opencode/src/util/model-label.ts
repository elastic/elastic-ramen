import { KibanaGateway } from "@/elastic/kibana-gateway"

type ModelEntry = { name?: string; api?: { id?: string } }
type ProviderEntry = { id: string; models: Record<string, ModelEntry> }

/**
 * Resolve the display label for a (providerID, modelID) pair.
 *
 * For Kibana, `modelID` may be the inference connector id while the catalog only
 * exposes that connector under `models.default` (`resolveKibanaModel`).
 */
export function resolveModelLabel(providerID: string, modelID: string, providers?: ProviderEntry[]): string {
  const prov = providers?.find((x) => x.id === providerID)
  const model =
    providerID === "kibana" ? KibanaGateway.resolveKibanaModel(prov?.models, modelID) : prov?.models[modelID]
  if (model?.name) return model.name
  if (providerID === "kibana") return KibanaGateway.connectorDisplayName(modelID)
  return modelID
}
