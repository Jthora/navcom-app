import { expect, test } from '@playwright/test';
import { seedDevice, open, TEST_SECRET } from './device';

/**
 * The live map, phase 1: the radar (the owner's map decisions, 2026-11-03).
 *
 * Blips for whoever chose to share where they are, drawn by this app with no tiles and no network:
 * on the watch, everybody on its board; on an operator's phone, themselves and where they are going.
 * Directions are the phone's own map app, handed a pin, and a person's name never goes with it.
 */

const bytes = (hex: string) => Uint8Array.from((hex.match(/../g) ?? []).map((b) => parseInt(b, 16)));
const WATCH_SECRET = '2'.repeat(63) + '7';
const PENN = { latitude: 40.7506, longitude: -73.9935 };
/** The 9th Street Drop-In, from New York's own list of drop-in centres. */
const DROP_IN = 'new-york-nycopendata-459b7897';

async function signal(sender: Uint8Array, type: 'on-station' | 'distress', payload: Record<string, unknown>, at: number) {
  const { finalizeEvent, getPublicKey } = await import('nostr-tools/pure');
  const { buildDistress, buildSignal } = await import('@navcom/core');
  const to = { pubkey: getPublicKey(bytes(WATCH_SECRET)), holders: [getPublicKey(bytes(TEST_SECRET))] };
  const built = type === 'distress' ? buildDistress(sender, to, payload as never, at) : buildSignal(sender, to, type, payload as never, at);
  return finalizeEvent(built, sender);
}

const out = (callsign: string, team: string, lat: number | null, lon = 0) => ({
  callsign, team, area: 'Midtown', expected_duration: 3600, routine_interval: null,
  share_position: lat !== null, position: lat !== null ? { lat, lon, precision_m: 0 } : null
});

test.describe('the live map', () => {
  test('on the watch: a blip for everybody who shares, the Distress marked, followed, and handed off without a name', async ({ page }) => {
    const { generateSecretKey } = await import('nostr-tools/pure');
    const now = Math.floor(Date.now() / 1000);
    const raven = generateSecretKey();
    await seedDevice(page, {
      callsign: 'Vale',
      watchSecret: WATCH_SECRET,
      relayEvents: [
        await signal(generateSecretKey(), 'on-station', out('Kite', 'Rescue Rangers', 40.7497, -73.9877), now - 60),
        await signal(raven, 'on-station', out('Raven', 'Zone Guardians', 40.7506, -73.9935), now - 60),
        await signal(generateSecretKey(), 'on-station', out('Quiet', 'Zone Guardians', null), now - 60),
        await signal(raven, 'distress', { position: { lat: 40.7506, lon: -73.9935, precision_m: 0 }, area: 'Penn Station', callsign: 'Raven' }, now - 5)
      ]
    });
    await open(page, '/terminal/watch/');
    await expect(page.locator('[data-floor] .nc-floor-row')).toHaveCount(3, { timeout: 15_000 });
    await page.locator('[data-live-map-link]').click();
    await page.waitForURL('**/terminal/map/');

    await expect(page.locator('[data-live-map]')).toHaveAttribute('data-mode', 'watch');
    const blips = page.locator('[data-radar] [data-blip]');
    await expect(blips).toHaveCount(2, { timeout: 15_000 });
    await expect(page.locator('[data-radar] [data-blip][data-state="distress"]')).toHaveCount(1);

    await page.locator('[data-listed] button', { hasText: 'Raven' }).click();
    await expect(page.getByText('Distress', { exact: true })).toBeVisible();
    await page.locator('[data-follow]').click();
    await expect(page.locator('[data-follow]')).toHaveAttribute('aria-pressed', 'true');
    const hrefs = await page.locator('[data-directions]').evaluateAll((a) => a.map((x) => (x as HTMLAnchorElement).href));
    expect(hrefs.length).toBe(4);
    for (const h of hrefs) expect(h).not.toMatch(/Raven/i);
    await expect(page.locator('[data-directions]').first()).toHaveAttribute('rel', 'noreferrer');
  });

  test('on an operator’s phone: where they are, the place an answer came from, how far, and the way there', async ({ browser }) => {
    const context = await browser.newContext({ permissions: ['geolocation'], geolocation: PENN });
    const page = await context.newPage();
    await seedDevice(page, { callsign: 'Kite', relayEvents: [] });
    await open(page, '/terminal/sign-on/');
    await page.locator('#area').fill('Penn Station');
    await page.locator('#share').selectOption('exact');
    await page.getByRole('button', { name: /^sign on$/i }).click();
    await page.waitForURL('**/terminal/');

    await open(page, `/terminal/map/?place=${DROP_IN}`);
    await expect(page.locator('[data-live-map]')).toHaveAttribute('data-mode', 'operator');
    await expect(page.locator('[data-radar] [data-blip][data-kind="self"]')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator('[data-radar] [data-blip][data-kind="place"]')).toHaveCount(1, { timeout: 15_000 });
    // Selected by the link, with how far and which way from here.
    await expect(page.locator('[data-go-distance]')).toContainText(/1\.\d km/);
    await expect(page.locator('[data-go-distance]')).toContainText(/N/);
    await expect(page.locator('[data-directions="Your map app"]')).toHaveAttribute('href', /\(9th%20Street%20Drop-In\)$/);
    await context.close();
  });

  test('a phone reloaded mid-patrol follows where it is again', async ({ browser }) => {
    // The sign-on survived a reload and nothing else did: no position went anywhere (2026-11-03).
    const context = await browser.newContext({ permissions: ['geolocation'], geolocation: PENN });
    const page = await context.newPage();
    await seedDevice(page, { callsign: 'Kite', relayEvents: [] });
    await open(page, '/terminal/sign-on/');
    await page.locator('#area').fill('Penn Station');
    await page.locator('#share').selectOption('exact');
    await page.getByRole('button', { name: /^sign on$/i }).click();
    await page.waitForURL('**/terminal/');
    await expect(page.locator('[data-sharing]')).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await page.waitForSelector('html[data-hydrated="true"]');
    await expect(page.locator('[data-station]')).toBeVisible();
    await expect(page.locator('[data-sharing]')).toBeVisible({ timeout: 15_000 });
    await context.close();
  });
});
