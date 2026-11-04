import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { STREET_AREAS } from '../src/lib/map/tiles';

/**
 * navcom.app's live map, after a deploy: the one thing the browser suite cannot stand in for.
 *
 * `serve-build.mjs` answers byte ranges the way this project wrote it to. Whether Vercel does, for a
 * file of 13 to 43 MB, is a fact about Vercel: a host that compresses an extract, or answers a range with
 * the whole file, leaves the streets blank in production while every test here passes. So this asks
 * the deployment itself, once — the deploy stamp, two ranges of each extract, then a phone signed on
 * in Manhattan drawing the streets, saving them for the night, and drawing them again offline.
 *
 * Nothing leaves this machine but requests to navcom.app: every socket the page opens is answered
 * here, every `EVENT` refused, so no callsign, sign-on or position reaches a relay.
 *
 * By hand, after a deploy, never in a loop: navcom.app answers repeated automated visits with a
 * challenge. `npm run check:live-site`, with `EXPECT_COMMIT=<sha>` to fail on a deploy that is not
 * the one pushed.
 */

test.skip(!process.env['LIVE_SITE'], 'Visits navcom.app: run by hand with LIVE_SITE=1.');
/** navcom.app, or this machine's build when the check itself is being tried (`LIVE_BASE=http://localhost:<port>`). */
const BASE = process.env['LIVE_BASE'] ?? 'https://navcom.app';
const HOST = new URL(BASE).hostname;
test.use({ baseURL: BASE });

const HERALD_SQ = { latitude: 40.7497, longitude: -73.9877 };

const problems: string[] = [];
function watch(page: Page) {
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error' || /content security policy|refused to/i.test(m.text())) problems.push(`console ${m.type()}: ${m.text().slice(0, 240)}`);
  });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message.slice(0, 240)}`));
  page.on('response', (r) => {
    if (r.status() >= 400 && new URL(r.url()).hostname === HOST) problems.push(`HTTP ${r.status()}: ${r.url().slice(0, 160)}`);
  });
}

test('the deploy is the one pushed, and Vercel serves every street extract a range at a time', async ({ request }) => {
  const stamp = await (await request.get('/version.json', { headers: { 'cache-control': 'no-cache' } })).json();
  console.log(`[live] deployed ${stamp.commit}, built ${stamp.builtAt}`);
  if (process.env['EXPECT_COMMIT']) expect(stamp.commit, 'navcom.app is not serving the commit that was pushed').toBe(process.env['EXPECT_COMMIT'].slice(0, 7));

  // Each area's header, where PMTiles starts reading, and a range at its far end, where the tiles are.
  // A range answered whole, or compressed, breaks it.
  for (const area of STREET_AREAS) {
    const head = await request.get(area.url, { headers: { range: 'bytes=0-16383', 'accept-encoding': 'gzip, br' } });
    expect(head.status(), `a range of ${area.id} was not answered as a range`).toBe(206);
    expect(head.headers()['content-range']).toBe(`bytes 0-16383/${area.bytes}`);
    expect(head.headers()['content-encoding'] ?? 'identity', `Vercel compressed ${area.id}, so its byte offsets mean nothing`).toBe('identity');
    const body = await head.body();
    expect(body.length).toBe(16_384);
    expect(body.subarray(0, 7).toString('latin1'), `${area.id} is not a PMTiles file`).toBe('PMTiles');
    expect(body[7], `${area.id} is not PMTiles version 3`).toBe(3);
    // Kept by the phone, so a map not saved for the night asks for each tile once, not on every look.
    expect(head.headers()['cache-control'], `${area.id} is not cached by the phone`).toMatch(/immutable/);
    const tail = await request.get(area.url, { headers: { range: `bytes=${area.bytes - 1024}-${area.bytes - 1}` } });
    expect(tail.status()).toBe(206);
    expect((await tail.body()).length).toBe(1024);
    console.log(`[live] ${area.id}: ${head.headers()['content-type']}, cache ${head.headers()['cache-control']}, ${head.headers()['x-vercel-cache'] ?? 'no x-vercel-cache'}`);
  }
});

test('signed on in Manhattan, a phone draws the streets, saves them for the night, and draws them offline', async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ permissions: ['geolocation'], geolocation: HERALD_SQ, timezoneId: 'America/New_York' });
  // Every relay answered here, every publish refused: nothing this phone signs leaves the machine.
  await context.routeWebSocket(/.*/, (ws) => {
    ws.onMessage((m) => {
      try {
        const msg = JSON.parse(typeof m === 'string' ? m : m.toString());
        if (msg[0] === 'EVENT') ws.send(JSON.stringify(['OK', msg[1]?.id, false, 'blocked: navcom smoke test, nothing published']));
        if (msg[0] === 'REQ') ws.send(JSON.stringify(['EOSE', msg[1]]));
      } catch {
        /* not NIP-01 */
      }
    });
  });
  const page = await context.newPage();
  watch(page);
  const elsewhere: string[] = [];
  const ranges: number[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol.startsWith('http') && u.hostname !== HOST) elsewhere.push(r.url());
  });
  page.on('response', (r) => {
    if (new URL(r.url()).pathname.endsWith('.pmtiles')) ranges.push(r.status());
  });

  await page.goto('/terminal/setup/');
  await page.waitForSelector('html[data-hydrated="true"]', { timeout: 30_000 });
  await page.locator('#callsign').fill('Smoke');
  await page.getByRole('button', { name: /create profile/i }).click();
  await page.goto('/terminal/sign-on/');
  await page.waitForSelector('html[data-hydrated="true"]');
  await page.locator('#area').fill('Herald Sq');
  await page.locator('#share').selectOption('exact');
  await page.getByRole('button', { name: /^sign on$/i }).click();
  await page.waitForURL('**/terminal/');
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, { timeout: 30_000 });

  await page.goto('/terminal/map/');
  await page.waitForSelector('html[data-hydrated="true"]');
  await expect(page.locator('[data-streets][data-drawn="true"]'), 'the streets did not draw from Vercel').toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[data-streets] canvas')).toBeVisible();
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: 'test-results/live-map-streets.png' });
  expect(ranges.length).toBeGreaterThan(0);
  expect(ranges.every((s) => s === 206), `the extract was answered ${ranges.join(', ')}, not a range each time`).toBe(true);
  expect(elsewhere, 'the map asked somebody other than navcom.app').toEqual([]);

  await page.locator('[data-save-streets]').click();
  await expect(page.locator('[data-streets-state]')).toContainText('Saved on this phone', { timeout: 120_000 });
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('html[data-hydrated="true"]');
  await expect(page.locator('[data-streets][data-drawn="true"]'), 'saved for the night, the streets did not draw offline').toBeVisible({ timeout: 30_000 });
  await context.setOffline(false);

  // Leaves nothing behind on this throwaway browser, and says what it saw.
  console.log('\n===== problems\n' + (problems.length ? problems.join('\n') : 'none'));
  expect(problems.filter((p) => /tiles|\/map\/|maplibre|pmtiles|content security/i.test(p)), 'the map screen logged problems').toEqual([]);
  await context.close();
});
