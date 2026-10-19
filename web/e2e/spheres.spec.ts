import { expect, test, type Page } from '@playwright/test';
import { open, seedDevice } from './device';
import { frame, mapReady, screenAt, tapAt, toneNear, zoomAt } from './map';
import { serveSpheres } from './spheres';

/**
 * The Spheres on the map [docs/design/map.md, Spheres; the owner's map decision D9], against the build
 * that deploys, on the phone.
 *
 * **No real lists exist until Mecha Jono's Part 2 is vendored (due 26 Oct)**, and nothing synthetic
 * ships, so this build has none: the one test that asks without a route sees the map say so. Every
 * other test serves NavCom's own fixture lists by route [./spheres.ts]: three overlapping Spheres, with
 * four small states (Malta, Singapore, Barbados, Mauritius) that the world's outlines do not draw.
 */

test.use({ serviceWorkers: 'block' });

async function landed(page: Page) {
  await seedDevice(page, { __noStorage: true });
  await open(page, '/');
  await mapReady(page);
}

async function chooseSpheres(page: Page) {
  await page.getByRole('button', { name: 'Map layers' }).click();
  const screen = page.locator('[data-screen="layers"]');
  await screen.getByRole('radio', { name: /^Spheres/ }).check();
  await expect(page.locator('[data-legend="spheres"]')).toBeVisible();
  return screen;
}

/**
 * How many pixels in a box are as bright as a hatch line drawn over land: ink at half strength. The
 * land, the ocean and every border are far darker, so where the hatch is not, there are none.
 */
/** Of `n` points round a circle, the share on which something muted is drawn: a solid ring is all of them. */
async function ringLit(page: Page, x: number, y: number, r: number, n: number): Promise<number> {
  let lit = 0;
  for (let i = 0; i < n; i++) {
    const a = (i * 2 * Math.PI) / n;
    if ((await toneNear(page, x + r * Math.cos(a), y + r * Math.sin(a), 0.5, '--t-muted')) > 0) lit++;
  }
  return lit / n;
}

const hatched = (page: Page, x: number, y: number, half: number) =>
  page.locator('.grid canvas').evaluate(
    (c: HTMLCanvasElement, [x, y, half]) => {
      const r = c.getBoundingClientRect();
      const k = c.width / r.width;
      const d = c.getContext('2d')!.getImageData(Math.round((x! - half! - r.left) * k), Math.round((y! - half! - r.top) * k), Math.round(2 * half! * k), Math.round(2 * half! * k)).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i]! + d[i + 1]! + d[i + 2]! > 300) n++;
      return n;
    },
    [x, y, half] as [number, number, number]
  );

test('in this build there are none yet, and the map says so rather than drawing anything', async ({ page }) => {
  await landed(page);
  const screen = await chooseSpheres(page);
  await expect(page.locator('[data-legend="spheres"]')).toHaveText('Spheres · not in this build yet');
  await expect(screen).toContainText(/not in this build/i);
});

test('choosing Spheres fetches the lists once, from navcom.app only, labelled a draft, with their credit', async ({ page }) => {
  const all: string[] = [];
  page.on('request', (r) => void (/^https?:/.test(r.url()) && all.push(r.url())));
  const asked = await serveSpheres(page);
  await landed(page);
  expect(asked, 'fetched before it was chosen').toEqual([]);
  const screen = await chooseSpheres(page);
  // What is hatched first, then the lists' age by the oldest read as well as the newest, and whose.
  await expect(page.locator('[data-legend="spheres"]')).toHaveText(
    'Spheres · open one to hatch it · draft lists, read 3 Aug–19 Oct · NavCom test fixture, never shipped, CC BY 4.0'
  );
  await expect(screen.locator('[data-slot="spheres"]')).toContainText('Draft lists');
  await expect(screen.locator('[data-slot="credit"]')).toContainText('NavCom test fixture, never shipped');
  await screen.getByRole('radio', { name: /^Nation States/ }).check();
  await screen.getByRole('radio', { name: /^Spheres/ }).check();
  await frame(page);
  expect(asked).toEqual(['/grid/spheres.json']);
  const home = new URL(page.url()).origin;
  expect(all.filter((u) => new URL(u).origin !== home), 'asked somebody other than navcom.app').toEqual([]);
});

test('a small state the world’s outlines leave out is a circle at its label point, and a tap on it names its Spheres', async ({ page }) => {
  await serveSpheres(page);
  await landed(page);
  await chooseSpheres(page);
  await expect(page.locator('[data-legend="spheres"]')).toContainText('draft lists');
  await page.locator('[data-back]').click();
  await frame(page);
  // Malta, at Natural Earth's label point: a muted circle where no outline is drawn (D9), dotted, so it
  // is never read as a region of Places, whose rings are solid.
  const malta = await screenAt(page, 14.43, 35.89);
  expect(await toneNear(page, malta.x + 5, malta.y, 1.5, '--t-muted'), 'no circle for Malta').toBeGreaterThan(0);
  const round = await ringLit(page, malta.x, malta.y, 5, 48);
  expect(round, 'Malta’s circle is solid, as a region’s ring is').toBeLessThan(0.75);
  expect(round, 'Malta’s circle is not there').toBeGreaterThan(0.15);
  await tapAt(page, 14.43, 35.89, 'Malta');
  const there = page.locator('[data-screen="sphere"][data-code="mt"]');
  await expect(there).toBeVisible();
  await expect(there.locator('[data-sphere-open]')).toHaveText(['Test Anglosphere']);
  await expect(there).toContainText('Draft');
});

test('opening a Sphere picks it out, hatched; every Sphere alike leaves none picked out', async ({ page }) => {
  await serveSpheres(page);
  await landed(page);
  const screen = await chooseSpheres(page);
  await expect(page.locator('[data-legend="spheres"]')).toContainText('draft lists');
  await zoomAt(page, -1.5, 52.5, 4);
  // Off the map, so nothing is lifted by a hover: a lift is ink, and as bright as a hatch.
  await page.mouse.move(1, 1);
  await frame(page);
  const london = await screenAt(page, -1.5, 52.5);
  expect(await hatched(page, london.x, london.y, 6), 'bright lines over Great Britain before any Sphere is picked out').toBe(0);
  await screen.locator('[data-sphere-open="sphere:test-anglosphere"]').click();
  const sphere = page.locator('[data-screen="sphere"][data-sphere="sphere:test-anglosphere"]');
  await expect(sphere.locator('[data-sphere-member]')).toHaveCount(8);
  await expect(sphere.locator('[data-slot="sources"] a')).toHaveAttribute('rel', 'noreferrer');
  await expect(sphere.locator('[data-slot="lists"]')).toContainText('Draft');
  await frame(page);
  // A hatch 6 px apart: in a 12 px box, two lines or more, each a few pixels of every row.
  expect(await hatched(page, london.x, london.y, 6), 'no hatch over Great Britain').toBeGreaterThan(20);
  // Back, and every Sphere alike: the hatch goes.
  await page.locator('[data-back]').click();
  await page.locator('[data-sphere-all]').click();
  await frame(page);
  expect(await hatched(page, london.x, london.y, 6), 'still hatched with every Sphere alike').toBe(0);
});

test('the key names the Sphere hatched after Back, and leaving Spheres lets it go', async ({ page }) => {
  await serveSpheres(page);
  await landed(page);
  const screen = await chooseSpheres(page);
  await expect(page.locator('[data-legend="spheres"]')).toContainText('open one to hatch it');
  await screen.locator('[data-sphere-open="sphere:test-anglosphere"]').click();
  await expect(page.locator('[data-screen="sphere"]')).toBeVisible();
  // Back to the layers, and Back to the map: the hatch is still drawn, and the key says whose it is.
  await page.locator('[data-back]').click();
  await page.locator('[data-back]').click();
  await expect(page.locator('[data-screen="layers"]')).toHaveCount(0);
  await expect(page.locator('[data-legend="spheres"]')).toContainText('Spheres · Test Anglosphere hatched ·');
  // Another layer, and back: nothing is still hatched from before, and the key says to open one.
  await page.getByRole('button', { name: 'Map layers' }).click();
  await screen.getByRole('radio', { name: /^Nation States/ }).check();
  await screen.getByRole('radio', { name: /^Spheres/ }).check();
  await expect(page.locator('[data-legend="spheres"]')).toContainText('Spheres · open one to hatch it ·');
  await expect(screen.locator('[data-sphere-all]')).toHaveAttribute('aria-pressed', 'true');
});

test('a source whose link is not https is its name, never a link, whatever the file says', async ({ page }) => {
  // A file the vendoring would refuse [core spheres isHttps]: the screen holds the line too.
  await serveSpheres(page, (f) => {
    f.spheres[0].sources = [
      { name: 'A script', url: 'javascript:alert(document.domain)' },
      { name: 'A data page', url: 'data:text/html,<script>alert(1)</script>' },
      { name: 'Plain http', url: 'http://example.org/' },
      { name: 'A real one', url: 'https://example.org/list' }
    ];
  });
  await landed(page);
  const screen = await chooseSpheres(page);
  await screen.locator('[data-sphere-open="sphere:test-anglosphere"]').click();
  const sources = page.locator('[data-screen="sphere"] [data-slot="sources"]');
  await expect(sources).toContainText('A script');
  await expect(sources).toContainText('A data page');
  await expect(sources.locator('a')).toHaveCount(1);
  await expect(sources.locator('a')).toHaveAttribute('href', 'https://example.org/list');
  await expect(sources.locator('a[href^="javascript:"], a[href^="data:"], a[href^="http:"]')).toHaveCount(0);
});

test.describe('the Spheres on a desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

  test('a hover over Canada names every Sphere it is in, the most specific first', async ({ page }) => {
    await serveSpheres(page);
    await landed(page);
    await chooseSpheres(page);
    await expect(page.locator('[data-legend="spheres"]')).toContainText('draft lists');
    const canada = await screenAt(page, -100, 58);
    await page.mouse.move(canada.x, canada.y);
    await expect(page.locator('[data-chip]')).toHaveText('Canada · Test Francophonie, Test Atlantic community, Test Anglosphere');
    const kenya = await screenAt(page, 37.9, 0.5);
    await page.mouse.move(kenya.x, kenya.y);
    // In no Sphere: it answers as Nation States would, so a tap there is never dead.
    await expect(page.locator('[data-chip]')).toHaveText('Kenya · Nothing open');
  });
});
