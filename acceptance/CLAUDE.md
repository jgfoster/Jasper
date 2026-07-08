# Acceptance tests (Playwright)

End-to-end tests that drive a real VS Code window via Playwright's Electron support — see [README.md](README.md) for how to run them (docker vs. local), flip through trace screenshots, and current scope. They are **not** part of `npm test`; specs live in `tests/*.spec.ts`, not `*.test.ts`, so the repo-wide `.claude/rules/tests.md` naming/structure conventions do **not** auto-load for these files — Playwright's own `test.describe`/`test` idioms apply instead.

- `helpers/vscode.ts` — downloads a pinned VS Code build and launches it with this repo as the extension-development path.
- `helpers/testStone.ts` / `helpers/containerStone.ts` — provision the GemStone stone a spec connects to (local vs. in-container).
- `helpers/rowan.ts`, `helpers/seaside.ts` — scenario-specific setup for the Rowan load and Seaside serve e2e flows.

<!-- Maintainer note (stripped from agent context): keep this file a pointer to README.md, not a duplicate of it — README is the human-facing usage doc, this is what an agent needs before touching acceptance/ code. -->
