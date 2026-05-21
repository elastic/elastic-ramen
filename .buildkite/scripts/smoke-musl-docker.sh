#!/usr/bin/env bash
# Copyright (c) 2026-present, Elastic NV
#
# Smoke-test a linux musl elastic-ramen binary on a glibc host by exec'ing it
# inside an alpine container. Used for arm64-musl, where the gcp arm agents
# are ubuntu VMs with no buildkite k8s image override available.
#
# Usage: smoke-musl-docker.sh <variant> <stage>
#   variant: e.g. arm64-musl
#   stage:   pre-sign | post-sign
set -euo pipefail

variant=$1
stage=$2
name="ramen-linux-${variant}"

case "${stage}" in
  pre-sign)
    buildkite-agent artifact download "packages/opencode/dist/${name}/bin/elastic-ramen" .
    bindir="$(pwd)/packages/opencode/dist/${name}/bin"
    ;;
  post-sign)
    archive="final/${name}.tgz"
    buildkite-agent artifact download "${archive}" .
    extracted="smoke/${name}"
    rm -rf "${extracted}"
    mkdir -p "${extracted}"
    tar -xzf "${archive}" -C "${extracted}"
    bindir="$(pwd)/${extracted}/bin"
    ;;
  *)
    echo "unknown stage: ${stage}" >&2
    exit 1
    ;;
esac

chmod +x "${bindir}/elastic-ramen"
docker run --rm -v "${bindir}:/w" -w /w alpine:latest /w/elastic-ramen --help
