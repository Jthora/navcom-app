import { expect, test } from '@playwright/test';

/**
 * What this app asks of somebody else's relay.
 *
 * Relays are strangers running a free service for volunteers. Every connection is a TCP and
 * TLS handshake they pay for, and most of them cap connections per IP. Being a good guest
 * there is not politeness — a relay that rate-limits us is a relay that drops a `Distress`.
 *
 * Seven modules each used to construct their own `SimplePool`. A pool deduplicates
 * connections within itself and knows nothing about the other six, so one relay got three
 * sockets on the Status screen alone and more as the operator moved through the app.
 */

/** Counts sockets without opening any. Same shape as a phone with no signal. */
async function countingSockets(page: import('@playwright/test').Page, storage: object) {
  await page.addInitScript((seed: object) => {
    (window as unknown as { __ws: string[] }).__ws = [];
    class Counting extends EventTarget {
      readyState = 3;
      url: string;
      constructor(url: string) {
        super();
        this.url = url;
        (window as unknown as { __ws: string[] }).__ws.push(url);
        setTimeout(() => this.dispatchEvent(new Event('error')), 0);
      }
      send() {}
      close() {}
    }
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = Counting;
    localStorage.setItem('navcom.accruing', JSON.stringify(seed));
  }, storage);
}

const WIRED = {
  secret: 'a'.repeat(63) + '1',
  callsign: 'Wren',
  watchtower: 'b'.repeat(64),
  relays: ['wss://relay.example'],
  peers: [{ pubkey: 'c'.repeat(64), callsign: 'Raven', since: 0 }]
};

/** The watch's relay, and beside it the defaults everything else also goes to [audit: relay paths, F15]. */
const DIALLED = ['wss://relay.example', 'wss://relay.damus.io', 'wss://nos.lol'];

test('opens one connection per relay, not one per module', async ({ page }) => {
  // Status alone starts the watch reader, peer presence and the key-bundle fetcher. Three
  // subscriptions, and one socket to each relay they use between them — never two to one.
  await countingSockets(page, WIRED);
  await page.goto('/terminal/');
  await page.waitForSelector('html[data-hydrated="true"]');
  await page.waitForFunction(() => (window as unknown as { __ws: string[] }).__ws.length >= 3, undefined, { timeout: 10_000 });

  const urls = await page.evaluate(() => (window as unknown as { __ws: string[] }).__ws);
  expect(new Set(urls).size, `opened ${urls.length} sockets: ${urls.join(', ')}`).toBe(urls.length);
  expect(new Set(urls.map((u) => u.replace(/\/$/, '')))).toEqual(new Set(DIALLED));
});

test('does not open one per screen either', async ({ page }) => {
  // Moving through the app must not accumulate connections. Peers adds the invite inbox on
  // top of everything Status already started.
  await countingSockets(page, WIRED);
  await page.goto('/terminal/');
  await page.waitForSelector('html[data-hydrated="true"]');
  await page.goto('/terminal/peers/');
  await page.waitForSelector('html[data-hydrated="true"]');

  const urls = await page.evaluate(() => (window as unknown as { __ws: string[] }).__ws);
  expect(new Set(urls.map((u) => u.replace(/\/$/, ''))), 'distinct relays').toEqual(new Set(DIALLED));
  // Two page loads: at most one socket per relay for each.
  expect(urls.length, 'total sockets across two screens').toBeLessThanOrEqual(2 * DIALLED.length);
});

test('opens nothing at all for an operator who has no relay reason to', async ({ page }) => {
  // No watch, no peers. There is nobody to talk to, so nothing should be dialled — an
  // operator working alone should not be generating traffic for a stranger to log.
  await countingSockets(page, { secret: 'a'.repeat(63) + '1', callsign: 'Wren' });
  await page.goto('/terminal/');
  await page.waitForSelector('html[data-hydrated="true"]');
  await page.waitForTimeout(500);

  expect(await page.evaluate(() => (window as unknown as { __ws: string[] }).__ws)).toEqual([]);
});
