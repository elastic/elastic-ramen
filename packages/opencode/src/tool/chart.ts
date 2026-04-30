import z from "zod"
import { Tool } from "./tool"

export const EIGHTHS = [" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉"]
export const BAR_WIDTH = 20

const ANSI_COLORS = ["\x1b[32m", "\x1b[33m", "\x1b[34m", "\x1b[35m", "\x1b[36m", "\x1b[31m"]
const ANSI_RESET = "\x1b[0m"

export function render(value: number, max: number, color?: string): string {
  if (max <= 0) return " ".repeat(BAR_WIDTH)
  const ratio = Math.min(value / max, 1)
  const full = Math.floor(ratio * BAR_WIDTH)
  const frac = Math.round((ratio * BAR_WIDTH - full) * 8)
  const partial = frac > 0 && frac < 8 ? EIGHTHS[frac] : ""
  const bar = "█".repeat(full) + partial + " ".repeat(Math.max(0, BAR_WIDTH - full - (partial ? 1 : 0)))
  if (!color) return bar
  return color + bar + ANSI_RESET
}

export function fmt(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toFixed(1)
}

function pad(s: string, w: number): string {
  return s + " ".repeat(Math.max(0, w - s.length))
}

function padStart(s: string, w: number): string {
  return " ".repeat(Math.max(0, w - s.length)) + s
}

function colorFor(i: number): string {
  return ANSI_COLORS[i % ANSI_COLORS.length]
}

function barChart(params: {
  title?: string
  columns: string[]
  rows: { label: string; values: number[] }[]
}): { lines: string[]; maxes: number[] } {
  const maxes = params.columns.map((_, i) => Math.max(0, ...params.rows.map((r) => r.values[i] ?? 0)))
  const nums = params.rows.map((r) => params.columns.map((_, i) => fmt(r.values[i] ?? 0)))

  const lw = Math.max(8, ...params.rows.map((r) => r.label.length))
  const nw = params.columns.map((_, i) => Math.max(0, ...nums.map((n) => n[i].length)))
  const cw = params.columns.map((col, i) => Math.max(col.length, BAR_WIDTH + 1 + nw[i]))

  const border = (left: string, mid: string, right: string) =>
    left + "─".repeat(lw + 2) + params.columns.map((_, i) => mid + "─".repeat(cw[i] + 2)).join("") + right

  const rowLine = (label: string, cells: string[]) =>
    "│ " + pad(label, lw) + " " + cells.map((c, i) => "│ " + pad(c, cw[i]) + " ").join("") + "│"

  const lines: string[] = []
  if (params.title) {
    lines.push(params.title)
    lines.push("")
  }

  lines.push(border("┌", "┬", "┐"))
  lines.push(rowLine("Category", params.columns))
  lines.push(border("├", "┼", "┤"))
  lines.push(
    ...params.rows.map((r, ri) =>
      rowLine(
        r.label,
        params.columns.map((_, ci) => render(r.values[ci] ?? 0, maxes[ci], colorFor(ci)) + " " + nums[ri][ci]),
      ),
    ),
  )
  lines.push(border("└", "┴", "┘"))

  return { lines, maxes }
}

function histogram(params: {
  title?: string
  columns: string[]
  rows: { label: string; values: number[] }[]
}): { lines: string[]; maxes: number[] } {
  // Histogram is rendered like a bar chart but with a single numeric column.
  return barChart(params)
}

function lineChart(params: {
  title?: string
  columns: string[]
  rows: { label: string; values: number[] }[]
}): { lines: string[]; maxes: number[] } {
  const maxes = params.columns.map((_, i) => Math.max(0, ...params.rows.map((r) => r.values[i] ?? 0)))
  const globalMax = Math.max(1, ...maxes)
  const plotH = 12
  const plotW = Math.max(20, params.rows.length * 3)

  const grid: string[][] = Array.from({ length: plotH }, () => Array(plotW).fill(" "))

  for (let ci = 0; ci < params.columns.length; ci++) {
    const pts = params.rows.map((r) => r.values[ci] ?? 0)
    const colPx = plotW / Math.max(1, pts.length - 1)
    for (let i = 0; i < pts.length - 1; i++) {
      const x0 = Math.round(i * colPx)
      const x1 = Math.round((i + 1) * colPx)
      const y0 = plotH - 1 - Math.round((pts[i] / globalMax) * (plotH - 1))
      const y1 = plotH - 1 - Math.round((pts[i + 1] / globalMax) * (plotH - 1))
      // Bresenham-ish line
      const dx = x1 - x0
      const dy = y1 - y0
      const steps = Math.max(Math.abs(dx), Math.abs(dy))
      for (let s = 0; s <= steps; s++) {
        const t = steps === 0 ? 0 : s / steps
        const x = Math.round(x0 + dx * t)
        const y = Math.round(y0 + dy * t)
        if (x >= 0 && x < plotW && y >= 0 && y < plotH) grid[y][x] = "*"
      }
    }
  }

  const yLabelW = Math.max(4, fmt(globalMax).length)
  const lines: string[] = []
  if (params.title) {
    lines.push(params.title)
    lines.push("")
  }

  for (let y = 0; y < plotH; y++) {
    const val = Math.round(((plotH - 1 - y) / (plotH - 1)) * globalMax)
    const label = padStart(fmt(val), yLabelW)
    lines.push(`${label} │${grid[y].join("")}`)
  }

  const xSep = "─".repeat(plotW)
  lines.push(" ".repeat(yLabelW) + " ├" + xSep)

  // X-axis labels: show first, middle, last
  const xLabels: string[] = []
  const first = params.rows[0]?.label ?? ""
  const mid = params.rows[Math.floor(params.rows.length / 2)]?.label ?? ""
  const last = params.rows[params.rows.length - 1]?.label ?? ""
  const leftPad = yLabelW + 3
  xLabels.push(" ".repeat(leftPad) + first)
  if (mid && mid !== first) {
    const midPos = Math.floor(plotW / 2) - Math.floor(mid.length / 2)
    if (midPos > first.length) {
      xLabels.push(
        " ".repeat(leftPad + midPos) + mid,
      )
    }
  }
  if (last !== first) {
    xLabels.push(" ".repeat(leftPad + plotW - last.length) + last)
  }
  lines.push(...xLabels)

  // Legend
  lines.push("")
  for (let ci = 0; ci < params.columns.length; ci++) {
    lines.push(`${colorFor(ci)}* ${params.columns[ci]}${ANSI_RESET}`)
  }

  return { lines, maxes }
}

function pieChart(params: {
  title?: string
  columns: string[]
  rows: { label: string; values: number[] }[]
}): { lines: string[]; maxes: number[] } {
  // Use the first numeric column for slice sizes.
  const idx = 0
  const total = params.rows.reduce((sum, r) => sum + (r.values[idx] ?? 0), 0)
  const maxes = params.columns.map((_, i) => Math.max(0, ...params.rows.map((r) => r.values[i] ?? 0)))

  const lines: string[] = []
  if (params.title) {
    lines.push(params.title)
    lines.push("")
  }

  if (total <= 0) {
    lines.push("No data")
    return { lines, maxes }
  }

  const slices = params.rows.map((r, i) => ({
    label: r.label,
    value: r.values[idx] ?? 0,
    pct: ((r.values[idx] ?? 0) / total) * 100,
    color: colorFor(i),
  }))

  const lw = Math.max(8, ...slices.map((s) => s.label.length))
  const vw = Math.max(6, ...slices.map((s) => fmt(s.value).length))

  const barW = 20
  const border = (left: string, mid: string, right: string) =>
    left + "─".repeat(lw + 2) + mid + "─".repeat(barW + 2) + mid + "─".repeat(vw + 2) + mid + "─".repeat(7) + right

  lines.push(border("┌", "┬", "┐"))
  lines.push("│ " + pad("Category", lw) + " │ " + pad("Visual", barW) + " │ " + pad("Value", vw) + " │ " + pad("Pct", 5) + " │")
  lines.push(border("├", "┼", "┤"))

  for (const s of slices) {
    const frac = Math.round((s.value / total) * barW)
    const vis = s.color + "█".repeat(frac) + ANSI_RESET + " ".repeat(barW - frac)
    lines.push("│ " + pad(s.label, lw) + " │ " + vis + " │ " + pad(fmt(s.value), vw) + " │ " + pad(fmt(s.pct) + "%", 5) + " │")
  }

  lines.push(border("└", "┴", "┘"))
  lines.push("")
  lines.push(`Total: ${fmt(total)}`)

  return { lines, maxes }
}

export const ChartTool = Tool.define("chart", {
  description: [
    "Render tabular data as an inline chart in the ramen terminal UI.",
    "Call this automatically whenever you have ES|QL query results or any other",
    "tabular data with numeric columns worth visualizing — do not wait to be asked.",
    "",
    "When to call: after any ES|QL result, aggregation, metric comparison, or ranked list.",
    "Map ES|QL columns to chart columns; map each result row's label field to `label`.",
    "",
    "Chart types:",
    "  bar       — vertical bars per row, one per column (default). Best for comparisons.",
    "  line      — line plot over rows. Best for time-series or trends.",
    "  pie       — proportions of the first value column. Best for part-to-whole.",
    "  histogram — bar chart variant. Best for binned distributions.",
    "",
    "Example — ES|QL result {rows: [{category:'web', count:120, p99:340}, ...]}:",
    '  type: "bar"',
    '  columns: ["count", "p99_ms"]',
    "  rows: [",
    '    { label: "web",   values: [120, 340] },',
    '    { label: "db",    values: [45,  890] }',
    "  ]",
  ].join("\n"),
  parameters: z.object({
    type: z
      .enum(["bar", "line", "pie", "histogram"])
      .default("bar")
      .describe("Chart type: bar, line, pie, or histogram"),
    title: z.string().optional().describe("Optional chart title"),
    columns: z.array(z.string()).describe("Headers for the numerical value columns"),
    rows: z
      .array(
        z.object({
          label: z.string().describe("Category label"),
          values: z.array(z.number()).describe("One numerical value per column"),
        }),
      )
      .min(1)
      .describe("Data rows with category labels and numerical values"),
  }),
  async execute(params) {
    let result: { lines: string[]; maxes: number[] }

    switch (params.type) {
      case "line":
        result = lineChart(params)
        break
      case "pie":
        result = pieChart(params)
        break
      case "histogram":
        result = histogram(params)
        break
      case "bar":
      default:
        result = barChart(params)
        break
    }

    return {
      title: params.title ?? params.type + " chart",
      metadata: {
        data: {
          type: params.type,
          title: params.title,
          columns: params.columns,
          rows: params.rows,
          maxes: result.maxes,
        },
      },
      output: result.lines.join("\n"),
    }
  },
})
