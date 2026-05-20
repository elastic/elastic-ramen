#!/usr/bin/env bash
# Copyright (c) 2026-present, Elastic NV
#
# Download the .asc detached signatures produced by the GPG signing trigger
# and upload them as artifacts of this build so a future publish step can
# ship them alongside the archives.
set -euo pipefail

# shellcheck source=./_lib.sh
source "$(dirname "$0")/_lib.sh"

mkdir -p signed
gpg_build=$(lookup_triggered_build_id gpg-sign-service)
buildkite-agent artifact download --build "${gpg_build}" "signed/ramen-*" signed/

ls -la signed/
