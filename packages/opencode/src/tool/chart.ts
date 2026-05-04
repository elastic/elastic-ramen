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

function visible(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "")
}

function pad(s: string, w: number): string {
  return s + " ".repeat(Math.max(0, w - visible(s).length))
}

function colorFor(i: number): string {
  return ANSI_COLORS[i % ANSI_COLORS.length]
}

/** Integer segment widths for stacked bars; sum is at most `width` (no ANSI slicing). */
export function segSizes(values: number[], globalMax: number, width: number): number[] {
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

export function ansiStack(values: number[], globalMax: number, width: number): string {
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

export const chartParameters = z.object({
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
}).superRefine((d, ctx) => {
  for (let i = 0; i < d.rows.length; i++) {
    if (d.rows[i].values.length !== d.columns.length) {
      ctx.addIssue({
        code: "custom",
        path: ["rows", i, "values"],
        message: `Row ${i} has ${d.rows[i].values.length} values, expected ${d.columns.length}`,
      })
    }
  }
})

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
    "Layout: table with one horizontal magnitude bar per numeric cell (category × column).",
    "",
    "Stacking: set stacked=true when columns are parts of a whole (e.g. success + error).",
    "Unstacked (default) shows columns side-by-side per row for comparison.",
    "",
    "Example — ES|QL result {rows: [{category:'web', count:120, p99:340}, ...]}:",
    '  stacked: false',
    '  columns: ["count", "p99_ms"]',
    "  rows: [",
    '    { label: "web",   values: [120, 340] },',
    '    { label: "db",    values: [45,  890] }',
    "  ]",
  ].join("\n"),
  parameters: chartParameters,
  async execute(params) {
    const stacked = params.stacked
    const result = barChart({ ...params, stacked })

    const lines = result.lines
    const t = params.title
    const body = t && lines[0] === t ? lines.slice(lines[1] === "" ? 2 : 1) : lines

    return {
      title: params.title ?? "bar chart",
      metadata: {
        data: {
          type: "bar" as const,
          stacked,
          title: params.title,
          columns: params.columns,
          rows: params.rows,
          maxes: result.maxes,
        },
      },
      output: body.join("\n"),
    }
  },
})
