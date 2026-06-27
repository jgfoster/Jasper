#!/usr/bin/env bash
set -euo pipefail

# Usage: ./gs-reset-extent.sh <version>
#
# Restores the extent to the pristine copy shipped with GemStone, discarding
# any data from previous runs. Called by gs-test-setup.sh before each test
# run so tests always start from a known, clean state.
#
# The stone must not be running when this script is called.
#
# Arguments:
#   version   GemStone version (e.g. 3.7.5)

# shellcheck disable=SC2034
VERSION="${1:?Usage: $0 <version>}"

# shellcheck source=gs-config.sh
source "$(dirname "$0")/gs-config.sh"

gs_require_install

# copydbf requires the destination not to exist.
rm -f "${GEMSTONE_DATA_DIR}/extent0.dbf"
copydbf "${GEMSTONE}/bin/extent0.dbf" "${GEMSTONE_DATA_DIR}/"
chmod 600 "${GEMSTONE_DATA_DIR}/extent0.dbf"
