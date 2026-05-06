// Copyright (c) 2026-present, Elastic NV

/**
 * Minimal Server-Sent Events parser.
 *
 * Yields `{ event, data }` for each event block. `data` is the joined value of
 * one or more `data:` lines (per spec, joined with `\n`). Comment lines (`:`)
 * and unknown fields are ignored.
 *
 * Callers can `break` early; the underlying reader is released in `finally`.
 */
export namespace Sse {
  export interface Event {
    event: string
    data: string
  }

  export async function* events(stream: ReadableStream<Uint8Array>): AsyncGenerator<Event> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buf = ""
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (value) buf += decoder.decode(value, { stream: true })
        buf = buf.replace(/\r\n/g, "\n")
        let i: number
        while ((i = buf.indexOf("\n\n")) !== -1) {
          const ev = parse(buf.slice(0, i))
          buf = buf.slice(i + 2)
          if (ev) yield ev
        }
        if (done) {
          if (buf.length) {
            const ev = parse(buf)
            if (ev) yield ev
          }
          return
        }
      }
    } finally {
      reader.cancel().catch(() => {})
    }
  }

  function parse(block: string): Event | undefined {
    let event = "message"
    const data: string[] = []
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue
      const colon = line.indexOf(":")
      const field = colon === -1 ? line : line.slice(0, colon)
      const raw = colon === -1 ? "" : line.slice(colon + 1)
      const value = raw.startsWith(" ") ? raw.slice(1) : raw
      if (field === "event") event = value
      else if (field === "data") data.push(value)
    }
    if (!data.length) return undefined
    return { event, data: data.join("\n") }
  }
}
