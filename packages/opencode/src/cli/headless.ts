/** True when argv is a non-interactive CLI invocation (run, serve, or -p/--prompt). */
export function headless(argv: string[]) {
  if (argv.some((a) => a === "-p" || a === "--prompt" || a.startsWith("--prompt="))) return true
  const cmd = argv.find((a) => !a.startsWith("-"))
  return cmd === "run" || cmd === "serve"
}
