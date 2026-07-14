# Vendored AST substrate — provenance

This directory holds the **verbatim** Tonel source of the AST engine the Jasper
refactoring tools build on. It is vendored, not authored here.

## Origin

- **Upstream:** Pharo `AST-Core` — the Refactoring Browser abstract syntax tree
  and rewriter (`RBParser`, `RBParseTreeRewriter`, `RBParseTreeSearcher`,
  `RB*Node`/`RB*Token`, `RBScanner`, `RBSmallDictionary`, `RBConfigurableFormatter`).
  Originally authored by **John Brant and Don Roberts** (the Refactoring
  Browser), maintained by the Pharo project. Canonical public home (lineage
  reference, not the exact bytes we copied):
  <https://github.com/pharo-project/pharo/tree/v12.0.0/src/AST-Core>.
- **Intermediary / exact source (what we actually copied):** GemStone **RowanV3**,
  released **3.7.5** (Build `cf61017e`), from
  `<product>/projects/RowanV3/rowan/src/`, packages:
  - `AST-Core/` — 56 classes
  - `AST-Kernel-Core/` — 10 kernel-class extensions (`*.extension.st`)
  - `AST-Tests-Core/` — 4 test classes (the vendored AST's own tests)
- **License:** MIT — see the Pharo `LICENSE`
  (<https://github.com/pharo-project/pharo/blob/v12.0.0/LICENSE>). Full text and
  attribution: repo-root `THIRD-PARTY.md` and `NOTICE`.
- **No embedded notices:** every file here was scanned — the vendored Tonel
  carries **no per-file copyright, license, or author header** (nor does upstream
  `AST-Core`). Attribution therefore rests on the package-level Pharo `LICENSE`
  linked above, which is why we cite it. The Apple / Viewpoints Research /
  Inria copyright lines in that `LICENSE` cover Squeak-descended parts of the
  *whole Pharo image*, not the Refactoring Browser AST vendored here.

## Verbatim vs. adapted

The Tonel here is a **byte-for-byte copy** of the RowanV3 3.7.5 source, so it can
be diffed against upstream on re-vendor. **No file here is hand-edited.**

The one behaviour-preserving adaptation the engine needs to load on a bare,
non-Rowan stone is applied at *build* time by
`gs-src/refactoring/build/build-ast-payload.sh` (never to these files):

| Site | Change | Reason |
|------|--------|--------|
| `AST-Core/RBProgramNode.class.st` → `RBProgramNode class>>formatterClass` | `Rowan globalNamed: FormatterClass name` → `System myUserProfile symbolList objectNamed: FormatterClass name` | `Rowan` is undefined on a non-Rowan stone; a dead branch (`FormatterClass` defaults nil). Resolve the global via the session symbol list. |
| `AST-Tests-Core/RBFormatterTests.class.st` (×2) | same `Rowan globalNamed:` → `symbolList objectNamed:` | same; test-only. |

The build script **fails** if the number of `Rowan globalNamed:` sites differs
from the expected count, so a re-vendor that introduces a new Rowan coupling is
caught rather than silently shipped.

## Loader notes (see build-ast-payload.sh / tonel-to-gs.js)

- Filing the payload in requires a **SystemUser** session — `AST-Kernel-Core`
  adds methods to SystemUser-owned kernel classes.
- The generated `.gs` includes explicit class-side `initialize` doits for
  `RBScanner`, `RBPatternScanner`, and `RBConfigurableFormatter`; topaz file-in
  does not auto-run them (unlike a Pharo image load), and the scanner/formatter
  are unusable until it does.

## Verification

Filed into a bare 3.7.5 stone (no Rowan), all 84 `AST-Tests-Core` tests pass
(RBParserTest 42, RBProgramNodeTest 26, RBSmallDictionaryTest 13,
RBFormatterTests 3), and parse → rewrite → regenerate round-trips.
