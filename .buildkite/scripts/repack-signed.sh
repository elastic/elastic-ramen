#!/usr/bin/env bash
# Copyright (c) 2026-present, Elastic NV
#
# Pull signed mac/windows binaries from the triggered signing builds, rebuild
# the original zip layout around them (preserving NOTICE/LICENSE), and pass
# the linux tarballs through untouched. Result is uploaded as signed/ramen-*
# for the downstream GPG signing step.
set -euo pipefail

# shellcheck source=./_lib.sh
source "$(dirname "$0")/_lib.sh"

mkdir -p downloads/unsigned downloads/signed work signed

buildkite-agent artifact download "packages/opencode/dist/ramen-*.zip"    downloads/unsigned/
buildkite-agent artifact download "packages/opencode/dist/ramen-*.tar.gz" downloads/unsigned/

mac_build=$(lookup_triggered_build_id macos-sign-service)
win_build=$(lookup_triggered_build_id windows-sign-service)

buildkite-agent artifact download --build "${mac_build}" "extracted/darwin-*/elastic-ramen"      downloads/signed/
buildkite-agent artifact download --build "${win_build}" "extracted/windows-*/elastic-ramen.exe" downloads/signed/

shopt -s nullglob
for arch in downloads/unsigned/packages/opencode/dist/ramen-darwin-*.zip \
            downloads/unsigned/packages/opencode/dist/ramen-windows-*.zip; do
  variant=$(basename "$arch" .zip)       # ramen-darwin-arm64
  short=${variant#ramen-}                 # darwin-arm64
  workdir="work/${variant}"
  rm -rf "${workdir}"
  mkdir -p "${workdir}"
  unzip -q "${arch}" -d "${workdir}"
  signed=$(find "downloads/signed/extracted/${short}" -type f | head -n1)
  if [[ -z "${signed}" ]]; then
    echo "no signed binary found for ${short}" >&2
    exit 1
  fi
  cp "${signed}" "${workdir}/bin/$(basename "${signed}")"
  (cd "${workdir}" && zip -qr "../../signed/${variant}.zip" bin)
done

cp downloads/unsigned/packages/opencode/dist/ramen-linux-*.tar.gz signed/

ls -la signed/
