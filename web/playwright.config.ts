import { defineConfig, devices } from '@playwright/test';

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

  /** `.only` left in a file must not silently narrow CI to one test. */
  forbidOnly: !!process.env['CI'],

  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: 'http://localhost:4191',
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
    }
  ],

  webServer: {
    /**
     * Serves `build/` — exactly what deploys.
     *
     * The same discipline the HTML assertions already follow: testing the source would test
     * something nobody runs.
     */
    /*
     * A port of our own, not Vite's default.
     *
     * `reuseExistingServer` reuses whatever is already listening on that port — and 4173 is
     * the default for every Vite project on the machine. A run once navigated to a different
     * application entirely and failed on a missing hydration flag, which reads exactly like a
     * bug in the screen under test. Reuse is worth keeping; colliding with every other
     * project is not.
     */
    command: 'npm run preview -- --port 4191 --strictPort',
    port: 4191,
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000
  }
});
