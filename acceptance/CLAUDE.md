# Acceptance tests (Playwright)

End-to-end tests that drive a real VS Code window via Playwright's Electron support — see [README.md](README.md) for how to run them (docker vs. local), flip through trace screenshots, and current scope. They are **not** part of `npm test`; specs live in `tests/*.spec.ts`, not `*.test.ts`, so the repo-wide `.claude/rules/tests.md` naming/structure conventions do **not** auto-load for these files — Playwright's own `test.describe`/`test` idioms apply instead.

- `helpers/vscode.ts` — downloads a pinned VS Code build and launches it with this repo as the extension-development path.
- `helpers/testStone.ts` / `helpers/containerStone.ts` — provision the GemStone stone a spec connects to (local vs. in-container).

<!-- Maintainer note (stripped from agent context): keep this file a pointer to README.md, not a duplicate of it — README is the human-facing usage doc, this is what an agent needs before touching acceptance/ code. -->

## Storyboard

`npm run test:acceptance` also writes `playwright-report/storyboard.html` — the run
as a manual: features in reading order, each step paired with the screenshots taken
while it ran and the actions that produced them. The reporter
(`reporters/storyboard.ts`) only gathers data; `reporters/storyboard.html` is the
whole appearance and is editable on its own, no build step.

**Structure.** A folder under `features/` is a section of the manual, titled and
introduced by its own `README.md` (a small Markdown subset — headings, lists,
links, emphasis, code spans). Reading order comes from a `.contents.json` per
folder, naming that folder's own entries and nothing deeper; a folder without one
reads alphabetically. `tests/storyboard-outline.spec.ts` fails on drift between an
outline and its directory.

**Marking.** `touch(locator)` clicks and rings; `shows(locator)` asserts visible
and rings; `mark(locator)` rings for any other assertion. Rings ride on the
element, never on a screen position — VS Code reshuffles under a stationary
pointer. `clearMarks` runs before every step so a frame rings only its own step.
The two colours live in `helpers/marks.ts` and nowhere else: they are drawn into
the live window (baked into the PNG) *and* used to colour the matching sentence
on the page, so both sides read them from there.

**Wording.** Step actions are phrased from the locator's role and accessible name
— the same identity a screen reader announces — so the page says "Click the
GemStone tab", never a selector. A step found only by CSS has no such name and is
dropped rather than printed. Prefer `getByRole` if you want a step to appear.

**Unresolved: reading a failure.** The page assumes a green run — a scenario is
there because it passed, so nothing is badged. A failed scenario shows only a
status pill and whatever frames it captured before dying: no error, no diff, no
sign of which step gave way. Playwright's own HTML report is still the only usable
account of a failure. How a failure should read here, and whether this is even the
right place to read one, is undecided.
