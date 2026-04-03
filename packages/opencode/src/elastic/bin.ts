// Copyright (c) 2026-present, Elastic NV
import p from "path"
import fs from "fs"
import os from "os"

declare const ELASTIC_CLI_B64: string

export namespace ElasticBin {
  let cached: string | undefined

  export async function resolve(): Promise<string> {
    if (cached) return cached
    const ext = process.platform === "win32" ? ".exe" : ""

    // Dev mode: look next to the executable
    const sibling = p.join(p.dirname(process.execPath), "elastic" + ext)
    if (fs.existsSync(sibling)) {
      cached = sibling
      return cached
    }

    // Compiled mode: extract from embedded base64
    if (typeof ELASTIC_CLI_B64 === "string" && ELASTIC_CLI_B64.length > 0) {
      const cacheDir = p.join(os.homedir(), ".cache", "ramen")
      fs.mkdirSync(cacheDir, { recursive: true })
      const dest = p.join(cacheDir, "elastic" + ext)
      if (!fs.existsSync(dest)) {
        fs.writeFileSync(dest, Buffer.from(ELASTIC_CLI_B64, "base64"))
        fs.chmodSync(dest, 0o755)
      }
      cached = dest
      return cached
    }

    // Fallback: assume it's on PATH
    cached = "elastic" + ext
    return cached
  }
}
