#!/usr/bin/env bash
# Copyright (c) 2026-present, Elastic NV
#
# Pack the linux build outputs into ramen-linux-*.tar.gz archives placed
# under artifacts-to-sign/ so the GPG signing service produces detached
# signatures over the final release archives.
set -euo pipefail

mkdir -p downloads work artifacts-to-sign

buildkite-agent artifact download "packages/opencode/dist/ramen-linux-*/bin/*" downloads/

shopt -s nullglob
for dir in downloads/packages/opencode/dist/ramen-linux-*; do
  variant=$(basename "$dir")
  workdir="work/${variant}"
  rm -rf "${workdir}"
  mkdir -p "${workdir}/bin"

  if [[ ! -f "${dir}/bin/elastic-ramen" ]]; then
    echo "no linux binary found for ${variant}" >&2
    exit 1
  fi
  cp "${dir}/bin/elastic-ramen" "${workdir}/bin/elastic-ramen"
  [[ -f "${dir}/bin/NOTICE" ]] && cp "${dir}/bin/NOTICE" "${workdir}/bin/NOTICE"
  [[ -f "${dir}/bin/LICENSE" ]] && cp "${dir}/bin/LICENSE" "${workdir}/bin/LICENSE"

  (cd "${workdir}" && tar -czf "../../artifacts-to-sign/${variant}.tar.gz" bin)
done

ls -la artifacts-to-sign/
