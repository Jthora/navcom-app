import { expect, test } from '@playwright/test';
import { seedDevice, serviceWorkerReady, open } from './device';
import { TERMINAL_ROUTES } from '../src/lib/terminal/routes';

/**
 * With the network off.
 *
 * Three things claim to work here — the cached directory, the patrol record, and the
 * terminal itself — and until this file existed **none of them had ever been tested with
 * the network down.** Two of them shipped without being cached at all, which the tests did
 * not notice because the tests read files from `build/`, and `build/` is always there.
 *
 * The sequencing matters more than it looks: the service worker has to reach `activated`
 * before going offline. Cutting the network first tests a page still being served from it,
 * and passes.
 */

const WREN = { callsign: 'Wren' };



test.describe.configure({ mode: 'serial' });

/*
 * Chromium only, and the reason is the tooling rather than the app.
 *
 * `context.setOffline(true)` is the honest way to cut the network, and **WebKit's driver
 * crashes on any navigation while it is set** — "WebKit encountered an internal error" out
 * of `page.goto`. WebKit runs the rest of this suite online without complaint, so this is a
 * Playwright limitation. `offline-webkit.spec.ts` covers what can be covered there.
 */
test.skip(() => test.info().project.name === 'iphone', 'WebKit driver crashes on navigation while offline');

test('every terminal screen loads with the network off', async ({ page, context }) => {
  await seedDevice(page, WREN);

  // Install and activate, online.
  await open(page, '/terminal/');
  await serviceWorkerReady(page);

  await context.setOffline(true);

  // TERMINAL_ROUTES itself, not a copy of it.
  //
  // This was a second hand-maintained list, under a comment claiming it was the first one.
  // It had already drifted: two screens shipped without being added here, which is the
  // exact failure `routes.ts` exists to prevent and the exact way it was defeated. A list
  // that must match another list is not a list, it is a bug with a delay on it.
  for (const route of TERMINAL_ROUTES) {
    const response = await open(page, `/terminal/${route}`);
    expect(response?.status(), `/terminal/${route} offline`).toBeLessThan(400);
    await expect(page.locator('h1')).toBeVisible();
  }
});

test('the cached directory is readable with no signal', async ({ page, context }) => {
  await seedDevice(page, WREN);

  // Opening an area is what saves it — there is no download button because visiting the
  // page IS the download.
  await open(page, '/terminal/directory/');
  await serviceWorkerReady(page);

  // Tapping through, which is how anybody actually gets here — and is a client-side
  // navigation that fetches this page's data and never its HTML. The page asks the worker
  // to save the document; this waits for that to land before cutting the network, because
  // testing the race would just make the test flaky rather than the app correct.
  await page.getByRole('link', { name: /st\. louis/i }).click();
  await expect(page.locator('[data-record]').first()).toBeVisible();
  await page.waitForFunction(async () => {
    for (const name of await caches.keys()) {
      const hit = await (await caches.open(name)).match('/terminal/directory/st-louis/');
      if (hit) return true;
    }
    return false;
  }, undefined, { timeout: 10_000 });

  await context.setOffline(true);
  await page.reload();

  await expect(page.locator('[data-record]').first()).toBeVisible();
  await expect(page.locator('[data-snapshot-age]')).toBeVisible();
});

test('an area never opened is not silently empty', async ({ page, context }) => {
  // Only what you open is kept, so an area you never visited genuinely is not there. What
  // matters is that it fails visibly rather than rendering an empty directory, which would
  // read as "nothing here" instead of "you do not have this".
  await seedDevice(page, WREN);
  await open(page, '/terminal/');
  await serviceWorkerReady(page);

  await context.setOffline(true);
  // `goto`, not `open`: this navigation is EXPECTED to fail, so there is no hydration to
  // wait for. Waiting for it here would turn the passing case into a fifteen-second hang.
  const response = await page.goto('/terminal/directory/london/');

  if (response && response.status() < 400) {
    // If it did come from cache, it must have real records rather than an empty shell.
    await expect(page.locator('[data-record]').first()).toBeVisible();
  } else {
    expect(response?.status()).toBeGreaterThanOrEqual(400);
  }
});

test('a patrol can be recorded and read back with no network', async ({ page, context }) => {
  // The patrol record says in as many words that it works with no signal. It shipped
  // without being cached, so it did not.
  await seedDevice(page, WREN);
  await open(page, '/terminal/');
  await serviceWorkerReady(page);

  await context.setOffline(true);

  await open(page, '/terminal/sign-on/');
  await page.locator('#area').fill('Downtown');
  await page.getByRole('button', { name: /sign on/i }).click();
  await expect(page.locator('[data-station]')).toBeVisible();

  await page.getByRole('button', { name: /stand down/i }).click();
  await page.getByRole('button', { name: /i'm home/i }).click();
  await expect(page.locator('[data-came-home]')).toBeVisible();

  await open(page, '/terminal/patrols/');
  await expect(page.getByText('Downtown')).toBeVisible();
});
