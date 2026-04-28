#!/usr/bin/env bash
set -euo pipefail
# Copyright (c) 2026-present, Elastic NV
#
# Strict mirror of
# elastic/synthetics-recorder/.buildkite/scripts/download-signed-artifacts.sh
#
# Resolves `triggered_build.id` for the named sign-* trigger step in
# this orchestrator BK build, and emits (to stdout) a dynamic step that
# downloads the signed artifacts from the child build into
# signed-artifacts/ and re-uploads them onto the orchestrator. The
# emitted step's `key` matches DOWNLOAD_STEP_NAME (the second arg) so
# create-github-release.sh can `buildkite-agent artifact download --step <name>`.
#
# Usage: download-signed-artifacts.sh <step_key> <download_step_name>
#   e.g. download-signed-artifacts.sh sign-gpg gpg
#
# Required env: BUILDKITE_TOKEN_SECRET (set by .buildkite/hooks/pre-command).

STEP=$1
DOWNLOAD_STEP_NAME=$2

# Support main pipeline and downstream pipelines
if [ -n "$BUILDKITE_TRIGGERED_FROM_BUILD_PIPELINE_SLUG" ] ; then
  BUILDKITE_PIPELINE_SLUG=$BUILDKITE_TRIGGERED_FROM_BUILD_PIPELINE_SLUG
  BUILDKITE_BUILD_NUMBER=$BUILDKITE_TRIGGERED_FROM_BUILD_NUMBER
fi

if [ -z "$BUILDKITE_TOKEN_SECRET" ] ; then
  echo "Token could not be loaded from vault. Please review .buildkite/hooks/pre-command"
  exit 1
fi

BUILDS_URL="https://api.buildkite.com/v2/organizations/elastic/pipelines/$BUILDKITE_PIPELINE_SLUG/builds"
build_json=$(curl -sfH "Authorization: Bearer $BUILDKITE_TOKEN_SECRET" "$BUILDS_URL/$BUILDKITE_BUILD_NUMBER")
SIGN_BUILD_ID=$(jq -r ".jobs[] | select(.step_key == \"$STEP\").triggered_build.id" <<< "$build_json")

if [ -z "$SIGN_BUILD_ID" ] || [ "$SIGN_BUILD_ID" = "null" ] ; then
  echo "Sign build id could not be found. Please review $BUILDS_URL/$BUILDKITE_BUILD_NUMBER and the below json output:"
  echo "$build_json"
  exit 1
fi

cat << EOF
  - label: ":pipeline: Download signed artifacts $DOWNLOAD_STEP_NAME"
    key: "$DOWNLOAD_STEP_NAME"
    commands:
      - mkdir -p signed-artifacts
      - buildkite-agent artifact download --build "$SIGN_BUILD_ID" "*.*" signed-artifacts/
      - ls -ltra signed-artifacts/
      - buildkite-agent artifact upload "signed-artifacts/*.*"
    agents:
      image: docker.elastic.co/ci-agent-images/ubuntu-build-essential
EOF
