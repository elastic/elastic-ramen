import { createContext, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import type { WorkflowRuns } from "@/elastic/workflow-runs"

function init() {
  const [store, set] = createStore({
    runs: [] as WorkflowRuns.Run[],
  })

  return {
    get runs() {
      return store.runs
    },
    set(runs: WorkflowRuns.Run[]) {
      set("runs", runs)
    },
  }
}

export type WorkflowRunsContext = ReturnType<typeof init>

const ctx = createContext<WorkflowRunsContext>()

export function WorkflowRunsProvider(props: ParentProps) {
  return <ctx.Provider value={init()}>{props.children}</ctx.Provider>
}

export function useWorkflowRuns() {
  const value = useContext(ctx)
  if (!value) throw new Error("useWorkflowRuns must be used within WorkflowRunsProvider")
  return value
}
