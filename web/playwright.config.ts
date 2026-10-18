import { defineConfig, devices } from '@playwright/test';
import { playwrightServer } from './scripts/serve-build.mjs';

/** This checkout's server over `build/`: its port, and whether one already running may be reused. */
const served = playwrightServer();

/**
 * Browser tests, against the built output.
 *
 * The layer that was missing. Nine shipped things did not do what they said in one session,
 * and every one of them lived in the gap between "the logic is right" and "the rendered HTML
 * says the words" — a control can be fully wired, fully typed, imported by its page, and
 * simply not on screen, while every other test passes.
 *
 * See `docs/verification.md`.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,

  /**
   * The real-relay check is not part of a run.
   *
   * It starts a NIP-01 relay on this machine and drives two browser contexts through it, to
   * close the one gap `verification.md` says nothing covers. It is slower than everything
   * else here and it is a *check* rather than a test — `npm run test:relay`.
   *
   * Excluded by name rather than by directory so it still lives beside what it is about.
   */
  testIgnore: ['**/real-relay.spec.ts'],

  /**
   * **No retries, anywhere.**
   *
   * A retry turns a flaky test into a passing one and hides the flake. If something here is
   * unreliable it is either the test or the app, and both are worth knowing about.
   */
  retries: 0,

  /**
   * Fewer workers than cores, because the suite was competing with itself.
   *
   * Five runs in one session failed on tests that pass alone in one to four seconds: the
   * service-worker area check, a thumb-reach measurement, two setup flows, a correction. Every
   * one of them blew a 30-second timeout under full parallelism and every page snapshot showed
   * exactly the content the assertion wanted. The common factor was load, not the test and not
   * the app — the third case the retries note below does not cover.
   *
   * **This hides nothing.** A retry would turn a flake into a pass; capping concurrency stops
   * manufacturing the flake. The cost is wall-clock on a suite that runs in minutes, and the
   * thing it buys is a deploy gate — `vercel.json` runs this as the build command, so a loaded
   * build container could fail a release for reasons that have nothing to do with the release.
   */
  workers: process.env['CI'] ? 2 : '50%',

  /** `.only` left in a file must not silently narrow CI to one test. */
  forbidOnly: !!process.env['CI'],

  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: served.baseURL,
    trace: 'retain-on-failure'
  },

  projects: [
    {
      /**
       * A phone, not a desktop.
       *
       * The device floor is a prepaid Android 8 held one-handed in the dark. Testing at
       * 1280px would pass layouts that no operator will ever see, and this project's whole
       * argument is about what actually reaches a person.
       */
      name: 'phone',
      use: { ...devices['Pixel 5'] }
    },
    {
      /**
       * The one deliberate exception to "phone, not desktop."
       *
       * The root console (`routes/+page.svelte`) is not the Field Terminal — it is the one
       * screen this project explicitly expects a desktop visitor to see first, and its
       * side-by-side Nav/Com bridge only exists above a 48rem breakpoint. The phone project
       * alone would never render it, and the white-margin bug this console shipped with was
       * only ever visible on a desktop monitor in the first place — scoped by `testMatch`
       * rather than applied everywhere, so this stays the one named exception, not a second
       * default.
       */
      name: 'desktop',
      testMatch: /root-console\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } }
    }
  ],

  /**
   * Serves `build/`, which is what deploys, through `scripts/serve-build.mjs`.
   *
   * This comment used to say the same thing while the command ran `vite preview`, which serves
   * `.svelte-kit/output` with an SSR fallback. So `prune-data`, `slim-html` and anything else
   * written into `build/` after `vite build` was never in front of a browser, and a path the
   * host would 404 could still render. `e2e/served-build.spec.ts` now fails if that comes back.
   *
   * The port is this checkout's own (a hash of its path, or `NAVCOM_E2E_PORT`), not a fixed
   * one. A fixed port with `reuseExistingServer` reused whatever was listening: 4173 once put a
   * different application under the suite, and with workflows running in worktrees a second
   * run could test another checkout's build. A running server is now reused only when it is
   * this checkout's serve-build, as its files stand now, over `build/`, and its `/version.json`
   * matches this build's. Anything else on the port stops the run with the reason.
   *
   * `pretest:browser` writes `build/.well-known/` before the suite, so the receipt production
   * always has is in front of the browser too.
   */
  webServer: served.webServer
});
