#!/usr/bin/env bash
#
# Bring up a fresh Rowan-3 GemStone stone inside the container, then exec the
# given command (the test run) with the connection details in the environment.
# Guest-mode NetLDI means RPC logins need no host credentials, and a pristine
# extent each run keeps results repeatable.
set -euo pipefail

cd /app/client

export VERSION=3.7.5
export NAME=jasper-rowan
# shellcheck source=/dev/null
source bin/gs-config.sh   # exports GEMSTONE, GEMSTONE_GLOBAL_DIR, PATH; sets STONE_NAME, LDI_NAME, GCI_LIBRARY_PATH, GEMSTONE_DATA_DIR

mkdir -p "$GEMSTONE_DATA_DIR" "$GEMSTONE_GLOBAL_DIR/locks" "$GEMSTONE_GLOBAL_DIR/log"

# Start from a pristine Rowan-3 extent every run.
cp "$GEMSTONE/bin/extent0.rowan3.dbf" "$GEMSTONE_DATA_DIR/extent0.dbf"
chmod 600 "$GEMSTONE_DATA_DIR/extent0.dbf"

# A Rowan project load overflows the default 50 MB gem cache; give the RPC gems
# the 500 MB the seaside-rowan project declares. NetLDI passes GEMSTONE_EXE_CONF
# through to the gems it spawns.
mkdir -p /app/gemconf
printf 'GEM_TEMPOBJ_CACHE_SIZE = 500000;\n' > /app/gemconf/gem.conf
export GEMSTONE_EXE_CONF=/app/gemconf

# The stone and guest NetLDI must run as a non-root user (guest mode is refused
# as root). Hand the server files to pwuser and start everything as pwuser; the
# root VS Code process still connects fine over the guest-mode NetLDI socket.
chown -R pwuser "$GEMSTONE_DATA_DIR" "$GEMSTONE_GLOBAL_DIR" /app/gemconf

runuser -u pwuser -- env \
  GEMSTONE="$GEMSTONE" \
  PATH="$PATH" \
  GEMSTONE_GLOBAL_DIR="$GEMSTONE_GLOBAL_DIR" \
  GEMSTONE_EXE_CONF="$GEMSTONE_EXE_CONF" \
  bash -c '
    set -e
    gslist -c || true
    echo "Starting stone '"$STONE_NAME"'…"
    startstone "'"$STONE_NAME"'"
    echo "Starting guest NetLDI '"$LDI_NAME"'…"
    startnetldi "'"$LDI_NAME"'" -g
    gslist -clv || true
  '

# Hand the connection details to the test process. The Playwright fixture
# forwards the environment to the VS Code it launches, and the extension needs
# GEMSTONE_GLOBAL_DIR to resolve the stone through the GCI library.
export JASPER_STONE_NAME="$STONE_NAME"
export JASPER_LDI_NAME="$LDI_NAME"
export JASPER_GCI_LIBRARY_PATH="$GCI_LIBRARY_PATH"
export JASPER_GS_VERSION="$VERSION"

exec "$@"
