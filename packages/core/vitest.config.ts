import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    /*
     * Every core, not Vitest's default of one fewer. On Vercel's two-core builder that default is one
     * worker, so the deploy ran this suite a file at a time, with the second core idle: 192 s of wall
     * time for 153 s of tests (measured 2026-11-01).
     */
    maxWorkers: availableParallelism(),
  }
});
