import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

/**
 * The moment this build was made, baked into the bundle as a literal.
 *
 * It has to be a compile-time constant rather than a `load` return. A universal load re-runs
 * on the client, so `built: new Date().toISOString()` evaluates on the operator's phone and
 * reports the build as having happened just now — which is how the directory's "This copy"
 * section came to tell a three-week-old cached page it was refreshed today, and why the
 * clock check had nothing trustworthy to measure against. A literal cannot re-run.
 *
 * Read once here, not per module: a build is one moment, the same reasoning
 * `lib/server/version.ts` already gives for computing its stamp on first import and never
 * again.
 */
const BUILT_AT = new Date().toISOString();

export default defineConfig({
  define: { __BUILT_AT__: JSON.stringify(BUILT_AT) },
  plugins: [sveltekit()],
  server: {
    // The directory CSV and the docs live in the repo root, above web/.
    fs: { allow: ['..'] }
  },
  test: {
    include: ['src/**/*.test.ts'],
    /*
     * Budgets set for this repo rather than inherited from vitest.
     *
     * Six tests in one night failed as timeouts — rendered, rtl, community, car twice, and
     * fixtures. Every one of them scans the whole corpus, every one passed comfortably at 66
     * regions, and every one broke at 1,904. The default 5s test / 10s hook was written for
     * unit tests, and most of the tests here that matter most are not unit tests: this project
     * prefers a check against the built artifact, so its best guards are precisely the ones
     * that read 26,000 files.
     *
     * The failure mode is what makes this worth a config change rather than six annotations.
     * A corpus guard that dies on the clock reports **the same red as the bug it exists to
     * catch** — a fixture leak, a rendered address, a squatted link — and reads as noise
     * because re-running it alone often passes. That teaches everyone to re-run instead of to
     * read, which is how a real failure gets waved through.
     *
     * 60s is far above what any honest test here costs (the slowest corpus scan measures ~16s
     * idle) and far below a hang. It also absorbs a loaded machine: the same grep that takes
     * 8s idle took 38s at load average 16, a 4.75x penalty, which is what indexing 1,836 new
     * directories does to a laptop. Tests needing more than this say so at the call site, with
     * their measurement and its date, because a budget with no number behind it goes stale
     * silently — which is exactly how car.test.ts got here.
     */
    testTimeout: 60_000,
    hookTimeout: 120_000
  }
});
