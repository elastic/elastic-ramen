#!/usr/bin/env bun
import { Script } from "@opencode-ai/script"
import { $ } from "bun"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

await $`bun tsc`
const pkg = await import("../package.json").then((m) => m.default)
const original = JSON.parse(JSON.stringify(pkg))
for (const [key, value] of Object.entries(pkg.exports)) {
  const file = value.replace("./src/", "./dist/").replace(".ts", "")
  // @ts-ignore
  pkg.exports[key] = {
    import: file + ".js",
    types: file + ".d.ts",
  }
}
await Bun.write("package.json", JSON.stringify(pkg, null, 2))
const result = await $`npm view ${pkg.name}@${pkg.version} version`.nothrow().quiet()
if (result.exitCode === 0 && result.stdout.toString().trim() !== "") {
  console.log(`Skipping ${pkg.name}@${pkg.version} (already published)`)
} else {
  await $`bun pm pack && npm publish *.tgz --tag ${Script.channel} --access public`
}
await Bun.write("package.json", JSON.stringify(original, null, 2))
