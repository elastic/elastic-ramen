import { describe, expect, test } from "bun:test"
import { ChartTool, render, fmt } from "../../src/tool/chart"

const ctx = {
  sessionID: "ses_test" as any,
  messageID: "" as any,
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

async function exec(args: any) {
  const tool = await ChartTool.init()
  return tool.execute(args, ctx as any)
}

describe("render bar", () => {
  test("renders empty for zero max", () => {
    expect(render(5, 0)).toBe(" ".repeat(20))
  })

  test("renders full bar at max", () => {
    expect(render(100, 100)).toBe("█".repeat(20))
  })

  test("renders partial bar", () => {
    expect(render(50, 100)).toBe("█".repeat(10) + " ".repeat(10))
  })

  test("caps at max", () => {
    expect(render(200, 100)).toBe("█".repeat(20))
  })
})

describe("fmt", () => {
  test("formats integers", () => {
    expect(fmt(42)).toBe("42")
  })

  test("formats floats to 1 decimal", () => {
    expect(fmt(3.14159)).toBe("3.1")
  })
})

describe("ChartTool", () => {
  test("bar chart renders with colored output", async () => {
    const res = await exec({
      type: "bar",
      columns: ["count"],
      rows: [
        { label: "a", values: [50] },
        { label: "b", values: [100] },
      ],
    })
    expect(res.output).toContain("a")
    expect(res.output).toContain("b")
    expect(res.output).toContain("count")
    expect(res.output).toContain("Category")
    expect(res.title).toBe("bar chart")
    expect(res.metadata.data.type).toBe("bar")
    expect(res.metadata.data.stacked).toBe(false)
  })

  test("horizontal chart renders", async () => {
    const res = await exec({
      type: "horizontal",
      columns: ["count"],
      rows: [
        { label: "a", values: [50] },
        { label: "b", values: [100] },
      ],
    })
    expect(res.output).toContain("a")
    expect(res.output).toContain("b")
    expect(res.title).toBe("horizontal chart")
    expect(res.metadata.data.type).toBe("horizontal")
  })

  test("histogram falls back to vertical bar rendering", async () => {
    const res = await exec({
      type: "histogram",
      columns: ["freq"],
      rows: [
        { label: "0-10", values: [5] },
        { label: "10-20", values: [12] },
      ],
    })
    expect(res.output).toContain("0-10")
    expect(res.output).toContain("10-20")
    expect(res.title).toBe("histogram chart")
    expect(res.metadata.data.type).toBe("histogram")
  })

  test("stacked bar chart combines columns", async () => {
    const res = await exec({
      type: "bar",
      stacked: true,
      columns: ["ok", "err"],
      rows: [
        { label: "web", values: [80, 20] },
        { label: "db", values: [95, 5] },
      ],
    })
    expect(res.output).toContain("web")
    expect(res.output).toContain("db")
    expect(res.output).toContain("Total")
    expect(res.metadata.data.stacked).toBe(true)
  })

  test("stacked horizontal chart combines columns", async () => {
    const res = await exec({
      type: "horizontal",
      stacked: true,
      columns: ["ok", "err"],
      rows: [
        { label: "web", values: [80, 20] },
      ],
    })
    expect(res.output).toContain("web")
    expect(res.metadata.data.stacked).toBe(true)
  })

  test("custom title is used", async () => {
    const res = await exec({
      type: "bar",
      title: "My Chart",
      columns: ["x"],
      rows: [{ label: "a", values: [1] }],
    })
    expect(res.title).toBe("My Chart")
    expect(res.output.startsWith("My Chart")).toBe(true)
  })

  test("multiple columns use different colors in bar output", async () => {
    const res = await exec({
      type: "bar",
      columns: ["a", "b"],
      rows: [{ label: "x", values: [10, 20] }],
    })
    expect(res.output).toContain("\x1b[32m")
    expect(res.output).toContain("\x1b[33m")
    expect(res.output).toContain("\x1b[0m")
  })
})
