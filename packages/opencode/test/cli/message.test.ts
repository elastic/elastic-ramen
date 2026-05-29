import { describe, expect, test } from "bun:test"
import { mergeStdin } from "../../src/cli/message"

describe("mergeStdin", () => {
  test("keeps message when stdin is not a TTY", async () => {
    expect(await mergeStdin("hello", false, async () => "piped")).toBe("hello")
  })

  test("reads stdin when message is empty and stdin is not a TTY", async () => {
    expect(await mergeStdin("", false, async () => "piped")).toBe("piped")
  })

  test("keeps message when stdin is a TTY", async () => {
    expect(await mergeStdin("hello", true, async () => "piped")).toBe("hello")
  })
})
