import z from "zod"
import { Tool } from "./tool"
import type { MessageV2 } from "../session/message-v2"

export const EIGHTHS = [" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉"]
export const BAR_WIDTH = 20
export const AREA_HEIGHT = 12
/** Braille dot bitmasks indexed by [row 0-3][col 0-1]. Row 0 is the topmost dot, row 3 the bottommost. */
export const BRAILLE_DOTS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
]

/** Width in braille chars for an area chart with `n` data points. */
export function areaWidth(n: number): number {
  // Each braille char holds 2 pixel columns. Target 60 chars (120 pixel cols)
  // to fill a typical terminal; data is interpolated across the full width.
  return Math.min(80, Math.max(20, 60))
}

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

/**
 * Build the braille grid for an area chart.
 * vals[seriesIdx][dataIdx]; returns bit patterns and dominant series per cell.
 */
export function areaGrid(
  vals: number[][],
  max: number,
  stacked: boolean,
  width: number,
): { bits: number[][]; dom: number[][] } {
  const H = AREA_HEIGHT
  const LEVELS = H * 4
  const n = vals[0]?.length ?? 0
  const S = vals.length
  const bits = Array.from({ length: H }, () => new Array(width).fill(0))
  const dom = Array.from({ length: H }, () => new Array(width).fill(-1))
  // Track dot count per cell per series to determine dominant color per cell.
  const dotCount = Array.from({ length: H }, () => Array.from({ length: width }, () => new Array(S).fill(0)))
  // Each braille char is 2 pixel columns wide; iterate over pixel columns.
  const pixelCols = width * 2
  for (let px = 0; px < pixelCols; px++) {
    const cx = Math.floor(px / 2)
    const dcol = px % 2
    // Map pixel column to a data index via linear interpolation.
    const di = n <= 1 ? 0 : (px / (pixelCols - 1)) * (n - 1)
    const lo = Math.floor(di)
    const hi = Math.min(n - 1, lo + 1)
    const t = di - lo
    let base = 0
    for (let si = 0; si < S; si++) {
      const v = (vals[si][lo] ?? 0) * (1 - t) + (vals[si][hi] ?? 0) * t
      const top = stacked ? base + v : v
      const fillTop = Math.min(LEVELS, Math.round((top / max) * LEVELS))
      const fillBase = stacked ? Math.round((base / max) * LEVELS) : 0
      for (let lev = fillBase; lev < fillTop; lev++) {
        const cy = H - 1 - Math.floor(lev / 4)
        const row = 3 - (lev % 4)
        bits[cy][cx] |= BRAILLE_DOTS[row][dcol]
        dotCount[cy][cx][si]++
      }
      if (stacked) base += v
    }
  }
  // Assign each cell's color to the series that contributed the most dots.
  for (let cy = 0; cy < H; cy++) {
    for (let cx = 0; cx < width; cx++) {
      let best = -1
      let bestCount = 0
      for (let si = 0; si < S; si++) {
        const c = dotCount[cy][cx][si]
        if (c > bestCount) { bestCount = c; best = si }
      }
      dom[cy][cx] = best
    }
  }
  return { bits, dom }
}

function brailleArea(vals: number[][], max: number, stacked: boolean, width: number): string[] {
  const { bits, dom } = areaGrid(vals, max, stacked, width)
  return bits.map((row, cy) =>
    row
      .map((b, cx) => {
        const ch = String.fromCharCode(0x2800 + b)
        const s = dom[cy][cx]
        return s >= 0 ? colorFor(s) + ch + ANSI_RESET : ch
      })
      .join(""),
  )
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
    const hdr = params.columns.map((c, i) => colorFor(i) + c + ANSI_RESET)
    lines.push(border("┌", "┬", "┐"))
    lines.push(rowLine("Category", hdr))
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
    if (params.columns.length > 1) {
      lines.push("")
      lines.push(params.columns.map((c, i) => `${colorFor(i)}█${ANSI_RESET} ${c}`).join("  "))
    }
  }

  return { lines, maxes }
}

function areaChart(params: {
  title?: string
  columns: string[]
  rows: { label: string; values: number[] }[]
}): { lines: string[]; maxes: number[] } {
  const n = params.rows.length
  const S = params.columns.length
  const vals = params.columns.map((_, si) => params.rows.map((r) => r.values[si] ?? 0))
  const maxes = params.columns.map((_, i) => Math.max(0, ...params.rows.map((r) => r.values[i] ?? 0)))
  // Area charts are always stacked — overlapping fills are meaningless.
  const stacked = S > 1
  const max = stacked
    ? Math.max(1, ...params.rows.map((r) => r.values.reduce((a, b) => a + (b ?? 0), 0)))
    : Math.max(1, ...vals.flat())
  const W = areaWidth(n)
  const lines: string[] = []
  if (params.title) {
    lines.push(params.title)
    lines.push("")
  }
  lines.push("┌" + "─".repeat(W) + "┐")
  for (const row of brailleArea(vals, max, stacked, W)) {
    lines.push("│" + row + "│")
  }
  lines.push("└" + "─".repeat(W) + "┘")
  if (n > 0) {
    const first = params.rows[0].label
    const last = params.rows[n - 1].label
    lines.push(" " + first + " ".repeat(Math.max(0, W - first.length - last.length)) + last)
  }
  if (S > 1) {
    lines.push("")
    lines.push(params.columns.map((c, i) => `${colorFor(i)}█${ANSI_RESET} ${c}`).join("  "))
  }
  return { lines, maxes }
}

const NUMERIC_ESQL = new Set([
  "long", "integer", "double", "float", "unsigned_long", "byte", "short", "half_float", "scaled_float",
])

type EsqlResult = { columns: { name: string; type: string }[]; values: unknown[][] }

function lastEsqlResult(messages: MessageV2.WithParts[]): EsqlResult | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    for (let j = msg.parts.length - 1; j >= 0; j--) {
      const part = msg.parts[j]
      if (part.type !== "tool" || part.state.status !== "completed") continue
      try {
        const data = JSON.parse(part.state.output)
        if (Array.isArray(data?.columns) && Array.isArray(data?.values)) return data as EsqlResult
      } catch {}
    }
  }
}

function esqlToChart(data: EsqlResult): { columns: string[]; rows: { label: string; values: number[] }[] } {
  const labelIdx = data.columns.findIndex((c) => !NUMERIC_ESQL.has(c.type))
  const valueIdxs = data.columns.flatMap((c, i) => (NUMERIC_ESQL.has(c.type) ? [i] : []))
  const columns = valueIdxs.map((i) => data.columns[i].name)
  const rows = data.values.map((row, ri) => ({
    label: labelIdx >= 0 ? String(row[labelIdx]) : String(ri),
    values: valueIdxs.map((i) => Number(row[i]) || 0),
  }))
  return { columns, rows }
}

export const chartParameters = z.object({
  type: z
    .enum(["bar", "area"])
    .default("bar")
    .describe("Chart type: bar for tabular bar chart, area for braille horizontal area chart"),
  stacked: z
    .boolean()
    .default(false)
    .describe("When true and there are multiple columns, stack their values into one bar per row"),
  title: z.string().optional().describe("Optional chart title"),
  columns: z.array(z.string()).optional().describe("Headers for the numerical value columns. Omit to reuse the last ES|QL result automatically."),
  rows: z
    .array(
      z.object({
        label: z.string().describe("Category label"),
        values: z.array(z.number()).describe("One numerical value per column"),
      }),
    )
    .min(1)
    .optional()
    .describe("Data rows with category labels and numerical values. Omit to reuse the last ES|QL result automatically."),
}).superRefine((d, ctx) => {
  if (!d.rows || !d.columns) return
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
    "Render tabular data as an inline chart in the ramen terminal UI.",
    "Call this automatically whenever you have ES|QL query results or any other",
    "tabular data with numeric columns worth visualizing — do not wait to be asked.",
    "",
    "If there are fewer than 2 data rows, prefer plain text instead of this tool —",
    "a chart rarely helps for a single category.",
    "",
    "IMPORTANT: after rendering the chart, do NOT repeat the same data in text.",
    "The chart is the answer. Avoid statements like 'as you can see, X is 42 and Y is 99'.",
    "",
    "AUTO-EXTRACTION: if you omit both `columns` and `rows`, the tool automatically",
    "reads the most recent ES|QL query result from the conversation and builds the chart",
    "from it. Prefer this — just call chart with type/title after an ES|QL query.",
    "",
    "Chart types:",
    "  bar  — table with one horizontal magnitude bar per numeric cell (category × column). Default.",
    "  area — braille-based stacked area chart. Use for time series or sequential data.",
    "         Multiple numeric columns are always stacked.",
    "",
    "Stacking (bar only): set stacked=true when columns are parts of a whole (e.g. success + error).",
    "",
    "Example — after an ES|QL query, just call:",
    '  { type: "area", title: "Request rate over time" }',
    "",
    "Example — manual data:",
    '  type: "bar", columns: ["count", "p99_ms"]',
    "  rows: [{ label: \"web\", values: [120, 340] }, ...]",
  ].join("\n"),
  parameters: chartParameters,
  async execute(params, ctx) {
    let { columns, rows } = params
    if (!columns || !rows) {
      const esql = lastEsqlResult(ctx.messages)
      if (!esql) throw new Error("No ES|QL result found in conversation. Provide columns and rows explicitly.")
      const derived = esqlToChart(esql)
      columns = derived.columns
      rows = derived.rows
    }
    const stacked = params.stacked
    const result = params.type === "area" ? areaChart({ ...params, columns, rows }) : barChart({ ...params, columns, rows, stacked })
    const lines = result.lines
    const t = params.title
    const body = t && lines[0] === t ? lines.slice(lines[1] === "" ? 2 : 1) : lines

    return {
      title: params.title ?? (params.type === "area" ? "area chart" : "bar chart"),
      metadata: {
        data: {
          type: params.type as "bar" | "area",
          stacked,
          title: params.title,
          columns,
          rows,
          maxes: result.maxes,
        },
      },
      output: body.join("\n"),
    }
  },
})
