import { expect, test, type Page } from '@playwright/test';
import { seedDevice, open, holdUntil } from './device';

/**
 * A phone holding the watch on relays that will not serve its board [review: relay paths].
 *
 * The beat checked only that the board's listener existed, and a listener whose every relay
 * refused it still existed: a named human went on being announced as at the console while nothing
 * on the phone could hear a `Distress`, and the holder's screen said *Published: Yes*. The relay
 * here takes every publish, and treats every subscription asking for what is addressed to
 * somebody one of two ways: refuses it, the way a relay that wants AUTH before it serves that
 * does, or answers it and ends it 50 ms later, the way a relay in a crash loop does.
 */

const WATCH_SECRET = 'd'.repeat(63) + '4';

type Treatment = 'refuse' | 'flap';

/** Installed after the harness's socket, so it wins. Records what was published and asked for. */
async function relayThat(page: Page, treatment: Treatment): Promise<void> {
  await page.addInitScript((how: Treatment) => {
    const sent: { kind: number; content: string }[] = [];
    const asked: number[] = [];
    (globalThis as unknown as { __sent: typeof sent; __asked: typeof asked }).__sent = sent;
    (globalThis as unknown as { __sent: typeof sent; __asked: typeof asked }).__asked = asked;
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
      private say(frame: unknown[], after = 0): void {
        setTimeout(() => {
          if (this.readyState !== 1) return;
          const message = new MessageEvent('message', { data: JSON.stringify(frame) });
          this.onmessage?.(message);
          this.dispatchEvent(message);
        }, after);
      }
      send(raw: string): void {
        const message = JSON.parse(raw) as unknown[];
        if (message[0] === 'EVENT') {
          const event = message[1] as { id: string; kind: number; content: string };
          sent.push(event);
          this.say(['OK', event.id, true, '']);
          return;
        }
        if (message[0] !== 'REQ') return;
        const filters = message.slice(2) as Record<string, unknown>[];
        if (!filters.some((f) => '#p' in f)) return this.say(['EOSE', message[1]]);
        asked.push(Date.now());
        if (how === 'refuse') return this.say(['CLOSED', message[1], 'auth-required: members only']);
        this.say(['EOSE', message[1]]);
        this.say(['CLOSED', message[1], 'error: subscription ended'], 50);
      }
      close(): void {
        this.readyState = 3;
      }
    }
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = StandIn;
  }, treatment);
}

const stationsSent = (page: Page) =>
  page.evaluate(
    () =>
      (globalThis as unknown as { __sent: { kind: number; content: string }[] }).__sent.filter(
        (e) => e.kind === 10910 && (JSON.parse(e.content) as { state?: string }).state === 'station'
      ).length
  );
const timesAsked = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __asked: number[] }).__asked.length);

test.describe('a watch held on relays that will not serve its board', () => {
  test('tells the holder this phone is not hearing, and announces nobody', async ({ page }) => {
    await seedDevice(page, { callsign: 'Wren', watchSecret: WATCH_SECRET });
    await relayThat(page, 'refuse');
    await open(page, '/terminal/watch/');

    // Visible before the hold that commits them: an empty board here is unknown, not empty.
    await expect(page.locator('[data-board-unknown]').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-empty-board]')).toHaveCount(0);

    await holdUntil(page, 'button:has-text("take the watch")');

    const warning = page.locator('[data-not-hearing]');
    await expect(warning).toBeVisible({ timeout: 10_000 });
    await expect(warning).toContainText(/not hearing on any relay/i);
    await expect(warning).toContainText(/would not\s+reach you/i);
    // Not the other warning: publishing works here, hearing does not.
    await expect(page.locator('[data-unannounced]')).toHaveCount(0);
    expect(await stationsSent(page), 'a named human announced while nothing here can hear a Distress').toBe(0);
    // Nothing was published, so nothing on the screen, open or folded, says it was.
    await expect(page.getByText(/published as the watch/i)).toHaveCount(0);
  });

  test('renews nothing on a relay that answers the board and ends it straight away', async ({ page }) => {
    // Each time it was asked again it answered for a moment, the claim went out in that moment,
    // and it never went stale while nothing here heard a Distress for more than 50 ms at a time.
    await seedDevice(page, { callsign: 'Wren', watchSecret: WATCH_SECRET });
    await relayThat(page, 'flap');
    await open(page, '/terminal/watch/');
    await expect(page.locator('[data-board-unknown]').first()).toBeVisible({ timeout: 10_000 });

    await holdUntil(page, 'button:has-text("take the watch")');
    await expect(page.locator('[data-watch-post]')).toContainText(/on station/i, { timeout: 10_000 });
    // A take is not held to the ten seconds, so one that lands inside a 50 ms answer may go out.
    // What must not happen is a renewal afterwards.
    const atTake = await stationsSent(page);
    const askedAtTake = await timesAsked(page);
    // Asked again at about one, three and seven seconds after it last ended the subscription.
    await page.waitForTimeout(9_000);
    expect(await timesAsked(page), 'the relay was not asked again: nothing was tested').toBeGreaterThanOrEqual(askedAtTake + 2);
    expect(await stationsSent(page), 'renewed on a relay this phone hears on for 50 ms at a time').toBe(atTake);
    await expect(page.locator('[data-not-hearing]')).toBeVisible();
  });
});
