import { existsSync } from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"

const cli = join(import.meta.dir, "..", "..", "cli")
const runner = join(cli, "src", "runner.ts")

if (!existsSync(runner)) {
  execSync("git apply ../cli-patches/0001-ramen-integration.patch", { cwd: cli, stdio: "inherit" })
}
