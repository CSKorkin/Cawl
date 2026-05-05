import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
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
