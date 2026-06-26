#!/usr/bin/env bash
set -euo pipefail

# Usage: ./gs-install.sh <version>
#
# Downloads and installs GemStone/S 64 Bit into tmp/gemstone/. Both the
# downloaded archive and the extracted installation are cached: re-running
# this script when the installation already exists is a complete no-op.
#
# Arguments:
#   version   GemStone version to install (e.g. 3.7.5)
#
# Layout after install:
#   tmp/downloads/                        cached archives
#   tmp/gemstone/GemStone64Bit<v>-<p>/   installation

# shellcheck disable=SC2034
# This variable is read by gs-config.sh when sourced below
VERSION="${1:?Usage: $0 <version>}"

# shellcheck source=gs-config.sh
source "$(dirname "$0")/gs-config.sh"

if [[ -d "$GEMSTONE" ]]; then
  echo "Install directory already exists, skipping download and extraction."
else
  if [[ -f "${ARCHIVE}" ]]; then
    echo "Archive already exists, skipping download."
  else
    echo "Downloading GemStone/S 64 Bit ${FILENAME}..."
    curl -fL --progress-bar -o "${ARCHIVE}" "$DOWNLOAD_URL"
  fi
  
  echo "Extracting..."
  case "$OS" in
    Linux)
      unzip -q "${ARCHIVE}" -d "$INSTALL_DIR"
      ;;
    Darwin)
      mount_point="$(mktemp -d)"
      # Ensure the DMG is always detached and the temp mount point removed,
      # even if the copy step fails.
      trap 'hdiutil detach "$mount_point" -quiet 2>/dev/null || true; rm -rf "$mount_point"' EXIT
      hdiutil attach "${ARCHIVE}" -mountpoint "$mount_point" -quiet -nobrowse
      cp -r "${mount_point}/$(basename "$GEMSTONE")" "$INSTALL_DIR/"
      hdiutil detach "$mount_point" -quiet
      rm -rf "$mount_point"
      trap - EXIT
      ;;
  esac

  # GemStone expects these directories to exist at startup.
  mkdir -p "${GEMSTONE_GLOBAL_DIR}/locks" "${GEMSTONE_GLOBAL_DIR}/log"

  "${GS_SCRIPTS_DIR}/gs-reset-extent.sh" "$VERSION"
fi
