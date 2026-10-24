import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { open, seedDevice } from './device';
import { bring, frame, inkNear, mapReady, screenAt, seen, tap, tapAt, zoomAt } from './map';
import { admit, mission, standInKey, type StandIn } from './registry';
import { busySeason, serveHazards } from './hazards';
import { serveSpheres } from './spheres';
import { serveZones } from './zsp';
import { HEIGHT, decode, inside, project, unproject, type Topology } from '../src/lib/grid/topology';
import { subsolar } from '../src/lib/grid/sun';

/**
 * The map read as a person reads it, on a cheap phone in sunlight [docs/design/map.md; the map audit of
 * 2026-10-19]. Every number here is one the audit measured on the build and found wanting: the land
 * at 1.10:1 on the sea, the key's words crossed by the marks under them, the Earth gone under the sheet
 * at half once a few overlays were on, the north of the Earth pinned under the key at ×4, the missions
 * lost in a mass of regions, a tap inside California opening a mission in Texas, the whole canvas
 * rasterised for every step of a pan. Each is held on the built page, by its pixels, its boxes, its
 * frames or what a screen reader is told, rather than by the logic that was meant to give it.
 */

test.use({ serviceWorkers: 'block' });

const KEY = standInKey();
const DESK: StandIn = { id: 'legible-desk', name: 'Legible Desk', agent: true, inbox: ['wss://nos.lol', 'wss://relay.primal.net'], keys: [KEY] };
const geo = (lat: number, lon: number, precision = 'address') => [['geo', `lat:${lat},lon:${lon}`], ['geo_kind', 'subject_location'], ['geo_precision', precision]];
/** A night's missions: California lit by jurisdiction; Houston, Philadelphia and London at points; a Manitoba depot the file has no province for. */
const MISSIONS = () => [
  mission(KEY, 'legible-ca', { title: 'Heat relief, Central Valley', jurisdiction: 'us-ca' }),
  mission(KEY, 'legible-houston', { title: 'Cooling centre staffing', jurisdiction: 'us-tx', extra: geo(29.76, -95.37, 'city') }),
  mission(KEY, 'legible-philly', { title: 'Depot sort, Kensington', jurisdiction: 'us-pa', extra: geo(39.9926, -75.1252) }),
  mission(KEY, 'legible-london', { title: 'Library warming room', jurisdiction: 'gb', extra: geo(51.5072, -0.1276) }),
  mission(KEY, 'legible-mb', { title: 'Water at the depot', jurisdiction: 'ca-mb', extra: geo(55, -100) })
];
/** 14:05 UTC: Brazil, the Atlantic and Guyana in daylight, so no night's dots fall where a test reads the land. */
const AT = new Date('2026-10-19T14:05:30Z');

async function landed(page: Page, o: { low?: boolean; signedOn?: boolean } = {}) {
  await page.clock.setFixedTime(AT);
  await admit(page, [DESK]);
  await seedDevice(page, { relayEvents: MISSIONS(), ...(o.signedOn ? { callsign: 'kestrel' } : {}), accruing: { signature: o.low ? 'low' : 'document' } });
  await open(page, '/');
  await mapReady(page);
  await expect(page.locator('[data-missions="open"]')).toContainText('live', { timeout: 15_000 });
  await expect(page.locator('html')).toHaveAttribute('data-signature', o.low ? 'low' : 'document');
  await frame(page);
}

async function layersScreen(page: Page) {
  if ((await page.locator('[data-screen="layers"]').count()) === 0) await page.getByRole('button', { name: 'Map layers' }).click();
  const screen = page.locator('[data-screen="layers"]');
  await expect(screen).toBeVisible();
  return screen;
}

async function choose(page: Page, name: RegExp) {
  const screen = await layersScreen(page);
  await screen.getByRole('radio', { name }).check();
  return screen;
}

/** Back to the root of Com and the sheet at peek, so the map is read with nothing open over it. */
async function home(page: Page) {
  for (let i = 0; i < 6 && (await page.locator('[data-back]').count()) > 0; i++) await page.locator('[data-back]').click();
  await expect(page.locator('[data-com]')).toHaveAttribute('data-detent', /peek|half/);
  await frame(page);
  await frame(page);
}

/** WCAG's relative luminance of an [r, g, b], and the contrast of two. */
const lum = ([r, g, b]: number[]) => {
  const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
};
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** The canvas's luminance at many CSS points at once, read from its own pixels. */
async function lumsAt(page: Page, points: [number, number][]): Promise<number[]> {
  const rgb = await page.locator('.grid canvas').evaluate(
    (c: HTMLCanvasElement, pts) => {
      const r = c.getBoundingClientRect();
      const k = c.width / r.width;
      const ctx = c.getContext('2d')!;
      return pts.map(([x, y]) => [...ctx.getImageData(Math.round((x - r.left) * k), Math.round((y - r.top) * k), 1, 1).data.slice(0, 3)]);
    },
    points
  );
  return rgb.map(lum);
}
const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!;

/** The median luminance of a patch `half` CSS px round (lon, lat): the ground there, whatever thin line crosses it. */
async function patch(page: Page, lon: number, lat: number, half = 3): Promise<number> {
  const at = await screenAt(page, lon, lat);
  expect(at.uncovered, `${lon}, ${lat} is in view`).toBe(true);
  const pts: [number, number][] = [];
  for (let dx = -half; dx <= half; dx++) for (let dy = -half; dy <= half; dy++) pts.push([at.x + dx, at.y + dy]);
  return median(await lumsAt(page, pts));
}

/** The brightest the canvas is along a line of latitude between two longitudes: a line drawn across it, if any. */
async function brightestAlong(page: Page, lat: number, from: number, to: number): Promise<number> {
  const a = await screenAt(page, from, lat);
  const b = await screenAt(page, to, lat);
  const pts: [number, number][] = [];
  for (let x = a.x; x <= b.x; x += 0.25) for (const dy of [-0.5, 0, 0.5]) pts.push([x, a.y + dy]);
  return Math.max(...(await lumsAt(page, pts)));
}

test.describe('the basemap in sunlight', () => {
  for (const low of [false, true]) {
    test(`${low ? 'low' : 'document'} signature: land parts from sea, and the coast and the borders from the land, under every layer`, async ({ page }) => {
      await serveZones(page, '2');
      await serveSpheres(page);
      await landed(page, { low });
      // At least 1.4:1 in document mode and 1.3:1 in Low signature: the panel's tokens gave 1.10 and 1.05.
      const floor = low ? 1.3 : 1.4;
      for (const [layer, name] of [['nations', /^Nation States/], ['zones', /^Zones/], ['spheres', /^Spheres/], ['timezones', /^Time zones/], ['none', /^None/]] as const) {
        await choose(page, name);
        await home(page);
        await page.waitForTimeout(300);
        await frame(page);
        const land = await patch(page, -55, -10);
        const sea = await patch(page, -28, -25);
        expect(contrast(land, sea), `${layer}: Brazil against the South Atlantic`).toBeGreaterThanOrEqual(floor);
        // The coast, drawn under every layer: across Brazil's east coast at 8°S.
        const coast = await brightestAlong(page, -8, -38, -32);
        expect(contrast(coast, sea), `${layer}: no coast between Brazil and the sea`).toBeGreaterThanOrEqual(2.5);
        expect(contrast(coast, land), `${layer}: the coast is lost against the land`).toBeGreaterThanOrEqual(2);
        if (layer === 'nations') {
          // A country's border, across Bolivia and Brazil at 12°S: at least 2.2:1 on the land, which was 1.73.
          const border = await brightestAlong(page, -12, -66, -59);
          expect(contrast(border, land), 'the border between Bolivia and Brazil').toBeGreaterThanOrEqual(2.2);
        }
      }
    });
  }
});

/** The key's lines, the Earth's box on screen and what covers it, at the sheet's height now. */
async function layout(page: Page) {
  return page.evaluate((H) => {
    const c = document.querySelector('.grid canvas') as HTMLCanvasElement;
    const [cx, cy, scale] = (c.dataset.view ?? '').split(' ').map(Number) as [number, number, number];
    const r = c.getBoundingClientRect();
    const top = r.top + r.height / 2 - cy * scale;
    const more = document.querySelector('[data-key-more]') as HTMLElement | null;
    const line = more ? parseFloat(getComputedStyle(more).lineHeight) : 0;
    const key = document.querySelector('.nav-key') as HTMLElement;
    const bg = getComputedStyle(key).backgroundColor;
    const alpha = /\/\s*([\d.]+)\)$/.exec(bg)?.[1] ?? /rgba\([^)]*,\s*([\d.]+)\)$/.exec(bg)?.[1] ?? '1';
    return {
      lines: more && line > 0 ? more.getBoundingClientRect().height / line : Infinity,
      keyFoot: key.getBoundingClientRect().bottom,
      sheetTop: document.querySelector('[data-com]')!.getBoundingClientRect().top,
      earthTop: top,
      earthFoot: top + H * scale,
      alpha: Number(alpha),
      swatchesInKey: key.querySelectorAll('[data-swatches]').length,
      border: getComputedStyle(key).borderTopWidth
    };
  }, HEIGHT);
}

/**
 * Every phone the key is held to, the device floor's among them: a prepaid Android's 360 × 640, and the
 * same less its status bar and the browser's address bar, 560 px of page.
 */
const PHONES = [
  { width: 393, height: 727 },
  { width: 375, height: 667 },
  { width: 360, height: 640 },
  { width: 360, height: 560 }
];

for (const viewport of PHONES) {
  test.describe(`the key on a ${viewport.width} × ${viewport.height} phone`, () => {
    test.use({ viewport });
    for (const set of ['nations', 'zones'] as const) {
      test(`with every overlay over ${set === 'nations' ? 'Nation States' : 'Zones'}: one panel, the feeds’ age whole, the Earth above the sheet at half, and every control in reach`, async ({ page }) => {
        await serveZones(page, '2');
        await serveHazards(page);
        await landed(page, { signedOn: true });
        const screen = await choose(page, set === 'nations' ? /^Nation States/ : /^Zones/);
        if (set === 'nations') await screen.locator('[data-ages]').check();
        await screen.locator('[data-daylight]').check();
        await screen.locator('[data-hazards]').check();
        await expect(page.locator('[data-legend]')).toContainText(/Hazards · 3 feeds just now/);
        await expect(page.locator('[data-legend]')).toContainText(set === 'nations' ? 'Directory by last check' : 'Zones · draft 2');
        await expect(page.locator('[data-com]')).toHaveAttribute('data-detent', 'half');
        await page.waitForTimeout(300);
        await frame(page);
        const at = await layout(page);
        // The swatches are in the key's own panel, and the panel is the ground, all but opaque, with an edge.
        expect(at.swatchesInKey, 'the overlays’ swatches are not in the key').toBe(1);
        expect(at.alpha, 'the key has no backing').toBeGreaterThanOrEqual(0.9);
        expect(at.border, 'the key has no edge').toBe('1px');
        expect(at.lines, 'the map’s lines in the key').toBeLessThanOrEqual(3.05);
        // Cut short, the key keeps what ages fastest whole: the feeds' age, and that they hold some events,
        // never all, which a 360 px key cut to one line lost [invariant 7].
        const feeds = await page.evaluate(() => {
          const more = document.querySelector('[data-key-more]')!;
          const line = [...more.querySelectorAll('.line')].find((l) => l.textContent!.startsWith('Hazards'))!;
          const r = line.getBoundingClientRect();
          return { whole: r.bottom <= more.getBoundingClientRect().bottom + 1, rows: Math.round(r.height / parseFloat(getComputedStyle(more).lineHeight)) };
        });
        expect(feeds.whole, 'the feeds’ age, or that they hold some events, never all, is cut from the key').toBe(true);
        // What of the Earth's box is below the key and above the sheet at half: 120 px, unless the key is
        // already cut to the feeds' line alone, and then no less than 100.
        const clear = Math.min(at.earthFoot, at.sheetTop) - Math.max(at.earthTop, at.keyFoot);
        expect(clear, `the Earth above the sheet at half: ${JSON.stringify(at)}`).toBeGreaterThanOrEqual(100);
        if (clear < 120) expect(at.lines, `the Earth is ${Math.round(clear)} px tall while the key keeps more than the feeds’ line`).toBeLessThanOrEqual(feeds.rows + 0.05);
        // And all of it: nothing of the Earth is under the sheet while the layer's screen is open.
        expect(at.earthFoot, 'the Earth runs under the sheet at half').toBeLessThanOrEqual(at.sheetTop + 1);
        // Every one of the map's controls in reach with the sheet at half: the topmost thing at its centre.
        const under = await page.evaluate(() =>
          [...document.querySelectorAll('.grid .controls button')].flatMap((b) => {
            const r = b.getBoundingClientRect();
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return top === b || b.contains(top) ? [] : [b.getAttribute('aria-label')];
          })
        );
        expect(under, 'map controls under the sheet at half').toEqual([]);
      });
    }
  });
}

/**
 * The longest task a pan and the frames it ends on may take on a CPU six times slower, in ms: the picture
 * and the names drawn again for where it stopped, each its own frame, and of the land only what is in
 * view. It was one task of 107 to 120 ms (audit, 2026-10-24), which nothing measured; measured after, 80
 * to 97.
 */
const SETTLE_MS = 100;

test.describe('the map, moved', () => {
  test('at ×4, with every overlay on, 60°N can be brought out from under the key', async ({ page }) => {
    await serveHazards(page);
    await landed(page, { signedOn: true });
    const screen = await choose(page, /^Nation States/);
    await screen.locator('[data-ages]').check();
    await screen.locator('[data-daylight]').check();
    await screen.locator('[data-hazards]').check();
    await expect(page.locator('[data-legend]')).toContainText(/Hazards · 3 feeds/);
    await home(page);
    // The helper drags the point out from under whatever covers it, and fails saying what if it cannot.
    await zoomAt(page, 25, 60, 4);
    await zoomAt(page, -100, 60, 1);
  });

  test('a pan or a pinch that starts on the key moves the map, and the page stays as it is', async ({ page }) => {
    await landed(page);
    const canvas = page.locator('.grid canvas');
    await zoomAt(page, -98, 38, 3);
    const before = await canvas.getAttribute('data-view');
    const name = (await page.locator('.nav-key h1').boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const [x, y] = [name.x + name.width / 2, name.y + name.height / 2];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 8 * i, y: y + 6 * i, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await frame(page);
    expect(await canvas.getAttribute('data-view'), 'a drag on the key did not move the map').not.toBe(before);
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1), 'the page was zoomed instead').toBe(1);
  });

  test('under a CPU six times slower, a pan of the whole Earth keeps up: no step of it a long task', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __long: number[]; __rec: boolean };
      w.__long = [];
      w.__rec = false;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (w.__rec) w.__long.push(e.duration);
      }).observe({ type: 'longtask', buffered: false });
    });
    await landed(page, { signedOn: true });
    const box = (await page.locator('.grid canvas').boundingBox())!;
    const keyFoot = (await page.locator('.nav-key').boundingBox())!;
    const sheet = (await page.locator('[data-com]').boundingBox())!;
    const [x, y] = [box.x + box.width / 2 - 40, (keyFoot.y + keyFoot.height + sheet.y) / 2];
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    await page.waitForTimeout(500);
    await page.evaluate(() => void ((window as unknown as { __rec: boolean }).__rec = true));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    for (let i = 1; i <= 30; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 3 * i, y: y - 2 * i, id: 1 }] });
      await page.waitForTimeout(16);
    }
    // Read before the finger lifts: the picture is drawn again once, then, and that is not a step of the pan.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    const long = await page.evaluate(() => {
      const w = window as unknown as { __long: number[]; __rec: boolean };
      w.__rec = false;
      return w.__long;
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    expect(Math.max(0, ...long), `long tasks during the pan: ${long.map(Math.round).join(', ')} ms`).toBeLessThanOrEqual(50);
  });

  test(`under a CPU six times slower, at ×4 with Places, a fire season and day and night on, the frame a pan ends on is no task over ${SETTLE_MS} ms`, async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __long: number[]; __rec: boolean };
      w.__long = [];
      w.__rec = false;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (w.__rec) w.__long.push(e.duration);
      }).observe({ type: 'longtask', buffered: false });
    });
    await serveHazards(page, { bodies: busySeason(AT.getTime()) });
    await landed(page, { signedOn: true });
    const screen = await layersScreen(page);
    await screen.locator('[data-daylight]').check();
    await screen.locator('[data-hazards]').check();
    await expect(page.locator('[data-legend]')).toContainText('Hazards · 3 feeds');
    await home(page);
    const places = page.waitForResponse((r) => r.url().endsWith('/grid/places.json'));
    await page.locator('.nav-key button.layer').click();
    await places;
    await zoomAt(page, -98, 38, 4);
    await page.waitForTimeout(300);
    await frame(page);
    const box = (await page.locator('.grid canvas').boundingBox())!;
    const keyFoot = (await page.locator('.nav-key').boundingBox())!;
    const sheet = (await page.locator('[data-com]').boundingBox())!;
    const [x, y] = [box.x + box.width / 2 - 60, (keyFoot.y + keyFoot.height + sheet.y) / 2];
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    await page.waitForTimeout(500);
    const ends: number[][] = [];
    // Two pans, one short and one long enough that the picture is drawn again during it.
    for (const [dx, dy] of [[90, 0], [280, -40]] as const) {
      await page.evaluate(() => {
        const w = window as unknown as { __long: number[]; __rec: boolean };
        w.__long = [];
        w.__rec = true;
      });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      for (let i = 1; i <= 20; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 20, y: y + (dy * i) / 20, id: 1 }] });
        await page.waitForTimeout(16);
      }
      // The finger lifts, and the picture and the names are drawn again for where the pan left them.
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))));
      await page.waitForTimeout(200);
      ends.push(
        await page.evaluate(() => {
          const w = window as unknown as { __long: number[]; __rec: boolean };
          w.__rec = false;
          return w.__long;
        })
      );
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const all = ends.flat();
    expect(Math.max(0, ...all), `long tasks, each pan and its end: ${ends.map((e) => e.map(Math.round).join(', ')).join(' | ')} ms`).toBeLessThanOrEqual(SETTLE_MS);
  });
});

/**
 * How a mission's ring stands against what is round it: its brightest annulus, and the median of the
 * band just outside it, which is the ground it is drawn on, a casing, or whatever the map put there.
 */
async function ringContrast(page: Page, lon: number, lat: number): Promise<number> {
  const at = await screenAt(page, lon, lat);
  expect(at.uncovered, `${lon}, ${lat} is in view`).toBe(true);
  const ring = async (r: number) => lumsAt(page, Array.from({ length: 48 }, (_, i) => [at.x + r * Math.cos((i * Math.PI) / 24), at.y + r * Math.sin((i * Math.PI) / 24)] as [number, number]));
  let best = { r: 0, lum: -1 };
  for (let r = 5; r <= 13; r += 0.5) {
    const m = median(await ring(r));
    if (m > best.lum) best = { r, lum: m };
  }
  const outside = [...(await ring(best.r + 2)), ...(await ring(best.r + 3))];
  return contrast(best.lum, median(outside));
}

/** The missions of the night with a point, each drawn as a ring there. */
const RINGS = [[-95.37, 29.76], [-75.1252, 39.9926], [-0.1276, 51.5072], [-100, 55]] as const;

type Box = { l: number; t: number; r: number; b: number };
/** The counts the map drew, as the canvas carries them [GridMap.svelte data-counts], in page px. */
async function countsOn(page: Page): Promise<{ of: string; n: number; x: number; y: number; box: Box }[]> {
  const canvas = page.locator('.grid canvas');
  const raw = JSON.parse((await canvas.getAttribute('data-counts')) ?? '[]') as [string, number, number, number, number, number, number, number][];
  const c = (await canvas.boundingBox())!;
  return raw.map(([of, n, x, y, l, t, r, b]) => ({ of, n, x: c.x + x, y: c.y + y, box: { l: c.x + l, t: c.y + t, r: c.x + r, b: c.y + b } }));
}

/** Whether a point of the page shows the map: the canvas topmost there, and nothing painted over it, the key included. */
const openAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([x, y]) => {
      const key = document.querySelector('.nav-key')!.getBoundingClientRect();
      const underKey = x! >= key.left && x! <= key.right && y! >= key.top && y! <= key.bottom;
      return !underKey && document.elementFromPoint(x!, y!) === document.querySelector('.grid canvas');
    },
    [x, y]
  );

test.describe('the missions, among everything else', () => {
  for (const low of [false, true]) {
    test(`${low ? 'low' : 'document'} signature: with Places on at the opening view, a mission's ring keeps 3:1 against what is round it`, async ({ page }) => {
      await landed(page, { low });
      const places = page.waitForResponse((r) => r.url().endsWith('/grid/places.json'));
      await page.locator('.nav-key button.layer').click();
      await places;
      await page.waitForTimeout(300);
      await frame(page);
      for (const [where, lon, lat] of [['Philadelphia', -75.1252, 39.99], ['Houston', -95.4, 29.8]] as const) {
        expect(await ringContrast(page, lon, lat), `${where}'s ring in the US's crowd of regions`).toBeGreaterThanOrEqual(3);
      }
    });
  }

  test('in a fire season, the missions are still the brightest thing where they are, at the whole Earth and at ×4', async ({ page }) => {
    await serveHazards(page, { bodies: busySeason() });
    await landed(page);
    const screen = await layersScreen(page);
    await screen.locator('[data-hazards]').check();
    await expect(page.locator('[data-legend]')).toContainText('Hazards · 3 feeds');
    await home(page);
    expect(await ringContrast(page, -95.4, 29.8), 'Houston among the fires').toBeGreaterThanOrEqual(3);
    await zoomAt(page, -95.4, 29.8, 4);
    expect(await ringContrast(page, -95.4, 29.8), 'Houston among the fires at ×4').toBeGreaterThanOrEqual(3);
  });

  test('in a fire season at the whole Earth, the US West’s fires are drawn clear of the missions’ rings, with how many', async ({ page }) => {
    await serveHazards(page, { bodies: busySeason(AT.getTime()) });
    await landed(page);
    const screen = await layersScreen(page);
    await screen.locator('[data-hazards]').check();
    await expect(page.locator('[data-legend]')).toContainText('Hazards · 3 feeds');
    await home(page);
    await page.waitForTimeout(300);
    await frame(page);
    // What the map drew a count for, where, and how many: the canvas carries it, as it does its view.
    const drawn = await countsOn(page);
    const fires = drawn.filter((c) => c.of === 'wildfire' && c.n >= 100);
    expect(fires.length, `no count of 100 or more fires drawn: ${JSON.stringify(drawn)}`).toBeGreaterThan(0);
    const fire = fires[0]!;
    // Clear of every ring, which is drawn over everything: its glyph, and its count.
    const rings = await Promise.all(RINGS.map(([lon, lat]) => screenAt(page, lon, lat)));
    for (const r of rings) {
      expect(Math.hypot(r.x - fire.x, r.y - fire.y), `the fires’ mark under a ring at ${Math.round(r.x)}, ${Math.round(r.y)}`).toBeGreaterThan(15);
      const b = fire.box;
      const nearest = Math.hypot(Math.max(b.l - r.x, 0, r.x - b.r), Math.max(b.t - r.y, 0, r.y - b.b));
      expect(nearest, 'the fires’ count under a ring').toBeGreaterThan(9);
    }
    // Drawn, and in the open: the glyph in ink, the count's figures in ink on its pill, neither under the key.
    expect(await inkNear(page, fire.x, fire.y, 7), 'no glyph where the fires are said to be').toBeGreaterThan(8);
    expect(await inkNear(page, (fire.box.l + fire.box.r) / 2, (fire.box.t + fire.box.b) / 2, 5), 'no figures in the fires’ count').toBeGreaterThan(4);
    for (const [px, py] of [[fire.x, fire.y], [(fire.box.l + fire.box.r) / 2, (fire.box.t + fire.box.b) / 2]] as const) expect(await openAt(page, px, py), 'under the key or the controls').toBe(true);
    // And it is the fires: what the pointer says over it.
    await page.mouse.move(fire.x, fire.y);
    await expect(page.locator('[data-chip]')).toHaveText(/^Fixture fire \d+, synthetic · .* and (\d+) more/);
    const more = Number(/and (\d+) more/.exec((await page.locator('[data-chip]').textContent()) ?? '')?.[1]);
    expect(more + 1, 'the mark under the pointer is not the fire season’s').toBeGreaterThanOrEqual(100);
  });

  test('a Zone’s count, Hazards’ counts and the sun are laid out once, none over another or under a ring', async ({ page }) => {
    await serveZones(page, '2');
    await serveHazards(page, { bodies: busySeason(AT.getTime()) });
    await landed(page);
    const screen = await choose(page, /^Zones/);
    await screen.locator('[data-daylight]').check();
    await screen.locator('[data-hazards]').check();
    await expect(page.locator('[data-legend]')).toContainText('Hazards · 3 feeds');
    await home(page);
    await page.waitForTimeout(300);
    await frame(page);
    const drawn = await countsOn(page);
    expect(drawn.some((c) => c.of.startsWith('zone:') || c.of.startsWith('terra:')), `no Zone’s count: ${JSON.stringify(drawn)}`).toBe(true);
    expect(drawn.some((c) => !c.of.includes(':')), `no Hazards’ count: ${JSON.stringify(drawn)}`).toBe(true);
    const over = (a: Box, b: Box) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
    for (const [i, a] of drawn.entries()) for (const b of drawn.slice(i + 1)) expect(over(a.box, b.box), `${a.of} ${a.n} over ${b.of} ${b.n}`).toBe(false);
    // The sun, where it is overhead at this minute, by the same arithmetic the map's own module does.
    const sun = subsolar(Math.floor(AT.getTime() / 60_000) * 60_000);
    const s = await screenAt(page, sun.lon, sun.lat);
    const rings = await Promise.all(RINGS.map(([lon, lat]) => screenAt(page, lon, lat)));
    for (const c of drawn) {
      expect(over(c.box, { l: s.x - 9.5, t: s.y - 9.5, r: s.x + 9.5, b: s.y + 9.5 }), `${c.of} ${c.n} over the sun`).toBe(false);
      for (const r of rings) expect(over(c.box, { l: r.x - 8, t: r.y - 8, r: r.x + 8, b: r.y + 8 }), `${c.of} ${c.n} under a ring`).toBe(false);
    }
  });

  test('at the whole Earth a ring is a 6 px symbol with its centre, and closer in it grows to 9', async ({ page }) => {
    await landed(page);
    // London's, alone in the open: the brightest circle round its point, and the centre in ink.
    const radius = async () => {
      const at = await screenAt(page, -0.1276, 51.5072);
      let best = { r: 0, n: -1 };
      for (let r = 4; r <= 12; r += 0.5) {
        let n = 0;
        for (let i = 0; i < 24; i++) n += await inkNear(page, at.x + r * Math.cos((i * Math.PI) / 12), at.y + r * Math.sin((i * Math.PI) / 12), 0.5);
        if (n > best.n) best = { r, n };
      }
      return { r: best.r, centre: await inkNear(page, at.x, at.y, 1) };
    };
    const far = await radius();
    expect(far.r, 'a ring at the whole Earth as large as one closer in').toBeLessThanOrEqual(7);
    expect(far.centre, 'no centre to a ring drawn as a symbol').toBeGreaterThan(0);
    await zoomAt(page, -0.1276, 51.5072, 3);
    await page.mouse.move(5, 5);
    await frame(page);
    expect((await radius()).r, 'a ring closer in no larger than at the whole Earth').toBeGreaterThanOrEqual(8.5);
  });

  test('a mission at a point in a province the file does not have is its ring, and does not light its whole country', async ({ page }) => {
    await landed(page);
    // Northern Quebec, far from the Manitoba depot's ring and its casing: plain land, as Siberia is.
    const canada = await patch(page, -70, 56, 2);
    const russia = await patch(page, 100, 64, 2);
    expect(contrast(canada, russia), 'Canada is lit for a depot in Manitoba').toBeLessThan(1.05);
  });
});

test.describe('a tap takes what the finger is inside', () => {
  test('at the opening view, a tap inside a lit California opens California, not a mission ring a thumb away in Texas', async ({ page }) => {
    await landed(page);
    await tapAt(page, -119.5, 37.2, 'California');
    await expect(page.locator('[data-screen="place"][data-place="us-ca"]')).toBeVisible();
    await expect(page.locator('[data-screen="mission"]')).toHaveCount(0);
  });

  test('at ×40, where a thumb is a street, a tap 10 px off a record opens the record, as its 12 px reach says, not the province under it', async ({ page }) => {
    await landed(page);
    const arrived = page.waitForResponse((r) => r.url().endsWith('/grid/places.json'));
    await page.locator('.nav-key button.layer').click();
    await arrived;
    // The record standing furthest from any other, in the band the opening view shows, on the map's rectangle.
    const file = await page.evaluate(async () => (await (await fetch('/grid/places.json')).json()) as { regions: Record<string, ([number, number] | null)[]> });
    const records = Object.entries(file.regions).flatMap(([slug, ps]) => ps.flatMap((p, i) => (p ? [{ slug, i, lon: p[0], lat: p[1], u: project(p[0], p[1]) }] : [])));
    const cells = new Map<string, typeof records>();
    const cellOf = (lon: number, lat: number) => `${Math.floor(lon)} ${Math.floor(lat)}`;
    for (const r of records) cells.set(cellOf(r.lon, r.lat), [...(cells.get(cellOf(r.lon, r.lat)) ?? []), r]);
    let lone = { r: records[0]!, gap: 0 };
    for (const r of records) {
      if (r.lat < 25 || r.lat > 55) continue;
      let gap = Infinity;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const o of cells.get(cellOf(r.lon + dx, r.lat + dy)) ?? []) if (o !== r) gap = Math.min(gap, Math.hypot(o.u[0] - r.u[0], o.u[1] - r.u[1]));
      if (gap > lone.gap) lone = { r, gap };
    }
    await zoomAt(page, lone.r.lon, lone.r.lat, 40);
    await page.mouse.move(5, 5);
    await frame(page);
    const at = await screenAt(page, lone.r.lon, lone.r.lat);
    const scale = Number(((await page.locator('.grid canvas').getAttribute('data-view')) ?? '').split(' ')[2]);
    expect(lone.gap * scale, `the loneliest record is ${Math.round(lone.gap * scale)} px from the next at ×40`).toBeGreaterThan(24);
    // 10 px off it, in the open: inside its province, past the 8 px a record took there, within the 12 its thumb is given.
    const spot = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => [at.x + 10 * Math.cos((k * Math.PI) / 4), at.y + 10 * Math.sin((k * Math.PI) / 4)] as [number, number]);
    let tapped: [number, number] | null = null;
    for (const t of spot) if (!tapped && (await openAt(page, ...t))) tapped = t;
    expect(tapped, 'nowhere 10 px off the record is in the open').not.toBeNull();
    await tap(page, ...tapped!);
    await expect(page.locator(`[data-screen="place"][data-place="${lone.r.slug}"][data-record="${lone.r.i}"]`)).toBeVisible();
  });

  test('under Spheres, a tap in Sicily 11 px from Malta’s diamond opens Italy, not Malta', async ({ page }) => {
    await serveSpheres(page);
    await landed(page);
    await choose(page, /^Spheres/);
    await expect(page.locator('[data-legend="spheres"]')).toContainText('draft lists');
    await home(page);
    await zoomAt(page, 14.4, 37, 8);
    await page.mouse.move(5, 5);
    await frame(page);
    const malta = await screenAt(page, 14.43, 35.89);
    const [x, y] = [malta.x, malta.y - 11];
    // Inside Sicily there, by the map's own inverse.
    const view = ((await page.locator('.grid canvas').getAttribute('data-view')) ?? '').split(' ').map(Number) as [number, number, number];
    const c = (await page.locator('.grid canvas').boundingBox())!;
    const [lon, lat] = unproject(view[0] + (x - c.x - c.width / 2) / view[2], view[1] + (y - c.y - c.height / 2) / view[2]);
    expect(lat > 37 && lat < 38 && lon > 13.5 && lon < 15.2, `${lon}, ${lat} is not in Sicily`).toBe(true);
    expect(await openAt(page, x, y)).toBe(true);
    await tap(page, x, y);
    await expect(page.locator('[data-screen="place"][data-place="it"]')).toBeVisible();
    await expect(page.locator('[data-screen="sphere"][data-code="mt"]')).toHaveCount(0);
  });

  test('under Zones, a tap inside a Zone opens the Zone, not a lit California within a thumb of it', async ({ page }) => {
    await serveZones(page, '2');
    await landed(page);
    await choose(page, /^Zones/);
    await expect(page.locator('[data-legend="zones"]')).toContainText('Zones · draft 2');
    await home(page);
    await tapAt(page, -120, 45, 'Oregon');
    await expect(page.locator('[data-screen="zone"][data-zone="zone:laurentia-west"]')).toBeVisible();
    await expect(page.locator('[data-screen="place"]')).toHaveCount(0);
  });
});

test.describe('a mark keeps to what it marks', () => {
  test('a Zone’s count moved off a ring stays inside its own Zone or Sector', async ({ page }) => {
    await serveZones(page, '2');
    await landed(page);
    const screen = await choose(page, /^Zones/);
    // Laurentia's Sectors, so Houston's ring sits by the label point of the Sector it is counted in.
    await screen.locator('[data-zone-open="terra:laurentia"]').click();
    await page.locator('[data-zone-open="zone:laurentia-west"]').click();
    await expect(page.locator('[data-screen="zone"][data-zone="zone:laurentia-west"]')).toBeVisible();
    await home(page);
    await page.waitForTimeout(300);
    await frame(page);
    const drawn = (await countsOn(page)).filter((c) => c.of.includes(':'));
    expect(drawn.length, 'no Zone’s count drawn').toBeGreaterThan(0);
    // Every area the fixture has, as the map decodes it.
    const zsp = (name: string) => decode(JSON.parse(readFileSync(new URL(`./fixtures/zsp/${name}`, import.meta.url), 'utf8')) as Topology);
    const areas = [...Object.values(zsp('outlines.json')), ...Object.values(zsp('terra-laurentia.json'))].flatMap((l) => l.shapes);
    const view = ((await page.locator('.grid canvas').getAttribute('data-view')) ?? '').split(' ').map(Number) as [number, number, number];
    const c = (await page.locator('.grid canvas').boundingBox())!;
    for (const d of drawn) {
      const area = areas.find((a) => a.id === d.of);
      expect(area, `no area ${d.of} in the fixture`).toBeTruthy();
      const u: [number, number] = [view[0] + (d.x - c.x - c.width / 2) / view[2], view[1] + (d.y - c.y - c.height / 2) / view[2]];
      expect(inside(area!.rings, u), `${d.of}’s count is drawn outside it, at ${unproject(...u).map((n) => n.toFixed(1)).join(', ')}`).toBe(true);
    }
  });
});

test.describe('the land and its coast, closer in', () => {
  test('from ×2 in, where the file has provinces, the land and its coast are theirs: Puget Sound’s shore is land, Pamlico Sound water', async ({ page }) => {
    await landed(page);
    // None: the land and its coast alone, with no name on them to read through.
    await choose(page, /^None/);
    await home(page);
    /** In to `zoom` at (lon, lat), from the whole Earth, with (lon, lat) in the middle of what nothing covers. */
    const look = async (lon: number, lat: number, zoom: number) => {
      await page.getByRole('button', { name: 'Show the whole map' }).click();
      await frame(page);
      await zoomAt(page, lon, lat, zoom);
      const [rx, ry] = ((await page.locator('.grid canvas').getAttribute('data-reticle')) ?? '').split(' ').map(Number) as [number, number];
      const c = (await page.locator('.grid canvas').boundingBox())!;
      const mid = await screenAt(page, lon, lat);
      await page.mouse.move(mid.x, mid.y);
      await page.mouse.down();
      await page.mouse.move(c.x + rx, c.y + ry, { steps: 4 });
      await page.mouse.up();
      await page.mouse.move(5, 5);
      await frame(page);
    };
    // Kitsap's shore, on the land at 1:10m and in the sea at 1:110m, beside inland Washington and the Pacific.
    await look(-123.6, 47.7, 80);
    const land = await patch(page, -122.2, 47.4, 1);
    const sea = await patch(page, -125.0, 47.6, 1);
    expect(contrast(land, sea), 'no land against the sea at all').toBeGreaterThanOrEqual(1.3);
    expect(contrast(await patch(page, -122.9, 47.9, 1), land), 'the shore of Puget Sound is drawn as sea').toBeLessThan(1.1);
    // Pamlico Sound, water at 1:10m and land at 1:110m, beside inland North Carolina and the Atlantic.
    await look(-76.3, 35.2, 80);
    const land2 = await patch(page, -77.2, 35.4, 1);
    const sea2 = await patch(page, -74.9, 35.0, 1);
    expect(contrast(land2, sea2), 'no land against the sea at all').toBeGreaterThanOrEqual(1.3);
    expect(contrast(await patch(page, -76.3, 35.2, 1), sea2), 'Pamlico Sound is drawn as land').toBeLessThan(1.1);
  });
});

test.describe('what the map says, and where', () => {
  test('the key gives the missions their own mark, a ring, and a lit place a row of its own', async ({ page }) => {
    await landed(page);
    // The ring the map draws, and not the directory's square.
    const ring = await page.locator('[data-missions="open"] .ring').evaluate((e) => {
      const st = getComputedStyle(e);
      return { radius: st.borderTopLeftRadius, w: e.getBoundingClientRect().width };
    });
    expect(ring.radius, 'the missions’ mark in the key is not round').toBe('50%');
    // California is lit by a mission filed under it: the key says what a lit place is.
    await expect(page.locator('[data-swatch="lit"]')).toHaveText('Missions filed under a place');
  });


  for (const viewport of [{ width: 393, height: 727 }, { width: 360, height: 560 }]) {
    test(`on a ${viewport.width} px phone, a readout with nowhere near to go is never over the controls, nor the point it names`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await landed(page);
      // The Manitoba depot's ring, high on the Earth, where nothing near the pointer is clear.
      const at = await bring(page, -100, 55);
      expect(at.uncovered, 'the depot’s ring in view').toBe(true);
      await page.mouse.move(at.x, at.y);
      const chip = page.locator('[data-chip]');
      await expect(chip).toHaveText(/^Water at the depot · open mission/);
      await frame(page);
      const box = (await chip.boundingBox())!;
      const controls = (await page.locator('.grid .controls').boundingBox())!;
      const key = (await page.locator('.nav-key').boundingBox())!;
      const over = (b: { x: number; y: number; width: number; height: number }) => box.x < b.x + b.width && box.x + box.width > b.x && box.y < b.y + b.height && box.y + box.height > b.y;
      expect(over(controls), `the readout ${JSON.stringify(box)} is over the controls ${JSON.stringify(controls)}`).toBe(false);
      expect(over(key), `the readout ${JSON.stringify(box)} is over the key ${JSON.stringify(key)}`).toBe(false);
      expect(over({ x: at.x - 3, y: at.y - 3, width: 6, height: 6 }), 'the readout is over the point it names').toBe(false);
    });
  }

  test('a readout under the pointer never sits over the key or the controls', async ({ page }) => {
    await landed(page);
    const key = (await page.locator('.nav-key').boundingBox())!;
    const controls = (await page.locator('.grid .controls').boundingBox())!;
    // Canada's far north, just under the key at the opening view: a readout above the pointer was over the key.
    const at = await screenAt(page, -95, 68);
    expect(at.uncovered).toBe(true);
    await page.mouse.move(at.x, at.y);
    const chip = page.locator('[data-chip]');
    await expect(chip).toHaveText(/Canada/);
    await frame(page);
    const box = (await chip.boundingBox())!;
    for (const [what, b] of [['key', key], ['controls', controls]] as const) {
      const over = box.x < b.x + b.width && box.x + box.width > b.x && box.y < b.y + b.height && box.y + box.height > b.y;
      expect(over, `the readout ${JSON.stringify(box)} is over the ${what} ${JSON.stringify(b)}`).toBe(false);
    }
  });

  test('a screen reader hears which layer is drawn, the key as sentences, and where the reticle is even over the sea', async ({ page }) => {
    await serveZones(page, '2');
    await serveHazards(page);
    await landed(page);
    const canvas = page.locator('.grid canvas');
    await expect(canvas).toHaveAttribute('aria-label', /Layer: Nation States/);
    const screen = await choose(page, /^Zones/);
    await expect(page.locator('[data-said]')).toHaveText(/^Map layer: Zones · draft 2/);
    await expect(canvas).toHaveAttribute('aria-label', /Layer: Zones · draft 2.*over it, missions by Zone/);
    await screen.locator('[data-hazards]').check();
    await expect(page.locator('[data-legend]')).toContainText('Hazards · 3 feeds');
    // Each line a sentence to a screen reader, not one run-on line.
    expect(await page.locator('[data-legend]').textContent()).toMatch(/^Hazards · 3 feeds just now · some events, never all\. Zones · draft 2, view only\. Missions in Zones: \d+ · by jurisdiction: \d+$/);
    await expect(page.locator('[data-swatches]')).toHaveAttribute('aria-label', 'Map key');
    await home(page);
    // The keyboard's reticle over the open Atlantic: it says so, and roughly where.
    await choose(page, /^Nation States/);
    await home(page);
    await zoomAt(page, -38, 28, 3);
    await canvas.focus();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[data-said]')).toHaveText(/^Open water, about \d+°[NS] \d+°[EW]$/);
  });

  for (const viewport of [{ width: 393, height: 727 }, { width: 360, height: 560 }]) {
    test(`on a ${viewport.width} px phone, a layer whose licence asks for credit carries it on the map, on one line over its foot, clear of the controls, and none at full height`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await serveZones(page, '2');
      await landed(page, { signedOn: viewport.width < 380 });
      await choose(page, /^Zones/);
      const credit = page.locator('[data-credit]');
      // The key keeps one short line; the credit CC BY asks for is on the map itself, as maps carry theirs.
      await expect(page.locator('[data-legend="zones"] .line').first()).toHaveText('Zones · draft 2, view only');
      await expect(credit).toHaveText('Zones: NavCom test fixture, never shipped, CC BY 4.0');
      await expect(page.locator('[data-com]')).toHaveAttribute('data-detent', 'half');
      const controls = (await page.locator('.grid .controls').boundingBox())!;
      const clear = async (where: string) => {
        expect(await seen(credit), `the credit is under the sheet at ${where}`).toBe(true);
        const box = (await credit.boundingBox())!;
        const line = await credit.evaluate((e) => parseFloat(getComputedStyle(e).lineHeight));
        expect(box.height, `the credit runs to more than one line at ${where}`).toBeLessThanOrEqual(line + 1);
        const beside = box.y < controls.y + controls.height && box.y + box.height > controls.y;
        if (beside) expect(box.x + box.width, `the credit runs under the controls at ${where}`).toBeLessThanOrEqual(controls.x);
      };
      await clear('half');
      await home(page);
      const detent = async (want: string) => {
        for (let i = 0; i < 3 && (await page.locator('[data-com]').getAttribute('data-detent')) !== want; i++) await page.locator('.grab').click();
        await expect(page.locator('[data-com]')).toHaveAttribute('data-detent', want);
        // The sheet eases to its height over 0.2 s.
        await page.waitForTimeout(400);
        await frame(page);
      };
      await detent('peek');
      await clear('peek');
      // At full height the map is a strip under the key: the credit stays on the layers screen.
      await detent('full');
      await expect(credit).toHaveCount(0);
      // Nation States carries none: Natural Earth's outlines are public domain.
      await detent('half');
      await choose(page, /^Nation States/);
      await expect(credit).toHaveCount(0);
    });
  }

  test('the layers screen gives the whole key: every line with the rest of its words, and every mark the map’s own row names', async ({ page }) => {
    await serveHazards(page);
    await landed(page, { signedOn: true });
    const screen = await layersScreen(page);
    await screen.locator('[data-daylight]').check();
    await screen.locator('[data-hazards]').check();
    await expect(page.locator('[data-legend]')).toContainText('Hazards · 3 feeds just now · some events, never all');
    const full = screen.locator('[data-key-full]');
    await expect(full).toContainText('worked out on this phone from its own clock, nothing fetched');
    await expect(full).toContainText('USGS, EONET and GDACS');
    // The marks a small phone's key is cut short before, each drawn as the map draws it.
    const marks = screen.locator('[data-key-swatches]');
    await expect(marks.locator('[data-key-swatch="triangle"]')).toHaveText('Fires · 1');
    await expect(marks.locator('[data-key-swatch="dots"]')).toHaveText('Night · twilight has half the dots');
    await expect(screen.locator('[data-key-mark="area"]')).toContainText('an event over an area');
  });

  test('a mission read out by the reticle or the pointer says where it is filed', async ({ page }) => {
    await landed(page);
    await zoomAt(page, -0.1276, 51.5072, 6);
    const at = await screenAt(page, -0.1276, 51.5072);
    await page.mouse.move(at.x, at.y);
    await expect(page.locator('[data-chip]')).toHaveText('Library warming room · open mission · United Kingdom');
  });
});
