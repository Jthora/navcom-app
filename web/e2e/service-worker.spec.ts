import { expect, test } from '@playwright/test';
import { seedDevice, serviceWorkerReady, open } from './device';

/**
 * Milestone 0, robustness: the offline shell under conditions nobody designed for.
 *
 * The verification layer's own foundation. If the worker does not install, every other
 * offline guarantee in this project is a claim nobody checked — and it fails while the
 * screen is online, which is the only time nobody is looking.
 */

const WREN = { callsign: 'Wren' };

/*
 * What is NOT tested here, and why it is said rather than faked.
 *
 * The finding this file came from is that `cache.addAll` rejects if *any* request fails and
 * adds nothing at all — so one 404 after a partial deploy failed the whole install,
 * `skipWaiting` never ran, and the terminal had no offline capability while looking fine on
 * a screen that was online.
 *
 * The fix is per-entry caching. **This suite cannot reproduce the trigger:** Playwright's
 * request interception does not reach a service worker's own fetches, so a test that aborts
 * an asset passes identically against the broken version. That was written, run against
 * both, and deleted — a test that passes either way is not evidence, and keeping it would
 * have been worse than having none.
 *
 * `Cache.addAll` atomicity is specified behaviour rather than something observed here. What
 * these tests cover is the half that is observable: that the worker reports what it missed,
 * and that the shell it did save is served.
 */

test('the worker can say what it failed to save', async ({ page }) => {
  // So a screen can tell the truth about what works offline rather than assuming the
  // install went perfectly.
  await seedDevice(page, WREN);
  await open(page, '/terminal/');
  await serviceWorkerReady(page);

  const missing = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const worker = navigator.serviceWorker.controller ?? registration.active;
    return new Promise<string[]>((resolve) => {
      const timer = setTimeout(() => resolve(['<no answer>']), 5000);
      navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
        clearTimeout(timer);
        resolve((e.data as { missing?: string[] }).missing ?? []);
      }, { once: true });
      worker?.postMessage({ ask: 'missing' });
    });
  });
  // On an unbroken build nothing should be missing, and it must answer rather than hang.
  expect(missing).toEqual([]);
});

test('an uncached page offline says so rather than looking empty', async ({ page, context }) => {
    /*
   * `context.setOffline(true)` plus a navigation crashes the WebKit driver — the same
   * Playwright limitation `offline.spec.ts` documents. Not a fact about this app: WebKit
   * runs the rest of this suite, and `offline-webkit.spec.ts` proves the worker serves
   * every terminal route from cache there.
   */
  test.skip(
    test.info().project.name === 'iphone',
    'WebKit driver crashes on navigation while offline'
  );
  await seedDevice(page, WREN);
  await open(page, '/terminal/');
  await serviceWorkerReady(page);
  await context.setOffline(true);

  const response = await page.goto('/terminal/directory/anchorage/');
  expect(response?.status()).toBeGreaterThanOrEqual(400);
  await expect(page.getByText(/not cached/i)).toBeVisible();
});

test('the directory says which areas are actually on this phone', async ({ page }) => {
  // 0.E: "opening it is what saves it" is true and says nothing about whether it worked.
  // An operator who believes they are carrying an area and is not finds out with no signal.
  await seedDevice(page, WREN);
  await open(page, '/terminal/directory/');
  await serviceWorkerReady(page);

  // Nothing carried yet.
  await expect(page.locator('[data-carried]')).toHaveCount(0);

  await open(page, '/terminal/directory/st-louis/');
  await page.waitForFunction(async () => {
    for (const n of await caches.keys()) {
      if (await (await caches.open(n)).match('/terminal/directory/st-louis/')) return true;
    }
    return false;
  }, undefined, { timeout: 15_000 });

  await open(page, '/terminal/directory/');
  await expect(page.locator('[data-carried="st-louis"]')).toBeVisible();
  // And only that one -- this is a check, not a decoration on every row.
  await expect(page.locator('[data-carried]')).toHaveCount(1);
});

test('says nothing about carrying when it cannot tell', async ({ page }) => {
  // Absence of an answer is not an answer. A browser with no Cache API reports unknown
  // rather than "no", the same way a blank directory field reads as unknown rather than as
  // no restriction.
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'caches', { configurable: true, get: () => undefined });
  });
  await seedDevice(page, WREN);
  await open(page, '/terminal/directory/');
  await expect(page.locator('[data-carried]')).toHaveCount(0);
  await expect(page.locator('h1')).toBeVisible();
});

test('a deploy does not throw away the areas an operator carries', async ({ page }) => {
    /*
   * `context.setOffline(true)` plus a navigation crashes the WebKit driver — the same
   * Playwright limitation `offline.spec.ts` documents. Not a fact about this app: WebKit
   * runs the rest of this suite, and `offline-webkit.spec.ts` proves the worker serves
   * every terminal route from cache there.
   */
  test.skip(
    test.info().project.name === 'iphone',
    'WebKit driver crashes on navigation while offline'
  );
  // 0.X. The cache name carries the build version, so activating a new one deleted the old
  // cache whole -- and areas live there too, added on visit rather than shipped in the
  // shell. Carry St. Louis, open the app once on wifi after a deploy, go out with no signal,
  // find nothing. "Opening it is what saves it", quietly revoked by an unrelated event.
  await seedDevice(page, WREN);
  await open(page, '/terminal/');
  await serviceWorkerReady(page);

  const AREA = '/terminal/directory/st-louis/';

  // A previous version's cache, holding an area the operator chose to carry.
  await page.evaluate(async (area) => {
    const old = await caches.open('navcom-terminal-previous');
    await old.put(area, new Response('<html><body>carried</body></html>', {
      headers: { 'content-type': 'text/html' }
    }));
  }, AREA);

  // Force a fresh install and activate, which is what a deploy does.
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  });
  await page.reload();
  await serviceWorkerReady(page);
  await page.waitForFunction(async () => {
    const names = await caches.keys();
    return names.length > 0 && !names.includes('navcom-terminal-previous');
  }, undefined, { timeout: 15_000 });

  // The old cache is gone, and the area came with it rather than going with it.
  const survived = await page.evaluate(async (area) => {
    for (const name of await caches.keys()) {
      const hit = await (await caches.open(name)).match(area);
      if (hit) return (await hit.text()).includes('carried');
    }
    return false;
  }, AREA);
  expect(survived, 'the carried area survived the version change').toBe(true);
});
