/** Merge a CLI message with piped stdin when stdin is not a TTY. */
export async function mergeStdin(message: string, tty = process.stdin.isTTY, read = () => Bun.stdin.text()) {
  if (!tty && !message.trim()) return read()
  return message
}
