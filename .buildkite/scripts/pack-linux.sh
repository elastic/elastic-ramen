#!/usr/bin/env bash
# Copyright (c) 2026-present, Elastic NV
#
# Pack the linux build outputs into ramen-linux-*.tar.gz archives placed
# under artifacts-to-sign/ so the GPG signing service produces detached
# signatures over the final release archives.
set -euo pipefail

mkdir -p downloads work artifacts-to-sign

buildkite-agent artifact download "packages/opencode/dist/ramen-linux-*/bin/*" downloads/

repo_root="$(pwd)"

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
  [[ -f "${repo_root}/NOTICE"  ]] && cp "${repo_root}/NOTICE"  "${workdir}/bin/NOTICE"
  [[ -f "${repo_root}/LICENSE" ]] && cp "${repo_root}/LICENSE" "${workdir}/bin/LICENSE"

  # Use .tgz (not .tar.gz) so the macOS signer's extension check skips it -
  # mac downloads artifacts-to-sign/* unfiltered and crashes on archives that
  # contain no Mach-O binaries.
  (cd "${workdir}" && tar -czf "../../artifacts-to-sign/${variant}.tgz" bin)
done

ls -la artifacts-to-sign/
