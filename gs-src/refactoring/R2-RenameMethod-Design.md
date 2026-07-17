# R2 — Rename method / selector: design (Task 0 output)

Working design doc for the R2 refactoring (rename a method / selector, incl.
keyword selectors with part-rename and argument reorder). Lives here for the
duration of the R2 work; it records what Task 0 established empirically so the
later tasks don't re-derive it. R1 (rename instance variable) is the shipped
precedent this mirrors.

Status: **Tasks 0–4 complete.** Engine + client built and validated; test suite
green (see Task 4 below). Findings below are empirical unless marked otherwise.

### Task 4 result (tests)

- **Engine GS SUnit** — `GsRenameMethodRefactoringTest` (15 tests): keyword
  rename+reorder (signature + call sites), unary, binary, comment-spelling
  safety, super-send, cascade, #class/#hierarchy/#wholeSystem scope +
  out-of-scope counts, methodRename-vs-methodRecompile staging, previewJsonString,
  byte-bounded pagination (offsets/done), server-side apply (compile-new/
  remove-old), apply honouring a deselection, and no-commit. **Green on 3.6.2 AND
  3.7.5** (run in-stone; 43 green with the 3 existing engine suites).
- **Client unit** (vitest): `renameMethodPreview` (18 — parse start/page/apply,
  selectors, validation, permutation, arg-names), `renameMethodEditor` (6 —
  reorder/live-selector/confirm), `renameMethodPanelHtml` (8 — removed/added
  markers, banner, skipped list, pager), `renameMethodPanel` (5 — deselect
  tracking, page append, apply/more messaging).
- **Automatic GCI integration** (`refactoringMethod.integration.test.ts`, 5):
  engine availability; runs ALL engine GS SUnit suites in-stone with zero
  failures (one in-image file-in + run — robust on 3.6.x); the rename-method
  suite's own count; a full client round trip (start → paged preview → server
  apply → stone reshaped); and pagination + honouring a deselected change.
  **5/5, reliably (no flakiness) on the 3.6.2 test stone.**
- **Test infra**: `build-refactoring.sh` also builds `engine-tests.gs` (into
  UserGlobals so a non-SystemUser can file it in); it is excluded from the .vsix
  (`.vscodeignore`) — test-only.

Not caused by R2, still failing on the 3.6.2 stone (pre-existing, documented
3.6.x GCI compiler-state / Unicode-comparison quirk — the H-stage "harden
refactoring.integration" follow-up): R1's `refactoring.integration` (×3) and
`gciLibrary` name-resolution (×1); on-demand GCI ~41 failures (under the ~45
baseline). Verified identical before/after R2.

Two 3.6.x traps fixed in the engine while writing these tests: apply/dictionary
comparisons now use `asSymbol` (a string literal is Unicode on 3.6.x and
comparing it to a byte string raises); test payload files into UserGlobals (a
non-SystemUser can't write the SystemUser-owned GsRefactoring dict).

### Task 1 result (engine)

Implemented in `gs-src/refactoring/`:
- `GsRenameMethodRefactoring` — the refactoring (signature rewrite + send
  rewrite, permutation, scope, change-set staging).
- `GsRefactoringEnvironment >> implementorsOf:` / `sendersOf:` (ClassOrganizer
  reflection, same as the client's queries).
- `methodRename` change kind on `GsRefactoringChange` / `GsRefactoringChangeSet`
  (server side pulled forward from Task 2, since the engine can't stage
  implementor changes without it; the TS parser + apply-ordering remain Task 2).

**Send-site rewrite recipe (validated):** neither `RBMessageNode>>renameSelector:
andArguments:` alone nor `RBParseTreeRewriter` registers replacements, so both
reflow. The working recipe (proven byte-exact): **mutate the message node AND
register `RBStringReplacement`s** for the keyword-token spans + (reordered)
argument spans, then `newSource` — its self-consistency check (reparsed tree must
equal the mutated AST) passes because we mutated, and the splice is minimal.

**Validated on 3.6.2** (fixtures created, exercised, then removed + committed):
keyword rename + arg reorder (`rmFrobFrom:to:` → `rmFrobTo:from:`), unary rename
(empty permutation), senders rewritten, **selector spelling inside comments left
untouched**, `#class` scope narrowing with correct out-of-scope counts, all
minimal-diff. The engine is currently loaded on the `jasper-test-3.6.2` stone.

Not yet covered (deferred to Task 4 SUnit): binary selectors, super-sends,
cascades, new-name collisions, `#hierarchy`/`#dictionary` scope, 3.7.5.

### Task 2 + Task 3 result (client)

- `renameMethodPreview.ts` — pure model: parse the combined `{changes,outOfScope}`
  envelope, order implementors-first, plan apply (rename = compile-new +
  delete-old, with a guard so a pure arg-reorder that keeps the same selector is
  recompiled in place, NOT deleted), selector-part split/validate,
  permutation-from-row-order, best-effort arg-name parse. (21 unit tests.)
- `queries/previewRenameMethod.ts` — one-round-trip query returning the combined
  envelope, with a scope argument.
- `renameMethodEditor.ts` + `…Html.ts` + `…View.js` — the keyword-part editor:
  one row per part pairing editable keyword + its argument, ▲/▼ reorder as a unit,
  live selector preview, scope dropdown. (6 jsdom tests.)
- `renameMethodPanel.ts` + `…Html.ts` — preview panel: implementor/sender
  grouping + out-of-scope warning banner; REUSES `renameInstVarPanelView.js`.
- Explorer wiring: `renameMethod` command + `applyMethodRename`; command/menu in
  `package.json` (inline pencil on method rows); `renameMethodEditorView.js`
  whitelisted in `.vscodeignore`.

Scope is chosen in the editor (default Hierarchy) for this first version; making
it a **live control inside the preview** (re-query on change) is the intended
follow-up.

### Pagination + server-side apply (large renames)

A whole-system rename of a common selector (e.g. `+` = 18 implementors, 2329
senders, ~3.2 MB of change JSON) must still work — refusing it defeats the
automation value. So the preview is **paginated** and the apply is
**server-side**:

- **Start** (`startPreviewToken:maxBytes:`) builds the change set once and stashes
  the refactoring in `SessionTemps` under a client-generated token (transient,
  per-session, never committed). It returns totals + warnings + the first page.
- **Pages** (`pageForToken:from:maxBytes:`) are **byte-bounded** (~200 KB, always
  at least one change) so every fetch fits the GCI buffer regardless of method
  sizes; the client fetches with a 1 MB buffer for headroom. The panel shows
  **More** / **Load all**, appending pages.
- **Apply** (`applyForToken:deselected:`) compiles-new/removes-old for every
  staged change EXCEPT the deselected ids, server-side, in ONE round trip, NO
  commit. So the user need not load every page to apply, and applying thousands
  is fast. R1 apply stays client-side; only R2 moved server-side (Eric approved).
- **Robustness**: a method the vendored AST can't parse is skipped and counted
  (`skipped`), with the skipped list shown behind a "Show" link — one bad method
  never aborts the whole preview.
- **Cleanup**: the token is dropped from `SessionTemps` on apply/cancel/close.

Root causes fixed along the way: `baseClassOf:` used Pharo's `instanceClass` on a
metaclass (GemStone uses `thisClass`); the 256 KB GCI fetch buffer silently
truncated any preview over ~150 methods (now paginated); the rename command was
fire-and-forget so errors vanished (now `.catch`-surfaced). Full `npm run compile` clean; new unit tests green. The 4 failing
client integration tests are **pre-existing** on the 3.6.2 test stone (identical
failures with these changes stashed) — a GCI compiler quirk that also breaks R1's
own integration test there.

**F5 prerequisite:** the connected stone must have TODAY's rebuilt engine (with
`GsRenameMethodRefactoring`). The availability probe keys on R1's class, so a
stone with only the older engine reports "available" and the command proceeds,
then errors at preview. Reload the engine (topaz `LOADING.md` path, or the
Install Server Support command) before F5. Prefer a 3.7.5 stone — the current
3.6.2 test stone exhibits the pre-existing GCI preview-query quirk above.

---

## 1. Goal & the UX we're chasing

Rename a selector — unary, binary, or keyword — across its implementors and
senders, previewing every change before applying, recompiling only the selected
changes, **never committing** (the user commits). The hard part is keyword
selectors: the user wants one smooth gesture that covers

- renaming the whole selector,
- renaming **part** of a keyword (`at:put:` → `at:insert:`),
- **reordering** arguments (`copyFrom:to:` → `copyTo:from:`).

### Prior art to beat (read the actual source, not guessed)

- **Jadeite (for Pharo)** — `JadeiteBrowserPresenter>>renameClass` →
  `JadeiteRenameClassMethodListBrowser`. It has **rename-class only, no
  rename-method**, and its preview is a naive text substitution:
  `selection source copyReplaceAll: oldName with: newName`
  (`JadeiteRenameClassMethodListPresenter>>showComparison`). A blunt string
  replace has no idea whether an occurrence is a real reference, a **comment**,
  or a **string literal** — exactly the failure mode Eric flagged. R2 must be
  AST-based so it changes symbol references only.

- **Pharo's "Method name editor" GUI** — the specific UX Eric called out as bad
  (source read from the Pharo 13 stable image: `StMethodNameEditorPresenter`,
  `RBChangeMethodNameRefactoring`, `ReRenameMethodDriver`,
  `SycRenameMessageCommand`). The dialog (for e.g. `inject:into:`) has:
  - a **free-text Selector box** (`inject:into:`) **and** a **separate
    Arguments list** (`thisValue`, `binaryBlock`) with **Up / Dn** buttons —
    keyword parts and their arguments live in *different widgets*; the
    keyword↔argument pairing is positional and implicit, and you reorder args
    with Up/Dn rather than moving the keyword+arg together.
  - Editing the selector as free text invites **colon-count/arity mistakes** →
    a validate-reject-**retry loop** (`ReRenameMethodDriver>>runRefactoring`
    loops on `failedApplicabilityPreconditions`, popping error dialogs).
  - Argument names **depend on where rename was invoked** — a candid comment in
    `requestNewMessage` admits *"when the user selected a call site the
    arguments make no sense"*, so it substitutes an implementor's arg names.
  - **Modal, no impact preview** — no sender list, no scope, no out-of-scope
    view; override/breaking-change detection is a *separate* later dialog.

**Our win:** one editor with reorderable **keyword-part rows that pair the
editable keyword text WITH its argument**, so rename-a-part and swap-order are
the *same* gesture (drag the row) and the pairing is never ambiguous — no
free-text whole-selector box to get out of sync, no separate Up/Dn args list.
Plus a live preview with sender grouping + scope + out-of-scope warning instead
of a blind modal.

### Confirmed from Pharo source (validates our engine plan)

- **Permutation semantics match our model exactly:**
  `parseTree renameSelector: newSel andArguments: (permutation collect: [:i |
  oldArgs at: i])` — i.e. `permutation at: newIndex = oldArgIndex`. Derive it
  from the row order.
- Pharo uses the **same `renameSelector:andArguments:` primitive** we probed,
  plus a parse-tree rewriter for senders
  (`RBReplaceMessageSendTransformation … permutation:`).
- **Rename is arity-preserving** (`selectorsHaveSameArity`). Add/remove argument
  are *separate* refactorings (`RBAddParameterRefactoring` /
  `RBRemoveParameterRefactoring`). **So R2 = rename-parts + reorder +
  rename-args at fixed arity; changing arity is future catalog work.**
- Pharo has **package-scoped** rename (`searchInPackages:`), validating our
  Dictionary/scope direction. Override collisions are surfaced as
  breaking-change preconditions (`doesNotOverrideExistingMethodPrecondition`) —
  aligns with our always-on out-of-scope / collision warning.

---

## 2. Formatter & rewrite findings (the core technical result)

The vendored RowanV3 RB has **two** source-generation paths. Which one we use
decides whether a rename is a tidy one-line diff or a whole-method reflow.

### `formattedCode` — reflows (avoid for R2)
Reparses and reprints the whole method: inserts blank lines after a method
comment, respaces (`^x` → `^ x`), and **relocates comments** (a standalone
inline comment jumps onto the previous statement's line). Comment *text*
survives (comments are stored as intervals into the original source and copied
verbatim), but placement/whitespace do not. **R1 currently uses this path.**

### `newSource` + `RBStringReplacement` — minimal diff (use for R2)
`RBMethodNode>>newSource`/`reformatSource`: when the tree has `replacements`
(a collection of `RBStringReplacement replaceFrom:to:with:`), it **splices them
into the original source string** and leaves every other byte untouched, then
**re-parses the result and asserts the tree is unchanged**, falling back to
`formattedCode` only if the splice would be unsafe. This is Pharo's real
refactoring path and it is already present in the vendored code — **no fork.**

### Proven on the stone (3.6.2)

- **Signature rename** via `RBMethodNode>>renameSelector:andArguments:`
  (`at:put:` → `set:to:`) → diff was **exactly one line**; the method comment and
  body were byte-for-byte identical. It registers `RBStringReplacement`s via
  `changeSourceSelectors:arguments:`, so `newSource` gives a minimal diff. ✅
- **Send-site rename** via `RBMessageNode>>renameSelector:andArguments:`
  (`copyFrom: 1 to: 5` → `copyTo: 5 from: 1`) → renamed correctly **and the arg
  reorder worked**, but it **reflowed**, because the message-node method mutates
  `selector`/`arguments` **without registering a replacement**, so `newSource`
  fell back to `formattedCode`. ⚠️

### Consequence for the engine
- **Comment/string safety:** guaranteed — the rewrite touches AST message nodes;
  a selector spelling inside a comment or string literal is never a send node.
  With the minimal-diff path, not just comment text but comment *placement* and
  all surrounding whitespace stay byte-identical.
- **Senders need explicit replacements.** To get minimal-diff on send sites (the
  bulk of R2), the engine must register `RBStringReplacement`s for the message
  node's keyword-token spans + reordered argument source spans — the same
  mechanism `changeSourceSelectors:arguments:` uses for signatures, applied to
  sends. This is small, **additive** code over vendored RB, not a modification.
  **Task 1, try first:** let `RBParseTreeRewriter` register those replacements
  (how Pharo rewrites senders); hand-roll the spans only if it doesn't.
- **Possible R1 follow-up:** back-port the minimal-diff path to R1 so ivar
  renames stop reformatting whole methods. Non-blocking.

---

## 3. Scope model

Scope governs the **set of methods searched** for implementors and senders — not
receiver-type analysis (Smalltalk is dynamically typed; we cannot know a
receiver's class, so a narrow scope can miss a real sender). Ship set:

- **Class** — implementors = this class; senders = sends in this class's methods.
- **Hierarchy** — this class + sub/superclasses implementing it; senders across
  the hierarchy's methods. *(Default.)*
- **Dictionary** — a single `SymbolDictionary` (the native GemStone grouping the
  engine already walks; the honest analog of "package").
- **Whole system** — all implementors + all senders (true RB semantics).

Deferred: Rowan **Package** (only if it earns its place — the engine stays
Rowan-free; if added, the *client* resolves package → class set and passes that
set to the engine). Rejected: method/class **category** (too granular).

**Out-of-scope warning — always on.** Whatever scope is chosen, the preview
counts and reports implementors/senders that exist *outside* it
("12 senders outside the chosen scope will NOT be changed"). This is the safety
net that makes narrow scopes usable without silently breaking callers.

Implementors/senders come from GemStone's built-in reflection (`implementorsOf:`
/ `sendersOf:`, already wrapped client-side in `queries/methodSearch.ts`) — no
new discovery algorithm, mirroring how R1 reused `instVarsAccessed`.

---

## 4. Interaction flow (no modal scope prompt)

1. Rename pencil on a **method** node in the Explorer → the **keyword-part
   editor**: one editable row per keyword part, each showing its argument;
   rows are reorderable. Editing a row renames that part; dragging reorders the
   args. Stays focused purely on *what* the new selector is.
2. **Preview panel** opens with a sensible **default scope** (Hierarchy) already
   applied, so the affected implementors/senders and the out-of-scope count are
   visible immediately, grouped implementors-vs-senders.
3. **Scope is a live control inside the preview** (Class · Hierarchy · Dictionary
   · Whole system). Changing it re-computes the preview in place — same
   round-trip-to-stone pattern the existing preview uses. Scope lives next to the
   out-of-scope warning because that warning is how you judge whether the scope
   is right.
4. Selective apply → recompile the selected changes, **no commit**. Gated by the
   existing `rbSupportAvailable` probe.

---

## 5. Edge-case policy (to finalize as Task 1 encounters them)

- `#selector` **symbol literals** and `perform:`/`perform:with:` sends carry the
  selector as data, not as a send node → **flag-but-skip with a warning**
  (surfaced in the preview), never silently rewritten. Distinct from comments.
- **super-sends** and **cascades** → rewrite (real sends).
- **Collision:** new selector already implemented on an involved class →
  warn/skip; apply-ordering must be collision-safe.
- Comments and string literals → never touched (structural guarantee above).

---

## 6. Change-set impact

Today `GsRefactoringChangeSet` has `methodRecompile` + `classDefinitionEdit`.
R2 adds a **`methodRename`** kind for implementors (apply = compile-new-selector
method, then remove old-selector method). **Senders stay plain
`methodRecompile`** (their own selector is unchanged; only a send expression in
the body changes). Extend: the Smalltalk JSON serializer, the TS `RenameChange`
type/parser, and a collision-safe apply-ordering rule (implementors before/with
senders).

---

## 7. Task plan (post-Task-0)

- **Task 1 — Engine:** `GsRenameMethodRefactoring` (mirror
  `GsRenameInstanceVariableRefactoring`); implementors/senders from base
  reflection; scope-aware affected set + out-of-scope counts; sender +
  implementor-pattern rewrite on the **minimal-diff replacement path**.
- **Task 2 — Change-set:** `methodRename` kind; JSON + TS parser; ordering.
- **Task 3 — Client:** `queries/previewRenameMethod.ts`; `renameMethodPreview.ts`
  helpers; preview webview (implementor/sender grouping, live scope control,
  out-of-scope warning); Explorer keyword-part editor + wiring; `rbSupportAvailable`
  gate.
- **Task 4 — Tests:** SUnit engine (unary/binary/keyword incl. rename-part &
  reorder-args; senders/super/cascade/collision) green on **3.7.5 + 3.6.2**;
  **comment/literal-safety test** (old selector spelling in method comment,
  inline comment, string literal all byte-identical while the real send is
  renamed — doubles as a minimal-diff/formatter guard); client vitest for the
  query + preview helpers; guarded GCI round-trip; `npm run compile && npm test`;
  F5 walkthroughs.

---

## Appendix — environment notes

- The engine is **loaded/committed on the `jasper-test-3.6.2` test stone** (was
  clean before Task 0), loaded via the `LOADING.md` topaz path as SystemUser.
- 3.6.x has the known MCP `execute_code` compiler bug (`ComStrmSetCursor`) on
  longer code; probes here were run via **topaz linked**, dumping strings to
  files with `GsFile` and diffing on the shell (`displayNl` also misbehaved for
  String in that session — use `GsFile`/`printNl`).
