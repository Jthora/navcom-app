import { expect, type Page } from '@playwright/test';

/**
 * Driving the landing page's map by longitude and latitude, as a person would by eye.
 *
 * Every position is computed from the view the canvas is drawing right now (`data-view`), with the
 * same Web Mercator the map uses, so a test taps where a place actually is on screen rather than
 * where it was when the test was written [GridMap.svelte].
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
  return canvas(page).evaluate(
    (c: HTMLCanvasElement, [lon, lat]) => {
      const [cx, cy, scale] = (c.dataset.view ?? '').split(' ').map(Number) as [number, number, number];
      const r = c.getBoundingClientRect();
      const phi = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
      const ux = (lon + 180) / 360;
      const uy = (1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2;
      const x = r.left + (ux - cx) * scale + r.width / 2;
      const y = r.top + (uy - cy) * scale + r.height / 2;
      const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      return { x, y, uncovered: inside && document.elementFromPoint(x, y) === c };
    },
    [lon, lat] as [number, number]
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
  const at = await screenAt(page, lon, lat);
  expect(at.uncovered, `${what} should be on screen and uncovered`).toBe(true);
  await tap(page, at.x, at.y);
}

const scaleOf = async (page: Page) => Number(((await canvas(page).getAttribute('data-view')) ?? '').split(' ')[2]);

/**
 * Zooms in by `factor` with the wheel, keeping (lon, lat) where it is on screen. In steps, and
 * checked against the scale the map then draws at: one large wheel event is not what a person
 * sends, and a browser may not deliver it whole.
 */
export async function zoomAt(page: Page, lon: number, lat: number, factor: number) {
  const target = (await scaleOf(page)) * factor * 0.999;
  for (let i = 0; i < 40 && (await scaleOf(page)) < target; i++) {
    const at = await screenAt(page, lon, lat);
    await page.mouse.move(at.x, at.y);
    const left = target / (await scaleOf(page));
    // GridMap zooms by exp(-deltaY × 0.0015) a wheel event: at most ×2 a step here.
    await page.mouse.wheel(0, -Math.log(Math.min(2, Math.max(left, 1.01))) / 0.0015);
    await frame(page);
  }
  expect(await scaleOf(page), `zoomed ×${factor}`).toBeGreaterThanOrEqual(target);
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
export async function toneNear(page: Page, x: number, y: number, half: number, token: '--t-ink' | '--t-muted'): Promise<number> {
  return canvas(page).evaluate(
    (c: HTMLCanvasElement, [x, y, half, token]) => {
      const hex = getComputedStyle(c).getPropertyValue(token as string).trim().replace('#', '') || (token === '--t-ink' ? 'F2F5F8' : '9BA5B2');
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
