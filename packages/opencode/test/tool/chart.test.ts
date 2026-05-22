import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { ChartTool, chartParameters, render, fmt, ansiStack, segSizes, BAR_WIDTH, EIGHTHS, areaGrid, AREA_HEIGHT, BRAILLE_DOTS, areaWidth } from "../../src/tool/chart"

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

describe("pad / alignment", () => {
  test("unstacked bar rows share same visual width for value column", async () => {
    const res = await exec({
      columns: ["count"],
      rows: [
        { label: "a", values: [1] },
        { label: "bbbbbbbbbbbb", values: [99999] },
      ],
    })
    const rows = res.output.split("\n").filter((ln) => ln.includes("│ a ") || ln.includes("│ bbbbbbbbbbbb "))
    expect(rows.length).toBe(2)
    const vis = rows.map((ln) => ln.replace(/\x1b\[[0-9;]*m/g, ""))
    expect(vis[0].length).toBe(vis[1].length)
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
      columns: ["x", "y"],
      rows: [
        { label: "p", values: [3, 40] },
        { label: "q", values: [10, 5] },
      ],
    })
    expect(res.metadata.data.maxes).toEqual([10, 40])
  })

  test("stacked bar keeps ANSI intact when rounding would overflow bar width", async () => {
    const res = await exec({
      stacked: true,
      columns: ["a", "b", "c"],
      rows: [{ label: "x", values: [1, 1, 1] }],
    })
    expect(res.output).toContain("x")
    expect(res.output.replace(/\x1b\[[0-9;]*m/g, "").includes("\x1b")).toBe(false)
  })

  test("stacked bar chart combines columns", async () => {
    const res = await exec({
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

  test("custom title is used", async () => {
    const res = await exec({
      title: "My Chart",
      columns: ["x"],
      rows: [{ label: "a", values: [1] }],
    })
    expect(res.title).toBe("My Chart")
    expect(res.output.startsWith("┌")).toBe(true)
    expect(res.output.includes("My Chart")).toBe(false)
  })

  test("multiple columns use different colors in bar output", async () => {
    const res = await exec({
      columns: ["a", "b"],
      rows: [{ label: "x", values: [10, 20] }],
    })
    expect(res.output).toContain("\x1b[32m")
    expect(res.output).toContain("\x1b[33m")
    expect(res.output).toContain("\x1b[0m")
  })

  test("unstacked bar row has one colored bar cell per column", async () => {
    const res = await exec({
      columns: ["c1", "c2"],
      rows: [{ label: "z", values: [100, 100] }],
    })
    const rows = res.output.split("\n").filter((ln) => ln.includes("│ z"))
    expect(rows.length).toBe(1)
    const matches = rows[0].match(/\x1b\[3[0-9]m/g)
    expect(matches?.length).toBe(2)
  })

  test("rejects rows whose values.length doesn't match columns", () => {
    expect(() =>
      chartParameters.parse({
        columns: ["ok", "err"],
        rows: [{ label: "web", values: [1, 2, 3] }],
      }),
    ).toThrow(/expected 2/)
  })

  test("multi-column unstacked bar has colored column headers", async () => {
    const res = await exec({
      columns: ["a", "b"],
      rows: [{ label: "x", values: [10, 20] }],
    })
    const headerLine = res.output.split("\n").find((ln) => ln.includes("a") && ln.includes("b") && ln.includes("│"))
    expect(headerLine).toBeDefined()
    expect(headerLine).toContain("\x1b[32m")
    expect(headerLine).toContain("\x1b[33m")
  })

  test("multi-column unstacked bar has legend at bottom", async () => {
    const res = await exec({
      columns: ["alpha", "beta"],
      rows: [
        { label: "x", values: [10, 20] },
        { label: "y", values: [5, 15] },
      ],
    })
    const lines = res.output.split("\n")
    const borderIdx = lines.findLastIndex((ln) => ln.startsWith("└"))
    expect(borderIdx).toBeGreaterThan(-1)
    const legend = lines.slice(borderIdx + 1).join("\n")
    expect(legend).toContain("alpha")
    expect(legend).toContain("beta")
  })

  test("single-column bar has no legend", async () => {
    const res = await exec({
      columns: ["count"],
      rows: [
        { label: "a", values: [1] },
        { label: "b", values: [2] },
      ],
    })
    const lines = res.output.split("\n")
    const borderIdx = lines.findLastIndex((ln) => ln.startsWith("└"))
    const after = lines.slice(borderIdx + 1).filter((l) => l.trim().length > 0)
    expect(after.length).toBe(0)
  })

  test("area chart type and title", async () => {
    const res = await exec({
      type: "area",
      columns: ["count"],
      rows: [
        { label: "t1", values: [10] },
        { label: "t2", values: [20] },
      ],
    })
    expect(res.metadata.data.type).toBe("area")
    expect(res.title).toBe("area chart")
  })

  test("area chart output contains braille characters", async () => {
    const res = await exec({
      type: "area",
      columns: ["n"],
      rows: Array.from({ length: 10 }, (_, i) => ({ label: `t${i}`, values: [i * 10] })),
    })
    expect(/[\u2800-\u28FF]/.test(res.output)).toBe(true)
    expect(res.output).toContain("┌")
    expect(res.output).toContain("└")
  })

  test("area chart has x-axis first and last labels", async () => {
    const res = await exec({
      type: "area",
      columns: ["v"],
      rows: [
        { label: "start", values: [5] },
        { label: "middle", values: [10] },
        { label: "end", values: [3] },
      ],
    })
    const lines = res.output.split("\n")
    const labelLine = lines[lines.length - 1]
    expect(labelLine).toContain("start")
    expect(labelLine).toContain("end")
  })

  test("area chart with multiple columns has legend", async () => {
    const res = await exec({
      type: "area",
      columns: ["ok", "err"],
      rows: [
        { label: "t1", values: [80, 20] },
        { label: "t2", values: [70, 30] },
      ],
    })
    const lines = res.output.split("\n")
    const legend = lines.filter((l) => l.includes("ok") && l.includes("err"))
    expect(legend.length).toBeGreaterThan(0)
  })

  test("area chart with multiple series uses colored braille", async () => {
    const res = await exec({
      type: "area",
      columns: ["ok", "err"],
      rows: [
        { label: "t1", values: [80, 20] },
        { label: "t2", values: [60, 40] },
      ],
    })
    expect(/[\u2800-\u28FF]/.test(res.output)).toBe(true)
    expect(res.output).toContain("\x1b[32m")
    expect(res.output).toContain("\x1b[33m")
  })
})

describe("areaGrid", () => {
  test("returns grids of correct dimensions", () => {
    const { bits, dom } = areaGrid([[10, 20, 30]], 30, false, 10)
    expect(bits.length).toBe(AREA_HEIGHT)
    expect(bits[0].length).toBe(10)
    expect(dom.length).toBe(AREA_HEIGHT)
    expect(dom[0].length).toBe(10)
  })

  test("all-zero input produces no filled dots", () => {
    const { bits, dom } = areaGrid([[0, 0, 0]], 10, false, 5)
    expect(bits.flat().every((b) => b === 0)).toBe(true)
    expect(dom.flat().every((s) => s === -1)).toBe(true)
  })

  test("full value fills bottom rows of grid", () => {
    const { bits, dom } = areaGrid([[100]], 100, false, 5)
    expect(bits[AREA_HEIGHT - 1][0] & BRAILLE_DOTS[3][0]).toBe(BRAILLE_DOTS[3][0])
    expect(dom[AREA_HEIGHT - 1][0]).toBe(0)
  })

  test("multi-series: smaller series dominates upper cells", () => {
    // Series 0 = 50, series 1 = 30; series 1 is smaller so it paints last (on top).
    // Both should appear as dominant in different cells.
    const { dom } = areaGrid([[50], [30]], 100, false, 5)
    const flat = dom.flat().filter((s) => s >= 0)
    expect(flat.some((s) => s === 0)).toBe(true)
    expect(flat.some((s) => s === 1)).toBe(true)
  })

  test("multi-series: both series visible when values differ", () => {
    const { dom } = areaGrid([[60], [40]], 100, false, 5)
    const flat = dom.flat().filter((s) => s >= 0)
    expect(flat.some((s) => s === 0)).toBe(true)
    expect(flat.some((s) => s === 1)).toBe(true)
  })

  test("data beyond width is ignored", () => {
    const { bits } = areaGrid([Array.from({ length: 100 }, (_, i) => i)], 99, false, 5)
    expect(bits[0].length).toBe(5)
  })
})

describe("ES|QL auto-extraction", () => {
  function ctxWithEsql(columns: { name: string; type: string }[], values: unknown[][]) {
    return {
      ...ctx,
      messages: [
        {
          info: { id: "msg_1", sessionID: "ses_test", role: "assistant", time: { created: 0 }, agent: "build", model: { providerID: "x", modelID: "y" } },
          parts: [
            {
              type: "tool",
              id: "p1",
              sessionID: "ses_test",
              messageID: "msg_1",
              callID: "c1",
              tool: "esql_query",
              state: { status: "completed", input: {}, output: JSON.stringify({ columns, values }), title: "esql", metadata: {}, time: { start: 0, end: 1 } },
            },
          ],
        },
      ],
    } as any
  }

  test("auto-extracts numeric columns from last ES|QL result", async () => {
    const tool = await ChartTool.init()
    const result = await tool.execute(
      chartParameters.parse({ type: "bar", title: "auto" }),
      ctxWithEsql(
        [{ name: "service", type: "keyword" }, { name: "count", type: "long" }],
        [["web", 120], ["db", 45]],
      ),
    )
    expect(result.metadata.data.columns).toEqual(["count"])
    expect(result.metadata.data.rows[0].label).toBe("web")
    expect(result.metadata.data.rows[0].values).toEqual([120])
  })

  test("throws when no ES|QL result and no data provided", async () => {
    const tool = await ChartTool.init()
    expect(tool.execute(chartParameters.parse({ type: "bar" }), ctx as any)).rejects.toThrow("No ES|QL result")
  })
})

describe("areaWidth", () => {
  test("always returns 60 — fixed target width with interpolation", () => {
    expect(areaWidth(1)).toBe(60)
    expect(areaWidth(0)).toBe(60)
    expect(areaWidth(40)).toBe(60)
    expect(areaWidth(1000)).toBe(60)
  })
})
