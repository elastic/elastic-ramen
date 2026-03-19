import z from "zod"
import { Tool } from "./tool"
import { KibanaClient } from "@/elastic/client"
import { KibanaAttachments } from "@/elastic/attachments"
import { Bus } from "@/bus"

export const KibanaExecuteTool = Tool.define("execute_kibana_tool", {
  description:
    "Execute a Kibana Agent Builder tool by ID. Only available after loading a skill that has associated tools. " +
    "The skill output will list available tool IDs, their parameter schemas, and the skill_id to use.",
  parameters: z.object({
    skill_id: z.string().describe("The skill ID that owns this tool (from the loaded skill's location)"),
    tool_id: z.string().describe("The tool ID from the loaded skill's <skill_tools> section"),
    tool_params: z.record(z.string(), z.unknown()).describe("Parameters matching the tool's schema"),
  }),
  async execute(params, ctx) {
    const { results, attachments } = await KibanaAttachments.executeTool(
      ctx.sessionID,
      params.skill_id,
      params.tool_id,
      params.tool_params,
    )
    Bus.publish(KibanaAttachments.Event.Updated, {
      sessionID: ctx.sessionID,
      attachments,
    })
    return {
      title: `Executed tool: ${params.tool_id}`,
      metadata: { skill_id: params.skill_id, tool_id: params.tool_id },
      output: JSON.stringify(results, null, 2),
    }
  },
})

export const KibanaSaveDashboardTool = Tool.define("save_kibana_dashboard", {
  description:
    "Save a dashboard attachment from the current session as a persistent Kibana dashboard. " +
    "Use after creating a dashboard via a skill tool. The attachment_id comes from the session's attachments. " +
    "Returns a dashboard URL that you MUST share with the user so they can open it directly.",
  parameters: z.object({
    attachment_id: z.string().describe("The dashboard attachment ID from the session"),
    title: z.string().optional().describe("Optional title override for the saved dashboard"),
  }),
  async execute(params, ctx) {
    const kibanaSessionId = await KibanaAttachments.getKibanaSessionId(ctx.sessionID)
    if (!kibanaSessionId) throw new Error("No active Kibana session. Execute a skill tool first.")
    const result = await KibanaClient.sessions().saveDashboard(kibanaSessionId, params.attachment_id, params.title)
    let url = result.url
    if (url && url.startsWith("/")) {
      const base = await KibanaClient.baseURL()
      url = `${base}${url}`
    }
    return {
      title: "Saved dashboard",
      metadata: { dashboard_id: result.dashboard_id },
      output: `Dashboard saved successfully.\nID: ${result.dashboard_id}\nURL: ${url}\n\nShare this URL with the user so they can open the dashboard directly.`,
    }
  },
})
