#!/usr/bin/env bash
# Copyright (c) 2026-present, Elastic NV
#
# Smoke-test a linux or darwin elastic-ramen binary by running --help.
# Used both pre-sign (raw build output from the build step) and post-sign
# (final archive produced by collect-signed.sh).
#
# Usage: smoke.sh <platform> <variant> <stage>
#   platform: linux | darwin
#   variant:  e.g. x64, arm64, x64-musl, x64-baseline-musl
#   stage:    pre-sign | post-sign
set -euo pipefail

platform=$1
variant=$2
stage=$3
name="ramen-${platform}-${variant}"

case "${stage}" in
  pre-sign)
    buildkite-agent artifact download "packages/opencode/dist/${name}/bin/elastic-ramen" .
    bin="packages/opencode/dist/${name}/bin/elastic-ramen"
    ;;
  post-sign)
    if [[ "${platform}" == "linux" ]]; then
      archive="final/${name}.tgz"
    else
      archive="final/${name}.tar.gz"
    fi
    buildkite-agent artifact download "${archive}" .
    extracted="smoke/${name}"
    rm -rf "${extracted}"
    mkdir -p "${extracted}"
    tar -xzf "${archive}" -C "${extracted}"
    bin="${extracted}/bin/elastic-ramen"
    ;;
  *)
    echo "unknown stage: ${stage}" >&2
    exit 1
    ;;
esac

chmod +x "${bin}"
"${bin}" --help
