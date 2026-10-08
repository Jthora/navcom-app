import { expect, test, type Page } from '@playwright/test';
import { seedDevice, open, serviceWorkerReady } from './device';
import { noticeFor } from '../src/lib/terminal/page-notice';

/**
 * What a pushed page shows, through the worker that ships [`escalation.spec.md`, *A page says what
 * kind it is*].
 *
 * The worker showed every page under one tag with no `renotify`. On Chromium and Firefox a card that
 * replaces another with the same tag makes no sound, so a repeat to the person who acknowledged was
 * heard only if they had cleared the first card; it read as a new `Distress`; it erased another
 * operator's unanswered card and its one-tap link; and a drill read as "NavCom — Distress", because
 * the kind was never read. `page-notice.test.ts` holds the rules; this proves the built worker
 * follows them, with real pushes delivered over the DevTools protocol and the cards read back from
 * the registration.
 */

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

interface Card {
  title: string;
  tag: string;
  url: string | null;
  requireInteraction: boolean;
}

/** The cards this registration is showing now. */
async function cards(page: Page): Promise<Card[]> {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return (await registration.getNotifications()).map((n) => ({
      title: n.title,
      tag: n.tag,
      url: ((n.data ?? {}) as { url?: string }).url ?? null,
      requireInteraction: n.requireInteraction
    }));
  });
}

/** A push, as the push service hands it to the worker. */
async function pusher(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const registrations: { registrationId: string; scopeURL: string }[] = [];
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e: { registrations: { registrationId: string; scopeURL: string }[] }) => {
    registrations.push(...e.registrations);
  });
  await cdp.send('ServiceWorker.enable');
  await expect.poll(() => registrations.length, { timeout: 10_000 }).toBeGreaterThan(0);
  const origin = new URL(page.url()).origin;
  const registrationId = registrations.find((r) => r.scopeURL.startsWith(origin))!.registrationId;
  return async (data: unknown) => {
    await cdp.send('ServiceWorker.deliverPushMessage', {
      origin,
      registrationId,
      data: typeof data === 'string' ? data : JSON.stringify(data)
    });
    /*
     * Each push is on the screen before the next is sent: replacement, not a race, is what is under
     * test. Waited for, never a fixed pause — on a loaded machine a close-then-show takes longer than
     * any pause, and the next push would then race it. The card it should leave is the one the rules
     * say (`noticeFor`), up to the arrival time a repeat's address carries.
     */
    let parsed: unknown = data;
    if (typeof data === 'string') {
      try {
        parsed = JSON.parse(data);
      } catch {
        parsed = null;
      }
    }
    const want = noticeFor(parsed, '', Math.floor(Date.now() / 1000));
    const stem = (url: string | null) => (url ?? '').split('&paged=')[0]!;
    await expect
      .poll(async () => (await cards(page)).some((c) => c.tag === want.tag && stem(c.url).endsWith(stem(want.url))), {
        timeout: 15_000
      })
      .toBe(true);
  };
}

test.describe('pages, as the worker shows them', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'DevTools push delivery is Chromium’s');

  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['notifications']);
    await seedDevice(page, { callsign: 'Wren' });
    await open(page, '/terminal/');
    await serviceWorkerReady(page);
    // A browser that keeps no notifications cannot show any of this; said, never passed vacuously.
    const keeps = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      try {
        await registration.showNotification('probe', { tag: 'probe' });
        const found = await registration.getNotifications({ tag: 'probe' });
        found.forEach((n) => n.close());
        return found.length > 0;
      } catch {
        return false;
      }
    });
    test.skip(!keeps, 'this browser keeps no notifications, so nothing here can be read back');
  });

  test('a repeat never replaces a first page, and opens the wake screen, never the acknowledgement', async ({ page }) => {
    const push = await pusher(page);
    await push({ kind: 'first', drill: false, distress: A });
    await push({ kind: 'repeat', drill: false, attempt: B, distress: C });
    const shown = await cards(page);
    expect(shown.map((c) => c.title).sort()).toEqual(['NavCom — Distress', 'NavCom — Someone you answered sent again']);
    expect(shown.find((c) => c.title === 'NavCom — Distress')?.url).toMatch(new RegExp(`/terminal/\\?ack=${A}$`));
    const repeat = shown.find((c) => c.tag === 'navcom-repeat')!;
    expect(repeat.url).toContain(`/terminal/wake/?attempt=${B}`);
    expect(repeat.url, 'a repeat offered the one-tap acknowledgement').not.toContain('ack=');
    expect(repeat.requireInteraction).toBe(true);
  });

  test('two ladders keep two cards, each with its own link', async ({ page }) => {
    const push = await pusher(page);
    await push({ kind: 'first', distress: A });
    await push({ kind: 'first', distress: B });
    const links = (await cards(page)).map((c) => c.url ?? '').sort();
    expect(links).toHaveLength(2);
    expect(links[0]).toMatch(new RegExp(`\\?ack=${A}$`));
    expect(links[1]).toMatch(new RegExp(`\\?ack=${B}$`));
  });

  test('consecutive repeats leave one card, the latest', async ({ page }) => {
    const push = await pusher(page);
    await push({ kind: 'repeat', attempt: A });
    await push({ kind: 'repeat', attempt: B });
    const repeats = (await cards(page)).filter((c) => c.tag === 'navcom-repeat');
    expect(repeats).toHaveLength(1);
    expect(repeats[0]!.url).toContain(B);
  });

  test('an unknown kind, or none, or no data that parses, shows as a first page', async ({ page }) => {
    const push = await pusher(page);
    await push({ kind: 'later-version', distress: A });
    await push('not json at all');
    const titles = (await cards(page)).map((c) => c.title);
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.every((t) => t === 'NavCom — Distress')).toBe(true);
  });

  test('a drill reads as a drill, by kind and by the older flag', async ({ page }) => {
    const push = await pusher(page);
    await push({ kind: 'drill', drill: true });
    let drills = (await cards(page)).filter((c) => c.tag === 'navcom-drill');
    expect(drills.map((c) => c.title)).toEqual(['NavCom drill — not an emergency']);
    await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).forEach((n) => n.close()));
    await push({ drill: true });
    drills = (await cards(page)).filter((c) => c.tag === 'navcom-drill');
    expect(drills.map((c) => c.title)).toEqual(['NavCom drill — not an emergency']);
  });
});
