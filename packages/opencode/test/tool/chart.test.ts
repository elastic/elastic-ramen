import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { ChartTool, chartParameters, render, fmt, ansiStack, segSizes, BAR_WIDTH, EIGHTHS } from "../../src/tool/chart"

function vis(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "")
}

type ChartCall = z.input<typeof chartParameters>

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

async function exec(args: ChartCall) {
  const tool = await ChartTool.init()
  return tool.execute(chartParameters.parse(args), ctx as any)
}

describe("render bar", () => {
  test("renders empty for zero max", () => {
    expect(render(5, 0)).toBe(" ".repeat(BAR_WIDTH))
  })

  test("renders full bar at max", () => {
    expect(render(100, 100)).toBe("█".repeat(BAR_WIDTH))
  })

  test("renders partial bar", () => {
    expect(render(50, 100)).toBe("█".repeat(10) + " ".repeat(10))
  })

  test("caps at max", () => {
    expect(render(200, 100)).toBe("█".repeat(BAR_WIDTH))
  })

  test("uses sub-block eighth for fractional width", () => {
    const out = render(1, 80)
    expect(out.includes(EIGHTHS[2])).toBe(true)
    expect(vis(out).length).toBe(BAR_WIDTH)
  })

  test("prepends color and resets when color given", () => {
    const out = render(50, 100, "\x1b[32m")
    expect(out.startsWith("\x1b[32m")).toBe(true)
    expect(out.endsWith("\x1b[0m")).toBe(true)
    expect(vis(out)).toBe("█".repeat(10) + " ".repeat(10))
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

describe("segSizes", () => {
  test("returns empty map for empty values", () => {
    expect(segSizes([], 10, 20)).toEqual([])
  })

  test("returns zeros when globalMax is not positive", () => {
    expect(segSizes([5, 5], 0, 20)).toEqual([0, 0])
  })

  test("returns zeros when width is not positive", () => {
    expect(segSizes([5, 5], 10, 0)).toEqual([0, 0])
  })

  test("never sums above width when rounding overflows", () => {
    const w = segSizes([1, 1, 1], 3, 20)
    expect(w.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(20)
    expect(w.every((x) => x >= 0)).toBe(true)
  })

  test("fills width for single full-size slice", () => {
    expect(segSizes([100], 100, 20)).toEqual([20])
  })

  test("distributes rounded widths without exceeding total", () => {
    const w = segSizes([30, 70], 100, 20)
    expect(w.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(20)
  })
})

describe("ansiStack", () => {
  test("visible width equals bar width", () => {
    const out = ansiStack([1, 1, 1], 3, 20)
    expect(vis(out).length).toBe(20)
  })

  test("has no incomplete escape sequences", () => {
    const out = ansiStack([40, 35, 25], 100, 20)
    expect(out.replace(/\x1b\[[0-9;]*m/g, "").includes("\x1b")).toBe(false)
  })

  test("pads when rounded segments sum below width", () => {
    const out = ansiStack([5, 5], 100, 20)
    expect(vis(out).length).toBe(20)
    expect([...vis(out)].filter((c) => c === "█").length).toBeGreaterThan(0)
    expect([...vis(out)].filter((c) => c === " ").length).toBeGreaterThan(0)
  })
})

describe("ChartTool", () => {
  test("defaults type to bar", async () => {
    const res = await exec({
      columns: ["n"],
      rows: [{ label: "a", values: [1] }, { label: "b", values: [2] }],
    })
    expect(res.metadata.data.type).toBe("bar")
    expect(res.title).toBe("bar chart")
  })

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

  test("metadata maxes match per-column peaks", async () => {
    const res = await exec({
      type: "bar",
      columns: ["x", "y"],
      rows: [
        { label: "p", values: [3, 40] },
        { label: "q", values: [10, 5] },
      ],
    })
    expect(res.metadata.data.maxes).toEqual([10, 40])
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

  test("horizontal unstacked multi-column repeats label with col suffix", async () => {
    const res = await exec({
      type: "horizontal",
      columns: ["u", "v"],
      rows: [{ label: "row1", values: [5, 10] }],
    })
    expect(res.output).toContain("row1 · u")
    expect(res.output).toContain("row1 · v")
  })

  test("stacked bar keeps ANSI intact when rounding would overflow bar width", async () => {
    const res = await exec({
      type: "bar",
      stacked: true,
      columns: ["a", "b", "c"],
      rows: [{ label: "x", values: [1, 1, 1] }],
    })
    expect(res.output).toContain("x")
    expect(res.output.replace(/\x1b\[[0-9;]*m/g, "").includes("\x1b")).toBe(false)
  })

  test("stacked horizontal keeps ANSI intact for overflow rounding", async () => {
    const res = await exec({
      type: "horizontal",
      stacked: true,
      columns: ["a", "b", "c"],
      rows: [{ label: "x", values: [1, 1, 1] }],
    })
    expect(res.output.replace(/\x1b\[[0-9;]*m/g, "").includes("\x1b")).toBe(false)
    expect(vis(res.output)).toContain("3")
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
      rows: [{ label: "web", values: [80, 20] }],
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

  test("unstacked bar row has one colored bar cell per column", async () => {
    const res = await exec({
      type: "bar",
      columns: ["c1", "c2"],
      rows: [{ label: "z", values: [100, 100] }],
    })
    const rows = res.output.split("\n").filter((ln) => ln.includes("│ z"))
    expect(rows.length).toBe(1)
    const matches = rows[0].match(/\x1b\[3[0-9]m/g)
    expect(matches?.length).toBe(2)
  })
})
