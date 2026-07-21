# Rename-at-cursor family — design (client-side)

How the rename refactorings (R1 instance variable, R2 method, R4 class variable,
R5 temporary/argument) are offered **from the method source editor**, in addition
to the Explorer tree pencils. This layer is **entirely client-side** (TypeScript);
it reuses the existing server-side engines and Explorer flows unchanged. Added
2026-07-21 on top of R5. **Uncommitted** at time of writing.

> Not to be confused with the per-refactoring engine design docs
> (`R2-…`, `R3-…`, `R4-…`, `R5-…`). This doc is about the shared *entry point*.

---

## 1. Entry point: the native "Refactor…" menu

VS Code always shows **Refactor…** (`editor.action.refactor`, also `Ctrl/Cmd+.`)
in a text editor's context menu and lightbulb. An extension **cannot remove** that
built-in item, and for GemStone methods it was otherwise empty. So instead of
adding our own top-level context entries, we **populate it**: a single
`RefactorCodeActionProvider` (`client/src/renameRefactorCodeActions.ts`,
registered for `{ scheme: 'gemstone', language: 'gemstone-smalltalk' }`) returns:

| Action | Command | Offered when |
| --- | --- | --- |
| Rename Temporary/Argument… | `gemstone.renameTemporary` | cursor on an identifier |
| Rename Instance Variable… | `gemstone.renameInstVarAtCursor` | cursor on an identifier |
| Rename Class Variable… | `gemstone.renameClassVarAtCursor` | cursor on an identifier |
| Rename Method… | `gemstone.renameMethodInEditor` | always (targets the method) |

Each carries the exact **position** it was offered at (`range.start`), so the
target is where the action appeared — not wherever the editor selection drifted.
The provider is cheap/synchronous (a regex + `getWordRangeAtPosition`, **no**
per-keystroke GCI).

**Discoverability (M7).** The family is reachable only via Refactor… / `Cmd+.`
and the command palette ("GemStone: Rename … at Cursor / in Editor") — there is no
`editor/context` right-click "Rename" entry (deliberate: the Explorer tree pencils
remain the discoverable, always-present path; the editor path is the power-user
convenience). Palette titles carry "…at Cursor"/"…in Editor" suffixes to
disambiguate from the Explorer-tree rename commands (which are hidden from the
palette via `when: false`).

---

## 2. "Offer all, decline politely"

The provider can't know what an identifier *is* without asking the stone, and
`provideCodeActions` must stay fast/synchronous. So all three variable renames are
offered on any identifier; the one that doesn't fit **declines with a reason that
points at the right one**, e.g.:

- Rename Instance Variable on a temporary → *"'x' is not an instance variable …
  use Rename Temporary/Argument."*
- on an **inherited** ivar → *"'x' is an instance variable INHERITED by Foo —
  rename it on its defining class"* (R1/R4 edit the *defining* class, so renaming
  from a subclass would target the wrong scope).
- Rename Temporary/Argument on an ivar/global/self → the engine's classifying
  decline (see `GsRenameTemporaryRefactoring>>declineReason`).

Refusals are **warning toasts** (`refuse()`), each also breadcrumbed to the
"GemStone GCI" output channel. (They are not modal — Eric's preference; a missed
toast earlier turned out to be per-extension Do-Not-Disturb filtering.)

---

## 3. Rename Method follows the cursor

Unlike the variable renames, Rename Method's target depends on where the cursor is:

- on a **sent selector** in the body (e.g. `runningSum` inside `report`) → renames
  **that** selector across its implementors and senders (R2);
- on the **method header**, or any non-send position → renames the **method being
  edited**.

The selector under the cursor is resolved by the LSP request
`gemstone/selectorAtPosition` (AST-based, so a click anywhere in a keyword send
like `at:put:` resolves the whole selector). The resolver **distinguishes**:

- returns `null` → no selector here (header/whitespace) → rename the edited method
  (intended, silent);
- **throws** → the lookup is unavailable (LSP not started / errored) → the command
  **aborts with a warning** rather than guess and risk renaming the wrong method.

---

## 4. Shared plumbing + the `*Named` contract

All four commands share `client/src/renameAtCursorShared.ts` so they can't
diverge on the bits that matter (this is what a review found copy-pasted 5× and
diverging on gating and dict-scope):

- `resolveMethodEditor(sessions, position, subject)` — the active editor must be a
  saved `gemstone:` **method** URI with a live session, else refuse. Returns
  `{ editor, parsed, session, at, dict }`, where **`dict = parsed.dictIndex ??
  parsed.dictName`** — a single scope value used for BOTH the membership pre-check
  AND the rename, so a class shadowed across dictionaries never resolves one way
  for the check and another for the rename.
- `wordAt(target, subject)` — the identifier at the position, with a **1-based
  code-point offset** (the engine indexes the stored source by character; VS Code
  offsets are UTF-16, so a non-BMP char before the cursor would shift it — counted
  via `Array.from`; ASCII/BMP is unchanged).
- `ensureRbSupport(available, action)` — the engine-install gate, run **first and
  uniformly** in every command.
- `saveIfDirty(editor)` — the rename recompiles the method server-side and the
  flow reloads the editor afterwards; saving first means unsaved edits are never
  silently discarded by that reload (and keeps the temp offset aligned).
- `reloadMethodEditor(editor)` — after an applied rename, reload from the stone
  (`workbench.action.files.revert`) and refocus.

The ivar/classVar/method flows **reuse the Explorer controller flows** via
name-based entry points extracted for this purpose:
`ExplorerController>>renameInstVarNamed / renameClassVarNamed / renameMethodNamed`,
each returning `Promise<boolean>` (true = applied) so the cursor caller knows to
reload the editor. The Explorer-tree pencils are now thin wrappers over the same
methods (they return `void`; the boolean is only consumed by the cursor path).
Rename Temporary/Argument (R5) has no Explorer flow, so its command is
self-contained but uses the same shared helper.

---

## 5. Testing

- Engine: `GsRenameTemporaryRefactoringTest` (28 cases, green on 3.6.2 + 3.7.5),
  incl. a comment-mention fixture proving a click inside a comment naming a real
  argument is declined (locks the `occurrenceNode` guard).
- Client: one test file per command
  (`rename{Temporary,InstVarAtCursor,ClassVarAtCursor,MethodAtCursor}Command`) +
  `renameRefactorCodeActions` (the four-action menu) + `renameAtCursorShared` (the
  code-point offset) + `getVisibleClassVarNames`. The shared editor guards are
  exercised through the ivar command's branch tests.

## 6. Known limitations (accepted)
- `occurrenceNode`/`declineReason` re-parse the method a few times per call — one
  method, negligible; not cached.
- Classification is name-membership (`getDefined*`/`getVisible*`), not AST, so a
  word inside a string/comment equal to an ivar name is treated as that ivar for
  the *offer*; harmless because the engine renames only real references and the R5
  engine additionally requires the offset to land on a real variable node.
