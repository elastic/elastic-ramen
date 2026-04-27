#!/usr/bin/env bun
// Copyright (c) 2026-present, Elastic NV
//
// Populate dist/ from a published GitHub release's signed archives so
// script/publish.ts can pack the same signed binaries into the 13 npm
// packages without rebuilding from source.
//
// Triggered by .github/workflows/publish.yml (which fires on
// release: published). Hard-fails if any of the 12 expected platform
// archives is missing, any sha512 sidecar fails, or any linux .asc
// fails gpg verify.
//
// Required env: OPENCODE_VERSION (e.g. "v0.0.7" or "0.0.7"),
//               GH_REPO ("elastic/elastic-ramen"), GH_TOKEN.
import { $ } from "bun"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"

const dir = path.dirname(fileURLToPath(import.meta.url + "/.."))
process.chdir(dir)

const version = (process.env.OPENCODE_VERSION ?? "").replace(/^v/, "")
if (!version) throw new Error("OPENCODE_VERSION env var is required")

const repo = process.env.GH_REPO
if (!repo) throw new Error("GH_REPO env var is required")

const EXPECTED = [
  "ramen-linux-arm64",
  "ramen-linux-arm64-musl",
  "ramen-linux-x64",
  "ramen-linux-x64-baseline",
  "ramen-linux-x64-musl",
  "ramen-linux-x64-baseline-musl",
  "ramen-darwin-arm64",
  "ramen-darwin-x64",
  "ramen-darwin-x64-baseline",
  "ramen-windows-arm64",
  "ramen-windows-x64",
  "ramen-windows-x64-baseline",
] as const

await $`rm -rf dist`
await $`mkdir -p dist/_archives`

console.log(`Downloading signed archives + sidecars for v${version}`)
await $`gh release download v${version} --repo ${repo} --pattern '*.tar.gz' --pattern '*.zip' --pattern '*.tar.gz.asc' --pattern '*.sha512' --dir dist/_archives`

const downloaded = new Set(fs.readdirSync("dist/_archives"))

const missing: string[] = []
for (const platform of EXPECTED) {
  const archive = platform.startsWith("ramen-linux-") ? `${platform}.tar.gz` : `${platform}.zip`
  if (!downloaded.has(archive)) missing.push(archive)
  if (!downloaded.has(`${archive}.sha512`)) missing.push(`${archive}.sha512`)
}
for (const platform of EXPECTED) {
  if (!platform.startsWith("ramen-linux-")) continue
  const asc = `${platform}.tar.gz.asc`
  if (!downloaded.has(asc)) missing.push(asc)
}
if (missing.length) {
  throw new Error(`release v${version} is missing required signed assets:\n  ${missing.join("\n  ")}`)
}

console.log("sha512sum --check (every archive in the release)")
await $`bash -c 'cd dist/_archives && sha512sum --check *.sha512'`

for (const platform of EXPECTED) {
  if (!platform.startsWith("ramen-linux-")) continue
  console.log(`gpg --verify ${platform}.tar.gz.asc`)
  await $`gpg --verify dist/_archives/${platform}.tar.gz.asc dist/_archives/${platform}.tar.gz`
}

for (const platform of EXPECTED) {
  const isLinux = platform.startsWith("ramen-linux-")
  const archive = isLinux ? `${platform}.tar.gz` : `${platform}.zip`
  const platformDir = `dist/${platform}`
  await $`mkdir -p ${platformDir}`
  if (isLinux) {
    await $`tar -xzf dist/_archives/${archive} -C ${platformDir}`
  } else {
    await $`unzip -q dist/_archives/${archive} -d ${platformDir}`
  }

  const expectedBin = platform.includes("windows") ? "elastic-ramen.exe" : "elastic-ramen"
  if (!fs.existsSync(path.join(platformDir, "bin", expectedBin))) {
    throw new Error(`extracted ${archive} but ${platformDir}/bin/${expectedBin} is missing`)
  }

  const npmOs = platform.includes("windows")
    ? "win32"
    : platform.includes("darwin")
      ? "darwin"
      : "linux"
  const cpu = platform.includes("arm64") ? "arm64" : "x64"

  await Bun.file(`${platformDir}/package.json`).write(
    JSON.stringify(
      {
        name: `@elastic/${platform}`,
        version,
        os: [npmOs],
        cpu: [cpu],
      },
      null,
      2,
    ),
  )
}

await $`rm -rf dist/_archives`
console.log(`Staged ${EXPECTED.length} platform packages from v${version} signed release`)
