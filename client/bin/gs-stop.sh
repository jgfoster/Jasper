#!/usr/bin/env bash
set -euo pipefail

# Usage: ./gs-stop.sh <version> <name>
#
# Stops the NetLDI and Stone for the given instance. Safe to call even if
# neither process is currently running.
#
# Arguments:
#   version   GemStone version (e.g. 3.7.5)
#   name      Instance name used when the stone was started

# shellcheck disable=SC2034
# This variable is read by gs-config.sh when sourced below
VERSION="${1:?Usage: $0 <version> <name>}"
# shellcheck disable=SC2034
# This variable is read by gs-config.sh when sourced below
NAME="${2:?Usage: $0 <version> <name>}"

# shellcheck source=gs-config.sh
source "$(dirname "$0")/gs-config.sh"

gs_require_install

# || true: the process may already be stopped; that is not an error here.
stopnetldi "$LDI_NAME" || true

# Pass the password via stdin rather than as a positional argument: passing it
# on the command line would expose it in `ps aux` / /proc/<pid>/cmdline for the
# lifetime of the process. stopstone prompts for the password when it is omitted,
# and that prompt reads from stdin, so piping works without any process-table exposure.
echo "$GS_PASSWORD" | stopstone "$STONE_NAME" "$GS_USERNAME" -i || true
