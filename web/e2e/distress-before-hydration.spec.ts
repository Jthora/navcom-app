import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
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
 * what a person sees in second one. Then they let it arrive slowly, and watch every frame.
 *
 * **The pages come from the routes.** Every page that carries a prerendered `#distress-early` is
 * checked here, read out of `src/routes`: the landing page joined the terminal's Status screen on
 * 2026-10-06, when Com moved onto it [com.md §4], and was never checked before its bundle until
 * this file looped. A third page that gains one is checked the day it does.
 */

/** Everything except the inline bootstrap, which is what a slow cell delays. */
const withoutTheBundle = (page: Page) => page.route('**/_app/immutable/**/*.js', (route) => route.abort());

const ROUTES = fileURLToPath(new URL('../src/routes/', import.meta.url));

/** The address of every route whose page carries a prerendered Distress, as the host serves it. */
function earlyDistressPages(): string[] {
  const pages: string[] = [];
  for (const file of readdirSync(ROUTES, { recursive: true }) as string[]) {
    if (!/(^|[\\/])\+page\.svelte$/.test(file)) continue;
    if (!readFileSync(ROUTES + file, 'utf8').includes('id="distress-early"')) continue;
    // Route groups are not in the address; a parameter would need a value this file does not have.
    const segments = file.split(/[\\/]/).slice(0, -1).filter((s) => !/^\(.*\)$/.test(s));
    if (segments.some((s) => s.includes('['))) {
      throw new Error(`${file} carries Distress early behind a parameter: give this file an address to open it at`);
    }
    pages.push('/' + segments.map((s) => `${s}/`).join(''));
  }
  return pages.sort();
}
const PAGES = earlyDistressPages();

test('the pages checked here include the two that promise Distress before the bundle', () => {
  // A floor, so that removing the early copy from one of them cannot quietly drop it from the loop
  // below: hooks.server.ts names both, and com.md §4 promises the landing page's.
  expect(PAGES).toEqual(expect.arrayContaining(['/', '/terminal/']));
});

/** Whether the app has started on this page. */
const hydrated = (page: Page) => page.locator('html[data-hydrated="true"]').count();

/**
 * Records, inside the page, from before the first byte is parsed: when the page first painted, when
 * a Distress control first painted, and for every frame after, whether one could be tapped.
 *
 * Paint times are the browser's own (Paint Timing, and Element Timing on every element of every
 * Distress link, tagged by a MutationObserver as the parser inserts it — before any frame can show
 * it). A frame is read in `requestAnimationFrame`, which runs in the same rendering step as the
 * paint and with nothing parsed between, so what it reads is what that frame drew.
 */
function recordFrames() {
  type Frame = { at: number; reach: boolean; hydrated: boolean };
  const rec: { page: number | null; distress: number | null; frames: Frame[] } = { page: null, distress: null, frames: [] };
  (window as unknown as { __distressFrames: typeof rec }).__distressFrames = rec;
  const LINK = 'a[href="/terminal/distress/"]';

  const tag = () => {
    for (const el of document.querySelectorAll(`${LINK}, ${LINK} *`)) {
      if (!el.hasAttribute('elementtiming')) el.setAttribute('elementtiming', 'distress');
    }
  };
  new MutationObserver(tag).observe(document, { childList: true, subtree: true });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') rec.page = e.startTime;
  }).observe({ type: 'paint', buffered: true });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries() as unknown as { identifier: string; renderTime: number }[]) {
      if (e.identifier !== 'distress' || !(e.renderTime > 0)) continue;
      rec.distress = rec.distress === null ? e.renderTime : Math.min(rec.distress, e.renderTime);
    }
  }).observe({ type: 'element', buffered: true });

  /** Whole on screen, at the thumb floor, and what a tap at its centre lands on. */
  const reachable = () =>
    [...document.querySelectorAll<HTMLElement>(LINK)].some((a) => {
      const r = a.getBoundingClientRect();
      if (r.height < 48 || r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) return false;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (hit === a || a.contains(hit));
    });
  const frame = () => {
    rec.frames.push({ at: performance.now(), reach: reachable(), hydrated: document.documentElement.dataset.hydrated === 'true' });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/**
 * Inside a tenth of a second of the page counts as with it.
 *
 * About the threshold below which a change reads as instantaneous, and well under the time anybody
 * needs to see a control and aim a tap at it. It is not slack for a slow reveal. Measured on both
 * pages, 2026-10-17, 24 runs at four workers: Distress paints 0–20 ms after the page, a frame or
 * so, when the bundle is what is slow. The landing page's reveal at the end of its body, on the
 * design-point cell below, and the reveals broken on purpose to prove these checks, measured
 * 2.3–4.8 s.
 */
const WITH_THE_PAGE_MS = 100;

/** Waits through hydration and some frames past it, then asserts on everything recorded. */
async function expectDistressThroughout(page: Page, path: string) {
  await page.waitForSelector('html[data-hydrated="true"]', { timeout: 60_000 });
  // Past the hand-over: the terminal swaps its prerendered copy for the app's own on mount.
  await page.evaluate(
    () =>
      new Promise((done) => {
        let n = 0;
        const step = () => (++n >= 20 ? done(null) : requestAnimationFrame(step));
        requestAnimationFrame(step);
      })
  );
  const rec = await page.evaluate(
    () =>
      (window as unknown as {
        __distressFrames: { page: number | null; distress: number | null; frames: { at: number; reach: boolean; hydrated: boolean }[] };
      }).__distressFrames
  );
  expect(rec.page, `${path} never painted`).not.toBeNull();
  expect(rec.distress, `Distress was never painted on screen on ${path}`).not.toBeNull();
  const late = Math.round(rec.distress! - rec.page!);
  test.info().annotations.push({ type: 'distress', description: `${path}: painted ${late} ms after the page` });
  expect(late, `${path} was on screen for ${late} ms with no Distress on it`).toBeLessThanOrEqual(WITH_THE_PAGE_MS);

  const since = rec.frames.filter((f) => f.at >= rec.distress!);
  // Both sides of hydration, or this tested one of them.
  expect(since.filter((f) => !f.hydrated).length, 'no frame was drawn between Distress and hydration').toBeGreaterThan(0);
  expect(since.filter((f) => f.hydrated).length, 'no frame was drawn after hydration').toBeGreaterThan(0);
  const missing = since.filter((f) => !f.reach).map((f) => `${Math.round(f.at)} ms${f.hydrated ? ', hydrated' : ''}`);
  expect(missing, `frames on ${path} with no Distress anybody could tap`).toEqual([]);
}

for (const path of PAGES) {
  test.describe(`Distress on ${path}, before the bundle`, () => {
    test.describe('with the bundle blocked', () => {
      /*
       * And the service worker with it. SvelteKit's inline start script registers the worker whether
       * or not the bundle arrives, the worker precaches every chunk, and a route here does not see a
       * worker's requests: the Distress page this leads to hydrated from that cache, and the check
       * that its person is reachable without the app was checking the app.
       */
      test.use({ serviceWorkers: 'block' });

      test('an operator can reach it, and it leads to their person', async ({ page }) => {
        await seedDevice(page, { callsign: 'Wren', contact: { label: 'Sam', number: '+15550100' } });
        await withoutTheBundle(page);
        // Not `open()` — that waits for `data-hydrated`, which is the thing that never comes here.
        await page.goto(path);

        const early = page.locator('#distress-early');
        await expect(early, 'Distress is unreachable until the bundle loads').toBeVisible();
        const link = early.locator('a');
        await expect(link).toHaveAttribute('href', '/terminal/distress/');
        // On the screen, not merely on the page: whole, at the thumb floor, and nothing over it.
        await expect(link).toBeInViewport({ ratio: 1 });
        expect((await link.boundingBox())!.height, 'under the 48px thumb floor').toBeGreaterThanOrEqual(48);
        const onTop = await link.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return hit === el || el.contains(hit);
        });
        expect(onTop, 'something covers Distress').toBe(true);

        // And it is a real link, not a control waiting on a handler — one that ends at a person,
        // with the bundle still blocked the whole way [invariant 2].
        await link.click();
        await expect(page).toHaveURL(/\/terminal\/distress\/$/);
        await expect(page.getByRole('link', { name: /call sam/i })).toHaveAttribute('href', 'tel:+15550100');
        await expect(page.getByRole('link', { name: /text sam/i })).toHaveAttribute('href', 'sms:+15550100');
        expect(await hydrated(page), 'the app ran, so this did not test the page without it').toBe(0);
      });

      test('and a device with no identity is offered nothing', async ({ page }) => {
        /*
         * The pair. Revealing it unconditionally would pass the test above and put a Distress
         * control in front of somebody who has not set this app up — for whom it terminates in
         * "create a callsign first", which is not what that button should mean.
         */
        await blankDevice(page);
        await withoutTheBundle(page);
        await page.goto(path);

        await expect(page.locator('#distress-early')).toBeHidden();
      });
    });

    test('and once hydrated there is exactly one Distress control, not two', async ({ page }) => {
      // The terminal removes its early link on mount, before `identity` is assigned, so the two
      // never overlap; the landing page keeps the one it has. Either way, one for the session.
      await seedDevice(page, { callsign: 'Wren' });
      await page.goto(path);
      await page.waitForSelector('html[data-hydrated="true"]', { timeout: 15_000 });

      await expect(page.locator('a[href="/terminal/distress/"]')).toHaveCount(1);
    });

    test('and it is on screen in every frame from first paint through hydration, the scripts held back', async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'Element Timing is Chromium’s');
      await seedDevice(page, { callsign: 'Wren' });
      await page.addInitScript(recordFrames);
      // As a congested cell delivers them: the page is there, and not yet live.
      await page.route('**/_app/immutable/**/*.js', async (route) => {
        await new Promise((r) => setTimeout(r, 3_000));
        await route.continue();
      });
      await page.goto(path, { waitUntil: 'commit' });
      await expectDistressThroughout(page, path);
    });

    test('and on the design-point cell, every byte of it slow', async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'network and CPU emulation are Chromium’s DevTools');
      /*
       * Where the landing page failed, found writing this test on 2026-10-17 [invariant 2]. The
       * reveal ran at the end of the body, and the landing page is 158 kB, the region picker's
       * 1,913 options before its end. A slow connection delivers the first part first and the
       * browser paints it: the map and the search, and no Distress until the rest arrived, 2.4 s
       * here. The reveal now sits inside the control it shows [hooks.server.ts REVEAL].
       */
      test.setTimeout(90_000);
      await seedDevice(page, { callsign: 'Wren' });
      await page.addInitScript(recordFrames);
      /*
       * The budget's design point [scripts/lib/budget.mjs, docs/research/device-floor.md]: 0.8 Mbps
       * on a 6x CPU penalty. It names no round trip; 150 ms is assumed, and the outcome turns on
       * bandwidth, not on it. The served build is uncompressed (scripts/serve-build.mjs), so the
       * same bandwidth carries more bytes than production's would: a harder cell than the number says.
       */
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 150,
        downloadThroughput: 800_000 / 8,
        uploadThroughput: 400_000 / 8
      });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
      await page.goto(path, { waitUntil: 'commit' });
      await expectDistressThroughout(page, path);
    });
  });
}

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
