#!/usr/bin/env bash
# Copyright (c) 2026-present, Elastic NV
#
# Per-platform package step for elastic-ramen-release. Runs once per
# matrix entry from .buildkite/release.yml.
#
# Sets up bun + go, checks out the pinned elastic/cli source, builds the
# elastic CLI for the target platform, then runs `bun run build --target=<…>`
# which produces dist/ramen-<target>.{tar.gz,zip} (with bin/elastic-ramen[.exe]
# + NOTICE + LICENSE inside). Renames the dist into artifacts-to-sign/ and
# uploads as a BK artifact for the sign-* trigger steps to consume via
# INPUT_PATH=buildkite://.
#
# Usage: build-and-package.sh <target>
#   <target> is the suffix passed to build.ts --target=<…>:
#     linux-arm64, linux-arm64-musl, linux-x64, linux-x64-baseline,
#     linux-x64-musl, linux-x64-baseline-musl, darwin-arm64, darwin-x64,
#     darwin-x64-baseline, windows-arm64, windows-x64, windows-x64-baseline

set -euxo pipefail

TARGET="${1:?usage: build-and-package.sh <target>}"

# Resolve the elastic-ramen workspace root (the script runs from .buildkite/scripts/).
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# bun installs to ~/.bun by default; respect any pinned version from .bun-version.
if ! command -v bun >/dev/null; then
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

# Go for the elastic-cli embed.
if ! command -v go >/dev/null; then
  GO_VERSION="1.23.4"
  curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -o /tmp/go.tar.gz
  sudo tar -C /usr/local -xzf /tmp/go.tar.gz
  export PATH="/usr/local/go/bin:$PATH"
fi

# Pinned elastic CLI ref — matches what was in
# .github/workflows/release-ramen.yml on dev.
CLI_REF="b056a344e6b9b27e09bb2b6270be2e6b8c5bf2fc"
CLI_DIR="${ROOT}/cli"
if [[ ! -d "$CLI_DIR" ]]; then
  echo "--- Checkout elastic/cli @ ${CLI_REF}"
  git clone --depth 1 --no-checkout "https://${GH_TOKEN}@github.com/elastic/cli.git" "$CLI_DIR"
  ( cd "$CLI_DIR" && git fetch --depth 1 origin "$CLI_REF" && git checkout FETCH_HEAD )
fi

cd "${ROOT}"

echo "--- bun install"
bun install --frozen-lockfile

echo "--- bun run build --target=${TARGET}"
cd packages/opencode
OPENCODE_VERSION="${BUILDKITE_TAG#v}" \
OPENCODE_RELEASE="1" \
GH_REPO="elastic/elastic-ramen" \
ELASTIC_CLI_DIR="${CLI_DIR}" \
  bun run build --target="${TARGET}"

echo "--- Stage artifact in artifacts-to-sign/"
mkdir -p "${ROOT}/artifacts-to-sign"
shopt -s nullglob
for f in "dist/ramen-${TARGET}.tar.gz" "dist/ramen-${TARGET}.zip"; do
  if [[ -f "$f" ]]; then
    cp "$f" "${ROOT}/artifacts-to-sign/"
  fi
done

cd "${ROOT}"
ls -la artifacts-to-sign/
buildkite-agent artifact upload "artifacts-to-sign/ramen-${TARGET}.*"
