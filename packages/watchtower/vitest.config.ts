import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    environment: "node",
    include: ["test/**/*.test.ts"],
    /*
     * Every core, not Vitest's default of one fewer. On Vercel's two-core builder that default is one
     * worker, so the deploy ran this suite a file at a time: 341 s of wall time for 311 s of tests.
     * Most of its slow files wait on relay sockets and the ladder's timers rather than compute, so a
     * second worker overlaps them (measured 2026-11-01).
     */
    maxWorkers: availableParallelism(),
  },
});
