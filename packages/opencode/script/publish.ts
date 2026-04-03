#!/usr/bin/env bun
// Copyright (c) 2026-present, Elastic NV
// Publishes @elastic/ramen and its platform-specific packages to npm.
// Run after build.ts has populated dist/.
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@opencode-ai/script"
import { fileURLToPath } from "url"
import path from "path"
import fs from "fs"

const dir = path.dirname(fileURLToPath(import.meta.url + "/.."))
process.chdir(dir)

// Collect all platform packages written by build.ts
const binaries: Record<string, string> = {}
for (const filepath of new Bun.Glob("*/package.json").scanSync({ cwd: "./dist" })) {
  const p = await Bun.file(`./dist/${filepath}`).json()
  if (p.name && p.version && p.os) {
    binaries[p.name] = p.version
  }
}
console.log("platform packages:", binaries)

const version = Object.values(binaries)[0]
if (!version) {
  console.error("No platform packages found in dist/ — run build.ts first")
  process.exit(1)
}

// Build the wrapper package that users install: @elastic/ramen
// It uses optionalDependencies to pull the right platform binary,
// and postinstall.mjs to symlink it into bin/.
const wrapperDir = `./dist/${pkg.name.replace(/^@[^/]+\//, "")}`
await $`mkdir -p ${wrapperDir}/bin`
await $`cp -r ./bin/. ${wrapperDir}/bin/`
await $`cp ./script/postinstall.mjs ${wrapperDir}/postinstall.mjs`

const licenseSource = path.resolve(dir, "../../LICENSE")
if (fs.existsSync(licenseSource)) {
  fs.copyFileSync(licenseSource, `${wrapperDir}/LICENSE`)
}

const noticeSource = path.resolve(dir, "../../NOTICE")
if (fs.existsSync(noticeSource)) {
  fs.copyFileSync(noticeSource, `${wrapperDir}/NOTICE`)
}

await Bun.file(`${wrapperDir}/package.json`).write(
  JSON.stringify(
    {
      name: pkg.name,
      version,
      bin: pkg.bin,
      scripts: {
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      license: pkg.license,
      publishConfig: pkg.publishConfig,
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

// Publish each platform package
const platformTasks = Object.keys(binaries).map(async (name) => {
  const dirName = name.replace(/^@[^/]+\//, "")
  const pkgDir = `./dist/${dirName}`
  if (process.platform !== "win32") {
    await $`chmod -R 755 .`.cwd(pkgDir)
  }
  await $`bun pm pack`.cwd(pkgDir)
  await $`npm publish *.tgz --access public --tag ${Script.channel}`.cwd(pkgDir)
})
await Promise.all(platformTasks)

// Publish the wrapper package
const wrapperDirName = pkg.name.replace(/^@[^/]+\//, "")
await $`cd ./dist/${wrapperDirName} && bun pm pack && npm publish *.tgz --access public --tag ${Script.channel}`

console.log(`Published ${pkg.name}@${version} (channel: ${Script.channel})`)
