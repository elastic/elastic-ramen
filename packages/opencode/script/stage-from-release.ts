#!/usr/bin/env bun
// Copyright (c) 2026-present, Elastic NV
//
// Populate dist/ from a published GitHub release's signed archives so
// script/publish.ts can pack the same signed binaries into the npm
// platform packages without rebuilding from source.
//
// Triggered by .github/workflows/publish.yml on `release: published`.
// Processes whatever signed assets the release contains — no hardcoded
// platform list. Per-PR pre-flights are responsible for catching
// contract drift; releases shouldn't fail because a new platform was
// added without updating this script.
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

await $`rm -rf dist`
await $`mkdir -p dist/_archives`

console.log(`Downloading signed assets for v${version}`)
await $`gh release download v${version} --repo ${repo} --pattern '*.tar.gz' --pattern '*.zip' --pattern '*.sha512' --dir dist/_archives`

const downloaded = fs.readdirSync("dist/_archives")
if (downloaded.length === 0) {
  throw new Error(`release v${version} has no assets matching the expected patterns`)
}

// Verify integrity of every signed asset present.
const sha512Files = downloaded.filter((f) => f.endsWith(".sha512"))
if (sha512Files.length > 0) {
  console.log(`sha512sum --check ${sha512Files.length} sidecar(s)`)
  await $`bash -c 'cd dist/_archives && sha512sum --check *.sha512'`
}

// The .asc detached signatures live INSIDE the linux tarballs (signed
// by unified-release-gpg-signing against the bare elastic-ramen
// binary, alongside NOTICE/LICENSE). Import the Elastic release public
// key so `gpg --verify` post-extraction trusts them.
console.log("Importing Elastic release GPG public key")
await $`bash -c 'curl -fsSL https://artifacts.elastic.co/GPG-KEY-elasticsearch | gpg --import'`

// Lay out dist/<basename>/bin/ from each archive so publish.ts can
// `bun pm pack`. build.ts archives are made with `cwd(binDir)`, so
// archive entries are at root (elastic-ramen, NOTICE, LICENSE, .asc)
// — extract straight into bin/ to restore the original layout.
const archives = downloaded.filter((f) => f.endsWith(".tar.gz") || f.endsWith(".zip"))
for (const archive of archives) {
  const basename = archive.replace(/\.(tar\.gz|zip)$/, "")
  const platformDir = `dist/${basename}`
  const binDir = `${platformDir}/bin`
  await $`mkdir -p ${binDir}`
  if (archive.endsWith(".tar.gz")) {
    await $`tar -xzf dist/_archives/${archive} -C ${binDir}`
  } else {
    await $`unzip -q dist/_archives/${archive} -d ${binDir}`
  }

  const expectedBin = basename.includes("windows") ? "elastic-ramen.exe" : "elastic-ramen"
  if (!fs.existsSync(path.join(binDir, expectedBin))) {
    throw new Error(`extracted ${archive} but ${binDir}/${expectedBin} is missing`)
  }

  // For linux: verify the GPG detached signature against the bare binary.
  const ascPath = path.join(binDir, `${expectedBin}.asc`)
  if (basename.startsWith("ramen-linux-")) {
    if (!fs.existsSync(ascPath)) {
      throw new Error(`missing GPG signature ${ascPath} inside ${archive}`)
    }
    console.log(`gpg --verify ${binDir}/${expectedBin}.asc`)
    await $`gpg --verify ${ascPath} ${path.join(binDir, expectedBin)}`
  }

  const npmOs = basename.includes("windows")
    ? "win32"
    : basename.includes("darwin")
      ? "darwin"
      : "linux"
  const cpu = basename.includes("arm64") ? "arm64" : "x64"

  await Bun.file(`${platformDir}/package.json`).write(
    JSON.stringify(
      {
        name: `@elastic/${basename}`,
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
console.log(`Staged ${archives.length} platform packages from v${version} signed release`)
