#!/usr/bin/env bash
# Copyright (c) 2026-present, Elastic NV
#
# Final step of elastic-ramen-release.
#
# Mirror of elastic/synthetics-recorder/.buildkite/scripts/create-github-release.sh
# with two elastic-ramen-specific changes:
#   1. Re-zip the Windows archives with the signed bare .exe + the
#      original NOTICE/LICENSE before uploading to GH (sign-windows
#      returns a bare .exe; users expect the .zip wrapper that build.ts
#      originally produced).
#   2. The draft GH release is created by the GHA kickoff workflow
#      (.github/workflows/release-ramen.yml) — this script only uploads
#      the signed assets to that pre-existing draft via
#      `gh release upload --clobber`.
#
# Required env:
#   BUILDKITE_TAG    set by BK on tag-triggered builds (production).
#                    Branch dry-runs leave this unset and we exit
#                    before the actual upload.
#   GITHUB_TOKEN     exported by the elastic/vault-github-token plugin
#                    attached to this step (gh CLI reads it natively).

set -eox pipefail

DIST_LOCATION=signed-artifacts

TAG="${BUILDKITE_TAG:-}"

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
  # build.ts archives the binary with `cwd(binDir)` (build.ts:335-337),
  # so the .exe (and NOTICE/LICENSE) live at the archive root, not under bin/.
  cp "$signed_exe" "$staging/elastic-ramen.exe"
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

if [[ -z "$TAG" ]]; then
  echo "Dry-run mode (no BUILDKITE_TAG); skipping GH release upload."
  exit 0
fi

echo "--- Upload signed assets to draft release ${TAG}"
if [ ! -d "$DIST_LOCATION" ] ; then
  echo "No signed artifacts found in ${DIST_LOCATION}"
  exit 1
fi

# The draft release is created by .github/workflows/release-ramen.yml.
# --clobber overwrites any prior assets with the same name (idempotent on retry).
gh release upload \
  "${TAG}" \
  --repo "elastic/elastic-ramen" \
  --clobber \
  "${DIST_LOCATION}"/*.*
