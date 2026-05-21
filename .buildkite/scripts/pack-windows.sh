#!/usr/bin/env bash
# Copyright (c) 2026-present, Elastic NV
#
# Pack the windows build outputs into ramen-windows-*.zip archives placed
# under artifacts-to-sign/ for the Windows signing service to consume, sign,
# and re-upload.
set -euo pipefail

mkdir -p downloads work artifacts-to-sign

buildkite-agent artifact download "packages/opencode/dist/ramen-windows-*/bin/*" downloads/

shopt -s nullglob
for dir in downloads/packages/opencode/dist/ramen-windows-*; do
  variant=$(basename "$dir")
  workdir="work/${variant}"
  rm -rf "${workdir}"
  mkdir -p "${workdir}/bin"

  if [[ ! -f "${dir}/bin/elastic-ramen.exe" ]]; then
    echo "no windows binary found for ${variant}" >&2
    exit 1
  fi
  cp "${dir}/bin/elastic-ramen.exe" "${workdir}/bin/elastic-ramen.exe"
  [[ -f "${dir}/bin/NOTICE" ]]  && cp "${dir}/bin/NOTICE"  "${workdir}/bin/NOTICE"
  [[ -f "${dir}/bin/LICENSE" ]] && cp "${dir}/bin/LICENSE" "${workdir}/bin/LICENSE"

  (cd "${workdir}" && zip -qr "../../artifacts-to-sign/${variant}.zip" bin)
done

ls -la artifacts-to-sign/
