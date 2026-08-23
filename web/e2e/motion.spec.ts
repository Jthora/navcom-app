import { expect, test, type Page } from '@playwright/test';
import { seedDevice, open, TEST_SECRET } from './device';

/**
 * Motion that carries state, with the motion turned off.
 *
 * The P4 gate: `prefers-reduced-motion` is a **branch**, not an off switch. This project
 * disables every animation under it with `!important`, so anything whose meaning lived in a
 * keyframe would become meaningless for exactly the people who asked for less movement.
 *
 * Driven through the real screens rather than injected elements. A first draft of this file
 * built a bar by hand, forgot to give it a duration, and measured something the application
 * never produces — which is how it found a real fail-dangerous default in the CSS, and also
 * why it was rewritten.
 */

const WATCH_SECRET = 'b'.repeat(63) + '3';

async function watchPub() {
  const { getPublicKey } = await import('nostr-tools/pure');
  return getPublicKey(
    Uint8Array.from((WATCH_SECRET.match(/../g) ?? []).map((b) => parseInt(b, 16)))
  );
}

/** A query, sent a known number of seconds ago, waiting on this watch. */
async function askFrom(secondsAgo: number) {
  const { generateSecretKey, finalizeEvent, getPublicKey } = await import('nostr-tools/pure');
  const { buildSignal } = await import('@navcom/core');
  const mine = Uint8Array.from((TEST_SECRET.match(/../g) ?? []).map((b) => parseInt(b, 16)));
  const sender = generateSecretKey();
  const at = Math.floor(Date.now() / 1000) - secondsAgo;
  return finalizeEvent(
    buildSignal(
      sender,
      { pubkey: await watchPub(), holders: [getPublicKey(mine)] },
      'query',
      { text: 'is the Patrick Center taking couples' } as never,
      at
    ),
    sender
  );
}

async function boardWith(page: Page, events: unknown[]) {
  await seedDevice(page, { callsign: 'Wren', watchSecret: WATCH_SECRET, relayEvents: events });
  // `emulateMedia`, not `test.use({ reducedMotion })` — the latter never reached the page here
  // (`matchMedia('(prefers-reduced-motion: reduce)').matches` stayed false), so every assertion
  // under it would have been measuring the ordinary branch while claiming to measure the other.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, '/terminal/watch/');
}

test.describe('with motion turned off', () => {
  test('is actually turned off, so the rest of this file means something', async ({ page }) => {
    // Without this the suite passes perfectly against the ordinary branch.
    await boardWith(page, []);
    expect(
      await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
    ).toBe(true);
  });


  test('a response window says how much of it is left, in words', async ({ page }) => {
    /*
     * The bar carries its quantity in movement, and with animation disabled it is painted once
     * and never advances — so on its own it would state the size of the window and nothing
     * about how much is left. The number takes over exactly where the movement is missing.
     *
     * A note on why this cannot be tested by backdating the signal: the board timestamps an
     * ask with **receipt time, not the sender's `created_at`**, on purpose — *"anything
     * backdated went straight to the top of the watch's queue"*. So a seeded ask always
     * arrives now, and the fraction at paint is always near zero. The part-elapsed case is
     * proven in `panel.test.ts`, where it can be isolated.
     */
    await boardWith(page, [await askFrom(0)]);

    const left = page.locator('[data-remaining]').first();
    await expect(left).toBeVisible({ timeout: 10_000 });
    await expect(left).toContainText(/\d+s left of 120s/);
  });

  test('and it is not claiming the window has already run out', async ({ page }) => {
    // The failure this guards. An animation with no duration fills to its end state, so a bar
    // that lost its duration rendered as a window fully gone — a false claim, in the direction
    // that makes a watch think somebody is late when they are not.
    await boardWith(page, [await askFrom(5)]);

    const bar = page.locator("[data-kind='window']").first();
    await expect(bar).toBeVisible({ timeout: 10_000 });
    await expect(bar).not.toHaveAttribute('data-expired', 'true');

    const scale = await bar.locator('i').evaluate((el) => {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return m.a;
    });
    expect(scale).toBeLessThan(0.2);
  });

  test('and a heartbeat is still telling you it has not finished', async ({ page }) => {
    /*
     * Not colour alone, and not motion alone: still-trying is a hollow ring and finished is a
     * filled dot. With animations disabled the pulse is gone, and with the two tones
     * indistinguishable — which is anybody who cannot separate amber from green — the shape is
     * all that is left.
     */
    await seedDevice(page, { callsign: 'Wren' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, '/terminal/');

    const shapes = await page.evaluate(() => {
      const make = (settled: string) => {
        const el = document.createElement('span');
        el.className = 'nc-beat';
        el.setAttribute('data-settled', settled);
        const dot = document.createElement('span');
        dot.className = 'nc-beat-dot';
        el.appendChild(dot);
        document.querySelector('.terminal')!.appendChild(el);
        const bg = getComputedStyle(dot).backgroundColor;
        el.remove();
        return bg;
      };
      return { trying: make('false'), done: make('true') };
    });

    expect(shapes.trying).not.toBe(shapes.done);
    expect(shapes.trying).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  });
});
