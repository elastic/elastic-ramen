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

function colorFor(i: number): string {
  return ANSI_COLORS[i % ANSI_COLORS.length]
}

/** Integer segment widths for stacked bars; sum is at most `width` (no ANSI slicing). */
function segSizes(values: number[], globalMax: number, width: number): number[] {
  if (values.length === 0 || width <= 0) return values.map(() => 0)
  if (globalMax <= 0) return values.map(() => 0)
  const w = values.map((v) => Math.max(0, Math.round(((v ?? 0) / globalMax) * width)))
  let sum = w.reduce((a, b) => a + b, 0)
  while (sum > width) {
    let i = w.length - 1
    while (i >= 0 && w[i] === 0) i--
    if (i < 0) break
    w[i]--
    sum--
  }
  return w
}

function ansiStack(values: number[], globalMax: number, width: number): string {
  const sw = segSizes(values, globalMax, width)
  let out = ""
  for (let i = 0; i < values.length; i++) {
    out += colorFor(i) + "█".repeat(sw[i]) + ANSI_RESET
  }
  const used = sw.reduce((a, b) => a + b, 0)
  if (used < width) out += " ".repeat(width - used)
  return out
}

function barChart(params: {
  title?: string
  columns: string[]
  rows: { label: string; values: number[] }[]
  stacked?: boolean
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

  if (params.stacked && params.columns.length > 1) {
    const rowTotals = params.rows.map((r) => r.values.reduce((sum, v) => sum + (v ?? 0), 0))
    const globalMax = Math.max(1, ...rowTotals)

    const tw = Math.max(6, ...rowTotals.map((t) => fmt(t).length))
    const headerBorder = (left: string, mid: string, right: string) =>
      left + "─".repeat(lw + 2) + mid + "─".repeat(BAR_WIDTH + 2) + mid + "─".repeat(tw + 2) + right

    const legend = params.columns.map((c, i) => `${colorFor(i)}█${ANSI_RESET} ${c}`).join("  ")

    lines.push(headerBorder("┌", "┬", "┐"))
    lines.push("│ " + pad("Category", lw) + " │ " + pad("Total", BAR_WIDTH) + " │ " + pad("Value", tw) + " │")
    lines.push(headerBorder("├", "┼", "┤"))
    for (let ri = 0; ri < params.rows.length; ri++) {
      const r = params.rows[ri]
      const seg = globalMax <= 0 ? " ".repeat(BAR_WIDTH) : ansiStack(r.values, globalMax, BAR_WIDTH)
      lines.push("│ " + pad(r.label, lw) + " │ " + seg + " │ " + pad(fmt(rowTotals[ri]), tw) + " │")
    }
    lines.push(headerBorder("└", "┴", "┘"))
    lines.push("")
    lines.push(legend)
  } else {
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
  }

  return { lines, maxes }
}

function horizontalBarChart(params: {
  title?: string
  columns: string[]
  rows: { label: string; values: number[] }[]
  stacked?: boolean
}): { lines: string[]; maxes: number[] } {
  const maxes = params.columns.map((_, i) => Math.max(0, ...params.rows.map((r) => r.values[i] ?? 0)))
  const lw = Math.max(8, ...params.rows.map((r) => r.label.length))
  const lines: string[] = []

  if (params.title) {
    lines.push(params.title)
    lines.push("")
  }

  if (params.stacked && params.columns.length > 1) {
    const rowTotals = params.rows.map((r) => r.values.reduce((sum, v) => sum + (v ?? 0), 0))
    const globalMax = Math.max(1, ...rowTotals)

    for (const r of params.rows) {
      const total = r.values.reduce((s, v) => s + (v ?? 0), 0)
      const bar = globalMax <= 0 ? " ".repeat(BAR_WIDTH) : ansiStack(r.values, globalMax, BAR_WIDTH)
      lines.push("│ " + pad(r.label, lw) + " │ " + bar + " │ " + fmt(total))
    }

    const legend = params.columns.map((c, i) => `${colorFor(i)}█${ANSI_RESET} ${c}`).join("  ")
    lines.push("")
    lines.push(legend)
  } else {
    const globalMax = Math.max(1, ...maxes)
    for (const r of params.rows) {
      for (let ci = 0; ci < params.columns.length; ci++) {
        const val = r.values[ci] ?? 0
        const bar = render(val, globalMax, colorFor(ci))
        const col = params.columns.length > 1 ? ` · ${params.columns[ci]}` : ""
        lines.push("│ " + pad(r.label + col, lw + col.length) + " │ " + bar + " │ " + fmt(val))
      }
      if (params.columns.length > 1) lines.push("")
    }
  }

  return { lines, maxes }
}

export const ChartTool = Tool.define("chart", {
  description: [
    "Render tabular data as an inline bar chart in the ramen terminal UI.",
    "Call this automatically whenever you have ES|QL query results or any other",
    "tabular data with numeric columns worth visualizing — do not wait to be asked.",
    "",
    "If there are fewer than 2 data rows, prefer plain text instead of this tool —",
    "a chart rarely helps for a single category.",
    "",
    "IMPORTANT: after rendering the chart, do NOT repeat the same data in text.",
    "The chart is the answer. Avoid statements like 'as you can see, X is 42 and Y is 99'.",
    "",
    "Chart types:",
    "  bar       — vertical bars per row. Default. Good for comparing categories.",
    "  horizontal — bars extend left-to-right from the label. Better for long labels.",
    "",
    "Stacking: set stacked=true when columns are parts of a whole (e.g. success + error).",
    "Unstacked (default) shows columns side-by-side per row for comparison.",
    "",
    "Example — ES|QL result {rows: [{category:'web', count:120, p99:340}, ...]}:",
    '  type: "bar"',
    '  stacked: false',
    '  columns: ["count", "p99_ms"]',
    "  rows: [",
    '    { label: "web",   values: [120, 340] },',
    '    { label: "db",    values: [45,  890] }',
    "  ]",
  ].join("\n"),
  parameters: z.object({
    type: z.enum(["bar", "horizontal"]).default("bar").describe("Chart layout: bar (vertical) or horizontal (left-to-right)"),
    stacked: z
      .boolean()
      .default(false)
      .describe("When true and there are multiple columns, stack their values into one bar per row"),
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
    const stacked = params.stacked ?? false
    let result: { lines: string[]; maxes: number[] }

    switch (params.type) {
      case "horizontal":
        result = horizontalBarChart({ ...params, stacked })
        break
      case "bar":
      default:
        result = barChart({ ...params, stacked })
        break
    }

    return {
      title: params.title ?? params.type + " chart",
      metadata: {
        data: {
          type: params.type,
          stacked,
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
