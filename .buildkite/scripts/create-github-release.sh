#!/usr/bin/env bash
# Copyright (c) 2026-present, Elastic NV
#
# Final step of elastic-ramen-release.
#
# Strict mirror of elastic/synthetics-recorder/.buildkite/scripts/create-github-release.sh
# with one elastic-ramen-specific addition: re-zip the Windows archives
# with the signed bare .exe + the original NOTICE/LICENSE before
# uploading to GH (sign-windows returns a bare .exe; users expect the
# .zip wrapper that build.ts originally produced).
#
# Required env: BUILDKITE_TAG, VAULT_GITHUB_TOKEN (set by pre-command).

set -eox pipefail

DIST_LOCATION=signed-artifacts

echo "--- Download signed artifacts (gpg, windows, macos)"
# Order matches synthetics-recorder: gpg first, windows next, macos last.
buildkite-agent artifact download --step gpg "$DIST_LOCATION/*.*" ./
ls -ltra "$DIST_LOCATION/"
buildkite-agent artifact download --step windows "$DIST_LOCATION/*.*" ./
ls -ltra "$DIST_LOCATION/"
buildkite-agent artifact download --step macos "$DIST_LOCATION/*.*" ./
ls -ltra "$DIST_LOCATION/"

# Pull the original unsigned windows zips so we can lift NOTICE/LICENSE.
buildkite-agent artifact download "artifacts-to-sign/ramen-windows-*.zip" .

echo "--- Repackage Windows zips with signed .exe"
WORK_WIN_OUT=$(mktemp -d)
shopt -s nullglob
for signed_exe in "$DIST_LOCATION"/ramen-windows-*.exe; do
  base=$(basename "$signed_exe" .exe)
  unsigned_zip="artifacts-to-sign/${base}.zip"
  if [[ ! -f "$unsigned_zip" ]]; then
    echo "ERROR: missing original zip $unsigned_zip" >&2
    exit 1
  fi
  staging=$(mktemp -d)
  unzip -q "$unsigned_zip" -d "$staging"
  cp "$signed_exe" "$staging/bin/elastic-ramen.exe"
  ( cd "$staging" && zip -qr "${WORK_WIN_OUT}/${base}.zip" . )
  rm -rf "$staging"
done
# Replace the bare .exe in DIST_LOCATION with the re-zipped wrapped versions.
rm -f "$DIST_LOCATION"/ramen-windows-*.exe
mv "$WORK_WIN_OUT"/*.zip "$DIST_LOCATION"/
rmdir "$WORK_WIN_OUT"

echo "--- Generate sha512 sidecars"
( cd "$DIST_LOCATION" && for f in *.tar.gz *.zip; do
    [ -f "$f" ] && sha512sum "$f" > "$f.sha512"
  done )

echo "--- Final release asset list"
ls -l "$DIST_LOCATION/"

echo "--- Install gh :github:"
if ! gh --version &>/dev/null ; then
  wget -q https://github.com/cli/cli/releases/download/v2.50.0/gh_2.50.0_linux_amd64.tar.gz -O gh.tar.gz
  tar -xpf gh.tar.gz --strip-components=2
  PATH="$(pwd):${PATH}"
  export PATH
  gh --version
fi

echo "--- Run GitHub release"
if [ -n "${BUILDKITE_TAG}" ] ; then
  if [ ! -d "$DIST_LOCATION" ] ; then
    echo "No signed artifacts found in ${DIST_LOCATION}"
    exit 1
  fi

  # VAULT_GITHUB_TOKEN is the GitHub ephemeral token created in Buildkite.
  # --draft so a maintainer can review assets before clicking Publish.
  # That click fires the release: published event → .github/workflows/publish.yml → npm.
  GH_TOKEN=$VAULT_GITHUB_TOKEN \
  gh release create \
    "${BUILDKITE_TAG}" \
    --draft \
    --generate-notes \
    --repo "elastic/elastic-ramen" \
    "${DIST_LOCATION}"/*.*
else
  echo "gh release won't be triggered (not a Git tag); listing existing releases for sanity:"
  GH_TOKEN=$VAULT_GITHUB_TOKEN \
  gh release list --repo elastic/elastic-ramen
fi
