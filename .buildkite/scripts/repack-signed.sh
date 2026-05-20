#!/usr/bin/env bash
# Copyright (c) 2026-present, Elastic NV
#
# Pull signed mac/windows binaries from the triggered signing builds and build
# fresh ramen-*.zip / ramen-*.tar.gz archives from the build output layout.
# Result is uploaded as signed/ramen-* for the downstream GPG signing step.
set -euo pipefail

# shellcheck source=./_lib.sh
source "$(dirname "$0")/_lib.sh"

mkdir -p downloads/build downloads/signed work signed

buildkite-agent artifact download "packages/opencode/dist/ramen-*/bin/*" downloads/build/

mac_build=$(lookup_triggered_build_id macos-sign-service)
win_build=$(lookup_triggered_build_id windows-sign-service)

buildkite-agent artifact download --build "${mac_build}" "extracted/darwin-*/elastic-ramen"      downloads/signed/
buildkite-agent artifact download --build "${win_build}" "extracted/windows-*/elastic-ramen.exe" downloads/signed/

shopt -s nullglob
for dir in downloads/build/packages/opencode/dist/ramen-*; do
  variant=$(basename "$dir")
  short=${variant#ramen-}
  os=${short%%-*}
  workdir="work/${variant}"
  rm -rf "${workdir}"
  mkdir -p "${workdir}/bin"

  if [[ "${os}" == "darwin" || "${os}" == "windows" ]]; then
    signed=$(find "downloads/signed/extracted/${short}" -type f | head -n1)
    if [[ -z "${signed}" ]]; then
      echo "no signed binary found for ${short}" >&2
      exit 1
    fi
    cp "${signed}" "${workdir}/bin/$(basename "${signed}")"
  elif [[ -f "${dir}/bin/elastic-ramen" ]]; then
    cp "${dir}/bin/elastic-ramen" "${workdir}/bin/elastic-ramen"
  elif [[ -f "${dir}/bin/elastic-ramen.exe" ]]; then
    cp "${dir}/bin/elastic-ramen.exe" "${workdir}/bin/elastic-ramen.exe"
  else
    echo "no binary found for ${variant}" >&2
    exit 1
  fi

  if [[ -f "${dir}/bin/NOTICE" ]]; then
    cp "${dir}/bin/NOTICE" "${workdir}/bin/NOTICE"
  fi
  if [[ -f "${dir}/bin/LICENSE" ]]; then
    cp "${dir}/bin/LICENSE" "${workdir}/bin/LICENSE"
  fi

  if [[ "${os}" == "linux" ]]; then
    (cd "${workdir}" && tar -czf "../../signed/${variant}.tar.gz" bin)
  else
    (cd "${workdir}" && zip -qr "../../signed/${variant}.zip" bin)
  fi
done

ls -la signed/
