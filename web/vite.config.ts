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
    include: ['src/**/*.test.ts']
  }
});
