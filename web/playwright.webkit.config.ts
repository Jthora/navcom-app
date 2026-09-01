import { defineConfig, devices } from '@playwright/test';

/** Pass 0: the same suite, on WebKit, once. Not added to the default run. */
export default defineConfig({
  testDir: 'e2e',
  testIgnore: ['**/real-relay.spec.ts'],
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4191' },
  projects: [{ name: 'iphone', use: { ...devices['iPhone 13'] } }],
  webServer: {
    command: 'npm run preview -- --port 4191 --strictPort',
    port: 4191,
    reuseExistingServer: true,
    timeout: 120_000
  }
});
