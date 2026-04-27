#!/usr/bin/env bash
# Copyright (c) 2026-present, Elastic NV
#
# unified-release-windows-signing signs bare PE binaries, not .zip
# archives. Pull every ramen-windows-*.zip down from the orchestrator
# build's artifacts, extract elastic-ramen.exe, and re-upload as
# artifacts-to-sign/<base>.exe so the windows trigger step's
# DOWNLOAD_ARTIFACTS_FILTER=*.exe picks them up.

set -euxo pipefail

WORK=artifacts-to-sign
mkdir -p "$WORK"

buildkite-agent artifact download "${WORK}/ramen-windows-*.zip" .

shopt -s nullglob
for zip in "$WORK"/ramen-windows-*.zip; do
  base=$(basename "$zip" .zip)
  tmp=$(mktemp -d)
  unzip -q -o "$zip" -d "$tmp"
  exe="$tmp/bin/elastic-ramen.exe"
  if [[ ! -f "$exe" ]]; then
    echo "ERROR: expected $exe inside $zip" >&2
    exit 1
  fi
  cp "$exe" "${WORK}/${base}.exe"
  rm -rf "$tmp"
done

buildkite-agent artifact upload "${WORK}/ramen-windows-*.exe"
