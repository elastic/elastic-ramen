#!/usr/bin/env bun
// Copyright (c) 2026-present, Elastic NV
// Publishes @elastic/ramen to npm.
// Run after build.ts has populated dist/.
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@opencode-ai/script"
import { fileURLToPath } from "url"
import path from "path"
import fs from "fs"

const dir = path.dirname(fileURLToPath(import.meta.url + "/.."))
process.chdir(dir)

// Read the version from the first platform package written by build.ts
let version: string | undefined
for (const filepath of new Bun.Glob("*/package.json").scanSync({ cwd: "./dist" })) {
  const p = await Bun.file(`./dist/${filepath}`).json()
  if (p.name && p.version && p.os) {
    version = p.version
    break
  }
}

if (!version) {
  console.error("No platform package found in dist/ — run build.ts first")
  process.exit(1)
}

// Build the wrapper package that users install: @elastic/ramen
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
    },
    null,
    2,
  ),
)

// Publish only the wrapper package
const wrapperDirName = pkg.name.replace(/^@[^/]+\//, "")
await $`cd ./dist/${wrapperDirName} && bun pm pack && npm publish *.tgz --access public --tag ${Script.channel}`

console.log(`Published ${pkg.name}@${version} (channel: ${Script.channel})`)
