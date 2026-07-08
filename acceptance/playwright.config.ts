import { defineConfig } from '@playwright/test';

/**
 * Acceptance tests drive a real VS Code (Electron) window with the Jasper
 * extension loaded, from the perspective of an end user. They are slow and
 * GUI-bound, so they live outside `npm test` and are run on demand with
 * `npm run test:acceptance`.
 *
 * `trace: 'on'` is the whole point of the reporting story: every action is
 * captured with a before/after DOM snapshot, so after a run you flip through
 * the screenshots step by step with `npm run test:acceptance:report`.
 */
export default defineConfig({
  testDir: './tests',
  // Keep per-test artifacts (screenshots, traces on failure) alongside the rest
  // of the acceptance output rather than in a repo-root `test-results/`.
  outputDir: './test-results',
  // One VS Code window at a time — the Electron app is a shared, stateful
  // resource, so parallelism would have tests fighting over the same window.
  workers: 1,
  fullyParallel: false,
  // A cold VS Code launch plus extension activation is not fast.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  // The fixture drives VS Code over a CDP connection and records the trace
  // itself (the runner's built-in trace only covers browsers it launches), so
  // leave the automatic capture off to avoid double-starting tracing.
  use: {
    trace: 'off',
    screenshot: 'off',
  },
});
