# R4 — Rename class variable: design (Task 2 output)

Working design for the R4 refactoring (rename a **class variable**). R1 (rename
instance variable) is the closest precedent — R4 is R1 with three differences:
class-side methods also reference the variable, the variable is a shared
**binding with a value that must be preserved**, and the definition clause is
`classVars:` not `instVarNames:`. Read `R2-RenameMethod-Design.md` for the reusable
infra (minimal-diff AST rewrite, paginated preview, server-side apply, 3.6.x traps).

Status: **Task 2 complete (this doc + empirical facts).** Every GemStone fact below
was established empirically on the 3.7.5 stone `gs64stone_375_testcleanRbinstall`
(uncommitted probes, all aborted). TDD order: Task 3 encodes these as failing SUnit,
Task 4 implements to green.

---

## 1. GemStone facts (empirical — 3.7.5)

1. **A class variable is a shared binding.** `aClass _classVars` is a
   `SymbolDictionary` mapping each class-var name (Symbol) → its `SymbolAssociation`
   (e.g. `#Counter->42`). The association object holds the single shared value.
2. **Bytecode-precise reference detection.** A method that references a class var
   holds that variable's **exact association object** in its literal frame:
   `aMethod literals anySatisfy: [:e | e == theAssociation]`. This is the R4 analog
   of R1's `instVarsAccessed` — precise, needs no source parse, and (crucially)
   **distinguishes the class var from a same-named global** (a different association)
   and from a **shadowing temp/argument** (no association literal at all). Verified:
   base instance method, base class method, subclass instance method, and subclass
   class method that read the var all hold the identical association; a method whose
   only occurrence is captured by a same-named block arg does **not**.
   - `aMethod literals` returns an `Array` — use `anySatisfy:`, **not**
     `identityIncludes:` (Array does not understand it).
3. **Class vars are visible across the whole hierarchy, both method sides.** The
   defining class, its metaclass, every subclass, and every subclass metaclass can
   reference the var — and all share the one association. So the affected-method scan
   walks `definingClass` + `allSubclasses`, instance **and** class side.
4. **A subclass reports only its OWN class vars.** `subclass classVarNames` does not
   include an inherited var (verified empty on a subclass of a class declaring
   `Counter`). So the class var is declared on exactly one class — the one whose row
   the user renames from — and only that class's definition is edited.
5. **`classVars:` is the definition clause.** `Foo definition` renders
   `classVars: #( Counter)` — the same tokenizable form R1 edits for `instVarNames:`.
6. **Renaming via a full class-def recompile DROPS THE VALUE.** Redefining the class
   with `classVars: #('Tally')` in place of `#('Counter')` leaves `Tally = nil` and
   `Counter` gone — the shared value (42) is lost. **This is the central R4 hazard**
   and the reason R4 ≠ R1. An instance var has per-instance storage (migration is a
   separate concern); a class var has one live value that a rename must carry.
7. **Reflective add/remove preserves everything and is value-safe.** `Class`
   understands `addClassVarName:` and `removeClassVarName:` (but not
   `renameClassVarFrom:to:` or `classVarNames:`). The sequence
   ```smalltalk
   oldVal := (cls _classVars associationAt: oldSym) value.
   cls addClassVarName: newName.
   (cls _classVars associationAt: newSym) value: oldVal.
   "...recompile referencing methods to the new name..."
   cls removeClassVarName: oldName.
   ```
   yields: `classVarNames = (Tally)`, `Tally = 42` (value carried), the persisted
   **definition source updated** to `classVars: #( Tally)`, and — see next — **no new
   class version**.
8. **A class-var change does NOT bump the class version.** `classHistory size` is
   unchanged across the rename (class vars do not affect instance format, so GemStone
   updates the class in place). So the Explorer's `Foo[n]` tag is **unchanged** by an
   R4 rename — unlike R3.

---

## 2. Scope model — hierarchy only (simpler than R2/R3)

A class variable is visible **only** in its defining class + descendants (both
sides). A same-named name anywhere else is a *different* binding (bytecode fact #2),
so there is nothing outside the hierarchy to rename. **R4 therefore has no
#class/#dictionary/#wholeSystem scope pick and no out-of-scope count** — the affected
set is exactly the whole subtree, always. This makes R4 lighter than R2/R3: a
new-name input, a preview, an apply. (**DECIDED** with Eric 2026-07-17: hierarchy-only,
no scope picker; the preview just states plainly that changes are confined to the class
and its subclasses. The four-scope model would be inert here, so it is dropped.)

Detection remains AST-scope-aware *within* each method: R1's `renameNodesIn:shadowed:`
already leaves a same-named temp/arg (and the references it captures) alone, so a
method that both reads the class var and has a same-named block arg is rewritten
correctly (only the genuine reference changes).

---

## 3. Change-set impact — reuse existing kinds

R4 needs **no new change kind**. It stages, exactly like R1:

- **one `classDefinitionEdit`** on the defining class — `oldSource`/`newSource` = the
  class definition with the `classVars:` clause name swapped (R1's
  `renameInstVarInDefinition:` recipe, retargeted at the `classVars:` clause). This is
  the before/after the preview renders; its **apply** does the value-safe reflective
  rename (facts #6–#7), not a naive recompile of `newSource`.
- **one `methodRecompile` per affected method** (both sides, whole subtree) — the
  method's body with the class-var reference renamed minimal-diff (R1's AST rewrite).
  `isMeta`, base class, and category derived via the R3 helpers (`baseClassOf:` uses
  `#thisClass`, **not** the Pharo-ism `#instanceClass`; `inClass categoryOfSelector:`).

**Apply ordering** (server-side, one round trip, R2/R3 pattern) — as implemented:
1. `classDefinitionEdit` (staged FIRST, so it applies first): capture the old value →
   `addClassVarName: newName` → set the new association's value → **`removeClassVarName:
   oldName` right here**, in this same change.
2. `methodRecompile` every reference (the new var now resolves).

The old var is removed in step 1 — *before* the method recompiles — not deferred to a
last step. This is safe because a not-yet-recompiled method keeps a working, **detached**
copy of the old association (still holding the carried value) in its literal frame until
it is recompiled to the new name; removing the name from `_classVars` does not disturb
that literal. Nothing commits (apply never commits — asserted in SUnit like R1/R2/R3).

> **Note (was "confirm with Eric", now decided).** An earlier draft proposed doing the
> `removeClassVarName:` *last* (after the recompiles). The shipped code removes it inside
> step 1; the two orders are equivalent given the detached-association fact above, and
> the single-change form is simpler. This paragraph is the reconciliation.

**Deselection policy — DECIDED: option A, all-or-nothing.** In R1/R2/R3 reference
recompiles are deselectable. For a class-var rename a *deselected* reference method would
be left naming a variable that step 1 removes — a silently broken (dangling) method.
Eric's call (2026-07-17): the rename is **all-or-nothing**. The client does **not** offer
to deselect the reference recompiles, and `applyDeselected:` **ignores** any
`deselectedIds` passed (applying every change) — accepting the argument only for
signature compatibility with the shared `applyForToken:deselected:` entry point. So there
is no path that removes the old var while leaving a method naming it. (The softer
cross-family "let it dangle but list the warnings in yellow" UX is a separate Stage-6/H
item, per the catalog — it does not apply to R4.)

---

## 4. Engine — `GsRenameClassVariableRefactoring`

Mirror `GsRenameInstanceVariableRefactoring`'s shape, add class-side coverage,
server-side apply, and value-safe rename:

- Constructor `class: aClass renameClassVar: oldString to: newString`
  (+ `environment:class:oldName:newName:` designated init). No scope args.
- Instance vars: `environment definingClass oldName newName oldNameSym newNameSym
  classVarAssociation changeSet` (+ `skippedMethods` if we isolate per-method errors
  like R2/R3).
- `buildChangeSet`: `stageClassDefinitionEditInto:` (rename the `classVars:` clause) +
  `stageMethodRecompilesInto:` (walk affected methods both sides). Precondition checks
  staged/surfaced, not applied.
- Reuse **verbatim** from R1: `renameNodesIn:shadowed:`, `node:declaresName:`,
  `renameInSource:` (AST body rewrite); `dictNameForClass:`. Retarget
  `renameInstVarInDefinition:` → `renameClassVarInDefinition:` (same tokenizer, keyed
  on `classVars:`).
- Reuse from R2/R3: the paginated preview (`startPreviewToken:maxBytes:`,
  `pageForToken:from:maxBytes:`, `pageJsonFrom:`), server-side apply
  (`applyDeselected:`, `applyForToken:deselected:`, `applyChange:`, `clearToken:`),
  pure-ASCII JSON escapers, `jsonQuote:`. `applyChange:` branches on
  `#classDefinitionEdit` (value-safe reflective rename) and `#methodRecompile`
  (R3's `applyMethodRecompile:` verbatim).
- Precondition: **new name already a class var / instance var / a bound global in the
  hierarchy, or not a valid variable identifier** → surfaced, not applied. (Class-var
  names are conventionally capitalized but GemStone does not require it; validate as a
  variable identifier.)

### Environment addition
`GsRefactoringEnvironment >> methodsAccessingClassVar: anAssociation inHierarchyOf:
aClass` → an `Array` of `GsNMethod` (both sides, `aClass` + `allSubclasses`) whose
`literals anySatisfy: [:e | e == anAssociation]`. Read-only; mirrors
`referencesToClassNamed:`/`implementorsOf:`. A companion
`classVarAssociationFor: aName in: aClass` → `(aClass _classVars associationAt:
aName asSymbol ifAbsent: [nil])` gives the association to scan for (and doubles as
the "is this actually a class var of this class?" precondition).

---

## 5. Client wiring (mirror R1's ivar rows, simplest editor)

- The Explorer already renders a class's instance-variable sub-tree with a rename
  pencil (R1). Add the **class-variable rows** the same way, with a rename pencil that
  calls a `renameClassVariable(item)` command.
- `queries/previewRenameClassVariable.ts` — `startRenameClassVariablePreview` /
  `pageRenameClassVariablePreview` / `applyRenameClassVariable` /
  `clearRenameClassVariablePreview` (token-based, byte-bounded, non-blocking fetch —
  the R2/R3 query shape).
- `renameClassVariablePreview.ts` — pure model: parse the start/page/apply envelopes
  (reuse the R1/R2 change parser: `classDefinitionEdit` + `methodRecompile`).
- Input: **new-name input box** (`showInputBox` with a variable-identifier validator)
  — no keyword editor, no scope quick-pick. Then the paginated preview panel, reusing
  `renameMethodPanelView.js` / the panel HTML (same change shape).
- **⚠️ Task-7 constraint — NO deselect checkboxes.** Because R4 is all-or-nothing and
  `applyDeselected:` ignores any deselection (§3), the R4 preview panel must **not**
  render per-change deselect checkboxes — otherwise a user could uncheck a method, see
  it applied anyway, and be confused. The shared R2/R3 panel renders selectable
  checkboxes; R4 must reuse it in a **read-only / all-required** mode (like R3 renders
  its structural changes as disabled/required), or render the change list without
  checkboxes at all. The preview should state plainly that the whole rename applies
  together. Engine is safe regardless; this is purely the panel's UX contract.
- `gemstoneExplorer.ts` + `package.json`: the `renameClassVariable` command, inline
  pencil on class-var rows, `rbSupportAvailable` gate + install offer (copy R1/R2's
  flow). After apply: refresh the providers/editors (the `[n]` tag does **not** change
  — fact #8 — but the class-var name and any recompiled method sources do).

---

## 6. Gotchas carried forward

- `#thisClass`, not Pharo's `#instanceClass`, for a metaclass's instance class.
- Emit **pure-ASCII JSON** (reuse the engine escapers) so the non-blocking GCI fetch
  never sees a Unicode-promoted wide string.
- Compare client-supplied strings via `#asSymbol` (3.6.x string literals are Unicode;
  comparing to byte strings raises error 2718). Applies to the deselected-id set and
  name comparisons.
- `aMethod literals` is an `Array` → `anySatisfy:`, not `identityIncludes:`.
- The 3.6.2-only GCI compiler-state quirk is WON'T-FIX (catalog **H**); it only bites a
  local 3.6.2 stone with the engine loaded — CI (no engine) is green.
- Pharo-ism sweep stays in Stage 6 / **H**.

---

## 7. Test plan (TDD)

**Task 3 — RED engine SUnit** (`GsRenameClassVariableRefactoringTest`, fixture: a base
class declaring class var `Counter` + a subclass, with methods exercising each case):
- renames a read in a base **instance** method;
- renames a read/assignment in a base **class** method;
- renames a read in a **subclass instance** method and a **subclass class** method;
- a same-named block arg (and the refs it captures) is left alone — the mixed case;
- a fully-shadowing method and a non-accessing method produce **no** change;
- a method/selector spelled like the var is not renamed (only the reference is);
- stages exactly one `classDefinitionEdit` with the `classVars:` clause renamed
  (old name gone, new name present, siblings intact) + one recompile per affected
  method;
- `previewJsonString` serializes `classDefinitionEdit` + `methodRecompile`;
- **building** the change set recompiles nothing and does not commit;
- **apply** (`applyDeselected: #()`): the class var is renamed, its **value is
  preserved**, `classHistory size` is **unchanged** (no version bump), referencing
  methods now name the new var, and **apply does not commit**;
- precondition: renaming to an existing class var / global name is reported, not
  applied.
- env: `methodsAccessingClassVar:inHierarchyOf:` returns exactly the accessing methods
  (both sides), excludes shadowing/non-accessing, and is read-only (no commit).

**Task 6 — RED client vitest**: query envelopes, model parse/validate, panel HTML,
Explorer command wiring. **Task 8 — GCI integration**: guarded start→page→apply→
value-preserved + no-commit round trip. Green on **3.7.5 and 3.6.2**
([[feedback-rb-sunit-both-boundaries]]); fresh 3.6.2 stone before any push.
