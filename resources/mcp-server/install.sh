#!/usr/bin/env bash
# Install the native GemStone MCP server classes into the image.
# Logs in via topaz, ensures the Published dictionary exists, files in the base GsMcp*
# classes, and commits. Pass --grail (or set
# GS_MCP_WITH_GRAIL=1) to additionally load the optional Grail/Python tools -- only valid on
# an image that has GemStone-Python (Grail/ModuleAst).
#
# Configure these (or export before running):
#   GEMSTONE       - GemStone product directory (defaults to $GEMSTONE if set)
#   GS_STONE       - stone name              (default: gs64stone)
#   GS_USER        - GemStone user           (default: DataCurator)
#   GS_PASS        - GemStone password       (default: swordfish)
set -euo pipefail
cd "$(dirname "$0")"

: "${GEMSTONE:?Set GEMSTONE to your GemStone product directory}"
GS_STONE="${GS_STONE:-gs64stone}"
GS_USER="${GS_USER:-DataCurator}"
GS_PASS="${GS_PASS:-swordfish}"
TOPAZ="$GEMSTONE/bin/topaz"

# Base classes only by default; pass --grail (or set GS_MCP_WITH_GRAIL) to also load the
# optional GemStone-Python (Grail) tools -- only valid on an image that has Grail/ModuleAst.
LOAD_FILE="load.gs"
if [ "${1:-}" = "--grail" ] || [ -n "${GS_MCP_WITH_GRAIL:-}" ]; then
  LOAD_FILE="load-grail.gs"
fi

"$TOPAZ" -l <<TPZ
set gemstone $GS_STONE
set username $GS_USER
set password $GS_PASS
login
iferr 1 exit 1
run
"Ensure the Published dictionary exists (self-referenced + inserted into the symbol list) so
 the classes' 'inDictionary: Published' resolves during file-in. Create it only if absent --
 Published is standard in most images, so this is usually a no-op."
| up existing d |
up := System myUserProfile.
existing := up resolveSymbol: #Published.
existing isNil
  ifTrue: [
    d := SymbolDictionary new.
    d at: #Published put: d.
    up insertDictionary: d at: up symbolList size + 1.
    System commitTransaction.
    'Published created' ]
  ifFalse: [ 'Published already exists' ].
%
display oops
errorcount
output push load.out only
input $LOAD_FILE
errorcount
output pop
errorcount
commit
logout
exit
TPZ
echo "GsMcp* classes installed and committed (loaded: $LOAD_FILE)."
