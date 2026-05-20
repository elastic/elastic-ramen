#!/usr/bin/env bash
# Copyright (c) 2026-present, Elastic NV
#
# Shared helpers for signing-pipeline scripts. Source with:
#   source "$(dirname "$0")/_lib.sh"

# Resolve the build ID of a downstream pipeline that was triggered from this
# build via a `trigger:` step with the given step_key. Echoes the build ID on
# stdout, exits non-zero on failure. BUILDKITE_TOKEN_SECRET is provisioned by
# the elastic/vault-secrets plugin declared on the calling step.
lookup_triggered_build_id() {
  local step_key="$1"
  : "${BUILDKITE_TOKEN_SECRET:?BUILDKITE_TOKEN_SECRET is required (set by plugin elastic/vault-secrets)}"
  : "${BUILDKITE_BUILD_NUMBER:?BUILDKITE_BUILD_NUMBER must be set by Buildkite}"

  curl -fsSL -H "Authorization: Bearer ${BUILDKITE_TOKEN_SECRET}" \
    "https://api.buildkite.com/v2/organizations/elastic/pipelines/elastic-ramen-release/builds/${BUILDKITE_BUILD_NUMBER}" \
    | jq -er ".jobs[] | select(.step_key==\"${step_key}\").triggered_build.id"
}
