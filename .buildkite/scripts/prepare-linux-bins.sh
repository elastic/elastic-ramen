#!/usr/bin/env bash
# Copyright (c) 2026-present, Elastic NV
#
# Mirror of prepare-windows-exes.sh for linux: extract the bare
# `elastic-ramen` binary out of every ramen-linux-*.tar.gz and re-upload
# as artifacts-to-sign/ramen-linux-<variant>-elastic-ramen so the
# unified-release-gpg-signing step signs the binary itself (matching
# what we do for darwin Mach-O and windows PE) rather than the wrapper
# archive.

set -euxo pipefail

WORK=artifacts-to-sign
mkdir -p "$WORK"

buildkite-agent artifact download "${WORK}/ramen-linux-*.tar.gz" .

shopt -s nullglob
for tarball in "$WORK"/ramen-linux-*.tar.gz; do
  base=$(basename "$tarball" .tar.gz)
  tmp=$(mktemp -d)
  tar -xzf "$tarball" -C "$tmp"
  bin="$tmp/elastic-ramen"
  if [[ ! -f "$bin" ]]; then
    echo "ERROR: expected $bin inside $tarball" >&2
    exit 1
  fi
  cp "$bin" "${WORK}/${base}-elastic-ramen"
  rm -rf "$tmp"
done

buildkite-agent artifact upload "${WORK}/ramen-linux-*-elastic-ramen"
