import z from "zod"
import { Tool } from "./tool"

export const EIGHTHS = [" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉"]
export const BAR_WIDTH = 20

export function render(value: number, max: number): string {
  if (max <= 0) return " ".repeat(BAR_WIDTH)
  const ratio = Math.min(value / max, 1)
  const full = Math.floor(ratio * BAR_WIDTH)
  const frac = Math.round((ratio * BAR_WIDTH - full) * 8)
  const partial = frac > 0 && frac < 8 ? EIGHTHS[frac] : ""
  return "█".repeat(full) + partial + " ".repeat(Math.max(0, BAR_WIDTH - full - (partial ? 1 : 0)))
}

export function fmt(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toFixed(1)
}

function pad(s: string, w: number): string {
  return s + " ".repeat(Math.max(0, w - s.length))
}

export const ChartTool = Tool.define("chart", {
  description: [
    "Render tabular data as an inline bar chart in the ramen terminal UI.",
    "Call this automatically whenever you have ES|QL query results or any other",
    "tabular data with numeric columns worth visualizing — do not wait to be asked.",
    "Each numeric column gets its own proportional bar per row for instant visual comparison.",
    "Supports multiple value columns (e.g. count + avg_duration side by side).",
    "",
    "When to call: after any ES|QL result, aggregation, metric comparison, or ranked list.",
    "Map ES|QL columns to chart columns; map each result row's label field to `label`.",
    "",
    "Example — ES|QL result {rows: [{category:'web', count:120, p99:340}, ...]}:",
    '  columns: ["count", "p99_ms"]',
    "  rows: [",
    '    { label: "web",   values: [120, 340] },',
    '    { label: "db",    values: [45,  890] }',
    "  ]",
  ].join("\n"),
  parameters: z.object({
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
    const maxes = params.columns.map((_, i) => Math.max(0, ...params.rows.map((r) => r.values[i] ?? 0)))
    const nums = params.rows.map((r) => params.columns.map((_, i) => fmt(r.values[i] ?? 0)))

    const lw = Math.max(8, ...params.rows.map((r) => r.label.length))
    const nw = params.columns.map((_, i) => Math.max(0, ...nums.map((n) => n[i].length)))
    const cw = params.columns.map((col, i) => Math.max(col.length, BAR_WIDTH + 1 + nw[i]))

    const border = (left: string, mid: string, right: string) =>
      left + "─".repeat(lw + 2) + params.columns.map((_, i) => mid + "─".repeat(cw[i] + 2)).join("") + right

    const row = (label: string, cells: string[]) =>
      "│ " + pad(label, lw) + " " + cells.map((c, i) => "│ " + pad(c, cw[i]) + " ").join("") + "│"

    const lines: string[] = []
    if (params.title) {
      lines.push(params.title)
      lines.push("")
    }

    lines.push(border("┌", "┬", "┐"))
    lines.push(row("Category", params.columns))
    lines.push(border("├", "┼", "┤"))
    lines.push(
      ...params.rows.map((r, ri) =>
        row(
          r.label,
          params.columns.map((_, ci) => render(r.values[ci] ?? 0, maxes[ci]) + " " + nums[ri][ci]),
        ),
      ),
    )
    lines.push(border("└", "┴", "┘"))

    return {
      title: params.title ?? "Chart",
      metadata: {
        data: {
          title: params.title,
          columns: params.columns,
          rows: params.rows,
          maxes,
        },
      },
      output: lines.join("\n"),
    }
  },
})
