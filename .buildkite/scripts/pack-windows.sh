#!/usr/bin/env bash
# Copyright (c) 2026-present, Elastic NV
#
# Stage raw windows binaries at the top level of artifacts-to-sign/ for the
# Windows signing service to consume and signtool-sign in place.
#
# We send raw .exe files (not .zip archives) so the macOS signing service -
# which downloads artifacts-to-sign/* unfiltered and crashes on archives
# containing no Mach-O binaries - silently skips them.
set -euo pipefail

mkdir -p downloads artifacts-to-sign

buildkite-agent artifact download "packages/opencode/dist/ramen-windows-*/bin/*" downloads/

shopt -s nullglob
for dir in downloads/packages/opencode/dist/ramen-windows-*; do
  variant=$(basename "$dir")
  if [[ ! -f "${dir}/bin/elastic-ramen.exe" ]]; then
    echo "no windows binary found for ${variant}" >&2
    exit 1
  fi
  cp "${dir}/bin/elastic-ramen.exe" "artifacts-to-sign/${variant}.exe"
done

ls -la artifacts-to-sign/
