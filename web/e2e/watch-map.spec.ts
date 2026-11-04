import { expect, test } from '@playwright/test';
import { seedDevice, open, serviceWorkerReady, TEST_SECRET } from './device';

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
    // In Manhattan the map opens on its streets; the radar is one tap away, with the same blips.
    await page.locator('[data-view="radar"]').click();
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
    await page.locator('[data-view="radar"]').click();
    await expect(page.locator('[data-radar] [data-blip][data-kind="self"]')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator('[data-radar] [data-blip][data-kind="place"]')).toHaveCount(1, { timeout: 15_000 });
    // Selected by the link, with how far and which way from here.
    await expect(page.locator('[data-go-distance]')).toContainText(/1\.\d km/);
    await expect(page.locator('[data-go-distance]')).toContainText(/N/);
    await expect(page.locator('[data-directions="Your map app"]')).toHaveAttribute('href', /\(9th%20Street%20Drop-In\)$/);
    // Where anybody was is the watch's alone: no trail on an operator's phone, theirs included.
    await expect(page.locator('[data-trail]')).toHaveCount(0);
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

  test('the streets: drawn from our own extract, asking nobody but navcom.app, and saved for tonight they draw with no network', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ permissions: ['geolocation'], geolocation: PENN });
    const page = await context.newPage();
    const asked: string[] = [];
    const failed: string[] = [];
    const ranges: number[] = [];
    page.on('request', (r) => asked.push(r.url()));
    page.on('response', (r) => {
      const path = new URL(r.url()).pathname;
      if (r.status() >= 400) failed.push(`${r.status()} ${path}`);
      if (path.endsWith('.pmtiles')) ranges.push(r.status());
    });
    await seedDevice(page, { callsign: 'Kite', relayEvents: [] });
    await open(page, '/terminal/sign-on/');
    await page.locator('#area').fill('Penn Station');
    await page.locator('#share').selectOption('exact');
    await page.getByRole('button', { name: /^sign on$/i }).click();
    await page.waitForURL('**/terminal/');
    await serviceWorkerReady(page);

    await open(page, '/terminal/map/');
    await expect(page.locator('[data-streets][data-drawn="true"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-streets] canvas')).toBeVisible();
    await expect(page.locator('[data-streets-state]')).toContainText('Not saved');
    // Every request this screen made went to navcom.app, its tiles a range at a time, its fonts found.
    const here = new URL(page.url()).host;
    const elsewhere = asked.filter((u) => /^https?:/.test(u) && new URL(u).host !== here);
    expect(elsewhere, 'the map asked a third party').toEqual([]);
    expect(ranges.length).toBeGreaterThan(0);
    expect(ranges.every((s) => s === 206)).toBe(true);
    expect(failed.filter((f) => f.includes('/map/') || f.includes('/tiles/'))).toEqual([]);

    // Manhattan, where the phone is, is the one offered; the rest are listed under it.
    await expect(page.locator('[data-save-streets]')).toContainText('Save Manhattan for tonight');
    await expect(page.locator('[data-street-areas] [data-area]')).toHaveCount(5);
    // Saved for tonight, then the signal goes: the streets come from the phone alone.
    await page.locator('[data-save-streets]').click();
    await expect(page.locator('[data-streets-state]')).toContainText('Saved on this phone', { timeout: 60_000 });
    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector('html[data-hydrated="true"]');
    await expect(page.locator('[data-streets][data-drawn="true"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-streets-state]')).toContainText('Saved on this phone');
    await context.close();
  });

  test('the radar, chosen, or wherever the streets cannot be drawn', async ({ browser }) => {
    const context = await browser.newContext({ permissions: ['geolocation'], geolocation: PENN });
    const page = await context.newPage();
    // A phone with no WebGL: the radar, saying why, and the same blips.
    await page.addInitScript(() => {
      const real = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
        return kind.startsWith('webgl') ? null : (real as (...a: unknown[]) => unknown).call(this, kind, ...rest);
      } as typeof real;
    });
    await seedDevice(page, { callsign: 'Kite', relayEvents: [] });
    await open(page, '/terminal/sign-on/');
    await page.locator('#area').fill('Penn Station');
    await page.locator('#share').selectOption('exact');
    await page.getByRole('button', { name: /^sign on$/i }).click();
    await page.waitForURL('**/terminal/');
    await open(page, '/terminal/map/');
    await expect(page.locator('[data-radar]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-streets-state]')).toContainText('Cannot draw them here');
    await expect(page.locator('[data-radar] [data-blip][data-kind="self"]')).toHaveCount(1);
    await context.close();
  });

  test('outside the city: the radar, OpenFreeMap only when pressed, said first, and never kept past the visit', async ({ browser }) => {
    test.setTimeout(90_000);
    // Hempstead, Long Island: east of Queens, past every extract's edge.
    const context = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: 40.7062, longitude: -73.6187 } });
    const page = await context.newPage();
    // OpenFreeMap stood in for, so the suite never asks the real one: a style with nothing but ground.
    const asked: string[] = [];
    await context.route('https://tiles.openfreemap.org/**', (route) => {
      asked.push(route.request().url());
      return new URL(route.request().url()).pathname.startsWith('/styles/')
        ? route.fulfill({ json: { version: 8, sources: {}, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', layers: [{ id: 'ground', type: 'background', paint: { 'background-color': '#111111' } }] } })
        : route.fulfill({ status: 404, body: '' });
    });
    await seedDevice(page, { callsign: 'Kite', relayEvents: [] });
    await open(page, '/terminal/sign-on/');
    await page.locator('#area').fill('Hempstead');
    await page.locator('#share').selectOption('exact');
    await page.getByRole('button', { name: /^sign on$/i }).click();
    await page.waitForURL('**/terminal/');

    await open(page, '/terminal/map/');
    await expect(page.locator('[data-radar]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-streets-state]')).toContainText('Not here');
    await expect(page.locator('[data-streets-state]')).toContainText('New York City and the New Jersey side only');
    // What pressing costs, on the screen before it is pressed; and nothing asked yet.
    await expect(page.locator('[data-openfreemap-cost]')).toContainText('which streets you look at');
    expect(asked).toEqual([]);

    await page.locator('[data-openfreemap]').click();
    await expect(page.locator('[data-streets][data-drawn="true"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-streets-state]')).toContainText('From OpenFreeMap');
    expect(asked.some((u) => u === 'https://tiles.openfreemap.org/styles/dark')).toBe(true);

    // Never kept: a reload is the radar again, and asks nobody.
    asked.length = 0;
    await page.reload();
    await page.waitForSelector('html[data-hydrated="true"]');
    await expect(page.locator('[data-radar]')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1_000);
    expect(asked).toEqual([]);
    await context.close();
  });

  test('a board filling while the streets load builds one map, not one for every position that arrives', async ({ browser }) => {
    // The mount read the centre, so each position heard while the engine was still loading started
    // another map and threw the last away: on a busy board, several engines built on a phone to show one.
    test.setTimeout(90_000);
    const context = await browser.newContext({ viewport: { width: 360, height: 640 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const w = window as unknown as { __maps: number };
      w.__maps = 0;
      new MutationObserver((changes) => {
        for (const c of changes) for (const n of c.addedNodes) if (n instanceof HTMLElement && n.classList.contains('maplibregl-canvas-container')) w.__maps += 1;
      }).observe(document, { subtree: true, childList: true });
    });
    const now = Math.floor(Date.now() / 1000);
    const events = [];
    for (let i = 0; i < 8; i++) events.push(await signal(new Uint8Array(32).fill(i + 3), 'on-station', out(`Unit ${i}`, 'Rescue Rangers', 40.745 + i * 0.002, -73.99 + i * 0.001), now - 60 + i));
    await seedDevice(page, { callsign: 'Lighthouse', watchSecret: WATCH_SECRET, relayEvents: events.slice(0, 1) });
    await open(page, '/terminal/map/');
    // The rest trickle in while the engine is loading, as a board's do.
    for (const e of events.slice(1)) {
      await page.evaluate((x) => (window as unknown as { __navcomDeliver: (e: unknown) => number }).__navcomDeliver(x), e);
      await page.waitForTimeout(120);
    }
    await expect(page.locator('[data-streets][data-drawn="true"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-blip-list] [data-listed]')).toHaveCount(8);
    await page.waitForTimeout(1_500);
    expect(await page.evaluate(() => (window as unknown as { __maps: number }).__maps), 'maps built for one screen').toBe(1);
    await context.close();
  });

  test('a borough across the river draws from its own extract, and with no signal and nothing saved, the radar', async ({ browser }) => {
    test.setTimeout(120_000);
    // Flushing, Queens: once outside the streets, now inside one of six.
    const context = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: 40.7675, longitude: -73.833 } });
    const page = await context.newPage();
    const read: string[] = [];
    page.on('response', (r) => {
      const path = new URL(r.url()).pathname;
      if (path.endsWith('.pmtiles')) read.push(path);
    });
    await seedDevice(page, { callsign: 'Kite', relayEvents: [] });
    await open(page, '/terminal/sign-on/');
    await page.locator('#area').fill('Flushing');
    await page.locator('#share').selectOption('exact');
    await page.getByRole('button', { name: /^sign on$/i }).click();
    await page.waitForURL('**/terminal/');
    await serviceWorkerReady(page);

    await open(page, '/terminal/map/');
    await expect(page.locator('[data-streets][data-drawn="true"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-streets-state]')).toContainText('Queens, read from navcom.app');
    await expect(page.locator('[data-save-streets]')).toContainText('Save Queens for tonight');
    expect(read.some((p) => p.includes('/tiles/queens-')), 'Queens was not read from its own extract').toBe(true);

    // The signal goes, with nothing saved: a blank street map would read as a broken one.
    await context.setOffline(true);
    await expect(page.locator('[data-radar]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-streets-state]')).toContainText('no signal');
    await expect(page.locator('[data-radar] [data-blip][data-kind="self"]')).toHaveCount(1);
    await context.close();
  });

  test('the watch sees the last ten minutes behind each blip, and an operator never does', async ({ browser }) => {
    test.setTimeout(90_000);
    const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const now = Math.floor(Date.now() / 1000);
    const kite = generateSecretKey();
    const at = (metres: number) => ({ lat: 40.7497 + metres / 111_320, lon: -73.9877, precision_m: 0 });
    const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    await seedDevice(page, { callsign: 'Vale', watchSecret: WATCH_SECRET, relayEvents: [await signal(kite, 'on-station', out('Kite', 'Rescue Rangers', 40.7497, -73.9877), now - 500)] });
    await open(page, '/terminal/map/');
    await page.locator('[data-view="radar"]').click();
    for (const [metres, ago] of [[60, 300], [120, 120], [180, 30]] as const) {
      const moved = await signal(kite, 'position' as never, { position: at(metres) }, now - ago);
      await page.evaluate((x) => (window as unknown as { __navcomDeliver: (e: unknown) => number }).__navcomDeliver(x), moved);
    }
    const trail = page.locator(`[data-radar] [data-trail="${getPublicKey(kite)}"]`);
    await expect(trail).toHaveCount(1, { timeout: 15_000 });
    // Where they signed on, and three moves: four points from the oldest to where they are now.
    expect((await trail.getAttribute('points'))!.trim().split(/\s+/).length).toBe(4);
    await context.close();
  });
});
