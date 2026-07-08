#!/usr/bin/env bash
#
# Serve the loaded Seaside app in a detached GemStone gem (WAGsZincAdaptor runs
# a blocking listen loop, so it must live in its own process). Assumes Seaside +
# the hello-seaside-rowan project are already loaded in the stone.
#
# Usage:
#   npm run serve:seaside                 # start on port 8383, stone jasper-test-3.7.5-gs64-stone
#   npm run serve:seaside -- 9090         # start on a different port
#   npm run serve:seaside -- 8383 myStone # different port + stone
#   npm run serve:seaside -- stop         # stop the server on port 8383
#   npm run serve:seaside -- stop 9090    # stop the server on port 9090
#
# Override the install with GEMSTONE=/path/to/GemStone64Bit... and the
# SystemUser password with SYSTEMUSER_PW=... if your stone isn't stock.
set -euo pipefail

cd "$(dirname "$0")/.."

# --- stop mode ---
if [ "${1:-}" = "stop" ]; then
  PORT="${2:-8383}"
  if pkill -f "startOn: ${PORT}\b" 2>/dev/null; then
    echo "Stopped the Seaside server on port ${PORT}."
  else
    echo "No Seaside server found on port ${PORT}."
  fi
  exit 0
fi

PORT="${1:-8383}"
STONE="${2:-jasper-test-3.7.5-gs64-stone}"
GS="${GEMSTONE:-$PWD/client/tmp/gemstone/GemStone64Bit3.7.5-arm64.Darwin}"
PW="${SYSTEMUSER_PW:-swordfish}"

if [ ! -x "$GS/bin/topaz" ]; then
  echo "topaz not found under $GS. Set GEMSTONE=/path/to/GemStone64Bit... and retry." >&2
  exit 1
fi
export GEMSTONE="$GS" GEMSTONE_GLOBAL_DIR="$GS/global" DYLD_LIBRARY_PATH="$GS/lib" PATH="$GS/bin:$PATH"

URL="http://localhost:${PORT}/hello"

if curl -fs -m 2 "$URL" >/dev/null 2>&1; then
  echo "Already serving: ${URL}"
  exit 0
fi

echo "Starting Seaside server gem on port ${PORT} (stone ${STONE})..."
LOG="/tmp/seaside-${PORT}.log"
topaz -l >"$LOG" 2>&1 <<EOF &
set gemstone ${STONE}
set user SystemUser
set pass ${PW}
login
run
WAGsZincAdaptor startOn: ${PORT}.
%
EOF

for _ in $(seq 1 25); do
  sleep 1
  if curl -fs -m 3 "$URL" 2>/dev/null | grep -q "Hello World"; then
    echo "Serving: ${URL}"
    echo "  View it: VS Code/VSCodium -> Cmd+Shift+P -> 'Simple Browser: Show' -> ${URL}"
    echo "  Stop it: npm run serve:seaside -- stop ${PORT}"
    exit 0
  fi
done

echo "Server did not respond on ${URL}. Recent log (${LOG}):" >&2
grep -avE 'Info\]|^\| ' "$LOG" | tail -20 >&2
echo "(If /hello 404s, the hello-seaside-rowan project isn't loaded/committed in ${STONE}.)" >&2
exit 1
