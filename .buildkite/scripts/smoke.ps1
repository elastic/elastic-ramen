# Copyright (c) 2026-present, Elastic NV
#
# Smoke-test a windows elastic-ramen.exe by running --help. Used both pre-sign
# (raw build output) and post-sign (final .zip from collect-signed.sh).
#
# Usage: smoke.ps1 -Variant <variant> -Stage <pre-sign|post-sign>
param(
  [Parameter(Mandatory=$true)][string]$Variant,
  [Parameter(Mandatory=$true)][ValidateSet("pre-sign","post-sign")][string]$Stage
)
$ErrorActionPreference = "Stop"
$Name = "ramen-windows-$Variant"

switch ($Stage) {
  "pre-sign" {
    buildkite-agent artifact download "packages/opencode/dist/$Name/bin/elastic-ramen.exe" .
    $Bin = ".\packages\opencode\dist\$Name\bin\elastic-ramen.exe"
  }
  "post-sign" {
    buildkite-agent artifact download "final/$Name.zip" .
    $Dest = "smoke\$Name"
    if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
    Expand-Archive -Path "final\$Name.zip" -DestinationPath $Dest
    $Bin = "$Dest\bin\elastic-ramen.exe"
  }
}

& $Bin --help
