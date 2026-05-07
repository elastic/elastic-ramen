import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { ElasticAuth } from "../../src/elastic/auth"
import { Handover } from "../../src/elastic/handover"
import { KibanaClient } from "../../src/elastic/client"
import { SessionProfile } from "../../src/elastic/session-profile"

// Tests for Handover.sync's profile-mismatch skip and 404 self-heal — the two
// behaviours that close the legacy-session 404 gap. We mock both the Kibana client
// (so no network) and ElasticAuth.check (so we control the active profile), then
// verify Handover routes the call to update vs create in the right scenarios.

type ConvApi = ReturnType<typeof KibanaClient.conversations>

function fakeApi(impl: Partial<ConvApi>): ConvApi {
  return {
    list: async () => ({ results: [] }),
    get: async () => {
      throw new Error("not implemented")
    },
    create: async () => {
      throw new Error("not implemented")
    },
    update: async () => {
      throw new Error("not implemented")
    },
    ...impl,
  } as ConvApi
}

const round = Handover.round({ id: "r1", user: "hi", assistant: "hello" })

describe("Handover.sync", () => {
  let checkSpy: ReturnType<typeof spyOn<typeof ElasticAuth, "check">>
  let convSpy: ReturnType<typeof spyOn<typeof KibanaClient, "conversations">>

  beforeEach(() => {
    checkSpy = spyOn(ElasticAuth, "check")
    convSpy = spyOn(KibanaClient, "conversations")
  })
  afterEach(async () => {
    checkSpy.mockRestore()
    convSpy.mockRestore()
  })

  test("skips entirely when the session belongs to a different profile (defensive)", async () => {
    const id = "ses-foreign-" + Bun.randomUUIDv7()
    // Stamp under profile A, then attempt to sync under profile B — picker should
    // never let this happen, but `--session=<id>` and similar paths can.
    checkSpy.mockResolvedValueOnce({ configured: true, name: "alpha" })
    await SessionProfile.stamp(id)
    checkSpy.mockResolvedValue({ configured: true, name: "beta" })

    let updateCalled = false
    let createCalled = false
    convSpy.mockReturnValue(
      fakeApi({
        update: async () => {
          updateCalled = true
        },
        create: async () => {
          createCalled = true
          return { id: "new" }
        },
      }),
    )

    let mismatch: { stamp: string; active: string } | undefined
    await Handover.sync(id, "title", [round], {
      onProfileMismatch: (info) => {
        mismatch = info
      },
    })
    expect(updateCalled).toBe(false)
    expect(createCalled).toBe(false)
    expect(mismatch).toEqual({ stamp: "alpha", active: "beta" })
    await SessionProfile.remove(id)
  })

  test("creates a fresh conversation when update() returns 404 (stale legacy link)", async () => {
    const id = "ses-stale-" + Bun.randomUUIDv7()
    checkSpy.mockResolvedValue({ configured: true, name: "alpha" })

    // Seed a kibana_link that will 404 on update — simulates a session whose
    // conversation was created under another cluster.
    Handover.link(id, "stale-conv-id")

    let updateAttempts = 0
    let createPayload: { title?: string } | undefined
    convSpy.mockReturnValue(
      fakeApi({
        update: async () => {
          updateAttempts++
          throw new Error("Kibana 404: conversation not found")
        },
        create: async (body) => {
          createPayload = body
          return { id: "fresh-conv-id" }
        },
      }),
    )

    await Handover.sync(id, "my title", [round])

    expect(updateAttempts).toBe(1)
    expect(createPayload?.title).toBe("RAMEN: my title")
    // After the recovery, the link points at the fresh conversation in the active cluster.
    expect(await Handover.resolve(id)).toBe("fresh-conv-id")
    await SessionProfile.remove(id)
  })

  test("rethrows non-404 errors from update() instead of silently recreating", async () => {
    const id = "ses-error-" + Bun.randomUUIDv7()
    checkSpy.mockResolvedValue({ configured: true, name: "alpha" })
    Handover.link(id, "conv-id")

    let createCalled = false
    convSpy.mockReturnValue(
      fakeApi({
        update: async () => {
          throw new Error("Kibana 500: internal server error")
        },
        create: async () => {
          createCalled = true
          return { id: "should-not-happen" }
        },
      }),
    )

    await expect(Handover.sync(id, "t", [round])).rejects.toThrow(/Kibana 500/)
    expect(createCalled).toBe(false)
    await SessionProfile.remove(id)
  })
})
