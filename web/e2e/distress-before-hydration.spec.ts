import { expect, test } from '@playwright/test';
import { blankDevice, seedDevice } from './device';

/**
 * Reaching Distress before the JavaScript arrives.
 *
 * The Distress action and the whole thirteen-link rail live inside `{#if identity}`, and
 * `identity` is read from `localStorage` on mount. So until the bundle hydrates, a returning
 * operator's Status screen offered exactly two links: the cached directory and setup. The
 * project's own budget script models a cold load on a congested cell at **~3.1 seconds** — the
 * device floor this app exists for, and Status is the screen somebody reaches for while
 * something is happening.
 *
 * `hooks.server.ts` already existed to solve the same problem one screen deeper: it inlines a
 * classic script so the operator's own `tel:` and `sms:` links appear on the Distress page
 * before the bundle. That fixed being *on* Distress early. It did not fix getting there.
 *
 * These tests block the app bundle outright, which is the slow-cell case taken to its limit:
 * the inline classic script still runs, hydration never happens, and what is left is exactly
 * what a person sees in second one.
 */

/** Everything except the inline bootstrap, which is what a slow cell delays. */
const withoutTheBundle = (page: import('@playwright/test').Page) =>
  page.route('**/_app/immutable/**/*.js', (route) => route.abort());

test('an operator with an identity can reach Distress with the bundle blocked', async ({ page }) => {
  await seedDevice(page, { callsign: 'Wren' });
  await withoutTheBundle(page);
  // Not `open()` — that waits for `data-hydrated`, which is the thing that never comes here.
  await page.goto('/terminal/');

  const early = page.locator('#distress-early');
  await expect(early, 'Distress is unreachable until the bundle loads').toBeVisible();
  await expect(early.locator('a')).toHaveAttribute('href', '/terminal/distress/');

  // And it is a real link, not a control waiting on a handler.
  await early.locator('a').click();
  await expect(page).toHaveURL(/\/terminal\/distress\/$/);
});

test('and a device with no identity is offered nothing', async ({ page }) => {
  /*
   * The pair. Revealing it unconditionally would pass the test above and put a Distress
   * control in front of somebody who has not set this app up — for whom it terminates in
   * "create a callsign first", which is not what that button should mean.
   */
  await blankDevice(page);
  await withoutTheBundle(page);
  await page.goto('/terminal/');

  await expect(page.locator('#distress-early')).toBeHidden();
});

test('and once hydrated there is exactly one Distress control, not two', async ({ page }) => {
  // The early link is removed on mount, before `identity` is assigned, so the two never
  // overlap. Without that the screen would carry a duplicate for the life of the session.
  await seedDevice(page, { callsign: 'Wren' });
  await page.goto('/terminal/');
  await page.waitForSelector('html[data-hydrated="true"]', { timeout: 15_000 });

  await expect(page.locator('#distress-early')).toHaveCount(0);
  await expect(page.locator('a[href="/terminal/distress/"]')).toHaveCount(1);
});

test('and the way out of the terminal survives the bundle not loading', async ({ page }) => {
  /*
   * The terminal links to nothing outside itself — not the public site, not the docs, not the
   * zero-JavaScript directory. Fine until the bundle is what is going wrong, at which point
   * the fallback that always works is unreachable from the place you would look for it.
   *
   * Prerendered and outside every `{#if}`, so it is checked here with the bundle blocked: a
   * link that only appears after hydration is no use to somebody whose app will not hydrate.
   */
  await blankDevice(page);
  await withoutTheBundle(page);
  await page.goto('/terminal/');

  const out = page.locator('[data-static-fallback]');
  await expect(out).toBeVisible();
  await expect(out.locator('a[href="/directory/"]')).toBeVisible();

  await out.locator('a[href="/directory/"]').click();
  await expect(page).toHaveURL(/\/directory\/$/);
  await expect(page.locator('h1')).toBeVisible();
});
