import { readFileSync } from 'node:fs';
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

/** Wraps whatever WebSocket the harness installed, so a test can see where the page connects. */
async function recordSockets(page: Page) {
  await page.addInitScript(() => {
    const g = globalThis as unknown as { WebSocket: new (u: string) => unknown; __sockets: string[] };
    const Inner = g.WebSocket;
    g.__sockets = [];
    g.WebSocket = class extends (Inner as unknown as { new (u: string): object }) {
      constructor(u: string) {
        super(u);
        g.__sockets.push(String(u));
      }
    } as unknown as typeof g.WebSocket;
  });
}

async function ready(page: Page) {
  await blankDevice(page);
  await recordSockets(page);
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

  test('it talks to nobody but navcom.app and the relay that holds the missions', async ({ page }) => {
    // The property map.md is built around, as refined when missions moved onto the device: no
    // tile server, no font host, no analytics — and one socket, to The Record, because every
    // device reads the missions itself rather than being handed a picture.
    const requested: string[] = [];
    page.on('request', (r) => requested.push(r.url()));
    await ready(page);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    // The subscription loads after first paint, so its socket is polled for, not read once.
    const sockets = () => page.evaluate(() => (globalThis as unknown as { __sockets?: string[] }).__sockets ?? []);
    await expect.poll(async () => (await sockets()).length, { timeout: 10_000 }).toBeGreaterThan(0);
    const home = new URL(page.url()).origin;
    expect(requested.length).toBeGreaterThan(1);
    expect(requested.filter((u) => new URL(u).origin !== home)).toEqual([]);
    expect(await sockets()).toEqual(expect.arrayContaining(['wss://record.cosmiccodex.app']));
    expect((await sockets()).filter((u) => u !== 'wss://record.cosmiccodex.app')).toEqual([]);
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

  test.describe('missions, read live from The Record', () => {
    /** Real packages signed by Mecha Jono; [0] is the California heat-relief campaign. */
    const REAL = JSON.parse(readFileSync(new URL('../../packages/core/test/fixtures/mission-packages.json', import.meta.url), 'utf8'));
    const HEAT = REAL[0];
    const HEAT_ENDS = Number(HEAT.tags.find((t: string[]) => t[0] === 'valid_until')[1]);
    /** The fixtures are real and expire; the clock is fixed so this suite does not, on 10 October. */
    const DURING = new Date('2026-10-06T20:00:00Z');

    /** Mean brightness of the whole canvas: a lit province makes it rise, and nothing else differs. */
    const brightness = (page: Page) =>
      page.locator('.grid canvas').evaluate((c: HTMLCanvasElement) => {
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += d[i]! + d[i + 1]! + d[i + 2]!;
        return sum / (d.length / 4);
      });
    /** A socket that never connects, installed last so it wins: a phone with no signal. */
    const noSignal = (page: Page) =>
      page.addInitScript(() => {
        class Dead extends EventTarget {
          readyState = 0;
          constructor(readonly url: string) {
            super();
          }
          send(): void {}
          close(): void {}
        }
        (globalThis as unknown as { WebSocket: unknown }).WebSocket = Dead;
      });
    async function load(page: Page) {
      await page.goto('/grid/', { waitUntil: 'networkidle' });
      await expect(page.locator('[data-grid="ready"]')).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Show the whole map' }).click();
    }

    test('an open mission lights its province, and says it is live', async ({ page }) => {
      await page.clock.setFixedTime(DURING);
      await blankDevice(page);
      await load(page);
      await expect(page.locator('[data-missions="none"]')).toContainText('live');
      const dark = await brightness(page);

      await seedDevice(page, { relayEvents: [HEAT], __noStorage: true } as Parameters<typeof seedDevice>[1]);
      await load(page);
      await expect(page.locator('[data-missions="open"]')).toContainText('Open missions · live');
      // Polled: the legend updates in the tick the event lands, the canvas on the next frame.
      await expect.poll(() => brightness(page), { timeout: 5_000 }).toBeGreaterThan(dark);
    });

    test('a mission that has ended lights nothing, by this device’s clock', async ({ page }) => {
      await page.clock.setFixedTime(new Date((HEAT_ENDS + 60) * 1000));
      await seedDevice(page, { relayEvents: [HEAT], __noStorage: true } as Parameters<typeof seedDevice>[1]);
      await load(page);
      await expect(page.locator('[data-missions="none"]')).toBeVisible();
    });

    test('with no signal and nothing remembered, it says The Record cannot be reached', async ({ page }) => {
      await blankDevice(page);
      await noSignal(page);
      await load(page);
      await expect(page.locator('[data-missions="connecting"]')).toBeVisible();
      await expect(page.locator('[data-missions="unavailable"]')).toBeVisible({ timeout: 15_000 });
    });

    test('offline, it shows what this device last saw, with its age', async ({ page }) => {
      await page.clock.setFixedTime(DURING);
      await seedDevice(page, { relayEvents: [HEAT], __noStorage: true } as Parameters<typeof seedDevice>[1]);
      await load(page);
      await expect(page.locator('[data-missions="open"][data-feed="live"]')).toBeVisible();

      await noSignal(page);
      await load(page);
      await expect(page.locator('[data-missions="open"][data-feed="cached"]')).toContainText(/as of \d{1,2} [A-Z][a-z]{2} \d{2}:\d{2} UTC, offline/);
    });

    test('a copy on the device that was tampered with fails verification on the way back in', async ({ page }) => {
      await page.clock.setFixedTime(DURING);
      const tampered = { ...HEAT, content: HEAT.content.replace('Bakersfield', 'Fresno') };
      await page.addInitScript((events) => {
        localStorage.setItem('navcom.wipeable', JSON.stringify({ missions: { at: '2026-10-06T19:00:00.000Z', events } }));
      }, [tampered]);
      await noSignal(page);
      await load(page);
      await expect(page.locator('[data-missions="none"][data-feed="cached"]')).toBeVisible();
    });
  });

  test('no axe violations', async ({ page }) => {
    await ready(page);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});
