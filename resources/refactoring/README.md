# Refactoring engine payloads (generated — do not edit by hand)

These `*.gs` files are **generated build artifacts**, not source. They are the
concatenated payloads that `GsRefactoringLoader` files into a stone when the
refactoring engine is installed (the client hands this directory's path to the
stone, whose gem reads the files via `GsFileIn fromServerPath:`). They ship as
runtime assets in the VSIX, which is why they live under `resources/` alongside
the other shipped bundles (`resources/enhancedInspector/`, `resources/walkthrough/`, …).

**The source of truth is [`gs-src/refactoring/`](../../gs-src/refactoring/)** (GemStone
Smalltalk in Tonel format). Do not edit these `.gs` files directly — your change
will be overwritten. Instead edit the source and regenerate:

```sh
gs-src/refactoring/build/build-refactoring.sh
```

That rebuilds every payload here; commit the regenerated `*.gs` alongside the
`gs-src/refactoring/` source change.

## The payloads (filed in, in this order)

| File | What it is |
|---|---|
| `ast-core.gs` | Vendored Refactoring-Browser AST (`RBParser`, rewriter, nodes) |
| `compat.gs` | Kernel-method backports for older releases (feature-detected) |
| `engine.gs` | The `Gs*` engine classes (environment, change-set, the refactorings) |
| `manifest.gs` | Expected class list + per-class method counts (post-load check) |
| `engine-tests.gs` | In-stone SUnit tests for the engine |
| `refactoring-loader.gs` | `GsRefactoringLoader` — the load mechanism (filed in first) |
| `load-refactoring.gs` | Convenience bootstrap: file in the loader, then run it |

See [`gs-src/refactoring/README.md`](../../gs-src/refactoring/README.md) for the
directory layout and [`gs-src/refactoring/LOADING.md`](../../gs-src/refactoring/LOADING.md)
for the load runbook.
