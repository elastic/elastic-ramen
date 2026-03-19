import { createContext, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import type { KibanaClient } from "@/elastic/client"

function init() {
  const [store, set] = createStore({
    attachments: [] as KibanaClient.AttachmentSummary[],
  })

  return {
    get attachments() {
      return store.attachments
    },
    set(attachments: KibanaClient.AttachmentSummary[]) {
      set("attachments", attachments)
    },
  }
}

export type AttachmentsContext = ReturnType<typeof init>

const ctx = createContext<AttachmentsContext>()

export function AttachmentsProvider(props: ParentProps) {
  return <ctx.Provider value={init()}>{props.children}</ctx.Provider>
}

export function useAttachments() {
  const value = useContext(ctx)
  if (!value) throw new Error("useAttachments must be used within AttachmentsProvider")
  return value
}
