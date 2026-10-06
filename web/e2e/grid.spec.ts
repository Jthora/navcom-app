import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { blankDevice, open, seedDevice } from './device';

/**
 * The grid, on the phone this project is built for [build-order 11.2].
 *
 * The unit tests prove the geometry decodes. They cannot prove a canvas draws anything — Path2D
 * exists only in a browser — and "a mechanism nobody can reach is not built" [verification.md].
 * So this drives the real page on a Pixel 5, against the build that deploys.
 */

/** A cheap fingerprint of what the canvas currently shows. */
async function picture(page: Page): Promise<{ colours: number; hash: number }> {
  return page.locator('.grid canvas').evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    const seen = new Set<number>();
    let hash = 0;
    for (let i = 0; i < data.length; i += 4 * 37) {
      const rgb = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
      seen.add(rgb);
      hash = (hash * 31 + rgb) | 0;
    }
    return { colours: seen.size, hash };
  });
}

async function ready(page: Page) {
  await blankDevice(page);
  await open(page, '/grid/');
  await expect(page.locator('[data-grid="ready"]')).toBeVisible({ timeout: 15_000 });
  // One frame after ready, so the first draw has happened.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
}

test.describe('the grid draws, and tells nobody', () => {
  test('it draws land, not an empty box', async ({ page }) => {
    await ready(page);
    // Ground, land, two kinds of border and region dots: far more than one colour.
    expect((await picture(page)).colours).toBeGreaterThan(3);
  });

  test('looking at it makes no request to anybody else', async ({ page }) => {
    // The property map.md is built around: the common case, looking at the map, tells nobody
    // anything. Asserted in a real browser rather than trusted.
    // Collected first and judged after load: during navigation `page.url()` is still
    // about:blank, which made the page's own request look foreign.
    const requested: string[] = [];
    page.on('request', (r) => requested.push(r.url()));
    await ready(page);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    const home = new URL(page.url()).origin;
    expect(requested.length).toBeGreaterThan(1);
    expect(requested.filter((u) => new URL(u).origin !== home)).toEqual([]);
  });

  test('it moves when asked, by button and by key', async ({ page }) => {
    await ready(page);
    const before = await picture(page);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    const zoomed = await picture(page);
    expect(zoomed.hash).not.toBe(before.hash);

    await page.locator('.grid canvas').focus();
    await page.keyboard.press('ArrowLeft');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    expect((await picture(page)).hash).not.toBe(zoomed.hash);
  });

  test('it opens on the regions, not on Greenwich', async ({ page }) => {
    // Found on the first live run: the world view put most of the US off the left edge of a
    // phone and left the bottom third empty. The opening view frames where most regions are,
    // so it must show more of them than the whole-world view does.
    const dotPixels = () =>
      page.locator('.grid canvas').evaluate((c: HTMLCanvasElement) => {
        const probe = getComputedStyle(c).getPropertyValue('--t-muted').trim();
        const hex = probe.startsWith('#') ? probe.slice(1) : '9BA5B2';
        const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (Math.abs(d[i]! - r!) < 6 && Math.abs(d[i + 1]! - g!) < 6 && Math.abs(d[i + 2]! - b!) < 6) n++;
        }
        return n;
      });
    await blankDevice(page);
    await page.goto('/grid/', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-grid="ready"]')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    const framed = await dotPixels();
    await page.getByRole('button', { name: 'Show the whole map' }).click();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    const world = await dotPixels();
    expect(framed).toBeGreaterThan(0);
    expect(framed).toBeGreaterThan(world);
  });

  test('its controls are thumb-sized, at the terminal’s own floor', async ({ page }) => {
    await ready(page);
    for (const name of ['Zoom in', 'Zoom out', 'Show the whole map']) {
      const box = await page.getByRole('button', { name }).boundingBox();
      expect(box!.width, name).toBeGreaterThanOrEqual(48);
      expect(box!.height, name).toBeGreaterThanOrEqual(48);
    }
  });

  test('when the geometry cannot load, it says so instead of showing an empty box', async ({ page }) => {
    // Offline is a normal state here [C10]; the failure path is the one worth testing.
    await page.route('**/grid/world.json', (r) => r.abort());
    await blankDevice(page);
    await open(page, '/grid/');
    await expect(page.locator('[data-grid-failed]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-grid-failed]')).toContainText(/needs one visit with a connection/);
  });

  test('a device set to low signature gets the map in low signature, not at full brightness', async ({ page }) => {
    // The console's rule, and the reason it applies the preference before anything else. Read
    // from the canvas itself: the top-left of the world view is Arctic ocean, drawn in --t-ground,
    // which low signature makes black. A rule the logic honoured and the pixels did not would
    // pass every other test here.
    const corner = (p: Page) =>
      p.locator('.grid canvas').evaluate((c: HTMLCanvasElement) => [...c.getContext('2d')!.getImageData(2, 2, 1, 1).data.slice(0, 3)]);

    await seedDevice(page, { accruing: { signature: 'low' } });
    await open(page, '/grid/');
    await expect(page.locator('[data-grid="ready"]')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    await expect(page.locator('html')).toHaveAttribute('data-signature', 'low');
    // The opening view frames the regions; the whole map puts Arctic ocean in the corner.
    await page.getByRole('button', { name: 'Show the whole map' }).click();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    expect(await corner(page)).toEqual([0, 0, 0]);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test.describe('missions on the map', () => {
    const snapshot = (missions: object[], status = 'ok') => ({
      version: 1, taken_at: new Date().toISOString(), source: 'test', status, missions, refused: []
    });
    const california = (validUntil: number) => ({
      d: 'test-ca', state: 'open', validUntil, placement: { jurisdiction: 'us-ca', point: null }
    });
    const serve = (page: Page, body: object) =>
      page.route('**/missions.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(body) }));
    /** Mean brightness of the whole canvas: a lit province makes it rise, and nothing else differs. */
    const brightness = (page: Page) =>
      page.locator('.grid canvas').evaluate((c: HTMLCanvasElement) => {
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += d[i]! + d[i + 1]! + d[i + 2]!;
        return sum / (d.length / 4);
      });
    async function settled(page: Page) {
      await blankDevice(page);
      await page.goto('/grid/', { waitUntil: 'networkidle' });
      await expect(page.locator('[data-grid="ready"]')).toBeVisible({ timeout: 15_000 });
      // The whole map, so both runs compare the same view however the regions arrived.
      await page.getByRole('button', { name: 'Show the whole map' }).click();
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    }

    test('an open mission lights its province, and says how old the snapshot is', async ({ page }) => {
      await serve(page, snapshot([]));
      await settled(page);
      const dark = await brightness(page);
      await expect(page.locator('[data-missions="none"]')).toContainText(/No open missions · as of \d{1,2} [A-Z][a-z]{2} \d{2}:\d{2} UTC/);

      await page.unroute('**/missions.json');
      await serve(page, snapshot([california(Math.floor(Date.now() / 1000) + 86_400)]));
      await settled(page);
      await expect(page.locator('[data-missions="open"]')).toContainText(/Open missions · as of/);
      // Polled, not read once: the legend updates in the same tick the snapshot lands, but the
      // canvas redraws on the next animation frame, and a single read can fall between the two.
      await expect.poll(() => brightness(page), { timeout: 5_000 }).toBeGreaterThan(dark);
    });

    test('a mission that has ended since the build lights nothing', async ({ page }) => {
      // Active when the snapshot was taken, over by the time somebody looks. This device's
      // clock decides, not the build's [invariant 7].
      await serve(page, snapshot([california(Math.floor(Date.now() / 1000) - 60)]));
      await settled(page);
      await expect(page.locator('[data-missions="none"]')).toBeVisible();
    });

    test('a build that could not reach The Record says so, rather than showing no missions', async ({ page }) => {
      await serve(page, snapshot([], 'unavailable'));
      await settled(page);
      await expect(page.locator('[data-missions="unavailable"]')).toBeVisible();
    });
  });

  test('no axe violations', async ({ page }) => {
    await ready(page);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});
