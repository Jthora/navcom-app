import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { open, seedDevice } from './device';
import { frame, mapReady, screenAt, tapAt, toneNear, zoomAt } from './map';
import { serveSpheres } from './spheres';

/**
 * The Spheres on the map [docs/design/map.md, Spheres; the owner's map decision D9], against the build
 * that deploys, on the phone.
 *
 * **The build ships Mecha Jono's Part 2 lists** (vendored 26 Oct): the one test that asks without a
 * route reads what the build carries, and one more says what a build without lists shows. Every other
 * test serves NavCom's own fixture lists by route [./spheres.ts]: three overlapping Spheres, with four
 * small states (Malta, Singapore, Barbados, Mauritius) that the world's outlines do not draw.
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
const hatched = (page: Page, x: number, y: number, half: number) =>
  page.locator('.grid canvas').evaluate(
    (c: HTMLCanvasElement, [x, y, half]) => {
      const r = c.getBoundingClientRect();
      const k = c.width / r.width;
      const d = c.getContext('2d')!.getImageData(Math.round((x! - half! - r.left) * k), Math.round((y! - half! - r.top) * k), Math.round(2 * half! * k), Math.round(2 * half! * k)).data;
      let n = 0;
      // Brighter than any line the map draws (its strongest is 308 on the three channels): the hatch is ink.
      for (let i = 0; i < d.length; i += 4) if (d[i]! + d[i + 1]! + d[i + 2]! > 400) n++;
      return n;
    },
    [x, y, half] as [number, number, number]
  );

const SHIPPED = (() => {
  try {
    return JSON.parse(readFileSync('build/grid/spheres.json', 'utf8')) as { navcom: { draft: boolean; credit: string } };
  } catch {
    return null;
  }
})();

test('the lists this build ships, from navcom.app, with their stage and credit', async ({ page }) => {
  test.skip(!SHIPPED, 'this build carries no Spheres');
  await landed(page);
  await chooseSpheres(page);
  await expect(page.locator('[data-legend="spheres"]')).toHaveText(
    new RegExp(`^Spheres · open one to hatch it · ${SHIPPED!.navcom.draft ? 'draft lists' : 'lists'}, read `)
  );
  await expect(page.locator('[data-credit]')).toHaveText(`Spheres: ${SHIPPED!.navcom.credit}, CC BY 4.0`);
});

test('a build with no lists says so rather than drawing anything', async ({ page }) => {
  await page.route('**/grid/spheres.json', (route) => route.fulfill({ status: 404, body: '' }));
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
  await expect(page.locator('[data-legend="spheres"]')).toHaveText('Spheres · open one to hatch it · draft lists, read 3 Aug–19 Oct');
  // Whose, as their licence asks, on the map itself, over its foot [GridMap credit].
  await expect(page.locator('[data-credit]')).toHaveText('Spheres: NavCom test fixture, never shipped, CC BY 4.0');
  await expect(screen.locator('[data-slot="spheres"]')).toContainText('Draft lists');
  await expect(screen.locator('[data-slot="credit"]')).toContainText('NavCom test fixture, never shipped');
  await screen.getByRole('radio', { name: /^Nation States/ }).check();
  await screen.getByRole('radio', { name: /^Spheres/ }).check();
  await frame(page);
  expect(asked).toEqual(['/grid/spheres.json']);
  const home = new URL(page.url()).origin;
  expect(all.filter((u) => new URL(u).origin !== home), 'asked somebody other than navcom.app').toEqual([]);
});

test('a small state the world’s outlines leave out is a small diamond at its label point, and a tap on it names its Spheres', async ({ page }) => {
  await serveSpheres(page);
  await landed(page);
  await chooseSpheres(page);
  await expect(page.locator('[data-legend="spheres"]')).toContainText('draft lists');
  await page.locator('[data-back]').click();
  await frame(page);
  // Malta, at Natural Earth's label point: a small filled muted diamond where no outline is drawn (D9).
  // Never a circle, which is a mission's, nor a square, which is the directory's, and no bigger than a
  // few pixels: a 5 px circle covered Sicily to Tunisia.
  const malta = await screenAt(page, 14.43, 35.89);
  expect(await toneNear(page, malta.x, malta.y, 0.75, '--t-muted'), 'no mark for Malta').toBeGreaterThan(0);
  expect(await toneNear(page, malta.x + 2, malta.y, 0.5, '--t-muted'), 'Malta’s diamond is not out to its corner').toBeGreaterThan(0);
  expect(await toneNear(page, malta.x + 2.6, malta.y + 2.6, 0.5, '--t-muted'), 'Malta’s mark is round or square, not a diamond').toBe(0);
  expect(await toneNear(page, malta.x + 5, malta.y, 1, '--t-muted'), 'Malta’s mark is wider than a few pixels').toBe(0);
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

test('a member a list counts and does not draw is listed apart, and never hatched', async ({ page }) => {
  // Test Francophonie draws France, Canada and Mauritius, and lists Ireland as an observer: as the real
  // Francophonie lists 33 observers and associates, Japan and Argentina among them.
  await serveSpheres(page);
  await landed(page);
  const screen = await chooseSpheres(page);
  await expect(page.locator('[data-legend="spheres"]')).toContainText('draft lists');
  await zoomAt(page, -4, 52, 4);
  await page.mouse.move(1, 1);
  await frame(page);
  await screen.locator('[data-sphere-open="sphere:test-francophonie"]').click();
  const sphere = page.locator('[data-screen="sphere"][data-sphere="sphere:test-francophonie"]');
  await expect(sphere.locator('[data-sphere-member]')).toHaveText(['France', 'Canada', 'Mauritius']);
  await expect(sphere.locator('[data-sphere-member-listed]')).toHaveText(['Ireland']);
  await expect(sphere.locator('[data-slot="note"]')).toContainText('Ireland, an observer here, is listed and not drawn');
  await frame(page);
  const ireland = await screenAt(page, -8, 53.2);
  const france = await screenAt(page, 2.5, 46.5);
  expect(await hatched(page, france.x, france.y, 6), 'France, which it draws, is not hatched').toBeGreaterThan(20);
  expect(await hatched(page, ireland.x, ireland.y, 6), 'Ireland, which it only lists, is hatched').toBe(0);
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
    // Ireland is in Test Francophonie only as an observer, listed and not drawn: not named over it.
    const ireland = await screenAt(page, -8, 53.2);
    await page.mouse.move(ireland.x, ireland.y);
    await expect(page.locator('[data-chip]')).toHaveText('Ireland · Test Atlantic community, Test Anglosphere');
    const kenya = await screenAt(page, 37.9, 0.5);
    await page.mouse.move(kenya.x, kenya.y);
    // In no Sphere: it answers as Nation States would, so a tap there is never dead.
    await expect(page.locator('[data-chip]')).toHaveText('Kenya · Nothing open');
  });
});
