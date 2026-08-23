import { expect, test, type Page } from '@playwright/test';
import { seedDevice, open, holdUntil } from './device';

/**
 * The one output channel this app has never used.
 *
 * There was not a single `navigator.vibrate` call in the codebase, while the core interaction
 * on patrol is performed by somebody who should be watching a street rather than a phone.
 *
 * The line this must not cross is the invariant: **the field terminal is silent.** Every pulse
 * is confirmation of a press the operator just made, in the moment they made it. Nothing fires
 * on arrival, and the tests below are mostly about that.
 */

/** Records every vibrate call, and reports support the way a phone without it would. */
async function recording(page: Page, supported = true) {
  await page.addInitScript((yes) => {
    (window as unknown as { __buzz: number[] }).__buzz = [];
    if (!yes) {
      delete (navigator as unknown as { vibrate?: unknown }).vibrate;
      return;
    }
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: (p: number | number[]) => {
        (window as unknown as { __buzz: number[] }).__buzz.push(...[p].flat());
        return true;
      }
    });
  }, supported);
}

const buzzes = (page: Page) =>
  page.evaluate(() => (window as unknown as { __buzz?: number[] }).__buzz ?? []);

test.describe('a pulse in a pocket', () => {
  test('confirms a press, in the moment of the press', async ({ page }) => {
    await recording(page);
    await seedDevice(page, { callsign: 'Wren' });
    await open(page, '/terminal/');

    expect(await buzzes(page), 'nothing before a press').toEqual([]);
    await page.getByRole('link', { name: /^sign on$/i }).click();
    // A link, not a button — nothing to confirm, and nothing fires.
    expect(await buzzes(page)).toEqual([]);
  });

  test('and says when a held threshold has actually fired', async ({ page }) => {
    /*
     * The case worth building: somebody holding a control in the dark, under stress, should
     * not have to look at the screen to learn the hold took.
     */
    await recording(page);
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await open(page, '/terminal/watch/');
    await page.getByRole('button', { name: /start a watch on this phone/i }).click();

    const before = await buzzes(page);
    await holdUntil(page, 'button:has-text("take the watch")');
    await expect(page.getByRole('button', { name: /stand down/i })).toBeVisible({ timeout: 10_000 });

    const after = await buzzes(page);
    expect(after.length).toBeGreaterThan(before.length);
    // The press, then the commit — and the commit is the longer of the two.
    expect(Math.max(...after)).toBeGreaterThan(Math.min(...after));
  });

  test('and never fires because something arrived', async ({ page }) => {
    /*
     * The invariant, and the reason the roster's `acknowledged` pattern was declined. An ack is
     * the strongest case for buzzing on arrival and still the wrong side of the line, because
     * the line is what stops the next twenty cases.
     */
    const { finalizeEvent, generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const { buildWatchStateEvent } = await import('@navcom/core');
    const secret = generateSecretKey();
    const now = Math.floor(Date.now() / 1000);
    const state = finalizeEvent(
      buildWatchStateEvent({
        state: 'station', holder: 'Owl', holder_kind: 'human', oncall: [],
        since: now - 60, agent_health: 'ok', last_drill: null, now
      } as never, now),
      secret
    );

    await recording(page);
    await seedDevice(page, {
      callsign: 'Wren',
      watchtower: { pubkey: getPublicKey(secret), relays: ['wss://fake.relay'] },
      relayEvents: [state]
    });
    await open(page, '/terminal/');

    // A watch came up, which is the most welcome arrival there is. The phone stays still.
    await expect(page.locator('[data-slot="watch"]')).toContainText(/on station/i, { timeout: 10_000 });
    expect(await buzzes(page)).toEqual([]);
  });

  test('and stays quiet for somebody who asked for less movement', async ({ page }) => {
    // A judgement rather than a certainty: the preference is about movement rather than touch,
    // and the cost of being wrong is a pulse they would have liked not happening.
    await recording(page);
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, '/terminal/watch/');
    await page.getByRole('button', { name: /start a watch on this phone/i }).click();

    await holdUntil(page, 'button:has-text("take the watch")');
    await expect(page.getByRole('button', { name: /stand down/i })).toBeVisible({ timeout: 10_000 });
    expect(await buzzes(page)).toEqual([]);
  });

  test('and a phone without it loses nothing', async ({ page }) => {
    // iOS has none of this. Every state a pulse confirms is also on the screen.
    await recording(page, false);
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await open(page, '/terminal/watch/');
    await page.getByRole('button', { name: /start a watch on this phone/i }).click();

    await holdUntil(page, 'button:has-text("take the watch")');
    await expect(page.getByRole('button', { name: /stand down/i })).toBeVisible({ timeout: 10_000 });
  });
});
