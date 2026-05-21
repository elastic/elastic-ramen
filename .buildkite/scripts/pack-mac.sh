#!/usr/bin/env bash
# Copyright (c) 2026-present, Elastic NV
#
# Pack the darwin build outputs into ramen-darwin-*.tar.gz archives placed
# under artifacts-to-sign/ for the macOS signing service to consume, codesign,
# notarize, staple, and re-upload.
set -euo pipefail

mkdir -p downloads work artifacts-to-sign

buildkite-agent artifact download "packages/opencode/dist/ramen-darwin-*/bin/*" downloads/

repo_root="$(pwd)"

shopt -s nullglob
for dir in downloads/packages/opencode/dist/ramen-darwin-*; do
  variant=$(basename "$dir")
  workdir="work/${variant}"
  rm -rf "${workdir}"
  mkdir -p "${workdir}/bin"

  if [[ ! -f "${dir}/bin/elastic-ramen" ]]; then
    echo "no darwin binary found for ${variant}" >&2
    exit 1
  fi
  cp "${dir}/bin/elastic-ramen" "${workdir}/bin/elastic-ramen"
  [[ -f "${repo_root}/NOTICE"  ]] && cp "${repo_root}/NOTICE"  "${workdir}/bin/NOTICE"
  [[ -f "${repo_root}/LICENSE" ]] && cp "${repo_root}/LICENSE" "${workdir}/bin/LICENSE"

  (cd "${workdir}" && tar -czf "../../artifacts-to-sign/${variant}.tar.gz" bin)
done

ls -la artifacts-to-sign/
