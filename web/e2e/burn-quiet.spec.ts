import { expect, test, type Page } from '@playwright/test';
import { seedDevice, open } from './device';

/**
 * A burn leaves nothing talking [review: relay paths].
 *
 * Burn is for seizure or compulsion, and the screen promises that nothing is left talking to
 * anybody. It tore down every connection, and a subscription that outlived its screen — the
 * region screen's, which nothing stops — reopened through a new pool a second later, to the relays
 * the burned phone had used, and went on reconnecting for as long as the tab was open. The burn
 * is a client-side navigation, so only a test that gets there the way an operator does, without a
 * reload, can see it.
 */

/** Wraps whatever socket the harness installed, and notes when each one is made. */
async function recordSockets(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const g = globalThis as unknown as { WebSocket: new (u: string) => unknown; __socketsAt: number[] };
    const Inner = g.WebSocket;
    g.__socketsAt = [];
    g.WebSocket = class extends (Inner as unknown as { new (u: string): object }) {
      constructor(u: string) {
        super(u);
        g.__socketsAt.push(Date.now());
      }
    } as unknown as typeof g.WebSocket;
  });
}

const socketsSince = (page: Page, at: number) =>
  page.evaluate((t) => (globalThis as unknown as { __socketsAt: number[] }).__socketsAt.filter((s) => s >= t).length, at);

test.describe('burning the device', () => {
  test('leaves no subscription to reopen, after a region screen opened one', async ({ page }) => {
    // A relay that answers, so the region screen's subscription is open when the burn comes.
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await recordSockets(page);
    await open(page, '/terminal/directory/st-louis/');
    await expect.poll(() => socketsSince(page, 0), { timeout: 10_000 }).toBeGreaterThan(0);

    // There the way an operator goes: links, not a reload.
    await page.getByRole('link', { name: /all areas/i }).click();
    await page.getByRole('link', { name: /status/i }).first().click();
    await page.getByRole('link', { name: /wipe this device/i }).click();
    await page.locator('#confirm').fill('Wren');

    const burnedAt = await page.evaluate(() => Date.now());
    await page.getByRole('button', { name: /burn this device/i }).click();
    // Past the first reopen, the second, and an "online" that wakes everything closed.
    await page.waitForTimeout(4_000);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForTimeout(1_000);

    expect(await socketsSince(page, burnedAt), 'a burned phone dialled a relay').toBe(0);
  });
});
