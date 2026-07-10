import { describe, expect, test } from "bun:test"
import { headless } from "../../src/cli/headless"

describe("headless", () => {
  test("run and serve", () => {
    expect(headless(["run", "hi"])).toBe(true)
    expect(headless(["serve"])).toBe(true)
  })

  test("-p and --prompt flags", () => {
    expect(headless(["-p", "hi"])).toBe(true)
    expect(headless(["--prompt", "hi"])).toBe(true)
    expect(headless(["--prompt=hi"])).toBe(true)
  })

  test("default TUI without prompt is not headless", () => {
    expect(headless([])).toBe(false)
    expect(headless(["./my-project"])).toBe(false)
  })
})
