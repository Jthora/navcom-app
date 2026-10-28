import { defineConfig, devices } from '@playwright/test';
import { playwrightServer } from './scripts/serve-build.mjs';

/** The same server, port and reuse rule as `playwright.config.ts`. */
const served = playwrightServer();

/** Pass 0: the same suite, on WebKit, once. Not added to the default run. */
export default defineConfig({
  testDir: 'e2e',
  testIgnore: ['**/real-relay.spec.ts', '**/live-*.spec.ts'],
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: served.baseURL },
  projects: [{ name: 'iphone', use: { ...devices['iPhone 13'] } }],
  /*
   * This config used to reuse whatever held port 4191, always, so a WebKit pass could run
   * against another checkout's build or another project. It reuses only this build now.
   */
  webServer: served.webServer
});
