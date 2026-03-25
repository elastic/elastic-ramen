import z from "zod"
import { Tool } from "./tool"
import { ElasticCloud } from "@/elastic/cloud"
import { ElasticAuth } from "@/elastic/auth"
import { Instance } from "@/project/instance"

function json(data: unknown) {
  return JSON.stringify(data, null, 2)
}

async function requireCloudApiKey(): Promise<string> {
  const key = await ElasticAuth.cloudApiKey()
  if (!key) throw new Error("Elastic Cloud API key not configured. Start with --cloud-api-key flag or add cloud_api_key to your elastic config.")
  return key
}

async function switchToProject(cloudApiKey: string, project: ElasticCloud.Project): Promise<string> {
  const esUrl = project.endpoints.elasticsearch
  const kibanaUrl = project.endpoints.kibana

  // Check if we have cached credentials for this project
  const contexts = await ElasticAuth.listContexts()
  const cached = contexts[project.name]
  if (cached?.api_key && cached?.elasticsearch_url) {
    const res = await fetch(cached.elasticsearch_url, {
      headers: { Authorization: `ApiKey ${cached.api_key}` },
    }).catch(() => null)
    if (res?.ok) {
      await ElasticAuth.switchContext(project.name)
      await Instance.dispose()
      return `Switched to project "${project.name}" (${project.id})\n  ES: ${esUrl}\n  Kibana: ${kibanaUrl}`
    }
  }

  // No cached credentials — user needs to authenticate via Kibana onboarding
  return `No cached credentials for "${project.name}". Use the /switch-project command to authenticate via Kibana onboarding.\n  Kibana: ${kibanaUrl}/app/elasticConsole`
}

// ── Cloud Tools ──────────────────────────────────────────────────────────

export const CloudListProjects = Tool.define("cloud_list_projects", {
  description:
    "List all serverless projects (Elasticsearch, Observability, Security) in the Elastic Cloud organization. Returns project names, IDs, types, regions, and endpoints. Use this to discover available projects before switching.",
  parameters: z.object({}),
  async execute() {
    const cloudApiKey = await requireCloudApiKey()
    const projects = await ElasticCloud.listProjects(cloudApiKey)

    const formatted = projects.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      region: p.region_id,
      elasticsearch: p.endpoints?.elasticsearch,
      kibana: p.endpoints?.kibana,
    }))

    return { title: "List projects", metadata: {}, output: json(formatted) }
  },
})

export const CloudSwitchProject = Tool.define("cloud_switch_project", {
  description:
    "Switch the current Elastic Console connection to a different serverless project. Creates a new API key for the target project and updates the local configuration. Use cloud_list_projects first to find the project ID.",
  parameters: z.object({
    project_id: z.string().describe("ID of the serverless project to switch to"),
  }),
  async execute(params) {
    const cloudApiKey = await requireCloudApiKey()
    const project = await ElasticCloud.getProject(cloudApiKey, params.project_id)
    const result = await switchToProject(cloudApiKey, project)
    return { title: `Switch to ${project.name}`, metadata: {}, output: result }
  },
})

export const CloudCreateProject = Tool.define("cloud_create_project", {
  description:
    "Create a new serverless project in Elastic Cloud and switch to it. The project will be created and this tool will wait for it to initialize before switching.",
  parameters: z.object({
    name: z.string().describe("Name for the new project"),
    region_id: z.string().optional().describe("Region ID (e.g. 'aws-us-east-1'). Defaults to 'aws-us-east-1'"),
    type: z
      .enum(["elasticsearch", "observability", "security"])
      .optional()
      .describe("Project type. Defaults to 'elasticsearch'"),
  }),
  async execute(params) {
    const cloudApiKey = await requireCloudApiKey()
    const regionId = params.region_id ?? "aws-us-east-1"
    const type = params.type ?? "elasticsearch"

    const created = await ElasticCloud.createProject(cloudApiKey, params.name, regionId, type)

    // Wait for the project to be fully initialized with endpoints
    const project = await ElasticCloud.waitForProject(cloudApiKey, created.id, type)

    const result = await switchToProject(cloudApiKey, project)
    return {
      title: `Created ${project.name}`,
      metadata: {},
      output: `Created ${type} project "${project.name}" (${project.id}) in ${regionId}\n${result}`,
    }
  },
})
