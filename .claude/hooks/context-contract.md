This file is loaded automatically, *only* when you are about to edit a context
file (a `CLAUDE.md` or a `.claude/rules/*.md`). It is the contract for such
edits — read it before writing the change.

## Whether it belongs (inclusion)

Litmus test: would a fresh session need this *before* touching code, and will
it still be true in a month? If not, it doesn't belong here.

- Fixes, incident write-ups, and "what I just did" summaries belong in commit
  messages and PR descriptions, not in context files — git history is
  authoritative for what changed and why.
- State stable rules once, tersely. Don't restate what the code already makes
  obvious to a careful reader.
- No duplication: link to the single source of truth instead of inlining a
  copy that will drift out of sync.
- Prefer replacing an existing line with a corrected one over appending a new
  paragraph next to it.
- **Exception — don't over-extract.** A rule needed to read the code
  correctly on first contact, or a prerequisite whose violation corrupts any
  debugging session (e.g. "you must run against the patched dependency or
  failures are misleading"), stays inline even though it's short-lived-looking
  or narrow. Moving it out just to hit a smaller file is the failure mode in
  the opposite direction — don't do that either.

## Where it belongs (placement)

Decide *before* adding. Push content DOWN (toward the subtree it governs) and
OUT (toward the most deterministic mechanism that fits), in this order:

1. **Applies to one subtree** (`client/` or `server/`) → that subtree's own
   `CLAUDE.md`, not the root one.
2. **Applies to a path or file-type pattern** → a `.claude/rules/*.md` with a
   `paths:` frontmatter glob, so it auto-loads only when a matching file is
   opened. Not prose bolted onto a `CLAUDE.md`.
3. **Is a multi-step procedure or workflow** → a skill, not a paragraph of
   steps in a `CLAUDE.md`.
4. **Is a deterministic "every time X, do Y" guardrail** → a hook (like this
   one), not a prose instruction hoping the model remembers. Prose guardrails
   fail under pressure; hooks don't.
5. **Needed only during one kind of task** (e.g. packaging, acceptance
   testing) → an on-demand doc, **task-named** (`adding-a-menu-entry.md`, not
   `gotchas.md`), referenced from the relevant `CLAUDE.md`'s docs index by a
   task- or symptom-keyed trigger ("hit `MessageNotUnderstood nil`? read X") —
   never a bare "see also" link with no firing condition.
6. **Stable, repo-wide, and needed before any work at all** → the top-level
   `CLAUDE.md`. This is the last resort, not the default — every line here is
   loaded into every session.

## Map of the current structure

- `CLAUDE.md` (root) — repo-wide, always loaded.
- `client/CLAUDE.md`, `server/CLAUDE.md` — loaded when working in that
  workspace.
- `.claude/rules/tests.md` — repo-wide test rules, path-scoped to test files.
- `.claude/rules/client/tests.md`, `.claude/rules/client/gci.md` — client-only
  rules, path-scoped further within `client/`.

If what you're adding doesn't clearly belong at the tier you're editing,
prefer the more specific tier, or reconsider whether it's derivable from the
code instead of documented at all.
