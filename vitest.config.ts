import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Many suites start Git, Node, and PowerShell subprocesses of their own.
    // Bound file-level workers so high-core Windows hosts do not oversubscribe
    // those process trees and turn deterministic 1-20s tests into 30s timeouts.
    maxWorkers: 4,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
    },
  },
});
