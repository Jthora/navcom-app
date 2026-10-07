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

/**
 * Counts sockets. By default none opens: the same shape as a phone with no signal.
 *
 * With `opens`, each one opens and stays open and silent, so the pool keeps it — and a second
 * socket to the same relay can only be a second pool, never a reconnect. The closed kind cannot
 * show that past a few seconds: nostr-tools never hears its error, gives up on the connection at
 * three seconds, and the subscription dials again a second later.
 */
async function countingSockets(page: import('@playwright/test').Page, storage: object, opts: { opens?: boolean } = {}) {
  await page.addInitScript(
    ({ seed, opens }: { seed: object; opens: boolean }) => {
      (window as unknown as { __ws: string[] }).__ws = [];
      class Counting extends EventTarget {
        static readonly OPEN = 1;
        readyState = opens ? 0 : 3;
        url: string;
        onopen: ((e: Event) => void) | null = null;
        onclose: ((e: Event) => void) | null = null;
        onerror: ((e: Event) => void) | null = null;
        onmessage: ((e: MessageEvent) => void) | null = null;
        constructor(url: string) {
          super();
          this.url = url;
          (window as unknown as { __ws: string[] }).__ws.push(url);
          setTimeout(() => {
            if (!opens) return void this.dispatchEvent(new Event('error'));
            this.readyState = 1;
            this.onopen?.(new Event('open'));
          }, 0);
        }
        send() {}
        close() {}
      }
      (globalThis as unknown as { WebSocket: unknown }).WebSocket = Counting;
      localStorage.setItem('navcom.accruing', JSON.stringify(seed));
    },
    { seed: storage, opens: opts.opens ?? false }
  );
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
  /*
   * Moving through the app must not accumulate connections: Peers adds the invite inbox on top of
   * everything Status already started.
   *
   * Moved the way an operator moves — the rail's link, one page, one pool. Two `page.goto`s were
   * two documents, each with a fresh pool and a count reset by the init script, so this measured
   * Peers on its own and let it open two sockets to every relay [audit: relay paths, review].
   */
  await countingSockets(page, WIRED, { opens: true });
  await page.goto('/terminal/');
  await page.waitForSelector('html[data-hydrated="true"]');
  await page.waitForFunction(
    (n) => (window as unknown as { __ws: string[] }).__ws.length >= n,
    DIALLED.length,
    { timeout: 10_000 }
  );

  await page.locator('nav[data-rail="all"] a[href="/terminal/peers/"]').click();
  await page.waitForURL('**/terminal/peers/');
  await expect(page.getByRole('heading', { level: 1, name: 'Peers' })).toBeVisible();
  // The invite inbox is started on mount; give it the moment it needs to dial, if it were going to.
  await page.waitForTimeout(500);

  const urls = await page.evaluate(() => (window as unknown as { __ws: string[] }).__ws);
  expect(new Set(urls).size, `opened ${urls.length} sockets across both screens: ${urls.join(', ')}`).toBe(urls.length);
  expect(new Set(urls.map((u) => u.replace(/\/$/, '')))).toEqual(new Set(DIALLED));
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

test.describe('where the Peers screen says things go [audit: relay paths, review]', () => {
  const ME = { secret: 'a'.repeat(63) + '1', callsign: 'Wren' };
  const where = (page: import('@playwright/test').Page) =>
    page.locator('details', { has: page.getByText('Where this goes') });

  test('names the relays mission traffic also goes to, beside a list that left them out', async ({ page }) => {
    // Claims and reports go where whoever posted the mission reads, whatever this list says.
    await countingSockets(page, { ...ME, relays_own: ['wss://mine.example'] });
    await page.goto('/terminal/peers/');
    await page.waitForSelector('html[data-hydrated="true"]');
    await where(page).locator('summary').click();

    await expect(where(page).locator('p.blocks')).not.toContainText('relay.damus.io');
    const missions = where(page).locator('[data-mission-relays]');
    await expect(missions).toContainText('wss://relay.damus.io');
    await expect(missions).toContainText('wss://nos.lol');
  });

  test('tells a phone holding a watch it is not under that the watch runs on this list', async ({ page }) => {
    // With no config of its own, a held watch announces and answers on these relays: editing them
    // moves it away from the relays its operators were given.
    await countingSockets(page, { ...ME, watch_secret: 'd'.repeat(63) + '7', watch_founded: true });
    await page.goto('/terminal/peers/');
    await page.waitForSelector('html[data-hydrated="true"]');
    await where(page).locator('summary').click();

    await expect(where(page).locator('[data-held-watch-relays]')).toContainText(/watch this phone holds runs on these/i);
  });

  test('says a saved list this page cannot use was set aside, rather than showing the defaults as chosen', async ({ page }) => {
    // Saved before the check: refused on any page, so the defaults stand in — and that is said.
    await countingSockets(page, { ...ME, relays_own: ['wss://relay.example:99999'] });
    await page.goto('/terminal/peers/');
    await page.waitForSelector('html[data-hydrated="true"]');

    // Open by itself, because something about the list is wrong.
    const aside = where(page).locator('[data-relays-set-aside]');
    await expect(aside).toBeVisible();
    await expect(aside).toContainText('wss://relay.example:99999');
    // The editor holds what was saved, to fix, and going back to the defaults is one tap.
    await expect(where(page).locator('[data-relay-list]')).toHaveValue('wss://relay.example:99999');
    await expect(where(page).locator('[data-relay-reset]')).toBeVisible();
  });

  /*
   * It opened because of the set-aside lines and closed when they went — so the save that fixed
   * them shut the section over the line saying what the save had done [audit: relay paths, review
   * of the fix].
   */
  test('stays open once the list is fixed, so what the save did is on the screen', async ({ page }) => {
    await countingSockets(page, { ...ME, relays_own: ['wss://relay.example:99999'] });
    await page.goto('/terminal/peers/');
    await page.waitForSelector('html[data-hydrated="true"]');
    await expect(where(page).locator('[data-relays-set-aside]')).toBeVisible();

    await where(page).locator('[data-relay-list]').fill('wss://mine.example');
    await where(page).locator('[data-relay-save]').click();
    await expect(where(page).locator('[data-relays-set-aside]')).toHaveCount(0);
    await expect(where(page)).toHaveJSProperty('open', true);
    await expect(where(page).locator('[data-relay-note]')).toBeVisible();
  });

  test('stays open after going back to the defaults, for the same reason', async ({ page }) => {
    await countingSockets(page, { ...ME, relays_own: ['wss://relay.example:99999'] });
    await page.goto('/terminal/peers/');
    await page.waitForSelector('html[data-hydrated="true"]');
    await expect(where(page).locator('[data-relays-set-aside]')).toBeVisible();

    await where(page).locator('[data-relay-reset]').click();
    await expect(where(page).locator('[data-relays-set-aside]')).toHaveCount(0);
    await expect(where(page)).toHaveJSProperty('open', true);
    await expect(where(page).locator('[data-relay-note]')).toContainText(/two that ship with the app/i);
  });
});
