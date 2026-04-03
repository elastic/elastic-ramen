// Copyright (c) 2026-present, Elastic NV
// This file is derived from opencode (https://github.com/anomalyco/opencode)
// and has been modified by Elastic NV. Changes: removed URL-based share import (opencode.ai dependency); file-based import retained
import type { Argv } from "yargs"
import type { Session as SDKSession, Message, Part } from "@opencode-ai/sdk/v2"
import { Session } from "../../session"
import { SessionID, MessageID, PartID } from "../../session/schema"
import { WorkspaceID } from "../../control-plane/schema"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Database } from "../../storage/db"
import { SessionTable, MessageTable, PartTable } from "../../session/session.sql"
import { Instance } from "../../project/instance"
import { EOL } from "os"
import { Filesystem } from "../../util/filesystem"

export const ImportCommand = cmd({
  command: "import <file>",
  describe: "import session data from a JSON file",
  builder: (yargs: Argv) => {
    return yargs.positional("file", {
      describe: "path to JSON file",
      type: "string",
      demandOption: true,
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      type ExportData = {
        info: SDKSession
        messages: Array<{ info: Message; parts: Part[] }>
      }

      const exportData = await Filesystem.readJson<ExportData>(args.file).catch(() => undefined)
      if (!exportData) {
        process.stdout.write(`File not found: ${args.file}`)
        process.stdout.write(EOL)
        return
      }

      const row = Session.toRow({
        ...exportData.info,
        id: SessionID.make(exportData.info.id),
        parentID: exportData.info.parentID ? SessionID.make(exportData.info.parentID) : undefined,
        workspaceID: exportData.info.workspaceID ? WorkspaceID.make(exportData.info.workspaceID) : undefined,
        projectID: Instance.project.id,
        revert: exportData.info.revert
          ? {
              ...exportData.info.revert,
              messageID: MessageID.make(exportData.info.revert.messageID),
              partID: exportData.info.revert.partID ? PartID.make(exportData.info.revert.partID) : undefined,
            }
          : undefined,
      })
      Database.use((db) =>
        db
          .insert(SessionTable)
          .values(row)
          .onConflictDoUpdate({ target: SessionTable.id, set: { project_id: row.project_id } })
          .run(),
      )

      for (const msg of exportData.messages) {
        const { id: _mid, sessionID: _msid, ...msgData } = msg.info
        Database.use((db) =>
          db
            .insert(MessageTable)
            .values({
              id: MessageID.make(msg.info.id),
              session_id: row.id,
              time_created: msg.info.time?.created ?? Date.now(),
              data: msgData,
            })
            .onConflictDoNothing()
            .run(),
        )

        for (const part of msg.parts) {
          const { id: _pid, sessionID: _psid, messageID: _pmid, ...partData } = part
          Database.use((db) =>
            db
              .insert(PartTable)
              .values({
                id: PartID.make(part.id),
                message_id: MessageID.make(msg.info.id),
                session_id: row.id,
                data: partData,
              })
              .onConflictDoNothing()
              .run(),
          )
        }
      }

      process.stdout.write(`Imported session: ${exportData.info.id}`)
      process.stdout.write(EOL)
    })
  },
})
