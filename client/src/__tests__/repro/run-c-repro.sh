#!/usr/bin/env bash
# Starts this repo's GemStone test stone, then compiles and runs
# InternedSelectorRepro.c against it.
#
# Usage:
#   ./run-c-repro.sh [gemstone-version]
#
# gemstone-version is optional and forwarded to `npm run test:server:start`
# (defaults to the oldest tracked release -- see gs-test-server.sh). Example:
#   ./run-c-repro.sh 3.7.5
#
# Works on macOS and Linux (the two platforms client/bin/gs-test-server.sh
# supports). Leaves the test stone running afterward -- this repo's other
# tests expect one to already be up, so this script doesn't tear it down.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
VERSION="${1:-}"

echo "==> Starting test stone${VERSION:+ (version $VERSION)}..."
declare -a start_args=()
if [[ -n "$VERSION" ]]; then
  start_args=(-- "$VERSION")
fi
(cd "$CLIENT_DIR" && npm run test:server:start "${start_args[@]}")

ENV_FILE="$CLIENT_DIR/.env.test"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: $ENV_FILE not found after test:server:start" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

: "${VITE_GEMSTONE_GCI_LIBRARY_PATH:?missing from $ENV_FILE}"
: "${VITE_GEMSTONE_STONE_NRS:?missing from $ENV_FILE}"
: "${VITE_GEMSTONE_GEM_NRS:?missing from $ENV_FILE}"
: "${VITE_GEMSTONE_USER:?missing from $ENV_FILE}"
: "${VITE_GEMSTONE_PASSWORD:?missing from $ENV_FILE}"
: "${VITE_GEMSTONE_GLOBAL_DIR:?missing from $ENV_FILE}"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
BIN="$WORK_DIR/gci_repro"

# dlopen/dlsym live in libSystem on macOS (no separate libdl, and `-ldl` fails
# to link there); glibc needs `-ldl` explicitly.
EXTRA_LIBS=()
if [[ "$(uname -s)" == "Linux" ]]; then
  EXTRA_LIBS=(-ldl)
fi

echo "==> Compiling InternedSelectorRepro.c..."
cc -o "$BIN" "$SCRIPT_DIR/InternedSelectorRepro.c" "${EXTRA_LIBS[@]}"

echo "==> Running repro against the live stone..."
echo
GEMSTONE_GLOBAL_DIR="$VITE_GEMSTONE_GLOBAL_DIR" \
  "$BIN" \
  "$VITE_GEMSTONE_GCI_LIBRARY_PATH" \
  "$VITE_GEMSTONE_STONE_NRS" \
  "$VITE_GEMSTONE_GEM_NRS" \
  "$VITE_GEMSTONE_USER" \
  "$VITE_GEMSTONE_PASSWORD"
