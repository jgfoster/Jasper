#!/usr/bin/env bash
set -euo pipefail

# Usage: ./gs-start.sh <version> <name>
#
# Starts a GemStone Stone and NetLDI process pair. The instance must not
# already be running — call gs-stop.sh first if it is. If either process
# fails to start, gs-stop.sh is called automatically to clean up.
#
# Arguments:
#   version   GemStone version to start (e.g. 3.7.5)
#   name      Instance name; Stone and NetLDI names are derived from it:
#               stone: <name>-<version>-gs64-stone
#               ldi:   <name>-<version>-gs64-ldi

VERSION="${1:?Usage: $0 <version> <name>}"
NAME="${2:?Usage: $0 <version> <name>}"

# shellcheck source=gs-config.sh
source "$(dirname "$0")/gs-config.sh"

gs_require_install

# Clean up stale lock files from any previously crashed servers.
gslist -c || true

stop_gemstone() {
  "$GS_SCRIPTS_DIR/gs-stop.sh" "$VERSION" "$NAME"
}

# Register cleanup before starting anything, so a startup failure always
# leaves the environment in a clean state.
trap stop_gemstone EXIT

echo "Starting Stone (${STONE_NAME})..."
startstone "$STONE_NAME"

echo "Starting NetLDI in guest mode (${LDI_NAME})..."
# -D keeps forked gems out of your home directory. Without it a gem's working
# directory is the child's home, so every RPC login drops a
# gemnetobject<hex>.log there and they accumulate silently. -D makes that
# directory the gem's cwd instead, so the logs land beside the rest of this
# instance's files, under the (gitignored) install tree.
GEM_LOG_DIR="$GEMSTONE_GLOBAL_DIR/log"
mkdir -p "$GEM_LOG_DIR"
startnetldi "$LDI_NAME" -g -D "$GEM_LOG_DIR"

# Both processes started successfully — no cleanup needed on exit.
trap - EXIT

echo "GemStone/S ${VERSION} is running."
echo "  Stone:  ${STONE_NAME}"
echo "  NetLDI: ${LDI_NAME}"
