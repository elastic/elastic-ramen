// Each entry is [row0, row1, row2] for one letter of ELASTIC
export const letters: [string, string, string][] = [
  ["█▀▀▀", "█▀▀ ", "▀▀▀▀"], // E
  ["█   ", "█   ", "▀▀▀▀"], // L
  ["█▀▀█", "█▀▀█", "▀  ▀"], // A
  ["█▀▀▀", "▀▀▀█", "▀▀▀▀"], // S
  ["▀█▀", " █ ", " ▀ "], // T
  ["▀▀▀", " █ ", "▀▀▀"], // I (serifs top+bottom to distinguish from T)
  ["█▀▀▀", "█   ", "▀▀▀▀"], // C
]

// Official Elastic brand colors from EUI (euiTheme.colors)
export const colors = [
  "#0B64DD", // E - primary
  "#BC1E70", // L - accent
  "#008B87", // A - accentSecondary
  "#FACB3D", // S - warning
  "#008A5E", // T - success
  "#ED6723", // I - risk
  "#8144CC", // C - assistance
]

export function hex(color: string): [number, number, number] {
  const n = parseInt(color.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}
