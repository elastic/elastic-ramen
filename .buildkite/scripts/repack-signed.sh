#!/usr/bin/env bash
# Copyright (c) 2026-present, Elastic NV
#
# Pull signed mac/windows binaries from the triggered signing builds and build
# fresh ramen-{darwin,windows}-*.zip archives from the build output layout.
# Linux archives are handled separately by pack-linux.sh because only linux
# goes through GPG detached signing.
set -euo pipefail

# shellcheck source=./_lib.sh
source "$(dirname "$0")/_lib.sh"

mkdir -p downloads/build downloads/signed work signed

buildkite-agent artifact download "packages/opencode/dist/ramen-darwin-*/bin/*"  downloads/build/
buildkite-agent artifact download "packages/opencode/dist/ramen-windows-*/bin/*" downloads/build/

mac_build=$(lookup_triggered_build_id macos-sign-service)
win_build=$(lookup_triggered_build_id windows-sign-service)

buildkite-agent artifact download --build "${mac_build}" "extracted/darwin-*/elastic-ramen"      downloads/signed/
buildkite-agent artifact download --build "${win_build}" "extracted/windows-*/elastic-ramen.exe" downloads/signed/

shopt -s nullglob
for dir in downloads/build/packages/opencode/dist/ramen-darwin-* \
           downloads/build/packages/opencode/dist/ramen-windows-*; do
  variant=$(basename "$dir")
  short=${variant#ramen-}
  workdir="work/${variant}"
  rm -rf "${workdir}"
  mkdir -p "${workdir}/bin"

  signed=$(find "downloads/signed/extracted/${short}" -type f | head -n1)
  if [[ -z "${signed}" ]]; then
    echo "no signed binary found for ${short}" >&2
    exit 1
  fi
  cp "${signed}" "${workdir}/bin/$(basename "${signed}")"

  [[ -f "${dir}/bin/NOTICE" ]]  && cp "${dir}/bin/NOTICE"  "${workdir}/bin/NOTICE"
  [[ -f "${dir}/bin/LICENSE" ]] && cp "${dir}/bin/LICENSE" "${workdir}/bin/LICENSE"

  (cd "${workdir}" && zip -qr "../../signed/${variant}.zip" bin)
done

ls -la signed/
