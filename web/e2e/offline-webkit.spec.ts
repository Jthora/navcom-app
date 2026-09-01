import { expect, test } from '@playwright/test';
import { seedDevice, serviceWorkerReady, open } from './device';
import { TERMINAL_ROUTES } from '../src/lib/terminal/routes';

/**
 * Offline, on WebKit. The first coverage this project has ever had there.
 *
 * `verification.md` has carried "iPhone — Chromium is not WebKit, and the two differ most in
 * exactly the places this app leans on: service workers, storage eviction, and
 * `BarcodeDetector`" as an open gap. The service-worker half of it is closed here.
 *
 * ## What this can and cannot prove, stated because the difference is real
 *
 * `offline.spec.ts` cuts the network with `context.setOffline(true)` and then navigates.
 * That is the honest shape of the test and **WebKit's driver crashes on it** — "WebKit
 * encountered an internal error" out of `page.goto`, every time, while the same browser runs
 * the rest of the suite online without complaint.
 *
 * Aborting every request instead does work, and a probe settled what that actually measures:
 * with the route abort installed, `navigator.serviceWorker.controller` is non-null and a
 * page-level `fetch` for a terminal route still returns **200**. So the service worker is
 * controlling the page and answering from its cache without the network — Playwright's
 * interception preempts the worker only for *navigations*, which is a limitation of the tool
 * and not a fact about WebKit.
 *
 * So this proves **the cache holds every terminal route and the worker serves them with the
 * network down on WebKit** — the mechanism a navigation would use. It does not prove
 * WebKit's own navigation path into that cache, and nothing available here can. That
 * residual belongs in `verification.md` rather than in a comment claiming more than it has.
 */

test.describe.configure({ mode: 'serial' });

test.skip(
  () => test.info().project.name !== 'iphone',
  'the Chromium path is covered honestly in offline.spec.ts'
);

test('the worker serves every terminal screen from cache with the network cut', async ({
  page,
  context
}) => {
  await seedDevice(page, { callsign: 'Wren' });

  // Install and activate, online. Cutting first would test a page still being served from
  // the network, and would pass.
  await open(page, '/terminal/');
  await serviceWorkerReady(page);
  expect(
    await page.evaluate(() => navigator.serviceWorker.controller !== null),
    'the worker is not controlling this page, so nothing below would mean anything'
  ).toBe(true);

  await context.route('**/*', (route) => route.abort());

  // TERMINAL_ROUTES itself, not a copy — the same reason offline.spec.ts uses it. A list
  // that must match another list is not a list, it is a bug with a delay on it.
  for (const route of TERMINAL_ROUTES) {
    const seen = await page.evaluate(async (path) => {
      const served = await fetch(path, { cache: 'no-store' })
        .then((r) => r.status)
        .catch(() => 0);
      const hit = await caches.match(path);
      return { served, cached: hit ? hit.status : null };
    }, `/terminal/${route}`);

    // Served at all, with every request aborted.
    expect(seen.served, `/terminal/${route} was not served on WebKit`).toBe(200);
    /*
     * And served from the cache rather than from the offline fallback.
     *
     * This second assertion is the one that matters. The worker answers an uncached path
     * with `fetch(request).catch(() => offline())`, and that fallback is also a 200 — so a
     * screen that was never cached at all would satisfy the line above while showing the
     * operator a placeholder instead of the screen they asked for. Checking Cache Storage
     * directly is what separates the two.
     */
    expect(
      seen.cached,
      `/terminal/${route} answered 200 from the offline fallback, not from the cache`
    ).toBe(200);
  }
});

test('and the cache check discriminates, rather than saying yes to anything', async ({ page }) => {
  /*
   * The guard, and this file needs it more than most.
   *
   * Every assertion above is a 200 and a cache hit, which is also what a completely broken
   * check returns if `caches.match` is answering everything. A path nothing has ever cached
   * must come back as a miss, or the run above proved nothing.
   */
  await seedDevice(page, { callsign: 'Wren' });
  await open(page, '/terminal/');
  await serviceWorkerReady(page);

  const miss = await page.evaluate(async () => {
    const hit = await caches.match('/__nothing-has-ever-cached-this__');
    return hit ? 'hit ' + hit.status : 'miss';
  });
  expect(miss).toBe('miss');
});
