import { expect, test, type Locator, type Page } from '@playwright/test';
import { open, seedDevice } from './device';

/**
 * The three holds, done with a finger rather than a mouse [live check, 2026-10-28].
 *
 * Every other test presses a hold with mouse events, or dispatches pointer events by hand. A phone
 * sends touch, and a finger is never still: it wobbles a few pixels, and past half a second the
 * browser has plans of its own — scrolling, selecting text, a callout — any of which cancels the
 * pointer and ends the hold before it fires. So these are pressed through the browser's own touch
 * input, with a wobble partway through, and each control is checked for what keeps the phone's
 * plans out of it.
 *
 * What this cannot do is be a phone: Chromium's touch input fires all three holds with or without
 * that guard, because the long-press behaviours that cancel a hold — selection, the callout, the
 * context menu — are the operating system's, not the page's. The guard is checked because it is the
 * part a page controls; a real phone in a hand is still the only full test.
 */

test.skip(({ browserName }) => browserName !== 'chromium', 'Touch is driven through Chromium’s DevTools protocol.');

async function finger(page: Page, target: Locator, ms: number) {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(ms / 3);
  // A finger is never still.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 4, y: y + 5 }] });
  await page.waitForTimeout((ms * 2) / 3);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function guarded(target: Locator) {
  const style = await target.evaluate((el) => {
    const s = getComputedStyle(el);
    return { touchAction: s.touchAction, userSelect: s.userSelect || s.getPropertyValue('-webkit-user-select') };
  });
  expect(style.touchAction, 'a wobble must not become a scroll that cancels the hold').toBe('none');
  expect(style.userSelect, 'a long press must not start selecting the label').toBe('none');
}

test('taking the watch, by finger', async ({ page }) => {
  await seedDevice(page, { callsign: 'Lighthouse', relayEvents: [] });
  await open(page, '/terminal/watch/');
  await page.locator('[data-start-watch]').click();
  const take = page.getByRole('button', { name: /hold to take the watch/i });
  await guarded(take);
  await finger(page, take, 1600);
  await expect(page.getByRole('button', { name: /^stand down$/i })).toBeVisible();
});

test('the panic wipe, by finger', async ({ page }) => {
  await seedDevice(page, { callsign: 'Jay', relayEvents: [], wipeable: { signon: { at: 1, area: 'Fishtown', expectedUntil: 2 } } } as Parameters<typeof seedDevice>[1]);
  await open(page, '/terminal/wipe/');
  const wipe = page.getByRole('button', { name: /hold to wipe tonight/i });
  await guarded(wipe);
  await finger(page, wipe, 1200);
  await page.waitForURL('**/terminal/');
});

test('Distress, by finger', async ({ page }) => {
  await seedDevice(page, {
    callsign: 'Kestrel',
    watchtower: { pubkey: 'f'.repeat(63) + '0', relays: ['wss://relay.example'] },
    relayEvents: []
  } as Parameters<typeof seedDevice>[1]);
  await open(page, '/terminal/distress/');
  const raise = page.locator('button.raise');
  await guarded(raise);
  await finger(page, raise, 1600);
  await expect(page.locator('[data-distress]')).toBeVisible({ timeout: 10_000 });
});
