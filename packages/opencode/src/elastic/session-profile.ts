// Copyright (c) 2026-present, Elastic NV
import { Storage } from "@/storage/storage"
import { ElasticAuth } from "./auth"

/**
 * Stamps each TUI session with the canonicalised name of the Elastic profile that was
 * active when the session was created or forked. The stamp lives in `Storage` as a
 * sidecar (`["session_profile", sessionID]`), parallel to `kibana_link` in `handover.ts`.
 *
 * Pickers use `get` / `getMany` to filter sessions to the active profile so a user who
 * switches profiles via `/connect` only sees their own history. Sessions created before
 * this feature shipped have no stamp and remain visible under every profile.
 */
export namespace SessionProfile {
  const cache = new Map<string, string | undefined>()

  function key(sessionID: string): string[] {
    return ["session_profile", sessionID]
  }

  /** Returns the active canonical profile, or `undefined` when Elastic is not configured. */
  export async function active(): Promise<string | undefined> {
    const status = await ElasticAuth.check().catch(() => undefined)
    if (!status?.configured || !status.name) return undefined
    return ElasticAuth.canon(status.name)
  }

  /** Stamp `sessionID` with the active profile. No-op if no profile is configured. */
  export async function stamp(sessionID: string): Promise<void> {
    const profile = await active()
    if (!profile) return
    cache.set(sessionID, profile)
    await Storage.write(key(sessionID), profile).catch(() => {})
  }

  /**
   * Stamp the session if it has no stamp yet, then return the resolved stamp.
   *
   * Used by `Handover.write` to migrate legacy (pre-feature) sessions on their first
   * sync: a session that exists from before stamping shipped gets bound to whatever
   * profile is active when the user next chats in it. Returns `undefined` if no
   * profile is configured (in which case the caller should still attempt the sync —
   * we have no way to associate it).
   */
  export async function ensureStamp(sessionID: string): Promise<string | undefined> {
    const existing = await get(sessionID)
    if (existing) return existing
    const profile = await active()
    if (!profile) return undefined
    cache.set(sessionID, profile)
    await Storage.write(key(sessionID), profile).catch(() => {})
    return profile
  }

  /** Returns the stamped profile, or `undefined` if the session has no stamp (legacy). */
  export async function get(sessionID: string): Promise<string | undefined> {
    if (cache.has(sessionID)) return cache.get(sessionID)
    const stored = await Storage.read<string>(key(sessionID)).catch(() => undefined)
    cache.set(sessionID, stored)
    return stored
  }

  /** Batched `get` for the picker. Populates the in-memory cache. */
  export async function getMany(sessionIDs: string[]): Promise<Map<string, string | undefined>> {
    const out = new Map<string, string | undefined>()
    const misses: string[] = []
    for (const id of sessionIDs) {
      if (cache.has(id)) out.set(id, cache.get(id))
      else misses.push(id)
    }
    if (misses.length) {
      const results = await Promise.all(
        misses.map((id) => Storage.read<string>(key(id)).catch(() => undefined)),
      )
      for (let i = 0; i < misses.length; i++) {
        const id = misses[i]
        const value = results[i]
        cache.set(id, value)
        out.set(id, value)
      }
    }
    return out
  }

  /** Filter sessions using the same profile rules as picker predicates. */
  export async function filter<T extends { id: string }>(sessions: T[]): Promise<T[]> {
    const profile = await active()
    const stamps = await getMany(sessions.map((s) => s.id))
    return sessions.filter((s) => matches(stamps.get(s.id), profile))
  }

  /** Drop the stamp for a deleted session. */
  export async function remove(sessionID: string): Promise<void> {
    cache.delete(sessionID)
    await Storage.remove(key(sessionID)).catch(() => {})
  }

  /**
   * Predicate for the session pickers: should a session whose stamp is `stamp`
   * be visible while `active` is the canonicalised profile name?
   *
   * - `active === undefined` → no profile configured, show everything (new install).
   * - `stamp === undefined` → legacy session created before stamping shipped, show under any profile.
   * - otherwise → strict match.
   */
  export function matches(stamp: string | undefined, active: string | undefined): boolean {
    if (active === undefined) return true
    if (stamp === undefined) return true
    return stamp === active
  }
}
