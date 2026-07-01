import { defineConfig } from 'vitest/config';

// Two projects so the VS Code Testing panel discovers both tiers from a single
// config (no second config file, which the extension would also auto-detect and
// double-count):
//   - 'unit' : the default suite (unit tests + the automatic GCI test that uses
//              useIntegrationTest). This is what `npm test` runs.
//   - 'gci'  : the on-demand GCI suite (src/__tests__/gci/**). It shows up in the
//              panel and can be run interactively, but is deliberately kept OUT
//              of `npm test` (the "test" script pins --project unit). Run it with
//              `npm run test:gci` (which pins --project gci).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/__tests__/**/*.test.ts'],
          exclude: ['src/__tests__/gci/**'],
          setupFiles: [
            'src/__tests__/vitest.windowSetup.cjs',
            'src/__tests__/vitest.uriSetup.ts',
          ],
          sequence: {
            shuffle: true,
            // seed: 12345, // uncomment to reproduce a specific run; seed is printed at the start of each run
          },
        },
      },
      {
        test: {
          name: 'gci',
          include: ['src/__tests__/gci/**/*.test.ts'],
          maxConcurrency: 5,
          fileParallelism: false,
          // Removes gci<pid>trace.log written by the GciTsGemTrace test on a
          // clean run; keeps them when a test failed (for debugging).
          globalSetup: ['./src/__tests__/gci/gciTraceGlobalSetup.ts'],
          setupFiles: ['./src/__tests__/gci/gciTraceCleanup.ts'],
        },
      },
    ],
  },
});
