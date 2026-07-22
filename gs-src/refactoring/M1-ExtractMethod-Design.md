# M1 — Extract method: design + TDD plan

Working design for **M1 (extract a selected run of statements — or a single
expression — into a new method, replacing the selection with a send)**. Read
`R5-RenameTempArg-Design.md` and `R4-RenameClassVariable-Design.md` first for the
family conventions — M1 **is** a stone-side `Gs…Refactoring` engine like R1–R5 and
reuses the same change-set / paginated-preview / token-apply / no-commit
machinery. But M1 is the **first non-rename** refactoring, and it is the first that
**creates a brand-new method** in addition to rewriting an existing one.

Status: **plan only.** TDD order below mirrors R1–R5: Task 3 encodes failing GS
SUnit, Task 4 implements the engine to green, Tasks 6–9 wire the client +
integration test + live verify.

> **Invariant — NO GemStone commits, ever.** Like every refactoring in this family,
> the M1 engine recompiles methods in the session but **never calls
> `System commitTransaction`** (nor abort). The refactored code sits as uncommitted
> session changes; committing (or aborting) is always the user's separate, explicit
> action. "No commit" throughout this doc means exactly this, and the SUnit asserts
> the transaction is untouched.

**UX decisions (Eric, 2026-07-21):**
1. **Full selector, auto-named args** — the user is prompted once for the complete
   new selector (unary or keyword). The variables the extracted code reads from
   outside the selection become the new method's arguments, **in source order,
   keeping their original names**. The keyword-part count must equal the number of
   arguments (validated client-side against a pre-flight arg count, and re-checked
   server-side).
2. **Own top-level editor context-menu item** — `gemstone.explorer.extractMethod`,
   NOT nested under the native "Refactor…" menu (unlike the R5 rename-at-cursor
   family). Selection-based: it reads the editor's selected text range.
3. **Collision scope = class + hierarchy, as a SOFT warning.** If the chosen
   selector is already implemented by the defining class, a superclass, or a
   subclass, the preview **warns** (possible override/shadow) but the user **may
   proceed** — it does not block Apply. (Contrast R5's collisions, which are hard
   declines.)
4. **Replace similar code in the hierarchy — opt-in checkbox, OFF by default**
   (Eric, 2026-07-21). When enabled, after building the extracted method the engine
   scans other methods in the **class + hierarchy** (same scope as the collision
   check) for statement runs **structurally equivalent** to the extracted selection
   and offers to replace each with a send to the new method. Each found duplicate
   is an **individually selectable** change in the preview (checkboxes — the user
   vets each match, since structural matching can surprise). The two core changes
   (the new method + the original's rewrite) stay mandatory. See §3.6.

---

## 1. What makes M1 different from the rename family

| Concern | R1–R5 (renames) | M1 (extract method) |
| --- | --- | --- |
| Methods changed | recompile existing method(s) | **rewrite one** (the source) **+ add one** (the extracted method) [**+ N similar sites** if the option is on] |
| New method created | never | **yes** — the whole point |
| Trigger | cursor / tree row | **editor text selection** (a source interval) |
| Variable analysis | rename one binding | **classify** the selection's variables into args / return / internal temps |
| Change kinds staged | `methodRecompile` (+ class-def / rename) | **`methodAdd` + `methodRecompile`** (+ one `methodRecompile` per replaced duplicate) |
| Deselection | R4/R5 all-or-nothing | **two core changes mandatory; duplicate replacements individually deselectable** |
| Preview panel | standard paginated, no checkboxes | **checkbox panel** (R2/R3 style): core changes shown always-on, duplicate replacements as vettable checkboxes |
| Server apply, no commit | yes | **yes** — compile both, never commit |
| 3.6.2 ↔ 3.7.5 SUnit boundary | applies | **applies** ([[feedback-rb-sunit-both-boundaries]]) |

So M1 = **one engine class + two staged changes (`methodAdd`, `methodRecompile`) +
a variable-flow analysis of the selection**, on the existing infra.

---

## 2. GemStone facts / substrate to reuse

1. **AST + source rewriting is R5's verbatim toolkit.** `RBParser parseMethod:`,
   node source intervals (`start`/`stop`), `tree bestNodeFor:`, `RBStringReplacement`
   and `tree newSource` (minimal-diff source edit that preserves formatting). R5's
   `scopeNode:declaresSym:` / `declaringScopeFor:` scope walk is reused to classify
   which referenced names are **locals declared outside the selection** (→ args) vs
   **locals declared inside** (→ internal temps).
2. **Statement/expression selection maps to AST nodes by interval.** The selected
   character range [`selStart`, `selStop`] (1-based, from the editor selection)
   resolves to a contiguous run of statement nodes within **one** sequence node, or
   to a single expression node. Anything else (partial expression, spanning two
   sequences) is a **decline**.
3. **A new method is just a compile.** `compileMethod: source dictionaries:
   category:` on the target behaviour adds a never-before-seen selector exactly as
   it recompiles an existing one — so the new-method apply path is R5's
   `applyMethodRecompile:` body, staged under a distinct `#methodAdd` kind (§4) so
   the preview can label it "new method" and not try to fetch a non-existent old
   source.
4. **Hierarchy implementor check reuses R2's `GsRefactoringEnvironment >>
   implementorsOf:`** — filter its result to `definingClass`, `definingClass
   allSuperclasses`, and `definingClass allSubclasses` for the soft collision
   warning (§3). No new environment query is required.
5. **Single-method-family plumbing is reused whole:** the R4/R5 token machinery
   (`startPreviewToken:maxBytes:`, `pageForToken:from:maxBytes:`,
   `applyForToken:deselected:`, `clearToken:`), the pure-ASCII JSON escapers, and
   `applyDeselected:` (with per-change deselection now honoured for the duplicate
   replacements — §5).
6. **`RBReadBeforeWrittenTester` is vendored** (`AST-Core`) —
   `class >> readBeforeWritten: varNames in: aParseTree` and
   `variablesReadBeforeWrittenIn:`. This is the exact utility upstream
   `RBExtractMethodRefactoring` uses to decide which variables flow *into* the
   extracted code. M1 uses it for §3.2's argument classification rather than
   hand-rolling read/write timing (which is subtle around blocks and
   `ifTrue:ifFalse:`).
7. **`RBParseTreeSearcher` / `RBParseTreeRewriter` are vendored** — structural
   pattern matching over the AST. §3.6's "replace similar code" pass builds a
   pattern from the extracted statements (extracted-argument variables become
   pattern variables) and uses a searcher to find equivalent runs in other methods
   — the same mechanism upstream extract-method uses for duplicate replacement.
8. **What is NOT vendored — and why that matters here.** The port is **AST-Core
   only**: there is no `RBExtractMethodRefactoring`, `RBRefactoring`, `RBCondition`,
   or `RBRefactoryError`. So there is **no upstream refactoring/precondition/error
   layer to mirror** — detecting unextractable code and surfacing compile failures
   is entirely the `Gs…Refactoring` engine's job (§3.7), done as JSON payload fields
   rather than exceptions across GCI, consistent with R1–R5.

---

## 3. The extract algorithm + preconditions (the correctness story)

Given a method, a selection interval, and a new selector:

### 3.1 Resolve the selection
- Parse the method. Collect the statement nodes whose intervals are **fully
  inside** the selection and share **one** sequence parent → the *extracted
  statements*. If the selection instead exactly covers a single expression node,
  treat it as an *expression extract* (the new method `^`-returns that expression;
  the call replaces the expression in place).
- **Decline** if: the selection is empty; it cuts a node partially (start/stop fall
  inside an expression); or the covered statements belong to more than one sequence.

### 3.2 Classify the selection's variables
Walk the extracted nodes; for each referenced **local** (arg/temp) whose declaring
scope (R5's `declaringScopeFor:`) is **outside** the selection. Use the vendored
**`RBReadBeforeWrittenTester`** (§2.6) on the extracted-statements sub-tree to
decide read-vs-write flow instead of hand-rolling it:
- **Argument** — an outside-declared local that is **read before written** inside
  the selection (`RBReadBeforeWrittenTester variablesReadBeforeWrittenIn:` the
  extracted sub-tree, intersected with the outside-declared locals). Its value
  flows in. Collected in **first-read source order**; this order fixes the new
  method's parameter order and the call-site argument order.
- **Return value** — assigned inside the selection **and** used after it. **At most
  one** is allowed: the new method ends with `^thatVar` and the call site becomes
  `thatVar := self newSel: …`. **Decline** if two or more locals are assigned
  inside and used afterward ("the selection assigns N variables used later; a
  method can return only one").
- **Internal temp** — a local (typically a method temp) referenced **only** inside
  the selection: declared in the new method's `| … |` and, if it was one of the
  original method's temporaries, **removed** from the original's temp list.

### 3.3 Hard declines (block Apply)
- Selection resolution failure (§3.1).
- More than one assigned-and-used-after variable (§3.2).
- Selection contains a **`^` return** node (extracting a non-local return changes
  control flow). *First cut: decline any `^` in the selection.* (Trailing-return
  support → §7.)
- Selection references **`super`** (a `super` send re-homed to a new method changes
  its meaning) or **`thisContext`**. (The `thisContext` guard is defensive: GemStone
  does not support `thisContext` in a compiled method — it fails to install — so this
  case is unreachable in real stone code, and its SUnit case was dropped. The guard
  is kept, cheap, in case a future release supports it.)
- New selector arity ≠ number of arguments, or not a valid selector (client
  validates too, §5).

### 3.4 Soft warning (surfaced, does NOT block — Eric)
- New selector already implemented by `definingClass`, a superclass, **or** a
  subclass → warn (possible override/shadow); the user may proceed. Surfaced in the
  preview payload like R4/R5 surface `collision`, but the client leaves Apply
  enabled.

### 3.5 Build the two source strings
- **New method** (staged as `#methodAdd`):
  ```
  <selectorPattern with the arg names interleaved>
      [| internalTemps |]
      <selected statements, verbatim via tree newSource>
      [^returnVar]
  ```
  Unary selector → just the selector line, no args. Keyword selector → interleave
  the user's keyword parts with the argument names in the §3.2 order. Expression
  extract → body is `^<expression>`. `category` = the source method's category
  (fallback `as yet unclassified`).
- **Rewritten original** (staged as `#methodRecompile`): replace the selected
  interval with the send — `self newSel: v1 with: v2` (statement), or `returnVar :=
  self newSel: …` (return case), or `(self newSel: …)` substituted for the
  expression. Drop any now-internal temp from the original's `| … |`. Use
  `RBStringReplacement` + `tree newSource` so surrounding formatting is preserved.

Comparisons via `#asSymbol` throughout (3.6.x Unicode-string trap,
[[feedback-rb-sunit-both-boundaries]] gotchas).

### 3.6 Optional pass — replace similar code in the hierarchy (checkbox, off by default)
When the user ticks "Also replace similar code" (§4/§5), the engine runs a second
pass **after** the extraction is built:

- **Scope** = the same class + hierarchy set as the collision check
  (`definingClass`, its superclasses, its subclasses), skipping the source method
  itself (its region is already handled) and the new method.
- **Match** = a contiguous statement run in a candidate method whose AST is
  **structurally equivalent** to the extracted selection, ignoring the identifiers
  at the **argument positions**. Implemented with the vendored
  **`RBParseTreeSearcher`** (§2.7): build a search pattern from the extracted
  statements with each extracted-argument variable turned into a **pattern
  variable** (`` `arg ``), so the searcher matches node-for-node on everything else
  (message sends, literals, control structure, non-argument variables) while
  binding each pattern variable consistently to whatever the candidate holds at
  that position. *First cut: a bound position must be a **variable or literal** node*
  (arbitrary-expression arguments → §7).
- **Replacement** = swap the matched run for `self newSel: <mapped nodes' source>`
  (mapped in the new method's parameter order), staged as one **deselectable**
  `methodRecompile` per candidate method.
- **Restricted to the safe shape.** The similar-code pass runs **only when the
  extraction has no return value and no escaping internal temps** (a pure void
  statement extraction). A value-returning or temp-escaping extraction skips the
  pass — replacing a duplicate would also have to reproduce the assign/return
  wiring at each site, which is deferred (§7). In that case the checkbox is shown
  disabled with a one-line reason (or the pass simply yields zero matches).
- **Each match is surfaced for vetting** — structural matching can catch a
  fragment the user did not intend, so every duplicate replacement is an
  independently checkable row in the preview (all checked by default when the
  option is on, but any can be unchecked). The user reviews the before/after per
  site before applying.

### 3.7 Unextractable code + compile errors — how they are handled
(Directly reviewed: the ported code is AST-Core only — **no** `RBRefactoring` /
`RBCondition` / `RBRefactoryError` — so all of this is the Gs engine's own
responsibility, surfaced as JSON, never as an exception thrown across GCI.)

- **Unextractable selection → a hard `declineReason` (JSON), Apply blocked.** Every
  §3.3 condition (partial-expression / multi-sequence selection, >1 returned
  variable, a `^` in the selection, `super`/`thisContext`, arity mismatch) is a
  precondition the engine checks while building the change set; on any of them the
  change set is **empty** and `declineReason` carries a specific message. The client
  refuses to open (or disables Apply on) the preview and shows the reason — the same
  mechanism R5 uses for its declines. This is the layer the ported browser does
  **not** provide, so it is authored here and covered by Task-3 SUnit.
- **Source that will not even parse** — `parseTree` returns nil (R5's `on: Error do:
  [nil]` guard); the engine declines with "the method source does not parse," never
  raising.
- **A candidate duplicate that would not compile** is simply **not offered** — the
  searcher only matches well-formed equivalent trees, and the safe-shape restriction
  (§3.6, void extractions only) keeps the generated send valid.
- **Compile errors at APPLY time are captured per change, not fatal.** The inherited
  `applyDeselected:` already wraps each change in `on: Error do:` and returns
  `{"applied":N,"failed":[{"id","label","error":<messageText>}]}` (verified in
  `GsRenameMethodRefactoring`). So if the extracted method or a rewritten site
  fails to compile in the stone, that change is reported in `failed` with its
  compiler message rather than silently lost, and **nothing is committed**. The
  client surfaces the `failed` list. Because M1's two core changes are mandatory and
  applied **new-method-first**, a failure there is reported before any duplicate
  replacement is attempted.
- **Richer apply-time compile-error/warning surfacing** (a persistent panel surface
  instead of a transient toast, dependency-aware selection) is the cross-cutting
  **H** / Stage-6 item — M1 rides the existing per-change `failed` envelope and does
  not build new surfacing here.

---

## 4. Engine — `GsExtractMethodRefactoring` (`gs-src/refactoring/engine/`)

Mirror `GsRenameTemporaryRefactoring`'s shape (single source method + tokens),
extended to emit two changes:

- Constructor
  `class: aClass selector: aSymbol meta: aBool selStart: n1 selStop: n2 newSelector: aString`
  (+ a `replaceSimilar: aBool` setter, default false, for the §3.6 pass; + an
  `environment:…` designated init for tests).
- Instance vars: `environment definingClass selector isMeta selStart selStop
  newSelector replaceSimilar changeSet` (+ cached analysis: `arguments returnVar
  internalTemps declineReason collisionWarning`).
- `buildChangeSet`: parse → resolve selection (§3.1) → classify (§3.2, via
  `RBReadBeforeWrittenTester`) → run hard declines (§3.3, empty change set +
  `declineReason` when tripped) → build both source strings (§3.5) → stage
  `methodAdd` (new method) **then** `methodRecompile` (rewritten original) → **if
  `replaceSimilar` and the extraction is the safe void shape**, run the §3.6
  searcher pass and stage one deselectable `methodRecompile` per matched site.
  Compiles nothing, commits nothing.
- **New AST helpers:** `extractedStatementsIn: tree` (interval → node run or
  expression, or nil), the read-before-written classification (delegates to
  `RBReadBeforeWrittenTester`), and `similarSitesUsing: pattern` (drives
  `RBParseTreeSearcher` over the hierarchy's methods). Reuse R5's
  `scopeNode:declaresSym:`/`declaringScopeFor:`, the JSON escapers,
  `dictNameForClass:`, `methodCategory`.
- **New change kind `#methodAdd`** — add
  `GsRefactoringChangeSet >> addMethodAddInDictionary: dn className: cn isMeta: b
  selector: sel category: cat newSource: ns` and the matching
  `GsRefactoringChange class >> methodAddId:…` (oldSource is nil/empty → the diff
  renders as an all-added method). Its apply is `compileMethod:dictionaries:category:`
  — identical to `applyMethodRecompile:`.
- **Apply** `applyChange:` dispatches `#methodAdd` → compile the new method,
  `#methodRecompile` → recompile the original or a duplicate site; **add-first**
  ordering. No commit. `applyDeselected:` now **honours deselection for the
  duplicate-replacement changes** (the two core changes always apply — they carry a
  `mandatory` marker the apply path never skips; a duplicate the user unchecked is
  skipped). Per-change failures are captured in the `failed` envelope (§3.7).
- **Preconditions surfaced (not applied):** `declineReason` (nil or a hard-decline
  string, blocks Apply) and `collisionWarning` (nil or the soft hierarchy-collision
  string, does NOT block) both ride in the start-preview `outOfScope` payload, the
  same shape R4/R5 use.
- **Pre-flight for the client:** class-side
  `analyzeSelectionForClass: aClass selector: sel meta: b selStart: n1 selStop: n2`
  → JSON `{argCount, argNames, returnVar, declineReason}` so the client can (a)
  refuse a bad selection before prompting and (b) suggest a default selector and
  validate the keyword arity the user types.
- **Token/preview/apply/clear class methods** copied from R5 verbatim
  (`startPreviewToken:` builds the change set, stashes under the token, returns
  totals=2 + oldName/newName replaced by a `newSelector` field + first page +
  `outOfScope`).

### Environment
No new query — the affected set is the one source method; the collision warning
reuses `implementorsOf:` filtered to the hierarchy (§2.4).

---

## 5. Client wiring (selection trigger, usual preview, reveal after)

- **Command** `gemstone.explorer.extractMethod` — its OWN editor context-menu item
  (Eric), `when: resourceScheme == gemstone && resourceLangId ==
  gemstone-smalltalk && editorHasSelection && rbSupportAvailable`. Palette entry too.
- On invoke: read the editor selection → convert to 1-based char offsets
  [`selStart`, `selStop`] in the method source. **Save the buffer first if dirty**
  (R5's rule — the engine recompiles the stored method, so offsets must match
  stored source).
- **Pre-flight** (`analyzeExtractSelection`): if `declineReason` non-nil, toast it
  and stop (no prompt). Otherwise suggest a default selector matching `argCount`
  and `showInputBox` for the selector, validating: valid selector syntax **and**
  keyword-part count == `argCount` (0 args ⇒ unary).
- **"Also replace similar code in the hierarchy" — a checkbox, OFF by default**
  (Eric). Offer it via a `showQuickPick` (canPickMany) or a follow-up
  `showQuickPick` toggle after the selector prompt; its value becomes
  `replaceSimilar:` on the start-preview call. When the extraction is not the safe
  void shape (§3.6), the option is shown **disabled** with a one-line reason (or
  simply yields zero matches).
- **Preview:** `startExtractMethodPreview` (passing `replaceSimilar`) → the
  **checkbox paginated panel** (reuse R2/R3's `renameMethodPanelView.js` *with*
  checkboxes): the two core changes render **always-on / disabled checkboxes**
  (mandatory), each duplicate-replacement renders a **checked, uncheckable-off-able**
  row so the user vets each site. A `declineReason` blocks Apply with the reason; a
  `collisionWarning` is a yellow banner but leaves Apply enabled.
- **Apply:** `applyExtractMethod` (sending the deselected duplicate ids) → engine
  compiles the two core changes + the selected duplicates server-side, no commit.
- **Reveal after apply (family pattern):** reload the original method's source
  editor to its rewritten source and re-focus it; the newly-created method now
  exists in the class (optionally reveal it in the Explorer).
- New client files (mirror R5): `queries/previewExtractMethod.ts` (pre-flight +
  start/page/apply/clear token expressions), `extractMethodPreview.ts` (pure model
  parsing the two-change envelope — one `methodAdd`, one `methodRecompile`),
  `extractMethodPanel(Html).ts` (reuse `renameMethodPanelView.js`, no checkboxes),
  `extractMethodCommand.ts` (selection→offsets, save-first, pre-flight, prompt,
  preview, apply, reload+reveal), `browserQueries.ts` wrappers, `extension.ts`
  registration, root `package.json` command + context-menu contribution.

---

## 6. Test plan (TDD)

**Task 3 — RED engine GS SUnit** (`GsExtractMethodRefactoringTest`; fixture: one
class + subclass with methods covering each case):
- extract a **statement run with no external reads and no return** → new **unary**
  method + `self sel` call at the site;
- extract statements **reading two outer locals** → new **keyword** method with
  those as args in source order; call passes them in that order;
- extract where **one temp is assigned inside and used after** → new method ends
  `^t`, call site is `t := self sel: …`;
- extract a **single expression** → new method `^`-returns it; the call replaces
  the expression in place;
- a **temp used only inside** the selection → declared in the new method, removed
  from the original's `| … |`;
- **hard declines** (empty change set + `declineReason`): >1 assigned-and-used-
  after; a `^` in the selection; `super`; `thisContext`; a partial-expression
  selection; a selection spanning two sequences;
- **soft collision** (change set still built, `collisionWarning` non-nil) when the
  new selector is already in the class / a superclass / a subclass;
- **arity mismatch** (selector keyword count ≠ argCount) → decline;
- **unparseable source** → declines (no raise), empty change set;
- **similar-code pass** (`replaceSimilar: true`): a structurally-equivalent run in a
  **subclass** and in a **superclass** method is found and staged as a deselectable
  `methodRecompile` sending the new selector with consistently-mapped args; a
  *nearly*-similar fragment (one differing send / non-arg variable) is **not**
  matched; the source method itself and the new method are excluded; with
  `replaceSimilar: false` **no** extra changes are staged; a value-returning /
  temp-escaping extraction stages **no** similar-code changes even when `true`
  (safe-shape restriction);
- **apply honours deselection of a duplicate** but never of the two core changes;
- **apply-time failure envelope**: force a duplicate site to fail compilation and
  assert it appears in `failed:[{id,label,error}]` while the core changes still
  applied and nothing committed;
- stages the **two core changes** (`methodAdd` then `methodRecompile`) [plus one per
  matched duplicate when enabled]; building compiles nothing and does **not** commit;
- **pre-flight** `analyzeSelectionForClass:…` returns the right `argCount` /
  `argNames` / `returnVar` and the decline reason for a bad selection;
- **preview**: `startPreviewToken:maxBytes:` returns `total`=2 + `newSelector` +
  first page + the `outOfScope` collision/decline; `previewJsonString` serializes
  both changes;
- **apply** (`applyForToken:`/`applyDeselected:`): both methods compile, the new
  selector exists and returns the right value, the original now sends it, the apply
  envelope reports `"applied":2`/`"failed":[]`, and **apply does not commit**.

Run the SUnit via topaz on **both 3.6.2 and 3.7.5** ([[feedback-rb-sunit-both-boundaries]];
netldi-by-PORT recipe + `GsFileIn` non-committing file-in + abort, per the R4/R5
notes and this repo's `gs-src/refactoring/build`).

**Task 4 — GREEN engine**: implement §4 to pass Task 3 on both boundaries; rebuild
payloads (`gs-src/refactoring/build/build-refactoring.sh`).

**Task 6 — RED client vitest**: pre-flight parsing; selector arity validation;
selection→offset conversion; dirty-buffer → save-first; decline → toast + no
prompt; collision → banner but Apply enabled; the panel renders two read-only
changes; apply → reload+reveal.

**Task 7 — GREEN client**: implement §5; `npm run test:client` +
`compile`/`lint`/`format:check` clean.

**Task 8 — GCI integration** (`refactoringExtractMethod.integration.test.ts`,
guarded, **skips-with-reason** when the engine is absent — the RH pattern): a live
pre-flight → start → preview → apply of a real selection, asserting the new method
exists and returns correctly, the original sends it, and **no commit**.

**Task 9 — verify + hand off**: live F5 (select statements in a method, Extract
Method, confirm the preview shows both changes, apply compiles + saves both, the
original editor reloads and re-focuses, the new method exists; verify a decline and
a soft collision-proceed); full `npm test` green on a fresh stone; engine SUnit
green on both boundaries; produce PR title + body for Eric. If a demo fixture class
is committed to a stone for F5, record a `*-fixture-cleanup` memory like
[[rivdemo-fixture-cleanup]]. **No commit until Eric says the word.**

---

## 7. Deferred / optional (not in the first cut)

- **Trailing-return extraction** — allow a selection whose last statement is `^expr`
  (new method returns it; call site becomes `^self newSel: …`). First cut declines
  any `^`.
- **Extract into a block / cascade / partial expression** — first cut is whole
  statements or a whole single expression.
- **Auto-suggested / editable argument names** — first cut keeps the original
  variable names (Eric's UX choice); renaming args during extract is polish.
- **Similar-code pass beyond the safe void shape** — replacing duplicates for a
  value-returning or temp-escaping extraction (reproducing the assign/return wiring
  at each site) and matching **arbitrary-expression** argument positions (not just
  variable/literal). First cut restricts to void extractions with variable/literal
  arg bindings.
- **Widening the similar-code search scope** beyond class+hierarchy (whole dictionary
  / system) — first cut matches the collision scope (hierarchy).
- **Extract to a different class / instance↔class side** — that is M6 (move method)
  territory.
- **Acceptance (Playwright) spec** for the selection→preview→apply flow → Stage-6 / **H**.

---

## 8. Rules carried forward (unchanged)

- **One task per session, stop for review** ([[feedback-one-stage-at-a-time]]).
- **TDD: failing GS SUnit FIRST (Task 3), then implement (Task 4).**
- **NEVER commit/push until Eric says the literal word "commit"** ([[commit-rule]]).
- **Eric opens PRs** ([[feedback-eric-creates-prs]]) — produce title + body.
- **Engine SUnit green on 3.6.2 AND 3.7.5** ([[feedback-rb-sunit-both-boundaries]]);
  **fresh test stone before any push** so the pre-push `npm test` passes; no
  `--no-verify` ([[feedback-fresh-test-stone-before-push]]).
- **Guarded GCI tests skip-with-reason, never falsely green** (the RH pattern).
- Consistent task-list format (✅/🔲/🔄 + **Task N — Title** + desc)
  ([[feedback-consistent-task-list-format]]).
