# Server-side refactoring engine (grail #62)

GemStone-side code that powers Jasper's refactoring tools. It runs **in the
stone** and is driven from the client over GCI. The first shippable refactoring
is *rename instance variable* (senders/references-aware, across all
dictionaries, non-committing); the classes here are the foundation the later
stages build on.

## Layout

- `*.class.st` — the engine, one class per file, in **Tonel** format. **This is
  the source of truth.**
- `tests/*.class.st` — in-stone SUnit tests (layer (a), the primary correctness
  layer), same Tonel format.

Tonel is authored here and committed. A build-time Tonel→`.gs` converter (added
in a later stage) will emit a concatenated `.gs` payload under
`resources/refactoring/` for the client's `GsFileIn` installer — the 3.6.2 test
stone has no runtime `TonelParser`, so the shipped artifact is `.gs`. The `.gs`
is a generated build artifact, never hand-edited; the intent is to move to Tonel
exclusively once a Tonel reader is reliably present in target stones.

## Naming

Classes use the `Gs` prefix (`GsRefactoringEnvironment`, `GsRefactoringChange`,
`GsRefactoringChangeSet`) to fit GemStone base conventions — this code is
intended to eventually live in the GemStone base and be usable by clients other
than Jasper. The prefix also avoids colliding with a Rowan stone's own `RB*`
AST classes, which the engine binds to in place (never shadows) when present.

## Provenance / licensing

The `Gs*` engine classes here are **original code** under the repository
`LICENSE`. The AST substrate (`AST-Core`: `RBParser` / `RBParseTreeRewriter`) is
**vendored** under `vendor/rowanv3-ast/` (from RowanV3 3.7.5; Pharo MIT via the
Rowan port) with per-file provenance and a repo-root `THIRD-PARTY.md` / `NOTICE`.
See `vendor/rowanv3-ast/PROVENANCE.md` and the Stage 0 design note for the
attribution mechanism, and `../../docs/refactoringSupport/build-ast-payload.sh`
for the reproducible Tonel→`.gs` build (which re-applies the one documented
de-Rowan adaptation).

## What's here now

**Stage 1 — environment + change-set foundation**

- **`GsRefactoringEnvironment`** — read-only wrapper over the **whole symbol
  list (ALL dictionaries)**: class resolution/enumeration across dictionaries,
  and instance-variable access lookup across a class hierarchy via
  bytecode-level reflection (`GsNMethod>>instVarsAccessed`, no source parse).
- **`GsRefactoringChangeSet`** / **`GsRefactoringChange`** — a **non-committing**
  set of individually-addressable changes (method recompile or class-definition
  edit) carrying old/new source for before/after previews, with stable ids for
  per-change selection and JSON serialization for the client. Building a change
  set compiles and commits **nothing**.

**Stage 2 — AST substrate** — the vendored `vendor/rowanv3-ast/` closure
(`AST-Core` + `AST-Kernel-Core` extensions), which files into a bare non-Rowan
stone and provides `RBParser` / `RBParseTreeRewriter`.

**Stage 3 — rename instance variable**

- **`GsRenameInstanceVariableRefactoring`** — the first shippable refactoring.
  Finds the affected methods (defining class + subclasses) via the Stage-1
  environment, parses each with `RBParser`, and renames only the variable
  references that resolve to the instance variable — a **scope-aware** walk that
  leaves a same-named block argument (and the references it captures) alone. It
  also stages the class-definition edit (renamed `instVarNames`). Everything is
  staged into a `GsRefactoringChangeSet`; it compiles and commits **nothing**.
  Note: the rewriter's own `#replace:with:` is *not* used — it is scope-blind and
  would corrupt a shadowing argument.

Two binding invariants are enforced and tested throughout: **all dictionaries**
(not just UserGlobals) and **no automatic commit**.

## Dev loop

Author Tonel here; iterate against a live stone via the gemstone MCP
(`compile_class_definition` / `compile_method`) — no in-stone `TonelParser`
needed. Run the tests with `run_test_class` (or topaz):

- `GsRefactoringChangeSetTest`
- `GsRefactoringEnvironmentTest`
- `GsRenameInstanceVariableRefactoringTest`

The rename tests need the AST substrate filed in first (`GsFileIn` the built
`resources/refactoring/ast-core.gs` under a **SystemUser** session — the kernel
extensions require it), then the `Gs*` engine.

Verified on GemStone 3.7.5. Cross-version (3.6.2) verification and the client
GCI round-trip test land with the stages that add the client-facing query
entry points and the loader.
