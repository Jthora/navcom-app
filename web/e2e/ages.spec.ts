import { expect, test, type Page } from '@playwright/test';
import { open, seedDevice } from './device';
import { bring, frame, mapReady, overEarth, screenAt, tap, toneNear, zoomAt } from './map';

/**
 * The directory by when it was last checked, over Nation States [docs/design/map.md, The directory
 * by last check; invariant 7], against the build that deploys.
 *
 * Every region reads as its oldest check, against **this phone's clock**: on 19 October 2026 every
 * region in the directory was last checked between 35 and 78 days before; on 15 December the same file
 * reads as more than three months old everywhere. Unknown is not old: a region none of whose places
 * carries a date is drawn as another shape.
 *
 * **The map names how long ago, and never what a page shows**: nearly every record carries no hours at
 * all, and its page says "Unknown" for them however recently it was checked, so a key that said "hours:
 * call first" said what no page did.
 */

test.use({ serviceWorkers: 'block' });

const OCTOBER = new Date('2026-10-19T12:00:00Z');
const DECEMBER = new Date('2026-12-15T12:00:00Z');

/** The sheet down to its peek, so the map has the room to zoom in on a place. */
async function peek(page: Page) {
  for (let i = 0; i < 3 && (await page.locator('[data-com]').getAttribute('data-detent')) !== 'peek'; i++) await page.locator('.grab').click();
  await expect(page.locator('[data-com]')).toHaveAttribute('data-detent', 'peek');
}

async function landed(page: Page, at: Date) {
  await page.clock.setFixedTime(at);
  await seedDevice(page, { __noStorage: true });
  await open(page, '/');
  await mapReady(page);
}

/** Nation States with the ages ticked, once their file has arrived and been drawn. */
async function agesOn(page: Page) {
  await page.getByRole('button', { name: 'Map layers' }).click();
  const screen = page.locator('[data-screen="layers"]');
  const arrived = page.waitForResponse((r) => r.url().endsWith('/grid/region-ages.json'));
  await screen.locator('[data-ages]').check();
  await arrived;
  await expect(page.locator('[data-legend="nations"]')).toContainText('Regions by last check');
  await frame(page);
  return screen;
}

/** The region with records that stands furthest from any other, so what is drawn at its centre is its own. */
const loneRegion = (page: Page) =>
  page.evaluate(async () => {
    const { centroids, figures } = (await (await fetch('/console-regions.json')).json()) as {
      centroids: { region: string; name: string; lat: number; lon: number }[];
      figures: Record<string, { records: number }>;
    };
    let best = { gap: 0, c: centroids[0]! };
    for (const c of centroids) {
      if (!figures[c.region]?.records || Math.abs(c.lat) > 60) continue;
      const gap = Math.min(...centroids.filter((o) => o !== c).map((o) => Math.hypot(o.lon - c.lon, o.lat - c.lat)));
      if (gap > best.gap) best = { gap, c };
    }
    return best.c;
  });

test('fetched once, only when ticked, and never by Places or by what is on screen', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => void (/^https?:/.test(r.url()) && asked.push(new URL(r.url()).pathname)));
  await landed(page, OCTOBER);
  expect(asked.filter((p) => p.includes('region-ages')), 'fetched before it was ticked').toEqual([]);
  const screen = await agesOn(page);
  await screen.locator('[data-ages]').uncheck();
  await screen.locator('[data-ages]').check();
  await frame(page);
  expect(asked.filter((p) => p.includes('region-ages'))).toEqual(['/grid/region-ages.json']);
  // The regions alone: Places' own file is Places', and nobody asked for it.
  expect(asked.filter((p) => p === '/grid/places.json')).toEqual([]);
  // The key says what it is, and that no person has confirmed any of the directory, by phone or in person.
  await expect(page.locator('[data-legend="nations"]')).toHaveText('Regions by last check · none confirmed by a person');
  // And the full key, every class by how long ago, with how many regions each holds today.
  await expect(screen.locator('[data-age-row="hours"]')).toContainText('14–89 days ago');
  await expect(screen.locator('[data-age-row="current"]')).toContainText(/0–13 days ago\s*0/);
  await expect(screen.locator('[data-age-row="unknown"]')).toContainText('Unknown · no check date');
  // No class claims what a page shows: the dates know nothing of a record's fields.
  await expect(screen.locator('[data-ages-key]')).not.toContainText(/hours|call first|intake|never/i);
  await expect(page.locator('[data-swatches]')).not.toContainText(/hours|call first|intake|never/i);
  // What the windows mean, said once, for a place that has hours; each page says the rest.
  await expect(screen.locator('[data-ages-note]')).toContainText('Hours, where a place has them, read call first after 14 days');
  await expect(screen.locator('[data-ages-note]')).toContainText('Where marks would crowd, the oldest is drawn');
});

test('in October a region’s mark is a solid muted dot, 14–89 days ago; in December the same is a hollow ring, 90+', async ({ page }) => {
  await landed(page, OCTOBER);
  const region = await loneRegion(page);
  await agesOn(page);
  await page.locator('[data-back]').click();
  await peek(page);
  await zoomAt(page, region.lon, region.lat, 4);
  const at = await screenAt(page, region.lon, region.lat);
  expect(await toneNear(page, at.x, at.y, 1, '--t-muted'), `${region.name}: no solid muted dot at its centre`).toBeGreaterThan(0);
  // The swatch row under the key names only the class there is, and how many regions are in it.
  await expect(page.locator('[data-swatches] [data-swatch="dot"]')).toHaveCount(1);
  await expect(page.locator('[data-swatches]')).toContainText(/14–89 days ago · [\d,]+/);
  await expect(page.locator('[data-swatches]')).not.toContainText('0–13 days');

  const later = await page.context().newPage();
  await later.clock.setFixedTime(DECEMBER);
  await seedDevice(later, { __noStorage: true });
  await open(later, '/');
  await mapReady(later);
  await agesOn(later);
  await later.locator('[data-back]').click();
  await peek(later);
  await zoomAt(later, region.lon, region.lat, 4);
  const there = await screenAt(later, region.lon, region.lat);
  expect(await toneNear(later, there.x, there.y, 1, '--t-muted'), 'December: still a solid dot at its centre').toBe(0);
  expect(await toneNear(later, there.x + 4.5, there.y, 1.5, '--t-muted'), 'December: no hollow ring round it').toBeGreaterThan(0);
  await expect(later.locator('[data-swatches]')).toContainText(/90\+ days ago · [\d,]+/);
});

test('at the whole-Earth view each mark is drawn at the size its key draws it, and where they would crowd the oldest is drawn', async ({ page }) => {
  await page.clock.setFixedTime(DECEMBER);
  await seedDevice(page, { __noStorage: true });
  await open(page, '/');
  await mapReady(page);
  const region = await loneRegion(page);
  await agesOn(page);
  await page.locator('[data-back]').click();
  await peek(page);
  await frame(page);
  // Not zoomed: the view the map opens on, where the key is read. Far from any other region, so its own.
  const at = await bring(page, region.lon, region.lat);
  expect(at.uncovered, `${region.name} in view`).toBe(true);
  // A hollow ring of radius 4.5, as the key's swatch is drawn, not half that.
  expect(await toneNear(page, at.x + 4.5, at.y, 1, '--t-muted'), `${region.name}: no ring at the key’s size`).toBeGreaterThan(0);
  expect(await toneNear(page, at.x, at.y, 1.5, '--t-muted'), `${region.name}: filled, where a ring is hollow`).toBe(0);
  const swatch = await page.locator('[data-swatches] [data-swatch="ring"] circle').getAttribute('r');
  expect(Number(swatch)).toBe(4.5);
  // Over the United States, nearly two thousand regions: thinned to marks that do not run into each
  // other, so a ring's hollow is still there to see, rather than one blob of overlapping rings.
  const us = await screenAt(page, -98, 39);
  const hollow = await page.locator('.grid canvas').evaluate((c: HTMLCanvasElement, [x, y]) => {
    const r = c.getBoundingClientRect();
    const k = c.width / r.width;
    const half = 30;
    const d = c.getContext('2d')!.getImageData(Math.round((x! - half - r.left) * k), Math.round((y! - half - r.top) * k), Math.round(2 * half * k), Math.round(2 * half * k)).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! + d[i + 1]! + d[i + 2]! > 300) lit++;
    return lit / (d.length / 4);
  }, [us.x, us.y]);
  expect(hollow, 'the regions over the United States run into one shape').toBeLessThan(0.5);
  expect(hollow, 'nothing drawn over the United States').toBeGreaterThan(0.02);
});

test('a region none of whose places carries a date is unknown, and drawn as a square, not as old', async ({ page }) => {
  await landed(page, OCTOBER);
  const region = await loneRegion(page);
  await page.route('**/grid/region-ages.json', async (route) => {
    const file = (await (await route.fetch()).json()) as { regions: Record<string, [number, number][]> };
    // Every one of its records with no date: one run of them.
    file.regions[region.region] = [[-1, file.regions[region.region]!.reduce((n, r) => n + r[1], 0)]];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(file) });
  });
  await agesOn(page);
  await page.locator('[data-back]').click();
  await peek(page);
  await zoomAt(page, region.lon, region.lat, 4);
  const at = await screenAt(page, region.lon, region.lat);
  expect(await toneNear(page, at.x, at.y, 1, '--t-faint'), 'filled, as if it were a reading').toBe(0);
  expect(await toneNear(page, at.x + 4, at.y + 4, 1.5, '--t-faint'), 'no square’s corner').toBeGreaterThan(0);
  await expect(page.locator('[data-swatches]')).toContainText(/Unknown · no check date · \d+/);
  // A tap says so, in words: unknown, never a date it does not have.
  await tap(page, at.x, at.y);
  const place = page.locator(`[data-screen="place"][data-place="${region.region}"]`);
  await expect(place.locator('[data-slot="checked"]')).toContainText('Unknown');
});

test('a tap on a region says when it was checked, its oldest and its newest, and leaves what that shows to each page', async ({ page }) => {
  await landed(page, OCTOBER);
  const region = await loneRegion(page);
  await agesOn(page);
  await page.locator('[data-back]').click();
  await peek(page);
  await zoomAt(page, region.lon, region.lat, 4);
  const at = await screenAt(page, region.lon, region.lat);
  await tap(page, at.x, at.y);
  const checked = page.locator(`[data-screen="place"][data-place="${region.region}"] [data-slot="checked"]`);
  await expect(checked).toContainText(/Oldest \d+ days ago/);
  await expect(checked).toContainText(/newest (the same|\d+ days ago)/);
  await expect(checked).toContainText('each place’s page says what its check still shows');
  await expect(checked).not.toContainText(/hours|call first/i);
});

test('the key under the map’s own leaves the whole Earth uncovered, with the layers open over it', async ({ page }) => {
  await landed(page, OCTOBER);
  await agesOn(page);
  await expect(page.locator('[data-swatches]')).toBeVisible();
  expect(await overEarth(page, page.locator('[data-swatches]')), 'the ages’ key covers the Earth').toBe(false);
  expect(await overEarth(page, page.locator('.nav-key')), 'the map’s key covers the Earth').toBe(false);
});

test.describe('on a desktop, a hover says when a region was checked', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

  test('a region’s mark: how many places, and how long ago its oldest was checked', async ({ page }) => {
    await landed(page, OCTOBER);
    const region = await loneRegion(page);
    await agesOn(page);
    await zoomAt(page, region.lon, region.lat, 4);
    const at = await screenAt(page, region.lon, region.lat);
    await page.mouse.move(at.x, at.y);
    const name = region.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await expect(page.locator('[data-chip]')).toContainText(new RegExp(`${name} · \\d+ places? · oldest check \\d+ days ago$`));
  });
});
