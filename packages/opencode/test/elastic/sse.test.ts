import { describe, expect, test } from "bun:test"
import { Sse } from "../../src/elastic/sse"

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const out: Sse.Event[] = []
  for await (const ev of Sse.events(stream)) out.push(ev)
  return out
}

describe("Sse.events", () => {
  test("parses event + data pair", async () => {
    const got = await collect(streamOf("event: hello\ndata: world\n\n"))
    expect(got).toEqual([{ event: "hello", data: "world" }])
  })

  test("defaults event to 'message' when omitted", async () => {
    const got = await collect(streamOf("data: lone\n\n"))
    expect(got).toEqual([{ event: "message", data: "lone" }])
  })

  test("joins multi-line data with newline", async () => {
    const got = await collect(streamOf("event: e\ndata: a\ndata: b\n\n"))
    expect(got).toEqual([{ event: "e", data: "a\nb" }])
  })

  test("ignores comment lines", async () => {
    const got = await collect(streamOf(": keep-alive\nevent: e\ndata: x\n\n"))
    expect(got).toEqual([{ event: "e", data: "x" }])
  })

  test("handles CRLF line endings", async () => {
    const got = await collect(streamOf("event: e\r\ndata: x\r\n\r\n"))
    expect(got).toEqual([{ event: "e", data: "x" }])
  })

  test("yields multiple events", async () => {
    const got = await collect(streamOf("event: a\ndata: 1\n\nevent: b\ndata: 2\n\n"))
    expect(got).toEqual([
      { event: "a", data: "1" },
      { event: "b", data: "2" },
    ])
  })

  test("handles chunk boundary mid-event", async () => {
    const got = await collect(streamOf("event: a\nda", "ta: 1\n\nevent:", " b\ndata: 2\n\n"))
    expect(got).toEqual([
      { event: "a", data: "1" },
      { event: "b", data: "2" },
    ])
  })

  test("flushes a final event without trailing blank line", async () => {
    const got = await collect(streamOf("event: e\ndata: x"))
    expect(got).toEqual([{ event: "e", data: "x" }])
  })

  test("skips blocks with no data", async () => {
    const got = await collect(streamOf("event: e\n\nevent: e2\ndata: x\n\n"))
    expect(got).toEqual([{ event: "e2", data: "x" }])
  })

  test("preserves leading single-space stripping per spec", async () => {
    const got = await collect(streamOf("data:no-space\ndata: with-space\n\n"))
    expect(got).toEqual([{ event: "message", data: "no-space\nwith-space" }])
  })

  test("releases reader when caller breaks early", async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("event: a\ndata: 1\n\nevent: b\ndata: 2\n\n"))
      },
      cancel() {
        cancelled = true
      },
    })
    for await (const _ of Sse.events(stream)) break
    expect(cancelled).toBe(true)
  })
})
