#!/usr/bin/env bash
# Copyright (c) 2026-present, Elastic NV
#
# Build step for elastic-ramen-release. Bun cross-compiles all 12
# platform binaries from a single Linux docker agent in one process,
# so we don't need a per-target matrix.
#
# Sets up bun + go, checks out the pinned elastic/cli source, embeds
# the elastic CLI per-target, then runs `bun run build` which produces
# dist/ramen-<target>.{tar.gz,zip} for every supported target. Moves
# them into artifacts-to-sign/ and uploads as BK artifacts so the
# sign-* trigger steps pick them up via INPUT_PATH=buildkite://.
#
# Required env:
#   BUILDKITE_TAG    set by BK on tag-triggered builds (production).
#                    For branch dry-runs (ci/* trigger), we synthesize
#                    a placeholder version below so build.ts has
#                    something to embed.
#   GITHUB_TOKEN     ephemeral GH App token exported by the
#                    elastic/vault-github-token plugin on this step.

set -euxo pipefail

: "${GITHUB_TOKEN:?GITHUB_TOKEN must be set by the elastic/vault-github-token plugin}"

TAG="${BUILDKITE_TAG:-}"
if [[ -z "$TAG" ]]; then
  # Branch dry-run: synthesize a version so build.ts can run end-to-end.
  TAG="v0.0.0-dryrun-${BUILDKITE_COMMIT:0:7}"
  echo "No BUILDKITE_TAG set; running as dry-run with synthetic ${TAG}"
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# bun installs to ~/.bun by default; respect any pinned version from
# .bun-version (build.ts will assert via @opencode-ai/script).
if ! command -v bun >/dev/null; then
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

# Go for the elastic-cli embed. 1.23 matches the version on dev's
# release-ramen.yml (pre-#58); follow-up issue tracks the upgrade.
if ! command -v go >/dev/null; then
  GO_VERSION="1.23.4"
  curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -o /tmp/go.tar.gz
  if [[ "$(id -u)" -eq 0 ]]; then
    tar -C /usr/local -xzf /tmp/go.tar.gz
  elif command -v sudo >/dev/null 2>&1; then
    sudo tar -C /usr/local -xzf /tmp/go.tar.gz
  else
    echo "Go installation requires root privileges or sudo to extract into /usr/local" >&2
    exit 1
  fi
  export PATH="/usr/local/go/bin:$PATH"
fi

# Pinned elastic CLI ref — matches what was on dev's release-ramen.yml
# (commit 26f5dfba4 at the time of writing).
CLI_REF="b056a344e6b9b27e09bb2b6270be2e6b8c5bf2fc"
CLI_DIR="${ROOT}/cli"
if [[ ! -d "$CLI_DIR" ]]; then
  echo "--- Checkout elastic/cli @ ${CLI_REF}"
  git clone --depth 1 --no-checkout "https://x-access-token:${GITHUB_TOKEN}@github.com/elastic/cli.git" "$CLI_DIR"
  ( cd "$CLI_DIR" && git fetch --depth 1 origin "$CLI_REF" && git checkout FETCH_HEAD )
fi

cd "${ROOT}"

echo "--- bun install"
bun install --frozen-lockfile

echo "--- bun run build (all 12 targets)"
cd packages/opencode
OPENCODE_VERSION="${TAG#v}" \
OPENCODE_RELEASE="1" \
GH_REPO="elastic/elastic-ramen" \
ELASTIC_CLI_DIR="${CLI_DIR}" \
  bun run build

echo "--- Stage artifacts in artifacts-to-sign/"
mkdir -p "${ROOT}/artifacts-to-sign"
shopt -s nullglob
for f in dist/ramen-*.tar.gz dist/ramen-*.zip; do
  cp "$f" "${ROOT}/artifacts-to-sign/"
done

cd "${ROOT}"
ls -la artifacts-to-sign/
buildkite-agent artifact upload "artifacts-to-sign/*"
