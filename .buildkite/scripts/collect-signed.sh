#!/usr/bin/env bash
# Copyright (c) 2026-present, Elastic NV
#
# Download the final signed release artifacts from the three signing-service
# builds and place them under final/ for downstream publish steps.
#
# Per-platform output:
#   - macOS:   ramen-darwin-*.tar.gz             (codesigned, notarized, stapled)
#   - Windows: ramen-windows-*.exe               (signtool-signed in place)
#   - Linux:   ramen-linux-*.tgz, .tgz.asc, .tgz.sha512   (GPG detached + checksum)
#
# Note: GPG also produces .asc/.sha512 for the mac/win files we sent it
# (harmless noise, ignored here).
set -euo pipefail

# shellcheck source=./_lib.sh
source "$(dirname "$0")/_lib.sh"

mkdir -p final

mac_build=$(lookup_triggered_build_id macos-sign-service)
win_build=$(lookup_triggered_build_id windows-sign-service)
gpg_build=$(lookup_triggered_build_id gpg-sign-service)

buildkite-agent artifact download --build "${mac_build}" "ramen-darwin-*.tar.gz"  final/
buildkite-agent artifact download --build "${win_build}" "ramen-windows-*.exe"    final/
buildkite-agent artifact download --build "${gpg_build}" "ramen-linux-*.tgz"      final/
buildkite-agent artifact download --build "${gpg_build}" "ramen-linux-*.tgz.asc"  final/
buildkite-agent artifact download --build "${gpg_build}" "ramen-linux-*.tgz.sha512" final/

ls -la final/
