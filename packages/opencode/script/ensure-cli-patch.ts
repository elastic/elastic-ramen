import { existsSync } from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"

const cli = join(import.meta.dir, "..", "..", "cli")
const runner = join(cli, "src", "runner.ts")
const esSchemaDist = join(cli, "packages", "es-schemas", "dist")
const configResolverDist = join(cli, "packages", "config-resolver", "dist")

if (!existsSync(runner)) {
  execSync("git apply ../cli-patches/0001-ramen-integration.patch", { cwd: cli, stdio: "inherit" })
}

// @elastic/es-schemas and @elastic/config-resolver ship no pre-built dist in the
// submodule — their package.json exports point to dist/*.js so they must be compiled
// before any runtime import can succeed.
if (!existsSync(esSchemaDist) || !existsSync(configResolverDist)) {
  execSync("node_modules/.bin/tsc -b packages/es-schemas packages/config-resolver", { cwd: cli, stdio: "inherit" })
}
