import { expect, test } from '@playwright/test';
import { blankDevice, seedDevice, open } from './device';

/**
 * Asking the browser to keep this device's data — once, and only once.
 *
 * `delivery.md` names eviction as what decides whether the cached directory is there at 2am,
 * on a device floor of a prepaid Android 8 with 400MB free, and the app never asked. The
 * browser has an API for exactly that.
 *
 * The reason it is not simply called on load is the whole design. **Firefox shows a
 * permission prompt for `persist()`**, and an unexpected prompt on a field terminal is the
 * banner-shaped interruption this project bans everywhere else. So it is asked at callsign
 * creation — a deliberate, unhurried moment the operator chose to be in — and never again.
 *
 * Both halves are asserted, because either alone is satisfied by a broken implementation:
 * one that never asks, and one that asks on every screen.
 */

/** Records calls without granting, so nothing here depends on the browser's real policy. */
const spy = (page: import('@playwright/test').Page) =>
  page.addInitScript(() => {
    const w = globalThis as unknown as { __persistCalls: number };
    w.__persistCalls = 0;
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        persisted: async () => false,
        persist: async () => {
          w.__persistCalls++;
          return false;
        }
      }
    });
  });

const calls = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (globalThis as unknown as { __persistCalls: number }).__persistCalls);

test('is asked when a callsign is created', async ({ page }) => {
  await blankDevice(page);
  await spy(page);
  await open(page, '/terminal/setup/');
  expect(await calls(page), 'asked before the operator did anything').toBe(0);

  await page.locator('#callsign').fill('Wren');
  await page.getByRole('button', { name: /generate keypair/i }).click();
  await expect(page.getByText(/wren/i).first()).toBeVisible({ timeout: 10_000 });

  expect(await calls(page), 'never asked, so eviction protection was never requested').toBe(1);
});

test('and never again, on the screens somebody opens while something is happening', async ({
  page
}) => {
  /*
   * The guard that matters more than the one above. A prompt fired from Status, Distress or
   * the directory is the thing this project refuses — worst on the screen somebody reaches
   * for in the dark. An implementation that asked on every load would satisfy the test above
   * perfectly.
   */
  await seedDevice(page, { callsign: 'Wren' });
  await spy(page);
  for (const path of ['/terminal/', '/terminal/distress/', '/terminal/directory/st-louis/']) {
    await open(page, path);
    expect(await calls(page), `${path} asked for persistent storage`).toBe(0);
  }
});
