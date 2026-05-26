#!/usr/bin/env bash
# Copyright (c) 2026-present, Elastic NV
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required but not installed" >&2
  exit 1
fi

token="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
if [[ -z "${token}" ]]; then
  echo "GH_TOKEN or GITHUB_TOKEN must be set to publish GitHub releases" >&2
  exit 1
fi
export GH_TOKEN="${token}"

repo="${GH_REPO:-elastic/elastic-ramen}"

if [[ -z "${BUILDKITE_TAG:-}" ]]; then
  echo "BUILDKITE_TAG not set — looking for an in-progress draft release in ${repo}"
  BUILDKITE_TAG="$(gh release list --repo "${repo}" --json tagName,isDraft \
    --jq '[.[] | select(.isDraft == true)] | first | .tagName')"
  if [[ -z "${BUILDKITE_TAG}" ]]; then
    echo "No draft release found in ${repo}" >&2
    exit 1
  fi
  echo "Found draft release: ${BUILDKITE_TAG}"
fi

echo "Resolving draft release for tag ${BUILDKITE_TAG} in ${repo}"
draft="$(gh release view "${BUILDKITE_TAG}" --repo "${repo}" --json isDraft --jq '.isDraft')"

if [[ "${draft}" != "true" ]]; then
  echo "Release ${BUILDKITE_TAG} is not draft; continuing to upload assets and publish state update"
fi

mkdir -p final
buildkite-agent artifact download "final/*" .

shopt -s nullglob
assets=(final/*)
if ((${#assets[@]} == 0)); then
  echo "No files found under final/ to upload" >&2
  exit 1
fi

echo "Uploading ${#assets[@]} artifacts"
gh release upload "${BUILDKITE_TAG}" "${assets[@]}" --repo "${repo}" --clobber

echo "Publishing release ${BUILDKITE_TAG}"
gh release edit "${BUILDKITE_TAG}" --repo "${repo}" --draft=false

echo "Release ${BUILDKITE_TAG} published"
