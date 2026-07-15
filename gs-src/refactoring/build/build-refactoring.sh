#!/bin/bash
#
# Build the complete set of refactoring-engine payloads a stone files in.
#
# This is the top-level build: run it whenever anything under gs-src/refactoring/
# changes, and commit the regenerated resources/refactoring/*.gs alongside. It
# produces the ordered payloads GsRefactoringLoader files in:
#
#   ast-core.gs           vendored AST substrate (RB* parser/rewriter/nodes)
#                         -- delegated to build-ast-payload.sh, which applies and
#                            AUDITS the one documented de-Rowan adaptation.
#   compat.gs             kernel-method backports, emitted as per-method
#                         feature-detected doits (installed only where missing;
#                         never shadow a method the base release already has).
#   engine.gs             our Gs* environment / change-set / rename refactoring.
#   manifest.gs           expected classes + method counts for the loader's
#                         post-load completeness check.
#   refactoring-loader.gs the loader class itself (into UserGlobals: it is a
#                         load-time tool, so it stays out of the pure engine dict).
#
# All engine/AST classes are declared inDictionary: GsRefactoring; the loader
# creates that dedicated dictionary before the first file-in.
#
# Usage (from anywhere -- paths resolve relative to this script):
#   gs-src/refactoring/build/build-refactoring.sh
set -euo pipefail

REPO="$(CDPATH= cd -- "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BUILD="$REPO/gs-src/refactoring/build"
SRC="$REPO/gs-src/refactoring"
CONVERTER="$BUILD/tonel-to-gs.js"
OUT="$REPO/resources/refactoring"
DICT="GsRefactoring"

mkdir -p "$OUT"

echo "1/5 AST substrate -> ast-core.gs"
"$BUILD/build-ast-payload.sh" --dict "$DICT"

echo "2/5 compat backports (feature-detected) -> compat.gs"
node "$CONVERTER" --dict "$DICT" --feature-detect \
  --out "$OUT/compat.gs" "$SRC/compat/362"

echo "3/5 engine (Gs* classes) -> engine.gs"
node "$CONVERTER" --dict "$DICT" \
  --out "$OUT/engine.gs" "$SRC/engine"

echo "4/5 loader class -> refactoring-loader.gs (into UserGlobals)"
node "$CONVERTER" --dict "UserGlobals" \
  --out "$OUT/refactoring-loader.gs" "$SRC/loader"

echo "5/5 load manifest (expected classes + method counts) -> manifest.gs"
node "$CONVERTER" --dict "$DICT" --manifest "$OUT/manifest.gs" \
  "$SRC/vendor/rowanv3-ast/AST-Core" \
  "$SRC/vendor/rowanv3-ast/AST-Kernel-Core" \
  "$SRC/engine"

echo "Done. Payloads in $OUT:"
ls -1 "$OUT"
