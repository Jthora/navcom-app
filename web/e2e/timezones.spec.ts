import { expect, test, type Page } from '@playwright/test';
import { chunkOf, open, seedDevice, serviceWorkerReady } from './device';
import { frame, mapReady, screenAt, seen, tapAt, zoomAt } from './map';

/**
 * The time zones layer [the owner's map decision D8; docs/design/map.md, Layers], against the build
 * that deploys, on a fixed clock.
 *
 * Two answers that must never be mistaken for each other: a band's standard time, which is all
 * Natural Earth's 2012 zones know, and a region's own clocks, from its IANA zone, which know
 * daylight saving. Birmingham in July is the case the bands alone get wrong by an hour.
 */

/** 11:05 UTC on 1 July 2026: British Summer Time, and the bands do not know it. */
const JULY = new Date('2026-07-01T11:05:00Z');

async function landed(page: Page) {
  await page.clock.setFixedTime(JULY);
  await seedDevice(page, { __noStorage: true });
  await open(page, '/');
  await mapReady(page);
}

async function chooseTimes(page: Page) {
  const arrived = Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/grid/timezones.json')),
    page.waitForResponse((r) => r.url().endsWith('/grid/region-times.json'))
  ]);
  await page.getByRole('button', { name: 'Map layers' }).click();
  await page.locator('[data-screen="layers"]').getByRole('radio', { name: /^Time zones/ }).check();
  await arrived;
  await frame(page);
}

test.describe('the time zones layer', () => {
  test.use({ serviceWorkers: 'block' });

  test('fetches its two files once, when chosen, from navcom.app only, and says how old its lines are', async ({ page }) => {
    const asked: string[] = [];
    page.on('request', (r) => {
      if (/^https?:/.test(r.url())) asked.push(r.url());
    });
    await landed(page);
    expect(asked.filter((u) => /timezones|region-times/.test(u)), 'fetched before it was chosen').toEqual([]);
    await chooseTimes(page);
    // And under it day and night, which Time zones always draws, worked out here [daylight.spec.ts].
    await expect(page.locator('[data-legend="timezones"] .line')).toHaveText(['Time zones 2012 · no daylight saving', 'Day and night at 11:05 UTC']);
    // Whose, and the rest of its words, in the whole key on the layers screen.
    await expect(page.locator('[data-key-full]')).toContainText('standard time as drawn in 2012, with no daylight saving · Natural Earth, public domain');
    // Seen, with the layers screen open over the map at half, not merely present under the sheet [invariant 7].
    await expect(page.locator('[data-com]')).toHaveAttribute('data-detent', 'half');
    expect(await seen(page.locator('[data-legend="timezones"]')), 'how old the lines are is under the sheet').toBe(true);
    await page.locator('[data-screen="layers"]').getByRole('radio', { name: /^Nation States/ }).check();
    await page.locator('[data-screen="layers"]').getByRole('radio', { name: /^Time zones/ }).check();
    await frame(page);
    expect(asked.filter((u) => /timezones|region-times/.test(u)).map((u) => new URL(u).pathname).sort()).toEqual(['/grid/region-times.json', '/grid/timezones.json']);
    const home = new URL(page.url()).origin;
    expect(asked.filter((u) => new URL(u).origin !== home)).toEqual([]);
  });

  test('a tap on a band opens it: its offset, standard time by this phone’s clock, and its age', async ({ page }) => {
    await landed(page);
    await chooseTimes(page);
    await page.locator('[data-back]').click();
    await tapAt(page, 36.82, -1.29, 'Nairobi');
    const band = page.locator('[data-screen="time"][data-offset="3"]');
    await expect(band).toBeVisible();
    await expect(band.locator('[data-post]')).toHaveText('UTC+3');
    await expect(band.locator('[data-slot="now"]')).toContainText('14:05');
    await expect(band.locator('[data-slot="drawn"]')).toContainText('2012');
    await expect(band).toContainText(/no daylight saving/i);
  });

  test('a band history holds, when the time zones’ code never arrived, says so and keeps its offset', async ({ page }) => {
    await page.route(chunkOf('src/lib/grid/layers/timezones.ts'), (r) => r.abort());
    await landed(page);
    // A band in an entry of history this page did not open itself, written the way SvelteKit keeps it,
    // as com-distress writes another version's screen: nothing here has loaded the time zones' code, so
    // the screen is the only thing that asks for it. It said "Loading", "standard time at ", for ever.
    await page.evaluate(() => history.replaceState({ ...history.state, 'sveltekit:states': { com: [{ kind: 'time', offset: '3' }] } }, ''));
    await page.getByRole('button', { name: 'Map layers' }).click();
    await expect(page.locator('[data-screen="layers"]')).toBeVisible();
    await page.locator('[data-back]').click();
    const band = page.locator('[data-screen="time"][data-offset="3"]');
    await expect(band.locator('[data-time-failed]')).toHaveText('Not loaded — it needs one visit with a connection');
    await expect(band.locator('[data-post]')).toHaveText('UTC+3');
    await expect(band.locator('[data-slot="now"]')).toHaveCount(0);
  });
});

test.describe('the time zones layer on a desktop: hover says the time', () => {
  test.use({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

  test('over Nairobi, UTC+3 and its standard time; over Birmingham’s ring, its own clocks, an hour ahead of its band in July', async ({ page }) => {
    await landed(page);
    await chooseTimes(page);
    const chip = page.locator('[data-chip]');
    const nairobi = await screenAt(page, 36.82, -1.29);
    await page.mouse.move(nairobi.x, nairobi.y);
    await expect(chip).toHaveText('UTC+3 · 14:05 now, standard time');
    const london = await screenAt(page, -1.9, 52.48);
    await page.mouse.move(london.x, london.y);
    await expect(chip).toHaveText('UTC±0 · 11:05 now, standard time');

    // With Places on, Birmingham's ring: Europe/London's clocks read 12:05, BST, which no band says.
    const arrived = page.waitForResponse((r) => r.url().endsWith('/grid/places.json'));
    await page.getByRole('button', { name: 'Places' }).click();
    await arrived;
    const b = await page.evaluate(async () => {
      const j = (await (await fetch('/console-regions.json')).json()) as { centroids: { region: string; lat: number; lon: number }[] };
      return j.centroids.find((c) => c.region === 'birmingham-uk')!;
    });
    await zoomAt(page, b.lon, b.lat, 16);
    const at = await screenAt(page, b.lon, b.lat);
    await page.mouse.move(at.x, at.y);
    await expect(chip).toContainText('12:05 BST, Europe/London');
    // And its place says so too, for a finger, which has no hover.
    await page.mouse.click(at.x, at.y);
    const place = page.locator('[data-screen="place"][data-place="birmingham-uk"]');
    await expect(place.locator('[data-slot="local-time"]')).toContainText('12:05 BST');
    await expect(place.locator('[data-slot="local-time"]')).toContainText(/local to Europe\/London/i);
  });
});

test('the service worker installs without any layer’s files: only somebody who chooses one pays for it', async ({ page }) => {
  await seedDevice(page, { __noStorage: true });
  await open(page, '/');
  await serviceWorkerReady(page);
  const cached = await page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) {
      for (const r of await (await caches.open(name)).keys()) out.push(new URL(r.url).pathname);
    }
    return out;
  });
  expect(cached, 'the map’s own geometry is installed').toContain('/grid/world.json');
  expect(cached.filter((p) => /^\/grid\/(timezones|region-times|region-ages|spheres)\.json$/.test(p) || p.startsWith('/grid/zsp/'))).toEqual([]);
});
