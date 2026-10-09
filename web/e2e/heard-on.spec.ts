import { expect, test, type Page } from '@playwright/test';
import { seedDevice, open, holdUntil } from './device';

/**
 * *Heard on*: where the watch is heard, in relays, said before anybody relies on it [relay-lists §7].
 *
 * The receipt said what the watch could do and nothing about where: a watch heard on one relay of
 * three is a watch a `Distress` reaches through that one relay only. Three relays here, each a
 * different night: `a` serves the watch's fresh state, `b` answers with nothing, and `c` refuses
 * the watch-state request the way a relay that wants AUTH before it serves anything does. Only `a`
 * counts, and the screens say so, relay by relay, and that the count is of relays and not people.
 *
 * And the `Distress` screen shows the count this phone already holds, with its age, and opens no
 * read of its own until a `Distress` starts.
 *
 * Other nights: two relays of three serving the watch with The Record among its relays, so the
 * denominator is drawn and The Record is shown outside it; none serving it; and none answering at
 * all, which is unknown rather than none.
 */

const RELAYS = ['wss://a.relay', 'wss://b.relay', 'wss://c.relay'];

/** A fresh state from the watch, signed in Node where the key is. */
async function freshState(): Promise<{ pubkey: string; event: unknown }> {
  const { finalizeEvent, generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
  const { buildWatchStateEvent } = await import('@navcom/core');
  const secret = generateSecretKey();
  const now = Math.floor(Date.now() / 1000);
  const event = finalizeEvent(
    buildWatchStateEvent(
      { state: 'automated', holder: 'nightwatch', holder_kind: 'agent', oncall: [], since: now - 600, agent_health: 'ok', last_drill: null, now },
      now
    ),
    secret
  );
  return { pubkey: getPublicKey(secret), event };
}

interface Night {
  /** Hosts that serve the watch's fresh state. The rest answer with nothing, unless they refuse. */
  serving?: string[];
  /** Hosts that refuse the watch-state request, as a relay that wants AUTH before it serves anything. */
  refusing?: string[];
}

/**
 * Relays told apart by host. Installed after the harness's socket, so it wins. Records every
 * watch-state request with the relay it went to and when, takes every publish, and notes when
 * Status's receipt leaves the page once a test has said it is leaving.
 */
async function standIn(page: Page, served: unknown, night: Night = {}): Promise<void> {
  const serving = night.serving ?? ['a.relay'];
  const refusing = night.refusing ?? ['c.relay'];
  await page.addInitScript(
    ({ event, serving, refusing }: { event: { id: string; pubkey: string }; serving: string[]; refusing: string[] }) => {
      const g = globalThis as unknown as {
        __stateAsked: { host: string; at: number }[];
        __leaving: boolean;
        __statusGoneAt: number | null;
        WebSocket: unknown;
      };
      const asked: { host: string; at: number }[] = [];
      g.__stateAsked = asked;
      g.__leaving = false;
      g.__statusGoneAt = null;
      // Status's own teardown closes its read in the same flush that removes its receipt, so a
      // request after this moment is not Status's.
      new MutationObserver(() => {
        if (g.__leaving && g.__statusGoneAt === null && !document.querySelector('[data-capability]')) {
          g.__statusGoneAt = performance.now();
        }
      }).observe(document, { childList: true, subtree: true });
      class StandIn extends EventTarget {
        static readonly CONNECTING = 0;
        static readonly OPEN = 1;
        static readonly CLOSING = 2;
        static readonly CLOSED = 3;
        readyState = 0;
        onopen: ((e: unknown) => void) | null = null;
        onclose: ((e: unknown) => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        onmessage: ((e: unknown) => void) | null = null;
        constructor(readonly url: string) {
          super();
          setTimeout(() => {
            this.readyState = 1;
            const open = new Event('open');
            this.onopen?.(open);
            this.dispatchEvent(open);
          }, 0);
        }
        private say(frame: unknown[]): void {
          setTimeout(() => {
            if (this.readyState !== 1) return;
            const message = new MessageEvent('message', { data: JSON.stringify(frame) });
            this.onmessage?.(message);
            this.dispatchEvent(message);
          }, 0);
        }
        send(raw: string): void {
          const message = JSON.parse(raw) as unknown[];
          if (message[0] === 'EVENT') {
            const sent = message[1] as { id: string };
            this.say(['OK', sent.id, true, '']);
            return;
          }
          if (message[0] !== 'REQ') return;
          const id = message[1];
          const filters = message.slice(2) as { kinds?: number[]; authors?: string[] }[];
          const host = new URL(this.url).host;
          const forState = filters.some((f) => f.kinds?.includes(10910));
          if (forState) asked.push({ host, at: performance.now() });
          if (forState && refusing.includes(host)) return this.say(['CLOSED', id, 'auth-required: members only']);
          if (forState && serving.includes(host) && filters.some((f) => f.authors?.includes(event.pubkey))) {
            this.say(['EVENT', id, event]);
          }
          this.say(['EOSE', id]);
        }
        close(): void {
          this.readyState = 3;
        }
      }
      g.WebSocket = StandIn;
    },
    { event: served as { id: string; pubkey: string }, serving, refusing }
  );
}

const stateAsked = (page: Page) =>
  page.evaluate(() => [...(globalThis as unknown as { __stateAsked: { host: string; at: number }[] }).__stateAsked]);
const hostsAsked = async (page: Page, from = 0) => [...new Set((await stateAsked(page)).slice(from).map((r) => r.host))].sort();

async function underTheWatch(page: Page, night: Night = {}, relays: string[] = RELAYS): Promise<void> {
  const { pubkey, event } = await freshState();
  await seedDevice(page, { callsign: 'Wren', watchtower: { pubkey, relays } });
  await standIn(page, event, night);
}

/**
 * Opens the receipt's Why, which starts open when the watch reads Dark: a click on an open one
 * would close it.
 */
async function openWhy(page: Page): Promise<void> {
  const why = page.locator('[data-capability] [data-why]');
  if (!(await why.evaluate((el) => (el as HTMLDetailsElement).open))) await why.locator('summary').first().click();
  await expect(page.locator('[data-heard-why]')).toBeVisible();
}

/** The first attempt's account, as the Distress screen words it. */
const firstAccount = (page: Page) => page.locator('section[data-distress] li.accounted').first();

test.describe('where the watch is heard, before sign-on', () => {
  test('counts one relay of three, says why for each, and says it counts relays', async ({ page }) => {
    await underTheWatch(page);
    await open(page, '/terminal/');

    const slot = page.locator('[data-capability] [data-slot="heard-on"]');
    await expect(slot).toContainText('1 relay only', { timeout: 15_000 });
    await expect(slot).toContainText('if it fails, nothing would hear a Distress');
    await expect(slot.locator('[data-overlong]')).toHaveCount(0);

    // One tap down, word for word, inside the receipt's own Why rather than a second one.
    const details = page.locator('[data-capability] [data-why]');
    await expect(details).toHaveCount(1);
    await expect(details.locator('.nc-why-body')).toBeHidden();
    await details.locator('summary').first().click();
    await expect(details.locator('.nc-why-body')).toBeVisible();
    const why = page.locator('[data-heard-why]');
    await expect(why).toBeVisible();
    await expect(why.locator('[data-heard-line]')).toContainText('Heard on 1 relay only: if it fails, nothing would hear a Distress.');

    const a = why.locator('[data-heard-relay="wss://a.relay"]');
    await expect(a).toContainText('handed over');
    await expect(a).toContainText('last heard there');
    await expect(a).toHaveAttribute('data-heard', 'true');
    await expect(why.locator('[data-heard-relay="wss://b.relay"]')).toContainText('holds no state from this watch');
    await expect(why.locator('[data-heard-relay="wss://c.relay"]')).toContainText('has not answered this phone');
    await expect(why.locator('[data-heard="true"]')).toHaveCount(1);
    await expect(why.locator('[data-not-people]')).toContainText('This counts relays, not people');
  });

  test('is said at sign-on the same way', async ({ page }) => {
    await underTheWatch(page);
    await open(page, '/terminal/sign-on/');
    await expect(page.locator('[data-told] [data-slot="heard-on"]')).toContainText('1 relay only', { timeout: 15_000 });
    await expect(page.locator('[data-told] [data-heard-line]')).toContainText('Heard on 1 relay only');
  });
});

test.describe('where the watch is heard, on other nights', () => {
  test('counts two of three, over the relays a Distress goes to, and shows The Record outside the count', async ({ page }) => {
    // The Record is read like any relay the watch names, and never counted or sent to: the 3 is the
    // relays a Distress goes to, and only a second relay heard on shows the "of" at all.
    const { THE_RECORD } = await import('@navcom/core');
    await underTheWatch(page, { serving: ['a.relay', 'b.relay', new URL(THE_RECORD).host] }, [...RELAYS, THE_RECORD]);
    await open(page, '/terminal/');
    const slot = page.locator('[data-capability] [data-slot="heard-on"]');
    await expect(slot).toContainText('2 of 3 relays', { timeout: 15_000 });
    await expect(slot.locator('[data-overlong]')).toHaveCount(0);

    await openWhy(page);
    const why = page.locator('[data-heard-why]');
    await expect(why.locator('[data-heard-line]')).toContainText('Heard on 2 of 3 relays.');
    await expect(why.locator('[data-heard-relay]')).toHaveCount(3);
    await expect(why.locator('[data-heard="true"]')).toHaveCount(2);
    const record = why.locator('[data-heard-withheld]');
    await expect(record).toHaveCount(1);
    await expect(record).toContainText(new URL(THE_RECORD).host);
    await expect(record).toContainText('not counted, and nothing is sent there');
  });

  test('says nowhere, of how many, when every relay answered and none holds the watch', async ({ page }) => {
    await underTheWatch(page, { serving: [] });
    await open(page, '/terminal/');
    const slot = page.locator('[data-capability] [data-slot="heard-on"]');
    await expect(slot).toContainText('Nowhere', { timeout: 15_000 });
    await expect(slot).toContainText('not on any of 3 relays');
    await openWhy(page);
    await expect(page.locator('[data-heard-line]')).toContainText(
      'Not heard on any of 3 relays. If the watch moved, ask whoever gave you its address.'
    );
  });

  test('says unknown, not nowhere, when no relay answered this phone', async ({ page }) => {
    // This phone could not ask: "nowhere" and "if the watch moved" would send somebody after the wrong fix.
    await underTheWatch(page, { serving: [], refusing: ['a.relay', 'b.relay', 'c.relay'] });
    await open(page, '/terminal/');
    const slot = page.locator('[data-capability] [data-slot="heard-on"]');
    await expect(slot).toContainText('Unknown', { timeout: 15_000 });
    await expect(slot).toContainText('no relay answered this phone');
    await expect(slot).not.toContainText('Nowhere');
    await openWhy(page);
    const line = page.locator('[data-heard-line]');
    await expect(line).toContainText('Unknown: no relay answered, so this phone could not ask where the watch is heard.');
    await expect(line).not.toContainText('watch moved');
  });
});

test.describe('the count on the Distress screen', () => {
  test('is the one already held, with its age, and nothing is read until a Distress starts', async ({ page }) => {
    await underTheWatch(page);
    await open(page, '/terminal/');
    await expect(page.locator('[data-capability] [data-slot="heard-on"]')).toContainText('1 relay only', { timeout: 15_000 });

    // Client navigation, as an operator taps it: the record is still in memory.
    await page.evaluate(() => {
      (globalThis as unknown as { __leaving: boolean }).__leaving = true;
    });
    await page.getByRole('link', { name: /^distress$/i }).first().click();
    await page.waitForURL('**/terminal/distress/');
    const held = page.locator('[data-heard-held] [data-slot="heard-on"]');
    await expect(held).toContainText('1 relay only', { timeout: 10_000 });
    await expect(held).toContainText('as last read');

    // Status's read closed when it was left, and this screen opens none of its own: counted from the
    // moment Status's receipt left the page, so a request sent as this screen mounted is counted too.
    await page.waitForTimeout(3_000);
    const goneAt = await page.evaluate(() => (globalThis as unknown as { __statusGoneAt: number | null }).__statusGoneAt);
    expect(goneAt, 'Status’s receipt never left the page').not.toBeNull();
    expect(
      (await stateAsked(page)).filter((r) => r.at > (goneAt as number)).map((r) => r.host),
      'the Distress screen asked for the watch’s state before any Distress'
    ).toEqual([]);

    // The hold starts one, and the read goes where it goes: each relay the watch names.
    const beforeHold = (await stateAsked(page)).length;
    await holdUntil(page, 'button.raise');
    await expect.poll(() => hostsAsked(page, beforeHold), { timeout: 10_000 }).toEqual(['a.relay', 'b.relay', 'c.relay']);
    await expect(held).toContainText('1 relay only');

    // The attempt's own account says where the watch was heard, from the count this phone held.
    await expect(firstAccount(page)).toHaveText('Attempt 1 — taken by 3 of 3 relays, the watch heard on 1', { timeout: 10_000 });
  });

  test('says it has read nothing, on a cold load, and never "heard on 0" before it has', async ({ page }) => {
    await underTheWatch(page);
    await open(page, '/terminal/distress/');
    await expect(page.locator('[data-heard-held] [data-slot="heard-on"]')).toContainText('Not read yet', { timeout: 10_000 });
    await page.waitForTimeout(2_000);
    expect(await stateAsked(page), 'a cold Distress screen read the watch’s state').toEqual([]);

    // Sent cold, the read opens beside the first attempt. Whichever answers first, the account says
    // where the watch was heard only once this phone has a count, and never a zero it has not read.
    await holdUntil(page, 'button.raise');
    const account = firstAccount(page);
    await expect(account).toHaveText(/^Attempt 1 — taken by 3 of 3 relays(, the watch heard on 1)?$/, { timeout: 10_000 });
    await expect(account).not.toContainText('heard on 0');
  });
});

test.describe('the Distress screen as prerendered, before any script has run', () => {
  test.use({ javaScriptEnabled: false });

  test('shows no count to anybody: it cannot know yet whether this phone has a watch', async ({ page }) => {
    // The same HTML goes to every visitor, Alone included, and stays on screen through hydration.
    await page.goto('/terminal/distress/');
    // The page itself is there: the control that sends one is in the HTML.
    await expect(page.locator('button.raise').first()).toBeAttached();
    await expect(page.locator('[data-slot="heard-on"]')).toHaveCount(0);
    await expect(page.locator('[data-heard-held]')).toHaveCount(0);
  });
});

test.describe('an operator with no watch', () => {
  test('is shown no count, on Status or the Distress screen', async ({ page }) => {
    // Alone is not a count of relays waiting to be filled in, and nothing may read as one.
    await seedDevice(page, { callsign: 'Wren' });
    await open(page, '/terminal/');
    await expect(page.locator('[data-capability]')).toBeVisible();
    await expect(page.locator('[data-slot="heard-on"]')).toHaveCount(0);
    await open(page, '/terminal/distress/');
    await expect(page.locator('button.raise')).toBeVisible();
    await expect(page.locator('[data-slot="heard-on"]')).toHaveCount(0);
  });
});
