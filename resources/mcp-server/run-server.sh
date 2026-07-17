#!/usr/bin/env bash
# Launch the native GemStone MCP server in a DEDICATED gem.
#
# The server runs as the gem's blocking main activity: forked GsProcesses only run
# while the gem is actively executing Smalltalk, so the accept loop must own the gem.
# This topaz session will block, serving requests, until the gem is terminated
# (Ctrl-C) or another session sends `aServer stop`.
#
# Configure (or export before running):
#   GEMSTONE   - GemStone product directory (required)
#   GS_STONE   - stone name      (default: gs64stone)
#   GS_USER    - GemStone user   (default: DataCurator)
#   GS_PASS    - GemStone password (default: swordfish)
#   GS_MCP_PORT- listen port      (default: 8000)
set -euo pipefail
cd "$(dirname "$0")"

: "${GEMSTONE:?Set GEMSTONE to your GemStone product directory}"
GS_STONE="${GS_STONE:-gs64stone}"
GS_USER="${GS_USER:-DataCurator}"
GS_PASS="${GS_PASS:-swordfish}"
GS_MCP_PORT="${GS_MCP_PORT:-8000}"
TOPAZ="$GEMSTONE/bin/topaz"

echo "Starting GsMcpServer on 127.0.0.1:$GS_MCP_PORT (Ctrl-C to stop)..."
"$TOPAZ" -l <<TPZ
set gemstone $GS_STONE
set username $GS_USER
set password $GS_PASS
login
iferr 1 stk
run
"Boot the most capable installed server: the Grail subclass if its file was loaded, else base."
((System myUserProfile objectNamed: #GsMcpServerWithGrail)
   ifNil: [GsMcpServer]
   ifNotNil: [:cls | cls]) runOnPort: $GS_MCP_PORT
%
logout
exit
TPZ
