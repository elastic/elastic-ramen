#!/usr/bin/env bash
# Copyright (c) 2026-present, Elastic NV
#
# Download darwin/windows binaries produced by the build step and stage them
# as bare files so the platform signing services can sign them directly.
set -euo pipefail

mkdir -p downloads extracted
buildkite-agent artifact download "packages/opencode/dist/ramen-*/bin/elastic-ramen*" downloads/

shopt -s nullglob
for dir in downloads/packages/opencode/dist/ramen-darwin-* \
           downloads/packages/opencode/dist/ramen-windows-*; do
  variant=$(basename "$dir")             # ramen-darwin-arm64
  out="extracted/${variant#ramen-}"      # extracted/darwin-arm64
  mkdir -p "$out"
  if [[ -f "$dir/bin/elastic-ramen" ]]; then
    cp "$dir/bin/elastic-ramen" "$out/elastic-ramen"
  elif [[ -f "$dir/bin/elastic-ramen.exe" ]]; then
    cp "$dir/bin/elastic-ramen.exe" "$out/elastic-ramen.exe"
  else
    echo "No binary found for $variant" >&2
    exit 1
  fi
done

ls -la extracted/*/
