import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // Use jsdom for everything: component tests need it, and engine tests
    // don't touch the DOM so the small startup cost is irrelevant. Vitest 3
    // deprecated environmentMatchGlobs in favor of `projects`, which is more
    // configuration than the marginal speed gain warrants here.
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/engine/**/*.ts'],
      exclude: [
        'src/engine/**/*.test.ts',
        'src/engine/index.ts',
        'src/engine/__fixtures__/**',
      ],
      reporter: ['text', 'html'],
      thresholds: {
        'src/engine/state.ts': {
          lines: 95,
          branches: 95,
          functions: 95,
          statements: 95,
        },
        'src/engine/matrix.ts': {
          lines: 95,
          branches: 95,
          functions: 95,
          statements: 95,
        },
        'src/engine/score.ts': {
          lines: 95,
          branches: 95,
          functions: 95,
          statements: 95,
        },
        'src/engine/rng.ts': {
          lines: 95,
          branches: 95,
          functions: 95,
          statements: 95,
        },
      },
    },
  },
});
