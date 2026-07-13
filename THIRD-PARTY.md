# Third-party software

Jasper (`gemstone-ide`) is licensed under the MIT License (see `LICENSE`). It
also incorporates vendored third-party source, listed here with its origin and
license.

---

## Pharo AST-Core (Refactoring Browser AST)

- **What:** the abstract syntax tree, parser, scanner, and parse-tree rewriter
  used by the server-side refactoring engine — `RBParser`,
  `RBParseTreeRewriter`, `RBParseTreeSearcher`, `RB*Node`/`RB*Token`,
  `RBScanner`, `RBSmallDictionary`, `RBConfigurableFormatter`, and the
  `AST-Kernel-Core` kernel-class extensions.
- **Where in this repo:** `gs-src/refactoring/vendor/rowanv3-ast/` (verbatim
  Tonel); compiled into the shipped payload `resources/refactoring/ast-core.gs`
  by `docs/refactoringSupport/build-ast-payload.sh`.
- **Origin:** the Refactoring Browser, originally by John Brant and Don Roberts,
  as maintained in the Pharo project's `AST-Core` package.
- **Obtained via:** GemStone RowanV3, released 3.7.5 (Build `cf61017e`),
  `projects/RowanV3/rowan/src/` (packages `AST-Core`, `AST-Kernel-Core`,
  `AST-Tests-Core`).
- **License:** MIT.
- **Modifications:** verbatim except one behaviour-preserving adaptation applied
  at build time (`Rowan globalNamed:` → `System myUserProfile symbolList
  objectNamed:`) so the engine loads on a non-Rowan stone. Detailed in
  `gs-src/refactoring/vendor/rowanv3-ast/PROVENANCE.md`.

### MIT License

```
The MIT License (MIT)

Copyright (c) the Pharo project and the original Refactoring Browser authors
(John Brant, Don Roberts).

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

> Note: the exact upstream copyright line should be confirmed against the Pharo
> `AST-Core` package license before public release; the RowanV3 Tonel carries the
> original class comments but no per-file license header.
