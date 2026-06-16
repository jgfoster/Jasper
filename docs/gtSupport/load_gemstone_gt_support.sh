#!/bin/bash
#
#
# Loads GT remote support into a running plain-vanilla GemStone stone by
# filing in the pre-built .gs files from each project's src-gs/ directory.
# These files are bundled in the same directory as this script and do not
# require Rowan or $ROWAN_PROJECTS_HOME.
#
# Files are loaded in dependency order. Source paths are from git checkouts:
#   1. Announcements.gs            gt4gemstone/src-gs/Announcements.gs
#   2. RemoteServiceReplication.gs RemoteServiceReplication/src-gs/bootstrapRSR.gs
#   3. STON.gs                     gt4gemstone/src-gs/STON.gs
#   4. patch-gemstone.gs           gt4gemstone/src-gs/patch-gemstone.gs
#   5. gtoolkit-wireencoding.gs    gtoolkit-wireencoding/src-gs/gtoolkit-wireencoding.gs
#   6. gt4gemstone.gs              gt4gemstone/src-gs/gt4gemstone.gs
#   7. gtoolkit-remote.gs          gtoolkit-remote/src-gs/gtoolkit-remote.gs
#
# REQUIREMENTS:
#   $GEMSTONE     Path to the GemStone product directory
#   .topazini     Must exist in the current working directory (or use -I).
#                 It should contain the stone name, username, and password:
#                   set gemstone <stone-name>
#                   set username SystemUser
#                   set password swordfish
#   The stone must be running and accessible via netldi.
#   The seven .gs files listed above must already be present in the same
#   directory as this script.
#
# USAGE:
#   cd /path/to/stone/data/dir     # the directory containing .topazini
#   ./load_gemstone_gt_support.sh
#
#   Or specify the topazini path explicitly:
#   ./load_gemstone_gt_support.sh -I /path/to/.topazini

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOPAZINI=".topazini"

usage() {
    echo "Usage: $0 [-I topazini-path]"
    exit 1
}

while getopts "I:h" opt; do
    case $opt in
        I) TOPAZINI="$OPTARG" ;;
        h) usage ;;
        *) usage ;;
    esac
done

# Check prerequisites
if [ -z "$GEMSTONE" ]; then
    echo "Error: GEMSTONE is not set."
    exit 1
fi

if [ ! -f "$TOPAZINI" ]; then
    echo "Error: .topazini not found at: $TOPAZINI"
    echo "Run from the stone's data directory, or use -I to specify the path."
    exit 1
fi

missing=()
for f in Announcements.gs RemoteServiceReplication.gs STON.gs patch-gemstone.gs \
         gtoolkit-wireencoding.gs gt4gemstone.gs gtoolkit-remote.gs; do
    [ ! -f "$SCRIPT_DIR/$f" ] && missing+=("$f")
done

if [ ${#missing[@]} -gt 0 ]; then
    echo "Error: missing .gs files in $SCRIPT_DIR:"
    for f in "${missing[@]}"; do
        echo "  $f"
    done
    echo "Copy the missing files from the project src-gs/ directories."
    exit 1
fi

echo "Loading GT support into stone; see \`load_gemstone_gt_support.out\` for details..."

"$GEMSTONE/bin/topaz" -lq -I "$TOPAZINI" << EOF
output push load_gemstone_gt_support.out only 
errorcount
iferr 1 stk
iferr 2 exit 1
login
input $SCRIPT_DIR/Announcements.gs
input $SCRIPT_DIR/RemoteServiceReplication.gs
input $SCRIPT_DIR/STON.gs
input $SCRIPT_DIR/patch-gemstone.gs
input $SCRIPT_DIR/gtoolkit-wireencoding.gs
input $SCRIPT_DIR/gt4gemstone.gs
input $SCRIPT_DIR/gtoolkit-remote.gs
commit
logout
errorcount
output pop
errorcount
exit
EOF

echo "Done."
