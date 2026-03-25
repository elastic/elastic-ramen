const BASE_URL = "https://api.elastic-cloud.com"

export namespace ElasticCloud {
  export type ProjectType = "elasticsearch" | "observability" | "security"

  export interface Project {
    id: string
    name: string
    alias: string
    region_id: string
    cloud_id: string
    type: ProjectType
    endpoints: { elasticsearch: string; kibana: string; apm?: string; ingest?: string }
    metadata: {
      created_at: string
      created_by: string
      organization_id: string
      suspended_at?: string
      suspended_reason?: string
    }
    optimized_for?: string
    product_tier?: string
  }

  export interface Region {
    identifier: string
    name: string
    project_creation_enabled: boolean
  }

  async function request<T>(path: string, cloudApiKey: string, opts?: { method?: string; body?: unknown }): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: opts?.method ?? "GET",
      headers: {
        Authorization: `ApiKey ${cloudApiKey}`,
        "Content-Type": "application/json",
      },
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`Elastic Cloud API ${res.status}: ${text}`)
    }
    return res.json() as Promise<T>
  }

  const PROJECT_TYPES: ProjectType[] = ["elasticsearch", "observability", "security"]

  export async function listProjects(cloudApiKey: string, types?: ProjectType[]): Promise<Project[]> {
    const toQuery = types ?? PROJECT_TYPES
    const results = await Promise.all(
      toQuery.map((t) => request<{ items: Project[] }>(`/api/v1/serverless/projects/${t}`, cloudApiKey).then((r) => r.items)),
    )
    return results.flat()
  }

  export async function getProject(cloudApiKey: string, id: string, type?: ProjectType): Promise<Project> {
    if (type) {
      return request<Project>(`/api/v1/serverless/projects/${type}/${id}`, cloudApiKey)
    }
    // Try each type until we find it
    for (const t of PROJECT_TYPES) {
      try {
        return await request<Project>(`/api/v1/serverless/projects/${t}/${id}`, cloudApiKey)
      } catch {
        // continue
      }
    }
    throw new Error(`Project ${id} not found`)
  }

  export async function createProject(
    cloudApiKey: string,
    name: string,
    regionId: string,
    type: ProjectType = "elasticsearch",
  ): Promise<Project & { credentials: { username: string; password: string } }> {
    return request(`/api/v1/serverless/projects/${type}`, cloudApiKey, {
      method: "POST",
      body: { name, region_id: regionId },
    })
  }

  export async function listRegions(cloudApiKey: string): Promise<Region[]> {
    return request<Region[]>("/api/v1/serverless/regions", cloudApiKey)
  }

  export async function waitForProject(
    cloudApiKey: string,
    projectId: string,
    type?: ProjectType,
    maxWaitMs = 60_000,
  ): Promise<Project> {
    const start = Date.now()
    while (Date.now() - start < maxWaitMs) {
      const project = await getProject(cloudApiKey, projectId, type)
      if (project.endpoints?.elasticsearch && project.endpoints?.kibana) {
        return project
      }
      await new Promise((r) => setTimeout(r, 3000))
    }
    throw new Error(`Project ${projectId} did not initialize within ${maxWaitMs / 1000}s`)
  }
}
