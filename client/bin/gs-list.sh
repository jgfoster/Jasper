#!/usr/bin/env bash
set -euo pipefail

# Usage: ./gs-list.sh <version>
#
# Lists all running GemStone processes for the given installation.
#
# Arguments:
#   version   GemStone version to inspect (e.g. 3.7.5)

# shellcheck disable=SC2034
# This variable is read by gs-config.sh when sourced below
VERSION="${1:?Usage: $0 <version>}"

# shellcheck source=gs-config.sh
source "$(dirname "$0")/gs-config.sh"

gs_require_install

gslist -v
