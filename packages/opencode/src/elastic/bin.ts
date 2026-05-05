// Copyright (c) 2026-present, Elastic NV
import p from "path"
import fs from "fs"
import os from "os"
import crypto from "crypto"
import { which } from "@/util/which"

declare const ELASTIC_CLI_B64: string

export namespace ElasticBin {
  /** Resolved path cache. Prefer `process.env.ELASTIC_RAMEN_ELASTIC` / `ELASTIC_RAMEN_ELASTIC_DIR` when set by the main CLI so workers inherit the embedded binary location. */
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

    const cacheDir = p.join(os.homedir(), ".cache", "ramen")

    // Compiled mode: extract from embedded base64. Key the cache filename on
    // a content hash so upgrades don't silently reuse a stale binary.
    if (typeof ELASTIC_CLI_B64 === "string" && ELASTIC_CLI_B64.length > 0) {
      fs.mkdirSync(cacheDir, { recursive: true })
      const hash = crypto.createHash("sha256").update(ELASTIC_CLI_B64).digest("hex").slice(0, 16)
      const dest = p.join(cacheDir, `elastic-${hash}${ext}`)
      if (!fs.existsSync(dest)) {
        const tmp = `${dest}.tmp-${process.pid}`
        fs.writeFileSync(tmp, Buffer.from(ELASTIC_CLI_B64, "base64"), { mode: 0o755 })
        fs.renameSync(tmp, dest)
        try {
          for (const entry of fs.readdirSync(cacheDir)) {
            if (entry === p.basename(dest)) continue
            if (entry.startsWith("elastic-") || entry === "elastic" || entry === "elastic.exe") {
              fs.unlinkSync(p.join(cacheDir, entry))
            }
          }
        } catch {
          // best-effort cleanup of older versions
        }
      }
      cached = dest
      return cached
    }

    const found = which("elastic" + ext)
    if (found) {
      cached = found
      return cached
    }

    cached = "elastic" + ext
    return cached
  }
}
