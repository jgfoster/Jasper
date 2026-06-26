import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    exclude: ['src/__tests__/gci/**'],
    setupFiles: [
      'src/__tests__/vitest.windowSetup.cjs', 
      'src/__tests__/vitest.uriSetup.ts',
      'src/__tests__/vitest.gemstoneIntegrationSetup.ts',
    ]
  },
});
