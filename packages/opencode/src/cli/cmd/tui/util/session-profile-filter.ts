// Copyright (c) 2026-present, Elastic NV
import { type Accessor, createMemo, createResource } from "solid-js"
import { SessionProfile } from "@/elastic/session-profile"

/**
 * Reactive predicate for filtering session pickers by the active Elastic profile.
 *
 * Returns an accessor that yields a `(sessionID) => boolean` predicate. The accessor
 * recomputes when the set of session IDs changes; stamps for unseen IDs are loaded
 * once via `SessionProfile.getMany` (which caches).
 *
 * The active profile is read from `SessionProfile.active()` rather than via
 * `useElasticProfile()` — the picker renders inside the `DialogProvider` subtree,
 * which sits *above* `ElasticProfileProvider` in the component tree, so the context
 * is unreachable from here. Picker dialogs are modal and short-lived, so we don't
 * need reactivity to profile switches mid-render.
 */
export function createSessionProfileFilter(sessions: Accessor<{ id: string }[]>) {
  const [active] = createResource(() => SessionProfile.active())
  const [profileMap] = createResource(
    () => sessions().map((s) => s.id),
    (ids) => SessionProfile.getMany(ids),
  )
  return createMemo(() => {
    const a = active()
    const m = profileMap()
    if (active.loading || profileMap.loading) return () => false
    return (sessionID: string) => SessionProfile.matches(m?.get(sessionID), a)
  })
}
