#!/usr/bin/env bash
# Copyright (c) 2026-present, Elastic NV
#
# Download the darwin/windows zips produced by the build step and unpack the
# bare binary so the platform signing services can sign it directly.
# Linux tarballs are intentionally left alone — they go straight to GPG.
set -euo pipefail

mkdir -p downloads extracted
buildkite-agent artifact download "packages/opencode/dist/ramen-*.zip" downloads/

shopt -s nullglob
for zip in downloads/packages/opencode/dist/ramen-darwin-*.zip \
           downloads/packages/opencode/dist/ramen-windows-*.zip; do
  variant=$(basename "$zip" .zip)        # ramen-darwin-arm64
  out="extracted/${variant#ramen-}"       # extracted/darwin-arm64
  mkdir -p "$out"
  # -j flattens the bin/ prefix so the signing service sees the binary directly.
  unzip -j "$zip" "bin/elastic-ramen" -d "$out" 2>/dev/null \
    || unzip -j "$zip" "bin/elastic-ramen.exe" -d "$out"
done

ls -la extracted/*/
