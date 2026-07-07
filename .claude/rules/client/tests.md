---
paths:
  - "client/**/*.test.ts"
  - "client/src/**/__tests__/**"
---

# Client tests

General test conventions (naming, three-part structure) are in `.claude/rules/tests.md`. This file covers `client/` workspace specifics.

Tests that use `useIntegrationTest` run against the real GCI shared library — do not use mocks or stubs for `GciLibrary` or any GCI calls.

## VS Code API mocking

The VS Code API is not available in tests. Vitest picks up `src/__mocks__/vscode.ts` automatically — a comprehensive manual mock of the `vscode` module. Any test importing extension code that touches the VS Code API gets it for free; no explicit import or `vi.mock()` call is needed.

Mock test helpers:
- `__resetConfig()` — clears all stored configuration values; call in `beforeEach` if your test uses `workspace.getConfiguration`.
- `__setConfig(section, key, value)` — pre-seeds a config value before the test runs.

Two vitest setup files run before every suite: `vitest.windowSetup.cjs` (polyfills `CSS.escape` for jsdom) and `vitest.uriSetup.ts` (registers a URI equality tester so `expect(uri).toEqual(otherUri)` compares by string value rather than object identity).

Query functions in `queries/` take a `QueryExecutor` — in tests, pass a `vi.fn()` returning a canned string; this avoids any GCI dependency for unit tests of query-dependent code.

<!-- Maintainer note: the fire-and-forget pattern below is tech debt in systemBrowser.ts (these calls should ideally be awaited), not a pattern to imitate. Documented as current reality so tests account for it until a follow-up fixes the underlying code. -->

Some handlers (e.g. in `systemBrowser.ts`) call async methods without awaiting them (fire-and-forget), so tests must account for the effect landing a tick later. Which tool depends on the assertion's polarity:

- **Positive assertion** ("the effect eventually happens", e.g. `expect(window.showTextDocument).toHaveBeenCalled()`): use `await vi.waitFor(() => expect(...).toHaveBeenCalled())`. It polls until the condition holds, returns as soon as it does, tolerates chains that span several ticks, and gives a diagnostic error on timeout. Prefer this over a blind flush.
- **Negative assertion** ("the effect must *not* happen", e.g. `expect(window.showTextDocument).not.toHaveBeenCalled()`): `vi.waitFor` does **not** work here — a negative expectation is already satisfied on the first poll, so it returns immediately without ever draining the fire-and-forget queue, and the bug never gets a chance to manifest. Instead, deterministically drain the queue first, then assert: `await new Promise(resolve => setTimeout(resolve, 0));`. Note this flushes only a single macrotask tick — a chain with multiple awaits/nested microtasks may need more, so **verify new negative assertions actually fail against the unfixed code before trusting them green.**

Tests run in random order; the seed is printed at the top of the output. Reproduce a run by replaying that seed via `VITEST_SEED=<seed>` (a root `SeededSequencer` in `client/vitest.config.ts` reads it and pins it into both projects for a fully reproducible file order).

## Integration tests

Tests using `useIntegrationTest` require a live GemStone instance so plain `npm test` needs a running stone. Run `npm run test:server:start` once to provision one; it writes connection details to `.env.test` (which the user may override with `.env.test.local`). CI runs these as a matrix over `client/.gemstone-integration-releases.json`. The deep GCI binding suite (`npm run test:gci`) is separate.
