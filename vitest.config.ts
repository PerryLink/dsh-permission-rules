import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // The browser client half runs in the web UI; this repo has no client
      // test harness, so it is excluded from the host-side coverage gate.
      exclude: ['src/index.ts', 'src/client/**'],
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90,
      },
    },
  },
})
