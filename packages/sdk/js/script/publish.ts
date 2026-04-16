#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const pkg = (await import("../package.json").then((m) => m.default)) as {
  name: string
  version: string
  exports: Record<string, string | object>
}
const original = JSON.parse(JSON.stringify(pkg))
function transformExports(exports: Record<string, string | object>) {
  for (const [key, value] of Object.entries(exports)) {
    if (typeof value === "object" && value !== null) {
      transformExports(value as Record<string, string | object>)
    } else if (typeof value === "string") {
      const file = value.replace("./src/", "./dist/").replace(".ts", "")
      exports[key] = {
        import: file + ".js",
        types: file + ".d.ts",
      }
    }
  }
}
transformExports(pkg.exports)
await Bun.write("package.json", JSON.stringify(pkg, null, 2))
const result = await $`npm view ${pkg.name}@${pkg.version} version`.nothrow().quiet()
if (result.exitCode === 0 && result.stdout.toString().trim() !== "") {
  console.log(`Skipping ${pkg.name}@${pkg.version} (already published)`)
} else {
  await $`bun pm pack`
  await $`npm publish *.tgz --tag ${Script.channel} --access public`
}
await Bun.write("package.json", JSON.stringify(original, null, 2))
