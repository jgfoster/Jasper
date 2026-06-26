# gs-config.sh — shared configuration sourced by all gs-*.sh scripts.
#
# Requires VERSION to be set before sourcing. NAME is optional; when set,
# STONE_NAME and LDI_NAME are derived from it.
#
# After sourcing, the following variables are available:
#   DOWNLOAD_URL        — full URL to download the archive
#   ARCHIVE             — full local path to the downloaded archive file
#   INSTALL_DIR         — root of all GemStone installations (tmp/gemstone/)
#   GCI_LIBRARY_PATH    — path to the GCI shared library (.so / .dylib)
#   GEMSTONE            — installation directory for this version; required by GemStone tools (exported)
#   GEMSTONE_DATA_DIR   — database data directory (extent files)
#   GEMSTONE_GLOBAL_DIR — shared locks and log directory (exported)
#   PATH                — prepended with this version's bin/ directory (exported)
#   GS_USERNAME         — admin account used to stop the stone (default: DataCurator)
#   GS_PASSWORD         — password for GS_USERNAME (default: swordfish)
#   STONE_NAME          — stone process name, e.g. jasper-test-3.7.5-gs64-stone (if NAME set)
#   LDI_NAME            — NetLDI process name, e.g. jasper-test-3.7.5-gs64-ldi  (if NAME set)
#   GS_SCRIPTS_DIR      — absolute path to the directory containing these scripts

# --- Platform ---

GS_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

OS="$(uname -s)"
# Normalize aarch64 → arm64: uname -m returns aarch64 on Linux and arm64 on
# macOS for the same architecture; GemStone uses arm64 in its archive names.
arch="$(uname -m)"
if [[ "$arch" = "aarch64" ]]; then
  arch="arm64"
fi

case "$OS" in
  Linux)
    platform="${arch}.Linux"
    FILENAME="GemStone64Bit${VERSION}-${platform}.zip"
    gci_library_extension="so"
    ;;
  Darwin)
    if [[ "$arch" != "arm64" ]]; then
      echo "Unsupported architecture: ${arch}. Only arm64 (Apple Silicon) is supported on Darwin." >&2
      exit 1
    fi
    platform="arm64.Darwin"
    FILENAME="GemStone64Bit${VERSION}-${platform}.dmg"
    gci_library_extension="dylib"
    ;;
  *)
    echo "Unsupported OS: $OS" >&2
    exit 1
    ;;
esac

# --- Paths ---

DOWNLOAD_DIR="$(pwd)/tmp/downloads"
INSTALL_DIR="$(pwd)/tmp/gemstone"
mkdir -p "$DOWNLOAD_DIR" "$INSTALL_DIR"

DOWNLOAD_URL="https://downloads.gemtalksystems.com/pub/GemStone64/${VERSION}/${FILENAME}"
ARCHIVE="${DOWNLOAD_DIR}/${FILENAME}"

export GEMSTONE="${INSTALL_DIR}/GemStone64Bit${VERSION}-${platform}"
GEMSTONE_DATA_DIR="${GEMSTONE}/data"
export GEMSTONE_GLOBAL_DIR="${GEMSTONE}/global"
export PATH="${GEMSTONE}/bin:${PATH}"
GCI_LIBRARY_PATH="${GEMSTONE}/lib/libgcits-${VERSION}-64.${gci_library_extension}"

# --- Functions ---

# Call this at the start of any script that requires GemStone to be installed.
gs_require_install() {
  if [[ ! -d "$GEMSTONE" ]]; then
    echo "GemStone ${VERSION} is not installed (expected: ${GEMSTONE})" >&2
    exit 1
  fi
}

# --- Credentials ---

# GemStone's factory-installed default admin account and password.
GS_USERNAME="${GS_USERNAME:-DataCurator}"
GS_PASSWORD="${GS_PASSWORD:-swordfish}"

# --- Instance ---

if [[ -n "${NAME:-}" ]]; then
  STONE_NAME="${NAME}-${VERSION}-gs64-stone"
  LDI_NAME="${NAME}-${VERSION}-gs64-ldi"
fi

