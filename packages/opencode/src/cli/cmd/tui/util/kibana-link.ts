// Copyright (c) 2026-present, Elastic NV
import { createSignal } from "solid-js"

// Module-level version signal. `Handover.sync` is fire-and-forget from
// app.tsx's busy→idle effect, so the sidebar's createResource (keyed on
// sessionID) never refetches when a fresh session's `kibana_link` is written
// for the first time. Bumping this after a successful sync gives the resource
// a reactive trigger to re-resolve.
const [version, setVersion] = createSignal(0)
export const kibanaLinkVersion = version
export function bumpKibanaLinkVersion() {
  setVersion((v) => v + 1)
}
