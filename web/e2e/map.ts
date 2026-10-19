import { expect, type Page } from '@playwright/test';
import { HEIGHT, project, unproject } from '../src/lib/grid/topology';

/**
 * Driving the landing page's map by longitude and latitude, as a person would by eye.
 *
 * Every position is computed from the view the canvas is drawing right now (`data-view`), with the
 * map's own projection, imported rather than written out again, so a test taps where a place
 * actually is on screen rather than where it was when the test was written, and a change of
 * projection is made once [GridMap.svelte; topology.ts project]. It was Web Mercator, inlined here,
 * until Equal Earth replaced it (2026-10-18, D1).
 */

const canvas = (page: Page) => page.locator('.grid canvas');

/** One frame, so whatever changed has been drawn. */
export const frame = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));

export async function mapReady(page: Page) {
  await expect(page.locator('[data-grid="ready"]')).toBeVisible({ timeout: 15_000 });
  await frame(page);
}

/** Where (lon, lat) is on screen, in CSS px, and whether a tap there would reach the map itself. */
export async function screenAt(page: Page, lon: number, lat: number): Promise<{ x: number; y: number; uncovered: boolean }> {
  const [ux, uy] = project(lon, lat);
  return canvas(page).evaluate(
    (c: HTMLCanvasElement, [ux, uy]) => {
      const [cx, cy, scale] = (c.dataset.view ?? '').split(' ').map(Number) as [number, number, number];
      const r = c.getBoundingClientRect();
      const x = r.left + (ux - cx) * scale + r.width / 2;
      const y = r.top + (uy - cy) * scale + r.height / 2;
      const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      return { x, y, uncovered: inside && document.elementFromPoint(x, y) === c };
    },
    [ux, uy] as [number, number]
  );
}

/**
 * A tap at a CSS point, the way this device makes one: a finger on a touchscreen, a click with a
 * mouse. On the phone project a mouse click is a mouse-type pointer event, a path no phone takes —
 * the map's hover runs for it and a finger's never does — so a test that clicked there tested the
 * desktop's way in on a phone's screen.
 */
export async function tap(page: Page, x: number, y: number) {
  if (await page.evaluate(() => navigator.maxTouchPoints > 0)) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/** Taps (lon, lat), after checking nothing covers it there. */
export async function tapAt(page: Page, lon: number, lat: number, what = `${lat},${lon}`) {
  const at = await bring(page, lon, lat);
  expect(at.uncovered, `${what} should be on screen and uncovered`).toBe(true);
  await tap(page, at.x, at.y);
}

/**
 * A point of the canvas nothing covers, as near as there is one to the middle of all such points, in
 * CSS px: found by asking the page what is at each point of a grid, so a key, the controls and the
 * sheet at whatever height it is are all accounted for. Null when nothing of the canvas is uncovered.
 */
async function clearSpot(page: Page): Promise<{ x: number; y: number } | null> {
  return canvas(page).evaluate((c: HTMLCanvasElement) => {
    const r = c.getBoundingClientRect();
    const clear: [number, number][] = [];
    for (let i = 1; i < 16; i++) {
      for (let j = 1; j < 16; j++) {
        const x = r.left + (r.width * i) / 16;
        const y = r.top + (r.height * j) / 16;
        if (document.elementFromPoint(x, y) === c) clear.push([x, y]);
      }
    }
    if (clear.length === 0) return null;
    const mx = clear.reduce((n, p) => n + p[0], 0) / clear.length;
    const my = clear.reduce((n, p) => n + p[1], 0) / clear.length;
    const [x, y] = clear.reduce((a, b) => (Math.hypot(b[0] - mx, b[1] - my) < Math.hypot(a[0] - mx, a[1] - my) ? b : a));
    return { x, y };
  });
}

/**
 * Where (lon, lat) is on screen, after dragging the map to bring it out from under the key, the
 * controls or the sheet when it is under one of them, or off the canvas: as a person would, and from
 * a point of the canvas nothing covers. A point already in the open is left where it is.
 */
export async function bring(page: Page, lon: number, lat: number): Promise<{ x: number; y: number; uncovered: boolean }> {
  const at = await screenAt(page, lon, lat);
  if (at.uncovered) return at;
  const spot = await clearSpot(page);
  if (!spot) return at;
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await page.mouse.move(spot.x + (spot.x - at.x), spot.y + (spot.y - at.y), { steps: 4 });
  await page.mouse.up();
  await frame(page);
  return screenAt(page, lon, lat);
}

const scaleOf = async (page: Page) => Number(((await canvas(page).getAttribute('data-view')) ?? '').split(' ')[2]);

/**
 * Zooms in by `factor` with the wheel, keeping (lon, lat) where it is on screen. In steps, and
 * checked against the scale the map then draws at: one large wheel event is not what a person
 * sends, and a browser may not deliver it whole.
 *
 * A step can carry the point under the map's key, or off the canvas: while the world is not quite
 * as tall as the canvas it is held wholly on it, which pins it top to bottom. Then the point is
 * brought back into the open first [bring], as a person would, and the zoom goes on there.
 */
export async function zoomAt(page: Page, lon: number, lat: number, factor: number) {
  const target = (await scaleOf(page)) * factor * 0.999;
  let pinned = 0;
  for (let i = 0; i < 40 && (await scaleOf(page)) < target; i++) {
    const brought = await bring(page, lon, lat);
    let at: { x: number; y: number } | null = brought;
    if (!brought.uncovered) {
      // Held wholly on the canvas, the world can be too pinned to drag the point out: zoom a step
      // where nothing covers the canvas instead, as a person would, then bring the point out again.
      if (++pinned > 3) await failToBring(page, lon, lat, brought);
      at = await clearSpot(page);
      if (!at) break;
    }
    await page.mouse.move(at.x, at.y);
    const left = target / (await scaleOf(page));
    // GridMap zooms by exp(-deltaY × 0.0015) a wheel event: at most ×2 a step here.
    await page.mouse.wheel(0, -Math.log(Math.min(2, Math.max(left, 1.01))) / 0.0015);
    await frame(page);
  }
  expect(await scaleOf(page), `zoomed ×${factor}`).toBeGreaterThanOrEqual(target);
  // And the point it was asked about is in the open at the end, where a test will look for it.
  const at = await bring(page, lon, lat);
  if (!at.uncovered) await failToBring(page, lon, lat, at);
}

/** Fails, saying what covers (lon, lat) and at what view, so a failure says why. */
async function failToBring(page: Page, lon: number, lat: number, at: { x: number; y: number; uncovered: boolean }) {
  const what = await page.evaluate(([x, y]) => {
    const e = document.elementFromPoint(x!, y!);
    return e ? `${e.tagName.toLowerCase()}${e.className ? `.${String(e.className).split(' ')[0]}` : ''}` : 'nothing';
  }, [at.x, at.y]);
  const view = await canvas(page).getAttribute('data-view');
  expect(at.uncovered, `(${lon}, ${lat}) is at ${Math.round(at.x)}, ${Math.round(at.y)} under ${what}, view ${view}, and could not be brought out`).toBe(true);
}

/** The canvas's colour at a CSS point, as [r, g, b]. */
export async function pixelAt(page: Page, x: number, y: number): Promise<number[]> {
  return canvas(page).evaluate(
    (c: HTMLCanvasElement, [x, y]) => {
      const r = c.getBoundingClientRect();
      const k = c.width / r.width;
      return [...c.getContext('2d')!.getImageData(Math.round((x - r.left) * k), Math.round((y - r.top) * k), 1, 1).data.slice(0, 3)];
    },
    [x, y] as [number, number]
  );
}

/** How many pixels in a box of `half` CSS px around a point are within 24 of `--t-ink` on every channel. */
export const inkNear = (page: Page, x: number, y: number, half = 12) => toneNear(page, x, y, half, '--t-ink');

/** How many pixels in a box of `half` CSS px around a point are within 24 of a token's colour on every channel. */
export async function toneNear(page: Page, x: number, y: number, half: number, token: '--t-ink' | '--t-muted' | '--t-faint'): Promise<number> {
  return canvas(page).evaluate(
    (c: HTMLCanvasElement, [x, y, half, token]) => {
      const fallback = token === '--t-ink' ? 'F2F5F8' : token === '--t-muted' ? '9BA5B2' : '78828F';
      const hex = getComputedStyle(c).getPropertyValue(token as string).trim().replace('#', '') || fallback;
      const ink = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const r = c.getBoundingClientRect();
      const k = c.width / r.width;
      const [x0, y0, h] = [x as number, y as number, half as number];
      const d = c.getContext('2d')!.getImageData(Math.round((x0 - h - r.left) * k), Math.round((y0 - h - r.top) * k), Math.round(2 * h * k), Math.round(2 * h * k)).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if ([0, 1, 2].every((j) => Math.abs(d[i + j]! - ink[j]!) < 24)) n++;
      return n;
    },
    [x, y, half, token] as [number, number, number, string]
  );
}

/**
 * Whether a person can see an element: on screen, and the topmost thing at its centre, rather than
 * present under the sheet. `toBeVisible` says only the first, and a readout of what the map draws was
 * once present, visible to every test, and behind the sheet whenever a layer's screen was open.
 */
export async function seen(locator: import('@playwright/test').Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (r.width === 0 || r.height === 0 || x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
    const top = document.elementFromPoint(x, y);
    return top !== null && (top === el || el.contains(top));
  });
}

/**
 * Whether any part of an element covers the Earth itself, by its outline rather than its box: its
 * corners, edges' middles and centre, each turned back into a place with the map's own inverse.
 */
export async function overEarth(page: Page, locator: import('@playwright/test').Locator): Promise<boolean> {
  const box = await locator.boundingBox();
  if (!box) return false;
  const view = ((await canvas(page).getAttribute('data-view')) ?? '').split(' ').map(Number) as [number, number, number];
  const r = (await canvas(page).boundingBox())!;
  for (const fx of [0, 0.5, 1]) {
    for (const fy of [0, 0.5, 1]) {
      const sx = box.x + box.width * fx - r.x;
      const sy = box.y + box.height * fy - r.y;
      const ux = view[0] + (sx - r.width / 2) / view[2];
      const uy = view[1] + (sy - r.height / 2) / view[2];
      if (uy < 0 || uy > HEIGHT) continue;
      const [lon] = unproject(ux, uy);
      if (Math.abs(lon) <= 180) return true;
    }
  }
  return false;
}

