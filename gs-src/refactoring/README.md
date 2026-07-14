# Server-side refactoring engine

This directory holds the GemStone-side code that powers Jasper's refactoring
tools. It runs **inside a stone** and is driven from the VS Code client over GCI.
The first refactoring it ships is *rename instance variable* — reference-aware,
across all dictionaries, and non-committing (the user commits explicitly).

If you are new to this code, **start with the "How it loads" section below** — it
is the thing most people need first and the reason the directory is laid out the
way it is.

## Directory map

Everything about the engine lives under `gs-src/refactoring/`, except the one
*generated, shipped* artifact, which lives where the VSIX packages runtime assets:

```
gs-src/refactoring/
  README.md          ← you are here
  engine/            ← the engine: the source of truth (Smalltalk, Tonel format)
  tests/             ← in-stone SUnit tests for the engine
  vendor/            ← third-party AST library, vendored verbatim (do not edit)
    rowanv3-ast/
      PROVENANCE.md  ← where the vendored code came from + the one adaptation
      AST-Core/  AST-Kernel-Core/  AST-Tests-Core/
  build/             ← turns vendor/ into the shipped payload (see "How it loads")
    build-ast-payload.sh
    tonel-to-gs.js
    ast-provenance-header.gs

resources/refactoring/
  ast-core.gs        ← GENERATED payload (built from vendor/); ships in the VSIX
```

### Finding the code

The engine is written in **Tonel**, Pharo's one-class-per-file source format.
Each file is named `<ClassName>.class.st` and defines exactly the class named in
the filename, so the class list *is* the file list:

| File in `engine/` | Class it defines |
|---|---|
| `GsRefactoringEnvironment.class.st` | `GsRefactoringEnvironment` — read-only queries over the whole symbol list |
| `GsRefactoringChange.class.st` | `GsRefactoringChange` — one addressable change (a method recompile or class-definition edit) |
| `GsRefactoringChangeSet.class.st` | `GsRefactoringChangeSet` — a non-committing set of changes the client previews |
| `GsRenameInstanceVariableRefactoring.class.st` | `GsRenameInstanceVariableRefactoring` — the rename-ivar refactoring itself |

Each class carries a doc comment at the top of its file; read those for the
per-class detail this README deliberately keeps out.

## How it loads

Loading a working engine into a stone has **two independent pieces**. Understand
this and the rest of the directory makes sense.

### 1. The vendored AST substrate (the big one)

The engine parses and rewrites Smalltalk source with the Refactoring Browser AST
(`RBParser`, `RBParseTreeRewriter`, and friends). We do not reimplement that — we
**vendor** it under `vendor/rowanv3-ast/` as verbatim Tonel and load it as-is.

The target stones (down to 3.6.2) have **no runtime Tonel reader**, so the Tonel
cannot be filed in directly. Instead, a build step converts it to a single
topaz-chunk `.gs` file that any stone can file in:

```
vendor/rowanv3-ast/  ──(build/build-ast-payload.sh)──▶  resources/refactoring/ast-core.gs
   (verbatim Tonel)         converts + adapts                (generated; ships in VSIX)
```

- `build/build-ast-payload.sh` — run this whenever the vendored source changes.
  It copies the Tonel to a temp dir, applies **one** documented, behaviour-
  preserving adaptation (`Rowan globalNamed:` → `System myUserProfile symbolList
  objectNamed:`, so it loads on a stone without Rowan), then invokes the
  converter. It **fails** if the number of adaptation sites drifts, so a
  re-vendor that pulls in a new Rowan dependency is caught, not silently shipped.
- `build/tonel-to-gs.js` — the Tonel→`.gs` converter (topological class order,
  preserved comments, explicit class-side `initialize` doits that topaz file-in
  would otherwise skip).
- `build/ast-provenance-header.gs` — the attribution header prepended to the
  generated `.gs`.

The generated `ast-core.gs` is **checked in** (so the VSIX ships without a Node
build step) and must be regenerated and committed whenever `vendor/` changes.
Never hand-edit it. Filing it in requires a **SystemUser** session, because
`AST-Kernel-Core` adds methods to SystemUser-owned kernel classes.

### 2. The `Gs*` engine classes

The `engine/*.class.st` classes are the source of truth. They are loaded on top
of the AST substrate from step 1. There is not yet a client-side loader that
files the engine into a stone automatically — that arrives with the client
integration — so today the engine is loaded during development (see below).

## Developing and testing

Author Tonel in `engine/`; iterate against a live stone with the gemstone MCP
(`compile_class_definition` / `compile_method`) — no in-stone Tonel reader is
needed for that path. To run the engine and its tests against a stone, load the
AST substrate first, then the engine:

1. `GsFileIn` the built `resources/refactoring/ast-core.gs` under a **SystemUser**
   session (the kernel extensions require it).
2. Load the `engine/` classes (via MCP compile, or topaz).
3. Run the tests with `run_test_class` (or topaz):
   - `GsRefactoringEnvironmentTest`
   - `GsRefactoringChangeSetTest`
   - `GsRenameInstanceVariableRefactoringTest`

Verified on GemStone 3.7.5. Cross-version (3.6.2) checks and the client GCI
round-trip arrive with the client integration.

## Naming

Classes use the `Gs` prefix (`GsRefactoringEnvironment`, etc.) to fit GemStone
base conventions — this code is meant to eventually live in the GemStone base and
be usable by clients other than Jasper. The prefix also avoids colliding with the
`RB*` AST classes of a Rowan stone, which the engine binds to in place (it never
shadows them) when they are already present.

## Provenance / licensing

- The `Gs*` engine classes in `engine/` are **original code** under the
  repository `LICENSE`.
- The AST substrate in `vendor/rowanv3-ast/` is **third-party**, vendored from
  RowanV3 3.7.5 (Pharo AST-Core, MIT). Its origin, the exact adaptation, and
  verification are documented in `vendor/rowanv3-ast/PROVENANCE.md`; attribution
  and license text are in the repo-root `THIRD-PARTY.md` and `NOTICE`.
