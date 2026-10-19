import { expect, test, type Page } from '@playwright/test';
import { chunkOf, open, seedDevice } from './device';
import { bring, frame, mapReady, pixelAt, screenAt, toneNear, zoomAt } from './map';
import { subsolar, terminator } from '../src/lib/grid/sun';

/**
 * Day and night on the map [docs/design/map.md, Day and night], against the build that deploys, on a
 * fixed clock: 14:05 UTC on 19 October 2026, when it is near midnight in central Australia and late
 * morning in Brazil.
 *
 * Where a place is on screen is read again after anything that changes the map's key: a line more in
 * the key moves the opening view, which keeps the whole Earth clear of it.
 *
 * Worked out on the phone from its own clock, so **nothing is fetched** for it but its own code; drawn
 * once a minute and never while the page is hidden, because a map left open on a phone is a battery
 * spent; and redrawn the moment Low signature changes the colours it is drawn in.
 */

const AT = new Date('2026-10-19T14:05:30Z');
const AUSTRALIA = [132, -20] as const;
/** Guyana, in the late morning, and far enough from where the sun is overhead that its mark is not in the patch. */
const GUYANA = [-60, 5] as const;

test.use({ serviceWorkers: 'block' });

async function landed(page: Page) {
  await page.clock.setFixedTime(AT);
  await seedDevice(page, { __noStorage: true });
  await open(page, '/');
  await mapReady(page);
}

/** The layers screen, with a layer chosen. */
async function layers(page: Page, layer: RegExp) {
  await page.getByRole('button', { name: 'Map layers' }).click();
  const screen = page.locator('[data-screen="layers"]');
  await screen.getByRole('radio', { name: layer }).check();
  await frame(page);
  return screen;
}

/**
 * A box of the canvas read whole: how many pixels are dots, lit well above the ground under them, and
 * the WCAG relative luminance of the ground itself, the median of what is not a dot.
 */
const patch = (page: Page, x: number, y: number, half: number) =>
  page.locator('.grid canvas').evaluate(
    (c: HTMLCanvasElement, [x, y, half]) => {
      const r = c.getBoundingClientRect();
      const k = c.width / r.width;
      const d = c.getContext('2d')!.getImageData(Math.round((x! - half! - r.left) * k), Math.round((y! - half! - r.top) * k), Math.round(2 * half! * k), Math.round(2 * half! * k)).data;
      const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      const sums: number[] = [];
      const lums: number[] = [];
      for (let i = 0; i < d.length; i += 4) {
        sums.push(d[i]! + d[i + 1]! + d[i + 2]!);
        lums.push(0.2126 * lin(d[i]!) + 0.7152 * lin(d[i + 1]!) + 0.0722 * lin(d[i + 2]!));
      }
      const order = [...sums.keys()].sort((a, b) => sums[a]! - sums[b]!);
      const ground = sums[order[Math.floor(order.length / 2)]!]!;
      // A dot is lit at least 30 above the ground, on the three channels together.
      const dots = sums.filter((v) => v >= ground + 30).length;
      const under = order.filter((i) => sums[i]! < ground + 30).map((i) => lums[i]!);
      return { dots, share: dots / sums.length, ground: under[Math.floor(under.length / 2)]! };
    },
    [x, y, half] as [number, number, number]
  );

test('ticked over None, it says what it is, worked out here, and fetches nothing but its own code', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => void (/^https?:/.test(r.url()) && asked.push(new URL(r.url()).pathname)));
  await landed(page);
  const screen = await layers(page, /^None/);
  const before = asked.length;
  await screen.locator('[data-daylight]').check();
  await expect(page.locator('[data-legend]')).toHaveText('Day and night at 14:05 UTC · worked out on this phone, nothing fetched');
  // The sun's own position, as the map's code works it out, and as the screen says it.
  const sun = subsolar(Date.parse('2026-10-19T14:05:00Z'));
  const deg = (v: number, p: string, n: string) => `${Math.abs(Math.round(v))}°${v >= 0 ? p : n}`;
  await expect(screen.locator('[data-slot="sun"]')).toContainText(`Overhead at ${deg(sun.lat, 'N', 'S')} ${deg(sun.lon, 'E', 'W')}`);
  await expect(screen.locator('[data-slot="sun"]')).toContainText('14:05 UTC by this phone’s clock');
  await frame(page);
  const own = chunkOf('src/lib/grid/layers/daylight.ts').replace('**', '');
  expect(asked.slice(before), 'fetched something for day and night beyond its own code').toEqual([own]);
});

/** Australia's middle and Guyana, where nothing else is drawn, in view: a patch of each, read whole. */
async function nightAndDay(page: Page) {
  const night = await screenAt(page, ...AUSTRALIA);
  const day = await screenAt(page, ...GUYANA);
  expect(night.uncovered && day.uncovered, 'Australia and Guyana both in view').toBe(true);
  return { night: await patch(page, night.x, night.y, 8), day: await patch(page, day.x, day.y, 8) };
}

/*
 * Night is carried by dots, and by a darker ground under them. Darkening alone cannot carry it: the land
 * is #141920, and WCAG's contrast, with its 0.05 for flare, puts even pure black against it at 1.19:1,
 * so four steps of a fifth each left full night the colour of the daytime ocean (1.10:1), invisible on a
 * cheap screen in sunlight. So the spec asks for the texture in both signatures, and for the ground's
 * own luminance to fall by at least a third, which is what a darker step can honestly be held to.
 */
for (const signature of ['document', 'low'] as const) {
  test(`in ${signature} signature, dots the night side and darkens it, leaves the day side as it was, and unticked, leaves the map as it was`, async ({ page }) => {
    await landed(page);
    if (signature === 'low') {
      await page.locator('[data-signature-toggle]').click();
      await expect(page.locator('html')).toHaveAttribute('data-signature', 'low');
    }
    const screen = await layers(page, /^None/);
    await page.locator('[data-back]').click();
    await frame(page);
    const off = await nightAndDay(page);
    expect(off.night.dots, 'dots before day and night is drawn').toBe(0);
    await page.getByRole('button', { name: 'Map layers' }).click();
    await screen.locator('[data-daylight]').check();
    await expect(page.locator('[data-legend]')).toContainText('Day and night at 14:05 UTC');
    await page.locator('[data-back]').click();
    await frame(page);
    const on = await nightAndDay(page);
    // Dots, on a 6 px grid twice over at night: in a 16 px box, a dozen or more, wherever it falls.
    expect(on.night.dots, `${signature}: night over Australia is not dotted`).toBeGreaterThan(10);
    // Out to the Earth's own edge, which Equal Earth bulges: the night once stopped a third of the way in.
    const edge = await screenAt(page, 172, 50);
    expect(edge.uncovered).toBe(true);
    expect((await patch(page, edge.x, edge.y, 6)).dots, `${signature}: night stops short of the Earth’s edge`).toBeGreaterThan(4);
    expect(on.night.share, `${signature}: night is a texture, not a fill`).toBeLessThan(0.25);
    expect(on.day.dots, `${signature}: dots on the day side`).toBe(0);
    // The ground under the dots: its luminance down by at least a third, in either signature.
    expect(on.night.ground / off.night.ground, `${signature}: the night side is not darker`).toBeLessThan(0.67);
    expect(on.day.ground, `${signature}: the day side changed`).toBe(off.day.ground);
    // And the key says what the dots are, drawn as the canvas draws them.
    await expect(page.locator('[data-swatches] [data-swatch="dots"]')).toContainText('Night · twilight has half the dots');
    await page.getByRole('button', { name: 'Map layers' }).click();
    await screen.locator('[data-daylight]').uncheck();
    await expect(page.locator('[data-legend]')).toHaveCount(0);
    await expect(page.locator('[data-swatches]')).toHaveCount(0);
    await page.locator('[data-back]').click();
    await frame(page);
    expect((await nightAndDay(page)).night, 'unticked, the night stayed').toEqual(off.night);
  });
}

test('twilight is dotted half as densely as night, so the two steps read apart without a tone', async ({ page }) => {
  await landed(page);
  const screen = await layers(page, /^None/);
  await screen.locator('[data-daylight]').check();
  await expect(page.locator('[data-legend]')).toContainText('Day and night');
  await page.locator('[data-back]').click();
  await frame(page);
  // From the sun's own position: a point in the middle of twilight, the sun 3.4° down, and one in night, 30° down.
  const sun = subsolar(Date.parse('2026-10-19T14:05:00Z'));
  const along = (below: number) => {
    // Due east of the point under the sun, on its parallel, where the sun is `below` degrees down.
    const lat = sun.lat;
    const p = (lat * Math.PI) / 180;
    const cosH = (Math.sin((-below * Math.PI) / 180) - Math.sin(p) ** 2) / Math.cos(p) ** 2;
    return [sun.lon + (Math.acos(cosH) * 180) / Math.PI, lat] as const;
  };
  // Twilight is a band 5° wide, a few pixels at the whole-Earth view: zoomed in until it is wider than the patch.
  await zoomAt(page, ...along(3.4), 10);
  const twilight = await screenAt(page, ...along(3.4));
  const t = await patch(page, twilight.x, twilight.y, 9);
  // The dots are kept in screen space, so night's count at this zoom is the same as at any other.
  const night = await bring(page, ...along(30));
  expect(night.uncovered).toBe(true);
  const n = await patch(page, night.x, night.y, 9);
  expect(t.dots, 'twilight not dotted').toBeGreaterThan(4);
  expect(n.dots / t.dots, `night ${n.dots} against twilight ${t.dots}`).toBeGreaterThan(1.6);
  expect(n.dots / t.dots).toBeLessThan(2.5);
});

test('draws the line where the sun is rising and setting, where the sun’s own position puts it', async ({ page }) => {
  await landed(page);
  const screen = await layers(page, /^None/);
  // Points of the line in view, from the same code the map runs, away from the Earth's edge.
  const line = terminator(subsolar(Date.parse('2026-10-19T14:05:00Z')));
  const points: [number, number][] = [];
  for (let i = 0; i < line.length; i += 2) if (Math.abs(line[i + 1]!) < 50 && Math.abs(line[i]!) < 160) points.push([line[i]!, line[i + 1]!]);
  const muted = async () => {
    let n = 0;
    for (const [lon, lat] of points) {
      const p = await screenAt(page, lon, lat);
      if (p.uncovered && (await toneNear(page, p.x, p.y, 2, '--t-muted')) > 0) n += 1;
    }
    return n;
  };
  expect(points.length).toBeGreaterThan(20);
  expect(await muted(), 'muted ink along the line before it is drawn').toBe(0);
  await screen.locator('[data-daylight]').check();
  await expect(page.locator('[data-legend]')).toContainText('Day and night');
  await frame(page);
  // Every point of it in view, not merely one: a line in the wrong place would cross one or two.
  const inView = (await Promise.all(points.map(([lon, lat]) => screenAt(page, lon, lat)))).filter((p) => p.uncovered).length;
  expect(inView).toBeGreaterThan(20);
  expect(await muted(), 'the line is not where the sun’s position puts it').toBe(inView);
});

test('is always drawn with Time zones, and says so in the key and on its box', async ({ page }) => {
  await landed(page);
  const screen = await layers(page, /^Time zones/);
  await expect(page.locator('[data-legend="timezones"]')).toHaveText(
    'Time zones · standard time as drawn in 2012, no daylight saving · Natural Earth Day and night at 14:05 UTC · worked out on this phone, nothing fetched'
  );
  // One line each, so neither is read as the other's.
  expect(await page.locator('[data-legend="timezones"]').evaluate((e) => e.textContent?.split('\n').length)).toBe(2);
  await expect(screen.locator('[data-daylight]')).toBeChecked();
  await expect(screen.locator('[data-daylight]')).toBeDisabled();
});

test('redraws once a minute, on the minute, and not at all while the page is hidden or while it is not drawn', async ({ page }) => {
  await page.clock.install({ time: AT });
  await seedDevice(page, { __noStorage: true });
  await open(page, '/');
  await mapReady(page);
  await expect(page.locator('[data-missions]')).toContainText('live');
  // Every draw fills the canvas's ground once: counted on the map's own context.
  await page.evaluate(() => {
    const ctx = document.querySelector<HTMLCanvasElement>('.grid canvas')!.getContext('2d')!;
    const fill = ctx.fillRect.bind(ctx);
    (window as unknown as { draws: number }).draws = 0;
    ctx.fillRect = (...a: Parameters<CanvasRenderingContext2D['fillRect']>) => {
      (window as unknown as { draws: number }).draws += 1;
      fill(...a);
    };
  });
  const draws = () => page.evaluate(() => (window as unknown as { draws: number }).draws);
  const reset = () => page.evaluate(() => void ((window as unknown as { draws: number }).draws = 0));

  // Before it is drawn: three minutes of the page's own clock ticking draws nothing.
  await page.clock.pauseAt(new Date('2026-10-19T14:05:40Z'));
  await reset();
  await page.clock.runFor(180_000);
  expect(await draws(), 'the map redrew with nothing new to show').toBe(0);

  // Chosen without waiting on a frame: the clock is paused, and frames wait on it.
  await page.getByRole('button', { name: 'Map layers' }).click();
  const screen = page.locator('[data-screen="layers"]');
  await screen.getByRole('radio', { name: /^None/ }).check();
  await screen.locator('[data-daylight]').check();
  await page.clock.runFor(1_000);
  await expect(page.locator('[data-legend]')).toContainText('Day and night at 14:08 UTC');
  await page.locator('[data-back]').click();
  await page.clock.runFor(1_000);
  await reset();
  await page.clock.runFor(180_000);
  const ticked = await draws();
  expect(ticked, 'more than one redraw a minute').toBeLessThanOrEqual(3);
  expect(ticked, 'the night did not move with the clock').toBeGreaterThanOrEqual(2);
  await expect(page.locator('[data-legend]')).toContainText('Day and night at 14:11 UTC');

  // Hidden: nothing, however long.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await reset();
  await page.clock.runFor(180_000);
  expect(await draws(), 'redrew while nobody could see it').toBe(0);
  // Back in view, one redraw for the minutes it missed, and the key says the minute it is now.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(100);
  expect(await draws()).toBe(1);
  await expect(page.locator('[data-legend]')).toContainText('Day and night at 14:14 UTC');
});

test('Low signature redraws the map at once, in its own colours, without anybody moving it', async ({ page }) => {
  await landed(page);
  // The South Atlantic: open ocean, which is the canvas's own ground.
  const sea = await screenAt(page, -30, -45);
  expect(sea.uncovered).toBe(true);
  expect(await pixelAt(page, sea.x, sea.y)).toEqual([0x0b, 0x0e, 0x12]);
  await page.locator('[data-signature-toggle]').click();
  await expect(page.locator('html')).toHaveAttribute('data-signature', 'low');
  await frame(page);
  expect(await pixelAt(page, sea.x, sea.y), 'the map kept its document colours').toEqual([0, 0, 0]);
});
