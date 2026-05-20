#!/usr/bin/env bash
set -euo pipefail

: "${BUN_VERSION:?BUN_VERSION must be set}"

echo "Installing pinned Bun for build pipeline"
echo "DRY_RUN=${DRY_RUN:-unset}"
echo "BUN_VERSION=${BUN_VERSION}"

export BUN_INSTALL="${PWD}/.bun"
export PATH="${BUN_INSTALL}/bin:${PATH}"

if ! command -v bun >/dev/null 2>&1 || [[ "$(bun --version)" != "${BUN_VERSION}" ]]; then
  echo "Installing pinned Bun ${BUN_VERSION} from GitHub Releases..."
  if [[ "$(uname -s)" != "Linux" ]]; then
    echo "This pipeline expects a Linux (Ubuntu) agent, got: $(uname -s)"
    exit 1
  fi

  case "$(uname -m)" in
    x86_64) target="bun-linux-x64" ;;
    aarch64|arm64) target="bun-linux-aarch64" ;;
    *)
      echo "Unsupported Linux architecture: $(uname -m)"
      exit 1
      ;;
  esac

  if ! command -v unzip >/dev/null 2>&1; then
    echo "unzip is required to install Bun from GitHub release assets"
    exit 1
  fi

  tmp="$(mktemp -d)"
  curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${target}.zip" -o "${tmp}/bun.zip"
  unzip -q "${tmp}/bun.zip" -d "${tmp}"
  mkdir -p "${BUN_INSTALL}/bin"
  install -m 0755 "${tmp}/${target}/bun" "${BUN_INSTALL}/bin/bun"
  rm -rf "${tmp}"
fi

echo "Using Bun $(bun --version)"
cd packages/opencode
bun install
bun run build
