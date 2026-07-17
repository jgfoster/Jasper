# R3 — Rename class + class-definition history: design (Task 0 output)

Working design for the R3 refactoring (rename a class) plus the companion
**class-definition history viewer** (with redo). R1 (rename ivar) and R2 (rename
method) are the shipped precedents this mirrors; read
`R2-RenameMethod-Design.md` first for the reusable infra (minimal-diff AST
rewrite, paginated preview, server-side apply, 3.6.x traps).

Status: **Tasks 0–4 complete** (engine + client + tests). All GemStone facts below
were established empirically on 3.7.5 (uncommitted probes, aborted) and are recorded
in the `reference-gemstone-class-rename-history` memory.

## Class-versioning nuances (doc review — GemStone/S 64 Programming Guide ch.2 & ch.10)

Reviewed against the official docs + verified empirically. How the engine handles each:

- **Format (byte / pointer-indexable / NSC / instancesInvariant) — FIXED bug.** The
  plain `newVersionOf:` creation form takes the new class's format from its
  SUPERCLASS, which silently drops the class's OWN format bits: an
  `instancesInvariant` class became mutable on rename (format `8 → 0`, verified).
  `makeNewVersionOf:shapedLike:named:superclass:` now uses the format-taking
  primitive `_subclass:instVarNames:format:…inClassHistory:…` and passes
  `shape format`, reproducing the exact format (byte/indexable/NSC/invariant).
  Indexable/byte/NSC formats were already OK (inherited from the same superclass),
  but invariant was not — now all are. SUnit: `testRenamePreservesFormatAndInvariantOption`,
  `testRenamePreservesIndexableFormat`.
- **Class-variable / class-instance-variable VALUES — preserved (no action).** All
  versions in one class history share the same class-var value objects, so
  threading `inClassHistory: old classHistory` carries them; we do NOT re-init them
  (would lose data). Verified. SUnit: `testRenamePreservesCategoryAndClassVars`.
- **Class category — preserved (verified).** Carried across the new version via the
  same-history creation; verified on 3.7.5 and covered by SUnit so the 3.6.2 CI leg
  catches any divergence.
- **Restore uses the HISTORICAL version's methods.** `restoreClass:toVersion:` sets
  `shapeSource` = the chosen version, so copy-forward pulls that version's shape AND
  methods (not the current class's) — a true shape+method restore. It always creates
  a new version (bypasses the "equivalent definition returns the existing class"
  dedup), so a restore never silently no-ops.
- **Instance migration — now an OPTION (JadeiteForPharo #142).** `migrateInstances`
  (default ON) migrates every instance of each superseded version to its new version
  (`Module>>migrateInstancesTo:`); it REQUIRES a commit, so the apply commits when it
  is on. Gotcha learned: migrating already-committed instances to a version created in
  the SAME uncommitted transaction is a no-op, so the apply commits the structural
  rename FIRST, then migrates, then commits again. Failure count surfaced
  (`migratedFailures`). Off → instances stay on their prior version (documented
  redefinition behavior) and nothing commits.
- **classHistory pruning — now an OPTION + a history-window action.** `ClassHistory`
  DOES expose `removeVersion:` (the doc review missed it). `removeOldFromHistory`
  (default OFF) prunes each reversioned class's history down to the current version
  after applying (commits). Separately, the Class History window offers a per-version
  **Remove** button (`GsClassHistory removeVersionOf:index:`, cannot remove the
  current version, does not commit). Removing a version that still has un-migrated
  instances is warned about.
- **copyMethods / recompileSubclasses options (JadeiteForPharo #142).** copyMethods
  (default ON) copies each superseded version's methods forward; off = the new
  versions start bare. recompileSubclasses (default ON) re-parents the descendant
  subtree; off = subclasses keep pointing at the old version (not touched).
- **Single-name-binding invariant.** GemStone requires at most one version of a
  history reachable by name in Globals; our "remove the old name binding" step
  satisfies it (only when the name actually changed).
- **Symbol literals (`#OldName`) are flagged-but-skipped**, per the AST policy — a
  compiled `SymbolAssociation` reference is rewritten via method recompile, but a
  `#Symbol` datum is not (it is data, not a binding reference).
- **Kernel/base classes — now WARNED.** Before opening the rename editor, the client
  probes `isKernelClass` — a class bound in the base `Globals` dictionary (kernel
  classes live in Globals; user code lives in UserGlobals or user dictionaries) — and
  shows a modal "this looks like a kernel/system class, renaming is risky — continue?"
  (a warning, not a hard block). NOTE: `isModifiable` is NOT used — it is false even
  for ordinary user classes (you can't instantiate a modifiable class), so it can't
  distinguish kernel from user code. The new-name collision precondition still blocks
  reusing a bound name.
- **Version tag shows `[current/total]`** (e.g. `Foo[2/3]`) in the Classes AND
  Hierarchy panes (`getClassVersions` returns current+total).

### Task 1–4 result (summary)

- **Engine** (`gs-src/refactoring/engine/`): `GsRenameClassRefactoring` (new
  version via `newVersionOf:`, method copy-forward with reference rewrite,
  top-down descendant reparent, external reference rewrite, old-name unbind, name
  collision precondition, paginated preview + server-side apply — classRename +
  classReparent always applied, only methodRecompile references deselectable);
  `GsClassHistory` (native-classHistory viewer JSON + `revertClassNamed:toIndex:`
  redo). New change kinds `classRename` / `classReparent` (+ a `newName` slot) on
  `GsRefactoringChange`/`ChangeSet`; `referencesToClassNamed:` / `descendantsOf:`
  on `GsRefactoringEnvironment`.
- **Engine tests**: `GsRenameClassRefactoringTest` (12) + `GsClassHistoryTest` (8),
  **20 new, all green on 3.7.5**; the 43 existing engine tests still green (63
  total). Comment/`#Symbol`-literal safety, subtree exclusion, scope + collision,
  no-commit all covered.
- **Client**: `queries/previewRenameClass.ts` + `queries/classHistory.ts` (wired
  through `browserQueries.ts`); `renameClassPreview.ts` (parse + validate model);
  `renameClassPanel(Html).ts` (paginated preview, structural changes rendered as
  disabled/required checkboxes, reusing the R2 `renameMethodPanelView.js`);
  `classHistoryModel.ts` + `classHistoryPanel(Html).ts` + `classHistoryPanelView.js`
  (read-only history viewer + redo confirm). Explorer: `renameClass` (inline
  pencil on class rows) + `classHistory` (context menu) commands, `rbSupportAvailable`
  gate + install offer; `package.json` commands/menus; `.vscodeignore` whitelists
  the new view JS.
- **Client tests**: 35 new vitest (preview parse/validate, panel HTML +
  disabled-structural behaviour, history parse, history viewer HTML + restore
  dispatch). Full suite green: **client 3432, server 320, mcp 95**.
- **Validated on 3.7.5 via MCP** (uncommitted, aborted): a whole-system rename of
  `R3P`→`R3Q` correctly created the new version (history `[R3P, R3Q]`), unbound the
  old name, re-parented `R3C` (its `bar` reference rewritten), rewrote `R3E>>makeP`
  (comment left intact), copied `foo` forward, and a shape-change + revert restored
  the prior shape + methods as a new version.
- **Deferred to the push cycle** (needs the engine committed on a stone, then a
  fresh-3.6.2 pre-push run): the automatic GCI integration test
  (`refactoringClass.integration.test.ts`) is written + gated on the engine being
  present, so it skips green on the engine-less CI/test stone and will exercise once
  loaded — proven equivalent by the MCP round trip above.

---

## 1. Goal & UX

Rename a class across the whole image, previewing every change before applying,
**never committing** (the user commits). Renaming a class is more than a
method: a class name is a global binding, it has a version history, it may have
subclasses that name it as their superclass, and its name appears as a global
reference in method bodies image-wide.

Companion feature (Eric's ask): an **unobtrusive class-definition history
viewer** — see every version of a class's definition in THIS stone, each with
its timestamp, the name it had then, its object id (oop), and the methods that
changed between versions. Plus a **redo** (recompile a prior version's
definition) — which is itself just a new version, so it composes with rename.

### Prior art
- **JadeiteForPharo**: rename-class exists but its preview is a blunt
  `copyReplaceAll:` text substitution (no AST — rewrites the name inside comments
  and string literals too). R3 must be AST-based (references only). JfP's
  *method* history is a home-grown per-user `UserGlobals` `RowanMethodHistory`
  dict appended on every tool compile; it does NOT do class-definition history —
  it only reads `classHistory size`/`indexOf:` for a `(v/total)` badge. So R3's
  history viewer is new ground, built directly on GemStone's native
  `classHistory`.

---

## 2. The GemStone model (empirical)

- A class's **name** is the `name` ivar (from `Module`); `#name` resolves via
  `Metaclass3>>name`. There is no public name setter.
- **`classHistory`** is the native definition history: an ordered collection of
  Class **version objects**. Each version independently answers `name`,
  `timeStamp` (when it was defined), `userId` (who defined it), `asOop`,
  `definition` (source), and its own methods (`selectors`,
  `compiledMethodAt:otherwise:`). `Foo[n]` in the Explorer already =
  `classHistory indexOf: theClass` (`queries/getClassVersions.ts`).
- **Redefining** a class (`superclass subclass: name ...`) creates a new version
  with an **empty method dictionary**, rebinds the name to the new version, and
  retains the old version (with its methods) in `classHistory`. The tools
  recompile methods onto each new version — methods do NOT auto-carry.
- **Rename** uses the current primitive
  `Class>>_subclass:instVarNames:classVars:classInstVars:poolDictionaries:inDictionary:newVersionOf:description:options:`
  (the `inClassHistory:` forms are Deprecated):

  ```smalltalk
  superclass
    _subclass: newName
    instVarNames: (old instVarNames collect: [:e | e asString])
    classVars: (old classVarNames collect: [:e | e asString])
    classInstVars: (old class instVarNames collect: [:e | e asString])
    poolDictionaries: #()  "resolve from old"
    inDictionary: definingDict
    newVersionOf: oldClass
    description: (old commentForFileout)
    options: #()
  ```

  It appends a NEW version to `oldClass classHistory` under the NEW name; the old
  versions keep their old names (verified: names `[Old, Old, New]`). It returns
  `oldClass` unchanged if the new class would be equivalent — the name always
  differs here, so it always makes a new version. **[N] bumps naturally.**
- The new version starts with **empty methods** → the apply must copy the old
  version's methods (both sides) forward.
- The **old name stays bound** → the apply must remove the old dictionary key.
- **Subclasses are NOT re-parented** — `child superclass` still `==` the old
  parent version, `newParent subclasses` is empty. So renaming a class WITH
  descendants must recompile the whole descendant subtree (each descendant → a
  new version re-pointed at the new parent chain, + its methods copied forward).
- **Instances** reference their class version object directly (not via the name),
  so they stay valid on their prior version. Not auto-migrated; optional
  migration is a documented follow-up, off by default.

---

## 3. Scope model (mirror R2)

Scope governs the set of method bodies searched for **references to the old class
name** (and which subclasses are re-parented). Class renames are usually
whole-system, but we keep R2's four scopes for consistency and safety:

- **Class** — references in the target class's own methods only.
- **Hierarchy** — references in the class + its sub/superclasses' methods.
- **Dictionary** — references in methods of classes in one `SymbolDictionary`.
- **Whole system** — all references image-wide. **(Default for rename-class.)**

**Out-of-scope warning — always on**, exactly like R2: references outside the
chosen scope are counted and reported ("N references outside the chosen scope
will NOT be updated"). Subclass re-parenting is NOT scoped — an orphaned subclass
is a correctness bug, so ALL descendants are always re-parented regardless of
scope (with a clear note in the preview). The rebind of the class binding itself
is likewise always done.

References come from `ClassOrganizer new referencesToObject:` (already wrapped
client-side in `queries/methodSearch.ts` as `referencesToObject`). Within a
referencing method, a real reference is an `RBVariableNode` whose name is the old
class name; `#OldName` symbol literals and the old name inside comments/strings
are NOT rewritten (AST guarantee, same as R2) — symbol literals are flagged-but-
skipped with a warning.

---

## 4. Change-set impact — new kinds

Today `GsRefactoringChangeSet` has `methodRecompile`, `methodRename`, and
`classDefinitionEdit`. R3 adds:

- **`classRename`** — the target class. Carries old className + `newName` (reuse
  the `newSelector` slot as the new name, or add a `newName` slot — prefer a
  dedicated slot for clarity). `oldSource`/`newSource` = old / new class
  definition (for the before/after diff). Apply (server-side): create the new
  version via `newVersionOf:`, copy the old version's methods (both sides)
  forward, add the new dictionary key, remove the old key.
- **`classReparent`** — one per descendant. `oldSource`/`newSource` = the
  descendant's old / new definition (only DIRECT children differ textually — the
  superclass name changes; deeper descendants are textually identical but still
  listed because they must be recompiled to re-point at the new version). Apply:
  recompile the descendant's definition `newVersionOf:` its current version, copy
  its methods forward. Processed top-down so each level re-points at the freshly
  created parent version.
- Reference rewrites in user methods stay plain **`methodRecompile`** (minimal-
  diff `RBVariableNode` rename, R2's `newSource` recipe) — the method's own
  selector is unchanged; only a global reference in its body changes.

Apply ordering (collision-safe, server-side in one round trip like R2):
1. `classRename` (create new target version, copy methods, rebind).
2. `classReparent` top-down (each descendant re-versioned under the new chain).
3. `methodRecompile` reference rewrites (compiled against the now-renamed class).

Everything is staged non-committing; apply compiles in the stone but never
commits. Preconditions checked up front and surfaced (not applied): new name
already bound to a different global (collision), new name not a valid class
identifier, renaming a kernel/base class (warn hard).

---

## 5. Engine class — `GsRenameClassRefactoring`

Mirror `GsRenameMethodRefactoring`'s shape:
- `class: aClass renameTo: newNameString scope: scopeSymbol` /
  `...dictionaryScope: dictName` constructors; `environment:...` designated init.
- `buildChangeSet` → stage the `classRename`, the `classReparent`s (walk
  `definingClass allSubclasses`, top-down), and a `methodRecompile` per in-scope
  referencing method (skip the definition-only refs; count out-of-scope);
  isolate each method in an `on: Error` block and record `skipped` (R2 pattern).
- Reuse verbatim: `dictNameForClass:`, `baseClassOf:` (`thisClass`, not
  `instanceClass`), the pure-ASCII JSON escapers, `hierarchyScopeClasses`,
  `isClassInScope:`, the paginated preview (`startPreviewToken:maxBytes:`,
  `pageJsonFrom:`, `pageForToken:...`) and server-side apply
  (`applyDeselected:`, `applyForToken:deselected:`, `clearToken:`), all
  byte-bounded and SessionTemps-token based.
- Add reference discovery to `GsRefactoringEnvironment`:
  `referencesToClassNamed:` → `(ClassOrganizer new referencesToObject: <assoc-or-class>)`,
  and `descendantsOf:` (top-down ordered) — read-only, mirrors the existing
  `implementorsOf:`/`sendersOf:`.
- Rename-specific `applyChange:` branch handling the three kinds above; the
  new-version + method-copy-forward + rebind is a private helper
  (`renameClass:to:` / `reparent:under:`).

Reference-body rewrite recipe (minimal diff, from R2): parse the referencing
method, walk for `RBVariableNode`s whose `name asSymbol == oldName asSymbol`,
mutate the node's token value AND register an `RBStringReplacement` for its
source span, then `newSource`. A shadowing temp/argument of the same name is not
a global var node, so it is safe (a class name is a capitalized global; the AST
distinguishes it from a local, same as R1's shadowing logic).

---

## 6. Class-definition history viewer + redo

A separate, self-contained feature reading `classHistory` (this-stone-only,
native — no home-grown store, no commit).

### Engine — `GsClassHistory` (query helper in the `GsRefactoring` dict)
`GsClassHistory class >> forClassNamed: aName` → a JSON array, newest-version
first, one object per version:
```json
{ "index": 3, "name": "BankAccount", "oop": 60097537,
  "timeStamp": "2026-07-17T09:41:07", "userId": "SystemUser",
  "isCurrent": true, "definition": "<class definition source>",
  "changedMethods": [ {"side":"instance","selector":"foo","change":"added"},
                      {"side":"class","selector":"bar","change":"modified"} ] }
```
- Walk `theClass classHistory`; per version emit name/oop/timeStamp/userId,
  `isCurrent` (== the currently-bound class), and `definition`.
- `changedMethods` = diff each version's method set/source against the PREVIOUS
  version in the history: `added` (selector new this version), `removed` (gone),
  `modified` (source differs). Both sides. Pure-ASCII JSON escapers reused.
- `timeStamp` serialized as ISO-8601 (parse GemStone `DateTime`/`timeStamp`
  robustly; fall back to `printString` on any error — display-only).
- Read-only; opening the viewer never compiles or commits.

### Engine — redo/revert
`GsClassHistory class >> revertClassNamed: aName toIndex: anInt` (server-side, NO
commit): take `classHistory at: anInt`, recompile its `definition`
`newVersionOf:` the current class, and copy that historical version's methods
forward. This creates a NEW version (== the redo) whose definition matches the
chosen old one — history is append-only, so a revert is never destructive and
can itself be reverted. Gated behind an explicit confirm in the client.

### Client — unobtrusive surfacing
- A `Foo[n]` class row already exists in the Explorer. Add a **context-menu /
  inline command "Class Definition History…"** on a class row (NOT a always-
  visible button — unobtrusive per Eric). Only meaningfully populated when
  `classHistory size > 1`, but always available.
- Opens a read-only webview (reuse the rename panel's collapsible-diff view):
  a list of versions newest-first, each showing `[n] name — timestamp — userId
  (oop)`, an expandable definition diff vs. the previous version, and the
  changed-method list. A **Redo / Restore this version** button per row →
  confirm → `revertClassNamed:toIndex:` → refresh the Explorer version tag.
- Gated by the same `rbSupportAvailable` probe (the `GsClassHistory` helper ships
  in the same payload); degrade gracefully (offer install) when absent.

---

## 7. Client wiring (mirror R2, simpler editor)

- `queries/previewRenameClass.ts` — `startRenameClassPreview` /
  `pageRenameClassPreview` / `applyRenameClass` / `clearRenameClassPreview`
  (token-based, byte-bounded, `AsyncQueryExecutor`), plus `getClassHistory` and
  `revertClassToVersion` in a new `queries/classHistory.ts`.
- `renameClassPreview.ts` — pure model: parse the start/page/apply envelopes
  (extend the R2 change parser with `classRename`/`classReparent` kinds),
  order class-rename-first then reparents then reference recompiles.
- Rename input: R3 needs only a **new-name input box** (no keyword-part editor).
  Use `showInputBox` with a class-name validator + scope quick-pick (default
  Whole system), then the paginated preview panel (REUSE
  `renameMethodPanelView.js` / the panel Html — the change list is the same
  shape). No new editor webview needed.
- `gemstoneExplorer.ts`: `renameClass(item: ClassItem)` + `classHistory(item)`
  commands; `package.json` inline pencil + context menu on `explorerClass` rows,
  `rbSupportAvailable` gate + install offer (copy R2's `renameMethod` flow).
  After apply: `loadDefinedIvarCounts` + refresh both providers so the `[n]`
  tag and the renamed class row update; reopen editors on the renamed class.

---

## 8. Task plan (post-Task-0)

- **Task 1 — Engine rename:** `GsRenameClassRefactoring` + `classRename`/
  `classReparent` change kinds + env `referencesToClassNamed:`/`descendantsOf:`;
  minimal-diff reference rewrite; scope + out-of-scope counts; server-side apply
  (new-version, method copy-forward, rebind, top-down reparent). Validate on
  3.7.5 (fixtures created, exercised, removed — never committed).
- **Task 2 — Engine history:** `GsClassHistory` (forClassNamed: JSON incl.
  changedMethods diff; revertClassNamed:toIndex:).
- **Task 3 — Client:** queries, model, Explorer wiring (rename input + scope +
  paginated preview reusing the R2 panel), the history viewer webview + redo.
- **Task 4 — Tests:** engine GS SUnit (rename w/ references, subclass reparent
  cascade, comment/symbol-literal safety, scope + out-of-scope, collision
  precondition, no-commit; history JSON incl. changedMethods; revert makes a new
  version) green on **3.7.5 + 3.6.2**; client vitest (query + model + panel +
  history parse); automatic GCI integration round trip (start → page → apply →
  reshaped + [n] bumped; history read; revert). `npm run compile && npm test`.
  Fresh 3.6.2 stone before any push (pre-push hook runs `npm test`).

### Edge-case policy (finalize in Task 1)
- New name already bound / invalid identifier / kernel class → precondition warn,
  surfaced in preview, not applied.
- `#OldName` symbol literals + `perform:`/name-as-data → flag-but-skip w/ warning.
- Comments / string literals → never touched (AST guarantee).
- Metaclass references / `OldName class` sends → the metaclass follows the class
  object, so a body reference `OldName class` is the same `RBVariableNode`
  rename; no extra handling.
- Instance migration → off by default; documented follow-up (surface instance
  count in the preview so the user knows).
