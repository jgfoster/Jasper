# R5 — Rename temporary / argument: design + TDD plan

Working design for **R5 (rename a method temporary or argument)**. Read
`R4-RenameClassVariable-Design.md` for the family conventions — R5 **is** a
stone-side `Gs…Refactoring` engine like R1–R4, but it is the lightest one: its
whole world is a **single method's source**, so it needs no cross-method scan, no
class-definition edit, no paginated preview, and no scope picker.

**UX decision (Eric, 2026-07-20):** do the rename **on the server and save the
method** (recompile it in the stone, no commit) — do **not** just dirty the editor
buffer client-side. The flow is the **usual family flow**: trigger on the variable
in the method source window → a one-line new-name input → **the standard preview
panel (before/after), as with R1–R4** → apply (server recompile, no commit) →
**the method is re-selected/revealed** so focus lands back on the just-refactored
method showing its saved source. (Eric, mid-plan: "there is a preview as usual" +
"the method is selected after the refactoring".)

Status: **plan only.** TDD order below: Task 3 encodes failing GS SUnit, Task 4
implements the engine to green, Tasks 6–8 wire the client + integration test.
(Task numbering mirrors R1–R4 so the shared infra maps 1:1.)

---

## 1. What makes R5 the lightest engine refactoring

A temporary or argument is **method-local**: every reference lives in the one
method the user is editing. Compared with R1–R4:

| Concern (R1–R4) | R5 |
| --- | --- |
| Cross-method / cross-class affected set | **None** — exactly one method changes |
| Stone scan to find references | **None** — the method's own AST is the whole scope |
| Class-definition edit | **None** |
| Scope picker (class/hierarchy/dictionary/wholeSystem) | **None** — always this one method |
| Paginated preview panel | **Shown, as usual** — before/after of the one method (Eric wants the standard preview) |
| Server-side apply, **no commit** | **Same as R1–R4** — recompile the one method, never commit |
| Re-select the target after apply | **Yes** — re-reveal/focus the method (like R4 re-reveals the class-var row) |
| 3.6.2 ↔ 3.7.5 SUnit boundary rule | **Applies** (stone code) — [[feedback-rb-sunit-both-boundaries]] |

So R5 = **one engine class + one `methodRecompile` change + recompile-apply**, on
top of the shared infra, with a deliberately minimal client (name input, no
panel).

---

## 2. GemStone facts / substrate to reuse

1. **The AST scope walk already exists and is reusable almost verbatim.**
   `GsRenameInstanceVariableRefactoring` has `renameNodesIn:shadowed:` +
   `node:declaresName:` + `renameInSource:` (vendored RowanV3 AST-Core / RBParser).
   R1 renames an **ivar** and *skips* shadowing locals; R5 renames a **local** and
   *stops* at an inner scope that redeclares it — the **same** shadowing walk,
   rooted at the target binding's declaring scope instead of the whole method.
2. **A method/block declares arguments; a sequence declares temporaries** —
   `node:declaresName:` already covers all three (`isMethod`/`isBlock` →
   `arguments`; `isSequence` → `temporaries`). This is the full local-binding
   model R5 needs.
3. **RB AST nodes carry source intervals**, so a client-supplied source offset
   (where the user's cursor sits on the variable) maps to the deepest scope node,
   from which the declaring scope of `oldName` is resolved outward — this is how
   R5 disambiguates a name that is declared in more than one scope of the same
   method (e.g. two blocks each with a `:each`).
4. **Single-method apply is R1/R3's `applyMethodRecompile:` verbatim** —
   recompile the one method at `environmentId: 0`, no commit (asserted in SUnit).
5. **Operates on a compiled method.** The engine recompiles a method that exists
   in the stone (by class + selector + isMeta). For a brand-new, never-saved
   buffer there is nothing server-side to recompile — the client requires the
   method be saved first (or the command is simply unavailable), §5.

---

## 3. Scope + shadowing rules (the whole correctness story)

Given a method, an `oldName`, and a **source offset** identifying the occurrence
the user clicked, R5 renames **exactly the occurrences that bind to that one
declaration**:

1. **Resolve the binding by position.** Find the deepest scope enclosing the
   offset; resolve `oldName` from there outward (method args, method temps, and
   each enclosing block's args/temps) → the **declaring scope node**. If `oldName`
   is not a local there (it's an instance/class var, a global, a class name, or
   `self`/`super`/`thisContext`), R5 **declines** with a message pointing at
   R1/R4 ("use Rename Instance Variable / Class Variable"). The engine's precise
   check: it's a local iff some enclosing scope's `arguments`/`temporaries`
   declares it.
2. **Declaration + every bound reference rename together** (one method recompile).
3. **Inner shadowing respected.** A block that redeclares `oldName` owns a
   *different* binding; occurrences inside it are **not** renamed (the walk marks
   `shadowed` on descent into a redeclaring child scope — R1's exact mechanism).
4. **Outer shadowing respected symmetrically.** Renaming an inner block param must
   not touch an outer same-named temp — the walk is rooted at the *inner*
   declaring scope, so it never sees the outer occurrences.
5. **New-name collision check** (a precondition surfaced, not applied). Renaming a
   local to an existing variable name does **not** break the method — the local
   declaration just **shadows** that variable, so it still compiles but silently
   means something different. That is exactly why it must be caught up front and
   the rename **declined** with a reason. **Identifier-shape validation (must be a
   valid Smalltalk identifier) is the client input-box validator's job**, exactly
   as in R1/R4 — the server-side `newNameCollision` below is about *collisions with
   existing names*, not spelling. Lowercase is only a convention, not enforced. The
   new name collides (and is rejected server-side) if it:
   - already names **any other argument or temporary declared in the method** — in
     the target's own scope, an enclosing scope, OR a nested block scope. **An arg
     must not collide with a temp and vice versa** (Eric, mid-plan): renaming arg
     `a`→`t` where `t` is a method temp would produce a duplicate declaration, and
     renaming a method temp to a name a nested block already binds would create
     silent shadowing. So the rule is conservative: the new name must not appear as
     an arg/temp **anywhere in the method's scope tree** (two legal sibling-block
     reuses are also rejected — the user simply picks another name). This is
     stricter than "visible in the target scope" and is deliberate; or
   - already names an **instance variable of the class, INCLUDING INHERITED ones**
     — use `definingClass allInstVarNames` (walks the superclass chain), not just
     the class's own ivars, since an arg/temp shadows an inherited ivar just as
     readily; or
   - already names a **class variable visible to the class**, i.e. a class var of
     `definingClass` **or any superclass** (class vars are inherited) — walk
     `superclass` collecting `classVarNames`; or
   - is a **pseudo-variable** (`self`/`super`/`thisContext`/`nil`/`true`/`false`).

   First cut covers all of the above (all cheaply checkable server-side from the
   class). Rejecting a name that shadows an arbitrary **global/pool** binding the
   method resolves is optional polish (§7). Comparisons via `#asSymbol` (3.6.x
   Unicode-string trap, [[feedback-rb-sunit-both-boundaries]] gotchas).

---

## 4. Engine — `GsRenameTemporaryRefactoring` (`gs-src/refactoring/engine/`)

Mirror `GsRenameInstanceVariableRefactoring`'s shape, single-method-scoped:

- Constructor
  `class: aClass selector: aSymbol meta: aBool renameTemp: oldString to: newString atOffset: anInt`
  (+ an `environment:…` designated init for tests). `atOffset:` is a 1-based
  character index into the method source identifying the clicked occurrence (§3.1).
- Instance vars: `environment definingClass selector isMeta oldName newName
  oldNameSym newNameSym offset changeSet` (+ `newNameCollision`).
- `buildChangeSet`: `stageMethodRecompileInto:` — fetch the method source
  (`compiledMethodAt:environmentId:otherwise:` → `sourceString`), parse, resolve
  the declaring scope at `offset`, rewrite via the shadow-aware walk, stage **one**
  `methodRecompile` (old→new source) iff the source changed. Precondition checks
  (not-a-local, collision) staged/surfaced, not applied.
- **Reuse verbatim from R1:** `renameNodesIn:shadowed:`, `node:declaresName:`,
  `renameInSource:` (retargeted to root at the declaring scope + rename the local
  rather than skip it). **Reuse from R1/R3:** `applyMethodRecompile:`,
  `dictNameForClass:`, the pure-ASCII JSON escapers.
- **New AST helper:** `declaringScopeOf: nameSym at: offset in: tree` — deepest
  enclosing scope whose interval covers `offset`, walked outward until a scope
  declares `nameSym`; returns that scope node (or nil ⇒ not a local ⇒ decline).
- **Preview (as usual) — reuse the R2/R3/R4 token machinery verbatim:**
  `startPreviewToken:maxBytes:` (stashes the refactoring under a token, returns
  totals + old/new names + the collision/decline reason + the first page),
  `pageForToken:from:maxBytes:`, and `clearToken:`. There is only ever **one**
  change (`methodRecompile`), so a page fits trivially, but reusing the same
  entry points keeps the client panel identical to the rest of the family.
  `previewJsonString` returns the one-change JSON (`methodRecompile` only — no
  `classDefinitionEdit`).
- **Apply** `applyForToken:deselected:` / `applyDeselected:` — recompile the one
  method, **no commit**. All-or-nothing: there is a single change, so deselection
  is inert (accepted for signature parity, like R4). Returns the
  `{"applied":N,"failed":[...]}` envelope.
- **Preconditions surfaced in the payload, not applied:** `newNameCollision` (nil
  or reason) and the not-a-local decline both appear in the start-preview payload
  (an `outOfScope`-style `collision`/`decline` field) so the panel can refuse and
  explain, exactly as R4 surfaces its collision.

### Environment
No new query is needed — R5 works from the one method's source, not a reflective
affected-set scan. The engine fetches the method via the class directly.

---

## 5. Client wiring (source window trigger, usual preview, re-select after)

The usual family flow, triggered from the **method source editor**
(`scheme: gemstone`, `language: gemstone-smalltalk`) with the cursor on the
variable:

- **Command** `gemstone.explorer.renameTemporary` (+ keybinding + editor
  context-menu entry, `when` gated on the gemstone-smalltalk editor and
  `rbSupportAvailable`). Optionally also offer it as a **code action** on a local
  identifier so it appears in the lightbulb.
- On invoke: read the identifier at the cursor (word-at-cursor) + the cursor's
  character offset in the method source; `showInputBox` for the new name
  (identifier validator, client-side — §3.5).
- **The method must be saved/compiled first.** If the editor is dirty, prompt to
  save (or auto-save) before renaming, since the engine recompiles the stored
  method (§2.5).
- **Preview as usual:** start the preview (`startRenameTemporaryPreview`), show
  the **standard preview panel** (reuse `renameMethodPanelView.js` / the R4
  no-checkbox panel — R5 is single-change all-or-nothing, so like R4 it renders
  the change read-only, no deselect boxes) with the before/after of the method. A
  collision/decline reason from the payload is surfaced in the panel and blocks
  Apply.
- **Apply:** `applyRenameTemporary` → engine recompiles the method server-side
  (no commit).
- **Re-select the method after apply (Eric):** re-reveal/focus the just-refactored
  method — reload its source editor to the saved, recompiled source and select its
  Explorer method row (mirror R4's post-apply re-reveal of the renamed row). On a
  declined/collision rename, leave the source untouched and surface the reason.
- `queries/renameTemporary.ts` — GCI expressions for
  start/page/apply/clear (the R2/R3/R4 token query shape).
  `renameTemporaryPreview.ts` — pure model parsing the envelopes (reuse the R1
  change parser: a single `methodRecompile`).
- `package.json` (**root**) — the command + editor/context-menu contribution +
  `when` clause.

> **Why not F2 / the LSP `RenameProvider`?** F2 returns a `WorkspaceEdit` that VS
> Code applies to the **buffer** — i.e. it dirties the method and does the rename
> **client-side**, which is exactly what Eric ruled out ("do it on the server and
> save the method"). So R5 uses a command + server recompile, not LSP rename. (The
> TS LSP server does have a `ScopeAnalyzer` that could resolve the local
> client-side; it is **not** used for R5's authoritative rename, though a future
> pre-flight "is this a local?" check could reuse it.)

---

## 6. Test plan (TDD)

**Task 3 — RED engine GS SUnit** (`GsRenameTemporaryRefactoringTest`, fixture: one
class with methods exercising each case — an arg used several times, a temp, a
block param, a method temp shadowed by a block temp, a method that also reads an
ivar of a different name):
- renames every occurrence of a **method argument** (keyword + binary patterns);
- renames a **method temporary** including an assignment target (`x := …`);
- renames a **block parameter** only within its block;
- **inner shadowing**: renaming the method temp leaves the shadowing block's
  occurrences alone; renaming the block temp leaves the method temp alone
  (offset selects which);
- an identifier that is an **instance variable / global / `self`** is **declined**
  (no change), with a reason;
- a same-spelled **selector/keyword** or symbol literal is **not** renamed;
- stages **exactly one** `methodRecompile` with the local renamed (old gone, new
  present) and nothing else;
- **collision** (`newNameCollision` non-nil, not applied) when the new name equals:
  - **another arg** (renaming a temp → an existing arg name) **and another temp**
    (renaming an arg → an existing temp name) — both directions (Eric);
  - an arg/temp declared in a **nested block** of the method;
  - an **own ivar**, an **inherited ivar** (fixture: rename in a subclass method to
    a superclass ivar name — caught via `allInstVarNames`), a **class var** (own or
    inherited), and a **pseudo-variable** (`self`);
- a **free** new name has no collision (`newNameCollision` nil);
- **building** the change set recompiles nothing and does not commit;
- **preview**: `previewJsonString` serializes the single `methodRecompile` (and
  **no** `classDefinitionEdit`); `startPreviewToken:maxBytes:` returns totals +
  old/new names + the first page, and surfaces a collision/decline reason;
- **apply** (`applyForToken:`/`applyDeselected:`): the one method is recompiled to
  the new name, the apply envelope reports `"applied":1`/`"failed":[]`, and **apply
  does not commit**; a second method that happened to use a same-spelled local is
  untouched.

Run the SUnit via topaz on **both 3.6.2 and 3.7.5** ([[feedback-rb-sunit-both-boundaries]]).

**Task 4 — GREEN engine**: implement §4 to pass Task 3 on both boundaries; rebuild
payloads (`gs-src/refactoring/build/build-refactoring.sh`).

**Task 6 — RED client vitest**: `renameTemporary` query builds the right GCI
expression + parses `{applied|declined}`; the command is registered + dispatches
from a gemstone-smalltalk editor; new-name identifier validation; dirty-buffer →
save-first path; declined → warning + source untouched.

**Task 7 — GREEN client**: implement §5; `npm run test:client` +
`compile`/`lint`/`format:check` clean.

**Task 8 — GCI integration** (`refactoringTemporary.integration.test.ts`, guarded,
skips-with-reason when the engine is absent — the RH pattern): a live
start→preview→apply of a temp in a fixture method asserting the method recompiled
to the new name, a shadowing block untouched, and **no commit**.

**Task 9 — verify + hand off**: live F5 (open a method, invoke Rename Temporary on
a temp used several times + a shadowing block, confirm the **preview** shows the
before/after, apply recompiles + saves, **the method is re-selected/focused**
afterward showing the saved source, the shadow is untouched, and an ivar is
declined); full `npm test` green on a fresh stone; engine SUnit green on both
boundaries; produce PR title + body for Eric. No commit until he says the word.

---

## 7. Deferred / optional (not in the first cut)

- **Global-shadowing collision awareness** — first cut rejects collisions with
  other locals, the class's inst/class vars, and pseudo-variables; rejecting a new
  name that shadows an arbitrary **global** is polish.
- **Code-action / lightbulb** entry in addition to the command — nice-to-have.
- **Acceptance (Playwright) spec** for the source-window flow → Stage-6 / **H**.

---

## 8. Rules carried forward (unchanged)

- **One task per session, stop for review** ([[feedback-one-stage-at-a-time]]).
- **TDD: failing GS SUnit FIRST (Task 3), then implement (Task 4).**
- **NEVER commit/push until Eric says the literal word "commit."**
- **Eric opens PRs** — produce title + body, don't `gh pr create`.
- **Engine SUnit green on 3.6.2 AND 3.7.5** ([[feedback-rb-sunit-both-boundaries]]);
  **fresh test stone before any push** so the pre-push `npm test` passes; no
  `--no-verify`.
- Consistent task-list format (✅/🔲/🔄 + **Task N — Title** + desc).
</content>
