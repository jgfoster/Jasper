#!/usr/bin/env bash
#
# Launch the extension in a fresh, isolated editor window — none of your
# personal settings, extensions, or login keychain. Loads Jasper from this
# working copy (whatever branch is checked out).
#
# Usage:
#   npm run dev:fresh                 # empty throwaway workspace
#   npm run dev:fresh -- /path/to/dir # open a specific folder
#
# For live reload, run `npm run watch` in another terminal, then reload the
# dev window (Cmd+R / "Developer: Reload Window") after edits.
set -euo pipefail

cd "$(dirname "$0")/.."

# Pick an editor CLI: VSCodium, then VS Code (and their Insiders builds).
EDITOR_CLI=""
for c in codium code codium-insiders code-insiders; do
  if command -v "$c" >/dev/null 2>&1; then EDITOR_CLI="$c"; break; fi
done
if [ -z "$EDITOR_CLI" ]; then
  echo "No editor CLI (codium/code) on PATH." >&2
  echo "In VS Code/VSCodium: Cmd+Shift+P -> 'Shell Command: Install ... command in PATH'." >&2
  exit 1
fi

# Build the extension if it isn't compiled yet (skip when using `npm run watch`).
if [ ! -f client/out/extension.js ]; then
  echo "client/out not built - compiling (use 'npm run watch' for live reload)..."
  npm run compile:client
fi

PROFILE="$(mktemp -d "${TMPDIR:-/tmp}/jasper-dev.XXXXXX")"
WORKSPACE="${1:-$(mktemp -d "${TMPDIR:-/tmp}/jasper-ws.XXXXXX")}"

echo "Launching $EDITOR_CLI with a fresh profile:"
echo "  extension : $PWD (branch $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?'))"
echo "  profile   : $PROFILE   (throwaway - no personal settings/extensions/keychain)"
echo "  workspace : $WORKSPACE"

exec "$EDITOR_CLI" \
  --extensionDevelopmentPath="$PWD" \
  --user-data-dir="$PROFILE/user-data" \
  --extensions-dir="$PROFILE/extensions" \
  --password-store=basic \
  --disable-workspace-trust \
  --new-window \
  "$WORKSPACE"
