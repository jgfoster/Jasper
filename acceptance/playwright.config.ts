import { defineConfig } from '@playwright/test';
import { defineBddProject } from 'playwright-bdd';

/**
 * Acceptance tests drive a real VS Code (Electron) window with the Jasper
 * extension loaded, from the perspective of an end user. Slow and GUI-bound, so
 * they live outside `npm test` and run on demand with `npm run test:acceptance`.
 *
 * The Rowan suite is authored in Gherkin and run via playwright-bdd (`bddgen`
 * generates the specs from `features/` + `steps/`). Older hand-written specs
 * under `tests/` run alongside them as a second project.
 */
export default defineConfig({
  outputDir: './test-results',
  // One VS Code window at a time — the Electron app is a shared, stateful
  // resource, so parallelism would have tests fighting over the same window.
  workers: 1,
  fullyParallel: false,
  // A cold VS Code launch plus extension activation is not fast.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    // Reads the same run as a storyboard — see reporters/storyboard.html for
    // everything about how it looks.
    ['./reporters/storyboard.ts'],
  ],
  // The fixture drives VS Code over CDP and records the trace itself, so leave
  // the runner's automatic capture off to avoid double-starting tracing.
  use: {
    trace: 'off',
    screenshot: 'off',
  },
  projects: [
    defineBddProject({
      name: 'rowan',
      features: 'features/**/*.feature',
      // The fixtures file (which exports the extended `test`) must be scanned too.
      steps: ['helpers/vscode.ts', 'steps/**/*.ts'],
    }),
    {
      name: 'specs',
      testDir: './tests',
    },
  ],
});
