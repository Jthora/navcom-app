import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * navcom.app itself, read and never written: what Vercel serves, with the real directory, The
 * Record's real packages and the public relays, on a phone.
 *
 * The browser suite serves `build/` through `serve-build.mjs`, which models `vercel.json` and not
 * Vercel. This visits the deployment once, in order, with no callsign — so nothing is signed or
 * published — and records every console error, failed request and refused script along the way.
 *
 * Never part of a run, and never in a loop: navcom.app answers repeated automated visits with a
 * challenge. `LIVE_SITE=1 npx playwright test live-site.spec.ts --config playwright.relay.config.ts`.
 */

test.skip(!process.env['LIVE_SITE'], 'Visits navcom.app: run by hand with LIVE_SITE=1.');
test.use({ baseURL: 'https://navcom.app' });

const problems: string[] = [];
function watch(page: Page) {
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error' || /content security policy|refused to/i.test(m.text())) problems.push(`console ${m.type()}: ${m.text().slice(0, 240)}`);
  });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message.slice(0, 240)}`));
  page.on('requestfailed', (r) => {
    // A relay socket that closes, or a request the page itself aborted on leaving, is not a failure of the site.
    const why = r.failure()?.errorText ?? '';
    if (/ERR_ABORTED/.test(why)) return;
    problems.push(`request failed: ${r.url().slice(0, 160)} (${why})`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && new URL(r.url()).hostname.endsWith('navcom.app')) problems.push(`HTTP ${r.status()}: ${r.url().slice(0, 160)}`);
  });
}

async function hydrated(page: Page) {
  await page.waitForSelector('html[data-hydrated="true"]', { timeout: 30_000 });
}

test('navcom.app, read once on a phone, with nothing published', async ({ page, context }) => {
  test.setTimeout(240_000);
  watch(page);
  const live: Record<string, string> = {};

  // The landing page, the missions The Record holds, and one opened.
  await page.goto('/');
  await hydrated(page);
  const missions = page.locator('[data-missions]');
  await expect(missions).toHaveAttribute('data-missions', /open|none/, { timeout: 45_000 });
  live['missions'] = (await missions.getAttribute('data-missions')) ?? '';
  if (live['missions'] === 'open') {
    await missions.click();
    const first = page.locator('[data-mission]').first();
    await expect(first).toBeVisible({ timeout: 15_000 });
    live['missions listed'] = String(await page.locator('[data-mission]').count());
    await first.click();
    await expect(page.locator('[data-screen="mission"]')).toBeVisible();
    live['a mission says'] = ((await page.locator('[data-takepart]').innerText()).replace(/\s+/g, ' ').slice(0, 160));
    await page.locator('[data-back]').click();
    await page.locator('[data-back]').click().catch(() => {});
  }

  // The map's layers, each fetched from Vercel.
  for (const layer of ['zones', 'spheres', 'timezones', 'nations']) {
    await page.locator('[data-layers]').click();
    const option = page.locator(`[data-layer-option="${layer}"] input`);
    await option.check();
    await page.waitForTimeout(2500);
    live[`layer ${layer}`] = (await page.locator('[data-screen="layers"]').innerText()).replace(/\s+/g, ' ').match(/(not loaded|failed|absent|unavailable)/i)?.[0] ?? 'drawn';
    await page.locator('[data-back]').click().catch(() => {});
  }

  // The Field Terminal, a carried region of the directory, and the public roster.
  await page.goto('/terminal/');
  await hydrated(page);
  await expect(page.getByRole('link', { name: /choose a callsign/i })).toBeVisible();
  await page.goto('/terminal/directory/philadelphia/');
  await hydrated(page);
  await expect(page.locator('[data-record]').first()).toBeVisible({ timeout: 30_000 });
  live['philadelphia records'] = String(await page.locator('[data-record]').count());
  await page.goto('/who/');
  await hydrated(page);
  await page.waitForTimeout(6000);
  live['public roster'] = (await page.locator('main').innerText()).replace(/\s+/g, ' ').match(/(No public card came back|Asking relays|More are listed)/)?.[0] ?? `${await page.locator('ul.roster li').count()} listed`;

  // Offline, after one visit: the terminal and the region carried, from the service worker.
  await page.goto('/terminal/');
  await hydrated(page);
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, { timeout: 30_000 }).catch(() => {});
  live['service worker'] = (await page.evaluate(() => (navigator.serviceWorker?.controller ? 'controlling' : 'not controlling')));
  await context.setOffline(true);
  await page.goto('/terminal/directory/philadelphia/').catch(() => {});
  live['offline region'] = (await page.locator('[data-record]').count()) > 0 ? 'served' : 'not served';
  await page.goto('/terminal/distress/').catch(() => {});
  live['offline distress'] = (await page.locator('h1').innerText().catch(() => 'nothing')).trim();
  await context.setOffline(false);

  console.log('\n===== what navcom.app did\n' + Object.entries(live).map(([k, v]) => `${k}: ${v}`).join('\n'));
  console.log('\n===== problems\n' + (problems.length ? problems.join('\n') : 'none'));
});
