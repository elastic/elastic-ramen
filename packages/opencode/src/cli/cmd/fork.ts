import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { bootstrap } from "../bootstrap"
import { KibanaClient } from "../../elastic/client"
import { Handover } from "../../elastic/handover"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { Server } from "../../server/server"
import { Session } from "../../session"
import { SessionID } from "../../session/schema"
import { Process } from "../../util/process"
import { Provider } from "../../provider/provider"
import { Agent } from "../../agent/agent"

export const ForkCommand = cmd({
  command: "fork <id>",
  describe: "fork a Kibana conversation for independent investigation, then post handoff summary",
  builder: (yargs: Argv) => {
    return yargs
      .positional("id", {
        describe: "Kibana conversation ID to fork",
        type: "string",
        demandOption: true,
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
  },
  handler: async (args) => {
    const conversationID = args.id

    // 1. Locate the conversation (claims ownership) and fetch full history
    UI.println(UI.Style.TEXT_DIM + `Locating conversation ${conversationID}...` + UI.Style.TEXT_NORMAL)
    try {
      await KibanaClient.conversations().locate(conversationID)
    } catch (e) {
      UI.error(`Failed to locate conversation: ${e instanceof Error ? e.message : String(e)}`)
      process.exit(1)
    }

    const conv = await Handover.get(conversationID).catch((e) => {
      UI.error(`Failed to fetch conversation: ${e instanceof Error ? e.message : String(e)}`)
      process.exit(1)
    })

    const rounds = Handover.rounds(conv)

    UI.println(UI.Style.TEXT_INFO_BOLD + "⑂  " + UI.Style.TEXT_NORMAL + `Forked: ${conv.title}`)
    if (rounds.length > 0) {
      UI.println(UI.Style.TEXT_DIM + `  ${rounds.length} round(s) loaded` + UI.Style.TEXT_NORMAL)
    }
    UI.empty()

    // 2. Create session, seed it with conversation history, and link it to the Kibana conversation
    let sessionID: string | undefined

    await bootstrap(process.cwd(), async () => {
      const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        return Server.Default().fetch(request)
      }) as typeof globalThis.fetch
      const sdk = createOpencodeClient({ baseUrl: "http://opencode.internal", fetch: fetchFn })

      const result = await sdk.session.create({ title: `Fork: ${conv.title}` })
      sessionID = result.data?.id
      if (!sessionID) throw new Error("Failed to create session")

      // Resolve model and agent for seeding metadata
      const parsedModel = args.model ? Provider.parseModel(args.model) : undefined
      const model = parsedModel ?? (await Provider.defaultModel())
      const agent = await Agent.defaultAgent()

      if (rounds.length > 0) {
        await fetchFn(`http://opencode.internal/session/${sessionID}/seed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rounds, model, agent }),
        })
      }

      Handover.link(sessionID, conversationID)
    })

    if (!sessionID) {
      UI.error("Failed to create session")
      process.exit(1)
    }

    // 3. Launch the TUI attached to the seeded session
    const tuiArgs = [process.execPath, "--session", sessionID]
    if (args.model) tuiArgs.push("--model", args.model)

    const tui = Process.spawn(tuiArgs, { stdin: "inherit", stdout: "inherit", stderr: "inherit" })
    await tui.exited

    // 4. Read the last assistant message and post handoff
    UI.empty()
    UI.println(UI.Style.TEXT_DIM + "Posting handoff summary..." + UI.Style.TEXT_NORMAL)

    let summary = "Investigation complete. No summary generated."
    await bootstrap(process.cwd(), async () => {
      const sid = SessionID.make(sessionID!)
      const msgs = await Session.messages({ sessionID: sid })
      // messages() returns newest-first; find the last assistant text part
      for (const msg of msgs) {
        if (msg.info.role !== "assistant") continue
        for (const part of msg.parts ?? []) {
          if (part.type === "text" && part.text?.trim()) {
            summary = part.text.trim()
            break
          }
        }
        if (summary !== "Investigation complete. No summary generated.") break
      }
    })

    try {
      await KibanaClient.conversations().handoff(conversationID, { summary })
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✓  " + UI.Style.TEXT_NORMAL + "Handoff posted to conversation " + conversationID)
    } catch (e) {
      UI.error(`Failed to post handoff: ${e instanceof Error ? e.message : String(e)}`)
    }
  },
})
