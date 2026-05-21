#!/usr/bin/env bash
# Copyright (c) 2026-present, Elastic NV
#
# Download the final signed release artifacts from the three signing-service
# builds and assemble them under final/ for downstream publish steps.
#
# Per-platform output:
#   - macOS:   ramen-darwin-*.tar.gz                       (codesigned, notarized, stapled)
#   - Linux:   ramen-linux-*.tgz, .tgz.asc, .tgz.sha512    (GPG detached + checksum)
#   - Windows: ramen-windows-*.zip                         (signed .exe + NOTICE + LICENSE)
#
# The GPG service signs every artifact in the parent build's artifacts-to-sign/
# (it has no filter knob), but we only consume the linux signatures here - the
# mac/win .asc/.sha512 GPG produced sit unused in the GPG build.
set -euo pipefail

# shellcheck source=./_lib.sh
source "$(dirname "$0")/_lib.sh"

mkdir -p final work/win-exe work/win-docs

mac_build=$(lookup_triggered_build_id macos-sign-service)
win_build=$(lookup_triggered_build_id windows-sign-service)
gpg_build=$(lookup_triggered_build_id gpg-sign-service)

# macOS - signer outputs signed tarballs; ship as-is.
buildkite-agent artifact download --build "${mac_build}" "ramen-darwin-*.tar.gz" final/

# Linux - signed tarballs + GPG detached sigs and SHA512 checksums.
buildkite-agent artifact download --build "${gpg_build}" "ramen-linux-*.tgz"        final/
buildkite-agent artifact download --build "${gpg_build}" "ramen-linux-*.tgz.asc"    final/
buildkite-agent artifact download --build "${gpg_build}" "ramen-linux-*.tgz.sha512" final/

# Windows - bundle the signed .exe with NOTICE/LICENSE from the build step into
# ramen-windows-<variant>.zip with a bin/ layout matching mac/linux.
buildkite-agent artifact download --build "${win_build}" "ramen-windows-*.exe"         work/win-exe/
buildkite-agent artifact download "packages/opencode/dist/ramen-windows-*/bin/NOTICE"  work/win-docs/
buildkite-agent artifact download "packages/opencode/dist/ramen-windows-*/bin/LICENSE" work/win-docs/

shopt -s nullglob
for exe in work/win-exe/ramen-windows-*.exe; do
  variant=$(basename "${exe}" .exe)
  stage="work/${variant}"
  rm -rf "${stage}"
  mkdir -p "${stage}/bin"
  cp "${exe}" "${stage}/bin/elastic-ramen.exe"
  src="work/win-docs/packages/opencode/dist/${variant}/bin"
  [[ -f "${src}/NOTICE"  ]] && cp "${src}/NOTICE"  "${stage}/bin/NOTICE"
  [[ -f "${src}/LICENSE" ]] && cp "${src}/LICENSE" "${stage}/bin/LICENSE"
  (cd "${stage}" && zip -qr "../../final/${variant}.zip" bin)
done

ls -la final/
