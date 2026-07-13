#!/bin/bash
#
# Build the vendored AST substrate .gs payload for the refactoring engine
# (grail #62, Stage 2) from the verbatim Tonel under
# gs-src/refactoring/vendor/rowanv3-ast/.
#
# Pipeline: stage the verbatim Tonel to a temp dir, apply the documented
# adaptations (auditable, and FAILS if the expected count drifts -- so a
# re-vendor that introduces a new Rowan dependency is caught, not silently
# shipped), then run tonel-to-gs.js. The verbatim vendored Tonel is never
# edited; adaptations live here so they are reproducible and reviewable.
#
# Adaptations (verbatim -> adapted):
#   `Rowan globalNamed: X` -> `System myUserProfile symbolList objectNamed: X`
#   Reason: the vendored engine must load on a bare, non-Rowan stone; `Rowan`
#   is undefined there. Resolving the global via the session symbol list is
#   behaviour-preserving. Occurs once in AST-Core (RBProgramNode class>>
#   formatterClass, a dead branch) and twice in AST-Tests-Core (RBFormatterTests).
#
# Usage:
#   docs/refactoringSupport/build-ast-payload.sh [--dict DICT] [--tests-out PATH]
#
# Outputs:
#   resources/refactoring/ast-core.gs        (engine substrate; ships in VSIX)
#   <tests-out>/ast-tests.gs                 (only with --tests-out; dev/CI only,
#                                             not shipped)
set -euo pipefail

REPO="$(CDPATH= cd -- "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENDOR="$REPO/gs-src/refactoring/vendor/rowanv3-ast"
CONVERTER="$REPO/docs/refactoringSupport/tonel-to-gs.js"
HEADER="$REPO/docs/refactoringSupport/ast-provenance-header.gs"
OUT="$REPO/resources/refactoring"
DICT="UserGlobals"
TESTS_OUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dict) DICT="$2"; shift 2 ;;
    --tests-out) TESTS_OUT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -r "$VENDOR/AST-Core" "$VENDOR/AST-Kernel-Core" "$VENDOR/AST-Tests-Core" "$STAGE/"
chmod -R u+w "$STAGE"   # release-tree sources are read-only; the stage must be writable

# Apply + audit the de-Rowan adaptation. EXPECTED counts guard against drift.
apply_adaptations() {
  local dir="$1" expected="$2"
  python3 - "$dir" "$expected" <<'PY'
import sys, os, re
root, expected = sys.argv[1], int(sys.argv[2])
find = "Rowan globalNamed:"
repl = "System myUserProfile symbolList objectNamed:"
total = 0
for dp, _, files in os.walk(root):
    for f in files:
        if not (f.endswith('.class.st') or f.endswith('.extension.st')):
            continue
        p = os.path.join(dp, f)
        s = open(p).read()
        n = s.count(find)
        if n:
            open(p, 'w').write(s.replace(find, repl))
            for i, line in enumerate(s.splitlines(), 1):
                if find in line:
                    print(f"  adapt {os.path.relpath(p, root)}:{i}: Rowan globalNamed: -> symbolList objectNamed:")
            total += n
if total != expected:
    sys.exit(f"ERROR: expected {expected} 'Rowan globalNamed:' adaptation(s), found {total}. "
             "Upstream changed -- review before shipping.")
print(f"  ({total} adaptation(s) applied in {os.path.basename(root)})")
PY
}

echo "Adapting engine (AST-Core + AST-Kernel-Core)..."
apply_adaptations "$STAGE/AST-Core" 1
apply_adaptations "$STAGE/AST-Kernel-Core" 0

mkdir -p "$OUT"
node "$CONVERTER" --dict "$DICT" --header "$HEADER" \
  --out "$OUT/ast-core.gs" "$STAGE/AST-Core" "$STAGE/AST-Kernel-Core"

if [ -n "$TESTS_OUT" ]; then
  echo "Adapting tests (AST-Tests-Core)..."
  apply_adaptations "$STAGE/AST-Tests-Core" 2
  mkdir -p "$TESTS_OUT"
  node "$CONVERTER" --dict "$DICT" --header "$HEADER" \
    --out "$TESTS_OUT/ast-tests.gs" "$STAGE/AST-Tests-Core"
fi

echo "Done. Engine payload: $OUT/ast-core.gs"
