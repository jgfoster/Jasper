# R4 — Rename class variable: CLIENT kickoff (Tasks 6–8)

> **✅ SHIPPED 2026-07-20 (uncommitted). This doc is now historical — see
> `R4-RenameClassVariable-Design.md` §5 for the as-built client.** Tasks 6–8 are
> done. Deviations from the plan below: (1) the panel **reuses
> `renameMethodPanelView.js`** — no new `renameClassVarPanelView.js` and **no
> `.vscodeignore` change** (the "clone the view JS / whitelist it" steps below are
> obsolete); (2) the Explorer gained an **instance/class variable-side layer**
> (`VarSideItem`) so ivar/class-var rows nest under an "instance"/"class" node;
> (3) shipped names are `…ClassVar…` (not `…ClassVariable…`).

Pickup doc for a fresh session. The **engine is done, committed, and pushed**
(`eric/refactoringTools`, `ea72dec` + merge `3437f34`); engine SUnit 30 R4 tests
and the full engine suite 105/105 are green on **both 3.6.2 and 3.7.5**. What
remains is the **VS Code client** + the GCI integration test. Read
`R4-RenameClassVariable-Design.md` (esp. §5 client wiring and §3 the
all-or-nothing decision) and this file first.

R4 is the class-variable analog of **R1 (rename instance variable)** and mirrors
its client almost exactly: a **new-name input box only** (no keyword editor, no
scope quick-pick), a paginated preview, a server-side apply. Clone the
`renameInstVar*` client files, not the method/class ones.

## Rules (unchanged)
- **One task per session, stop for review** ([[feedback-one-stage-at-a-time]]).
- **TDD: write the failing vitest FIRST (Task 6), then implement (Task 7).**
- **NEVER commit/push until Eric says the literal word "commit."**
- **Eric opens PRs** — produce title + body, don't `gh pr create`.
- **Fresh 3.6.2 stone before any push** so the pre-push `npm test` passes; no
  `--no-verify`.
- Consistent task-list format (✅/🔲/🔄 + **Task N — Title** + desc).

---

## ⚠️ The one non-obvious constraint: NO deselect checkboxes

A class-variable rename is **all-or-nothing**. The engine's `applyDeselected:`
**ignores** any deselected ids (it always applies every change) because removing
the old class-var binding while leaving a method that still names it would
silently break that method. Therefore the **R4 preview panel must NOT render
per-change deselect checkboxes** — otherwise a user unchecks a method, sees it
applied anyway, and is confused. R1's `renameInstVarPanel` DOES have selection;
R4's panel must drop it (render the change list read-only / all-applied) and pass
`deselected: []` to the apply query. The engine is safe regardless; this is purely
the panel UX. (Recorded in design §5.)

---

## Engine API the client calls (already shipped, in the `GsRefactoring` dict)

Construct: `GsRenameClassVariableRefactoring class: aClass renameClassVar: old to: new`.

Paginated preview + apply (identical shape to R2/R3, token in SessionTemps):
- instance `startPreviewToken: token maxBytes: n` → JSON
  `{token,total,oldName,newName,outOfScope,skippedMethods,page:{changes,nextOffset,done}}`.
  `outOfScope` = `{"references":0,"skipped":N,"scope":"hierarchy","collision":null|"reason"}`
  (R4 has no out-of-scope refs; **collision** is the precondition to surface).
- class `pageForToken: token from: i maxBytes: n` → `{changes,nextOffset,done}`.
- class `applyForToken: token deselected: ids` → `{"applied":N,"failed":[...]}`
  (**ids ignored** — see constraint above; pass `[]`).
- class `clearToken: token` → `'ok'`.
- instance `previewJsonString` (whole change set, unpaginated) and
  `newNameCollision` (nil | reason) also exist.

Change kinds in the change list (same JSON as R1): **`classDefinitionEdit`** (the
`classVars:` clause edit; always applied) and **`methodRecompile`** (each
reference; fields `id, kind, dictName, className, isMeta, selector, category,
oldSource, newSource`). No new kinds.

Note: an R4 rename does **not** bump the class version, so the Explorer `Foo[n]`
tag does NOT change after apply (unlike R3) — but the class-var name and recompiled
method sources do; refresh accordingly.

---

## 🔲 Task 6 — RED: client vitest first

Write failing vitest mirroring `client/src/__tests__/` coverage for R1/R2, before
any client code:
- **query layer** — `previewRenameClassVar` start/page/apply/clear build the right
  GCI expressions and parse the envelopes (model tests in the style of
  `renameInstVarPreview` tests).
- **model** — parse/validate the start+page+apply JSON into the change list
  (`classDefinitionEdit` + `methodRecompile`), new-name identifier validation,
  collision surfaced.
- **panel HTML** — renders the change list **without** selection checkboxes
  (assert no checkbox inputs), shows old→new per change, states the rename applies
  as a whole.
- **Explorer wiring** — the `renameClassVariable` command is registered and
  dispatches on a class-var row; gated on `rbSupportAvailable` with the install
  offer (copy R1's `renameInstVar` gate).
Run vitest → red. **vitest invocation** (the `.bin` shebang fails under the Bash
tool): `node ../node_modules/vitest/vitest.mjs run --project default <path>
--reporter=dot` from `client/` (see [[vitest-run-invocation]]).

## 🔲 Task 7 — GREEN: client implementation

Clone the R1 `renameInstVar*` files → `renameClassVar*` and wire them:
- `client/src/queries/previewRenameClassVar.ts` — clone
  `queries/previewRenameInstVar.ts`; point at `GsRenameClassVariableRefactoring`
  and its `...renameClassVar:to:` / token methods. Non-blocking fetch, byte-bounded
  pages (`executeFetchStringNb`), under the 256 KB cap.
- `client/src/renameClassVarPreview.ts` — clone `renameInstVarPreview.ts` (model
  parse/validate; reuse the R1 change parser — same two kinds).
- `client/src/renameClassVarPanel.ts` + `renameClassVarPanelHtml.ts` +
  `renameClassVarPanelView.js` — clone the `renameInstVarPanel*` trio **but strip
  the checkbox/selection UI** (all-applied, read-only list). Apply calls
  `applyForToken:deselected:` with `[]`.
- `client/src/gemstoneExplorer.ts`:
  - **Class-var rows.** Verify whether the Explorer already shows class variables
    as rows. IvarItem exists (`class IvarItem` ~L199; built ~L2405 from
    `getDefinedInstVarNames`; dispatched ~L2682 `if (item instanceof IvarItem)
    void ctl.renameInstVar(item)`). There is likely **no `ClassVarItem` yet** — add
    one mirroring `IvarItem`, a query for the class's own `classVarNames`
    (analogous to `getDefinedInstVarNames`/`getDefinedInstVarCounts`), tree
    population under a ClassItem, and the `getParent` case.
  - `renameClassVariable(item: ClassVarItem)` method mirroring `renameInstVar`
    (~L1188): `rbSupportAvailable` gate + install offer, `showInputBox` new-name
    (variable-identifier validator), start preview, show the no-checkbox panel,
    apply, then refresh providers/editors (the `[n]` tag is unchanged; the class-var
    name + method sources change).
- `package.json` (**root**, not client/) — the rename commands live here
  (`gemstone.explorer.renameMethod` ~L1063, `gemstone.explorer.renameClass`
  ~L1069, + `menus`/`view/item/context` entries ~L1313/1567). Add
  `gemstone.explorer.renameClassVariable` command + an inline pencil / context menu
  on class-var rows, `when` gated like the others.
- `.vscodeignore` — whitelist the new view JS: add
  `!client/src/renameClassVarPanelView.js` (see the block at ~L61–65).
Run vitest → green + `npm run compile` + `npm run lint` + `npm run format:check`.

## 🔲 Task 8 — GCI integration test (red→green)

`client/src/__tests__/refactoringClassVariable.integration.test.ts`, mirroring
`refactoring.integration.test.ts` (R1) / `refactoringClass.integration.test.ts`
(R3): **guarded** on the engine being present (skips green when absent), a live
start→page→apply round trip asserting the class var renamed, **value preserved**,
`[n]` unchanged, referencing methods recompiled, and **no commit**.

### Running the engine live for the integration test (recipe that works)
The engine is NOT on the CI/test stones. To exercise the test against a loaded
engine WITHOUT committing to a stone:
- **3.7.5** (via the Jasper MCP `jasper` session, already SystemUser): create the
  `GsRefactoring` dict on the symbol list, then
  `GsFileIn fromPath: dir,'/<f>.gs' on: #serverUtf8File to: nil` for
  `ast-core.gs, compat.gs, engine.gs` (and `engine-tests.gs` for SUnit), run, then
  **`abort`** — leaves the stone clean.
- **3.6.2** (topaz): the `jasper-test-3.6.2` netldi NAME isn't in `/etc/services`,
  so address it by **port**: `PID=$(pgrep -f "netldid jasper-test-3.6.2-gs64-ldi");
  ss -tlnp | grep pid=$PID` → e.g. 37845;
  `set gemnetid !tcp@localhost#netldi:<port>#task!gemnetobject`;
  `set gemstone !tcp@localhost#server!jasper-test-3.6.2-gs64-stone`; SystemUser /
  swordfish; `GEMSTONE=client/tmp/gemstone/GemStone64Bit3.6.2-x86_64.Linux`;
  file in via `GsFileIn fromServerPath:` (pre-3.7 form, **not** serverUtf8File);
  `System abortTransaction`; logout. (See the scratch script from the engine
  session; also [[feedback-rb-sunit-both-boundaries]].)
Rebuild payloads after any engine edit: `gs-src/refactoring/build/build-refactoring.sh`.

## 🔲 Task 9 (after 6–8) — Verify + hand off
Full `npm test` green (fresh 3.6.2 stone); engine SUnit still green on both
boundaries; then produce the PR title + body for Eric. No commit until he says so.

---

## Reuse map (don't rebuild)
- Client template = **R1 `renameInstVar*`** (new-name-only, two change kinds).
- Non-blocking paginated fetch + apply, `AsyncQueryExecutor`, `rbSupportAvailable`
  probe + install offer (`refactoringInstall.ts` / `refactoringAvailability.ts`).
- Change-list parser (reuse R1's — `classDefinitionEdit` + `methodRecompile`).
- Escaping: user strings into generated Smalltalk (`escapeString`) AND HTML
  (`escapeHtml`); webview CSP + nonce + `localResourceRoots: []`; dispose via
  `context.subscriptions` (Stage-6/H pre-merge checklist).

## Gotchas
- The **no-checkbox** panel constraint above.
- `[n]` version tag is UNCHANGED by an R4 rename (no new class version).
- Pure-ASCII JSON from the engine (already handled) → non-blocking fetch never sees
  a wide string; compare client strings via `#asSymbol` server-side (3.6.x trap).
- The 3.6.2-only GCI compiler-state quirk is WON'T-FIX (catalog H) — CI (engine-less)
  is green.
