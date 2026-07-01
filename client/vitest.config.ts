import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    exclude: ['src/__tests__/gci/**'],
    setupFiles: [
      'src/__tests__/vitest.windowSetup.cjs',
      'src/__tests__/vitest.uriSetup.ts'
    ],
    sequence: {
      shuffle: true,
      // seed: 12345, // uncomment to reproduce a specific run; seed is printed at the start of each run
    },
  },
});
