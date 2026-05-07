import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { ElasticAuth } from "../../src/elastic/auth"
import { SessionProfile } from "../../src/elastic/session-profile"
import { Storage } from "../../src/storage/storage"

// Per-test cleanup of the SessionProfile in-memory cache (which is process-wide and
// would otherwise bleed between tests). Storage entries are key-scoped per session so
// random IDs make per-test cleanup unnecessary, but the cache for any seeded ID must
// be cleared to keep tests honest.
async function clearSession(id: string) {
  await SessionProfile.remove(id)
}

describe("SessionProfile.matches", () => {
  test("no active profile (fresh install) → everything visible", () => {
    expect(SessionProfile.matches(undefined, undefined)).toBe(true)
    expect(SessionProfile.matches("anything", undefined)).toBe(true)
  })

  test("legacy unstamped sessions visible under any active profile", () => {
    expect(SessionProfile.matches(undefined, "prod")).toBe(true)
  })

  test("strict match when both stamp and active are set", () => {
    expect(SessionProfile.matches("prod", "prod")).toBe(true)
    expect(SessionProfile.matches("prod", "staging")).toBe(false)
  })
})

describe("SessionProfile.stamp / get / getMany / ensureStamp / remove", () => {
  // Single spy shared by every test so calls don't stack across cases. Each test
  // queues its own mock responses; the spy is restored to the real impl in afterEach.
  let checkSpy: ReturnType<typeof spyOn<typeof ElasticAuth, "check">>
  beforeEach(() => {
    checkSpy = spyOn(ElasticAuth, "check")
  })
  afterEach(() => {
    checkSpy.mockRestore()
  })

  test("stamp() is a no-op when no Elastic profile is configured", async () => {
    const id = "ses-unstamped-" + Bun.randomUUIDv7()
    checkSpy.mockResolvedValueOnce({ configured: false })
    await SessionProfile.stamp(id)
    expect(await SessionProfile.get(id)).toBeUndefined()
    await clearSession(id)
  })

  test("stamp() writes the canonicalised profile and get() reads it back", async () => {
    const id = "ses-stamped-" + Bun.randomUUIDv7()
    // Raw (non-canonical) name — stamp must canonicalise so it matches the picker
    // filter, which compares against ElasticAuth.canon-derived names.
    checkSpy.mockResolvedValueOnce({ configured: true, name: "Prod US East" })
    await SessionProfile.stamp(id)
    expect(await SessionProfile.get(id)).toBe("Prod_US_East")
    expect(ElasticAuth.canon("Prod US East")).toBe("Prod_US_East")
    await clearSession(id)
  })

  test("get() returns undefined for an unknown session and caches the miss", async () => {
    const id = "ses-missing-" + Bun.randomUUIDv7()
    expect(await SessionProfile.get(id)).toBeUndefined()
    // Second call must not hit Storage — prove by seeding disk after the first
    // call and verifying get() still returns the cached miss.
    await Storage.write(["session_profile", id], "leaked")
    expect(await SessionProfile.get(id)).toBeUndefined()
    await clearSession(id)
  })

  test("getMany() merges cache hits with disk reads in one batch", async () => {
    const cached = "ses-cached-" + Bun.randomUUIDv7()
    const onDisk = "ses-disk-" + Bun.randomUUIDv7()
    const missing = "ses-missing-" + Bun.randomUUIDv7()

    checkSpy.mockResolvedValueOnce({ configured: true, name: "alpha" })
    await SessionProfile.stamp(cached)
    await Storage.write(["session_profile", onDisk], "beta")

    const result = await SessionProfile.getMany([cached, onDisk, missing])
    expect(result.get(cached)).toBe("alpha")
    expect(result.get(onDisk)).toBe("beta")
    expect(result.get(missing)).toBeUndefined()

    await clearSession(cached)
    await clearSession(onDisk)
    await clearSession(missing)
  })

  test("filter() keeps current-profile and legacy sessions only", async () => {
    const alpha = "ses-alpha-" + Bun.randomUUIDv7()
    const beta = "ses-beta-" + Bun.randomUUIDv7()
    const legacy = "ses-legacy-" + Bun.randomUUIDv7()

    checkSpy.mockResolvedValueOnce({ configured: true, name: "alpha" })
    await SessionProfile.stamp(alpha)
    checkSpy.mockResolvedValueOnce({ configured: true, name: "beta" })
    await SessionProfile.stamp(beta)
    checkSpy.mockResolvedValueOnce({ configured: true, name: "alpha" })

    const result = await SessionProfile.filter([{ id: alpha }, { id: beta }, { id: legacy }])
    expect(result.map((s) => s.id)).toEqual([alpha, legacy])

    await clearSession(alpha)
    await clearSession(beta)
    await clearSession(legacy)
  })

  test("ensureStamp() preserves existing stamp instead of overwriting on profile switch", async () => {
    const id = "ses-ensure-existing-" + Bun.randomUUIDv7()
    checkSpy.mockResolvedValueOnce({ configured: true, name: "alpha" })
    await SessionProfile.stamp(id)

    // Even if the active profile has changed, ensureStamp must return the original stamp.
    checkSpy.mockResolvedValueOnce({ configured: true, name: "beta" })
    expect(await SessionProfile.ensureStamp(id)).toBe("alpha")
    expect(await SessionProfile.get(id)).toBe("alpha")
    await clearSession(id)
  })

  test("ensureStamp() stamps legacy sessions with the active profile and returns it", async () => {
    const id = "ses-ensure-legacy-" + Bun.randomUUIDv7()
    checkSpy.mockResolvedValueOnce({ configured: true, name: "gamma" })
    expect(await SessionProfile.ensureStamp(id)).toBe("gamma")
    expect(await SessionProfile.get(id)).toBe("gamma")
    await clearSession(id)
  })

  test("ensureStamp() returns undefined and writes nothing when no profile is configured", async () => {
    const id = "ses-ensure-none-" + Bun.randomUUIDv7()
    checkSpy.mockResolvedValueOnce({ configured: false })
    expect(await SessionProfile.ensureStamp(id)).toBeUndefined()
    expect(await SessionProfile.get(id)).toBeUndefined()
    await clearSession(id)
  })

  test("remove() clears both disk and cache so a re-stamp under a new profile sticks", async () => {
    const id = "ses-rewrite-" + Bun.randomUUIDv7()
    checkSpy.mockResolvedValueOnce({ configured: true, name: "alpha" })
    await SessionProfile.stamp(id)
    expect(await SessionProfile.get(id)).toBe("alpha")

    await SessionProfile.remove(id)
    expect(await SessionProfile.get(id)).toBeUndefined()

    checkSpy.mockResolvedValueOnce({ configured: true, name: "beta" })
    await SessionProfile.stamp(id)
    expect(await SessionProfile.get(id)).toBe("beta")
    await clearSession(id)
  })
})
