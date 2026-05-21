#!/usr/bin/env bash
# Copyright (c) 2026-present, Elastic NV
#
# Download the final signed release archives from the three signing-service
# builds and place them under final/ for downstream publish steps.
#
# Notes on what each signer produces in its own build's artifacts:
#   - macOS:   ramen-darwin-*.tar.gz  (codesigned, notarized, stapled)
#   - Windows: ramen-windows-*.zip    (signtool-signed binaries inside)
#   - GPG:     ramen-linux-*.tar.gz, ramen-linux-*.tar.gz.asc, *.sha512
#              (GPG also produces .asc/.sha512 for the mac/win input archives
#              we sent it -- harmless noise, not collected here.)
set -euo pipefail

# shellcheck source=./_lib.sh
source "$(dirname "$0")/_lib.sh"

mkdir -p final

mac_build=$(lookup_triggered_build_id macos-sign-service)
win_build=$(lookup_triggered_build_id windows-sign-service)
gpg_build=$(lookup_triggered_build_id gpg-sign-service)

buildkite-agent artifact download --build "${mac_build}" "ramen-darwin-*.tar.gz"      final/
buildkite-agent artifact download --build "${win_build}" "ramen-windows-*.zip"        final/
buildkite-agent artifact download --build "${gpg_build}" "ramen-linux-*.tar.gz"       final/
buildkite-agent artifact download --build "${gpg_build}" "ramen-linux-*.tar.gz.asc"   final/
buildkite-agent artifact download --build "${gpg_build}" "ramen-linux-*.tar.gz.sha512" final/

ls -la final/
