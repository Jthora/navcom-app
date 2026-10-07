import { existsSync, readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { blankDevice, open, seedDevice } from './device';

/**
 * The landing page's map, on the phone this project is built for [build-order 11.2, 11.3].
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

/** True when a tap at the element's centre would land on it, rather than on something over it. */
async function uncovered(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit === el || el.contains(hit);
  });
}

/** The URL pattern of the chunk a module was split into, read from the build under test. */
function chunkOf(module: string): string {
  const manifest = JSON.parse(
    readFileSync(new URL('../.svelte-kit/output/client/.vite/manifest.json', import.meta.url), 'utf8')
  ) as Record<string, { file: string }>;
  const file = manifest[module]?.file;
  if (!file) throw new Error(`${module} is not in the Vite manifest`);
  // A manifest from another build names a chunk this server does not have, and a route on it
  // would block nothing — the test would pass for the wrong reason. Fail here instead.
  if (!existsSync(new URL(`../build/${file}`, import.meta.url))) throw new Error(`${file} is not in web/build`);
  return `**/${file}`;
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
  await open(page, '/');
  await expect(page.locator('[data-grid="ready"]')).toBeVisible({ timeout: 15_000 });
  // One frame after ready, so the first draw has happened.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
}

test.describe('the landing map draws, and tells nobody', () => {
  test('it draws land, not an empty box', async ({ page }) => {
    await ready(page);
    // Ground, land, two kinds of border and region dots: far more than one colour.
    expect((await picture(page)).colours).toBeGreaterThan(3);
  });

  test('it talks to nobody but navcom.app and the relays that hold the missions', async ({ page }) => {
    // The property map.md is built around, as refined when missions moved onto the device: no
    // tile server, no font host, no analytics — and sockets only to The Record and its mirror,
    // because every device reads the missions itself rather than being handed a picture. Listed
    // here by name on purpose: a new host on this page should fail this test until somebody
    // decides it belongs [docs/design/grid.md].
    const RELAYS = ['wss://record.cosmiccodex.app', 'wss://blackpi.cosmiccodex.app'];
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
    await expect.poll(async () => new Set(await sockets()).size, { timeout: 10_000 }).toBe(RELAYS.length);
    expect(await sockets()).toEqual(expect.arrayContaining(RELAYS));
    expect((await sockets()).filter((u) => !RELAYS.includes(u))).toEqual([]);
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
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-grid="ready"]')).toBeVisible({ timeout: 15_000 });
    // Coverage is off on the landing map [map.md §6], so the dots this counts are switched on
    // first. Switching them on does not move the view: framing follows the regions either way.
    await page.getByRole('button', { name: 'Coverage' }).click();
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

  test('when the geometry cannot load, it says so where it can be seen', async ({ page }) => {
    // Offline is a normal state here [C10]; the failure path is the one worth testing.
    await page.route('**/grid/world.json', (r) => r.abort());
    await blankDevice(page);
    await open(page, '/');
    const failed = page.locator('[data-grid-failed]');
    await expect(failed).toBeVisible({ timeout: 15_000 });
    await expect(failed).toContainText(/needs one visit with a connection/);
    // Visible to Playwright is not seen by a person. This line sat at the foot of the map, under
    // the phone's sheet, and passed the check above the whole time.
    expect(await uncovered(failed)).toBe(true);
  });

  test('when the map’s own code cannot arrive, it says so instead of a blank map', async ({ page }) => {
    // It comes by dynamic import, so a first visit can get the page and lose the map [com.md §6].
    await page.route(chunkOf('src/lib/components/grid/GridMap.svelte'), (r) => r.abort());
    await blankDevice(page);
    await open(page, '/');
    const failed = page.locator('[data-grid-failed]');
    await expect(failed).toBeVisible({ timeout: 15_000 });
    await expect(failed).toContainText(/needs one visit with a connection/);
    expect(await uncovered(failed)).toBe(true);
  });

  test('a device set to low signature gets the map in low signature, not at full brightness', async ({ page }) => {
    // The console's rule, and the reason it applies the preference before anything else. Read
    // from the canvas itself: the top-left of the world view is Arctic ocean, drawn in --t-ground,
    // which low signature makes black. A rule the logic honoured and the pixels did not would
    // pass every other test here.
    const corner = (p: Page) =>
      p.locator('.grid canvas').evaluate((c: HTMLCanvasElement) => [...c.getContext('2d')!.getImageData(2, 2, 1, 1).data.slice(0, 3)]);

    await seedDevice(page, { accruing: { signature: 'low' } });
    await open(page, '/');
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
      await page.goto('/', { waitUntil: 'networkidle' });
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

    test('with The Record down, its mirror alone lights the province', async ({ page }) => {
      // Both relays at once, and either answering alone draws the map [docs/design/grid.md].
      await page.clock.setFixedTime(DURING);
      await blankDevice(page);
      await load(page);
      const dark = await brightness(page);

      // Installed last, so it wins: The Record refuses the connection, the mirror holds the mission.
      await page.addInitScript((heat) => {
        class Split extends EventTarget {
          readyState = 0;
          constructor(readonly url: string) {
            super();
            setTimeout(() => {
              if (url.includes('record.cosmiccodex.app')) return void this.dispatchEvent(new Event('error'));
              this.readyState = 1;
              this.dispatchEvent(new Event('open'));
            }, 0);
          }
          send(data: string): void {
            const [type, sub] = JSON.parse(data) as [string, string];
            if (type !== 'REQ') return;
            const say = (f: unknown[]) =>
              this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(f) }));
            setTimeout(() => {
              say(['EVENT', sub, heat]);
              say(['EOSE', sub]);
            }, 0);
          }
          close(): void {}
        }
        (globalThis as unknown as { WebSocket: unknown }).WebSocket = Split;
      }, HEAT);
      await load(page);
      await expect(page.locator('[data-missions="open"]')).toContainText('Open missions · live');
      await expect.poll(() => brightness(page), { timeout: 5_000 }).toBeGreaterThan(dark);
    });

    test('a mission that has ended lights nothing, by this device’s clock', async ({ page }) => {
      await page.clock.setFixedTime(new Date((HEAT_ENDS + 60) * 1000));
      await seedDevice(page, { relayEvents: [HEAT], __noStorage: true } as Parameters<typeof seedDevice>[1]);
      await load(page);
      await expect(page.locator('[data-missions="none"]')).toBeVisible();
    });

    test('with no signal and nothing remembered, it says no relay can be reached', async ({ page }) => {
      await blankDevice(page);
      await noSignal(page);
      await load(page);
      await expect(page.locator('[data-missions="connecting"]')).toBeVisible();
      await expect(page.locator('[data-missions="unavailable"]')).toBeVisible({ timeout: 15_000 });
    });

    test('when its own code cannot arrive, it says so rather than reaching forever', async ({ page }) => {
      // "Reaching The Record…" with nothing behind it is a pending state that never resolves.
      await page.route(chunkOf('src/lib/missions/live.ts'), (r) => r.abort());
      await blankDevice(page);
      await load(page);
      await expect(page.locator('[data-missions="unloaded"]')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-missions="connecting"]')).toHaveCount(0);
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

test.describe('the landing page: Com over the map', () => {
  const detentOf = (page: Page) => page.locator('[data-com]').getAttribute('data-detent');
  /** One tap on the handle moves one step: peek → half → full → peek. */
  async function setDetent(page: Page, want: 'peek' | 'half' | 'full') {
    for (let i = 0; i < 3 && (await detentOf(page)) !== want; i++) {
      await page.locator('.grab').click();
    }
    await expect(page.locator('[data-com]')).toHaveAttribute('data-detent', want);
  }

  test('somebody who needs a place sees the search at once, and no Distress they cannot use', async ({ page }) => {
    // Search first [com.md §2]: the landing page is also where somebody looks for a bed
    // tonight, and a form in front of the search would make them meet a sign-up first.
    await blankDevice(page);
    await open(page, '/');
    await expect(page.locator('[data-com]')).toHaveAttribute('data-detent', 'peek');
    // All of it, not a sliver: an earlier layout passed a looser check with only the field's top
    // edge on screen, because the page was sized taller than the phone it was on.
    const search = page.getByLabel(/where are you, or what do you need/i);
    await expect(search).toBeInViewport({ ratio: 1 });
    // And nothing floats over it.
    const clear = await search.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + 12, r.top + r.height / 2);
      return hit === el || el.contains(hit);
    });
    expect(clear).toBe(true);
    await expect(page.locator('.distress-layer')).toBeHidden();
    // And joining is right there beneath it, for the person who came to help.
    await expect(page.getByRole('link', { name: /open the field terminal/i })).toHaveCount(1);
  });

  test('typing lifts the sheet so the results can be seen', async ({ page }) => {
    await blankDevice(page);
    await open(page, '/');
    await page.getByLabel(/where are you, or what do you need/i).focus();
    await expect(page.locator('[data-com]')).toHaveAttribute('data-detent', 'half');
  });

  test('the handle steps the sheet through its three heights, by touch and by key', async ({ page }) => {
    await blankDevice(page);
    await open(page, '/');
    await setDetent(page, 'half');
    await setDetent(page, 'full');
    await expect(page.locator('.grab')).toHaveAttribute('aria-label', 'Show less');
    await page.locator('.grab').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-com]')).toHaveAttribute('data-detent', 'peek');
  });

  test('an operator can reach Distress at every height of the sheet, and nothing covers it', async ({ page }) => {
    // The test panicWipe never had [verification.md]: not that the control renders, but that a
    // person can reach it whatever state the interface is in [com.md §4, invariant 2].
    await seedDevice(page, { callsign: 'kestrel' } as Parameters<typeof seedDevice>[1]);
    await open(page, '/');
    const distress = page.locator('.distress-layer a');
    for (const detent of ['peek', 'half', 'full'] as const) {
      await setDetent(page, detent);
      await expect(distress, detent).toBeVisible();
      await expect(distress, detent).toBeInViewport();
      const box = await distress.boundingBox();
      expect(box!.height, detent).toBeGreaterThanOrEqual(48);
      const onTop = await distress.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return hit === el || el.contains(hit);
      });
      expect(onTop, `something covers Distress at ${detent}`).toBe(true);
    }
  });

  test('coverage is one switch away, and off until somebody asks', async ({ page }) => {
    const mutedPixels = () =>
      page.locator('.grid canvas').evaluate((c: HTMLCanvasElement) => {
        const hex = getComputedStyle(c).getPropertyValue('--t-muted').trim().replace('#', '') || '9BA5B2';
        const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (Math.abs(d[i]! - r!) < 6 && Math.abs(d[i + 1]! - g!) < 6 && Math.abs(d[i + 2]! - b!) < 6) n++;
        }
        return n;
      });
    await blankDevice(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-grid="ready"]')).toBeVisible({ timeout: 15_000 });
    const coverage = page.getByRole('button', { name: 'Coverage' });
    await expect(coverage).toHaveAttribute('aria-pressed', 'false');
    const off = await mutedPixels();
    await coverage.click();
    await expect(coverage).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(mutedPixels, { timeout: 5_000 }).toBeGreaterThan(off + 1000);
  });
});


test.describe('the landing page: missions you can open', () => {
  /** Real packages signed by Mecha Jono; [0] is the California heat-relief campaign. */
  const [HEAT] = JSON.parse(readFileSync(new URL('../../packages/core/test/fixtures/mission-packages.json', import.meta.url), 'utf8'));
  const DURING = new Date('2026-10-06T20:00:00Z');
  const HEAT_D = 'starcom_mission_package_field-heat_relief-CA-2026-10-02';

  async function withHeat(page: Page, seed: Record<string, unknown> = {}) {
    await page.clock.setFixedTime(DURING);
    await seedDevice(page, { relayEvents: [HEAT], __noStorage: true, ...seed } as Parameters<typeof seedDevice>[1]);
    await open(page, '/');
    await expect(page.locator('[data-missions="open"]')).toContainText('Open missions · live', { timeout: 15_000 });
  }

  test('the missions line opens the list, and a mission opens with its limits above every ask', async ({ page }) => {
    await withHeat(page);
    await page.locator('[data-missions="open"]').click();
    const list = page.locator('[data-screen="missions"]');
    await expect(list).toBeVisible();
    // Half, never full: the map stays in view behind a mission [com.md §7].
    await expect(page.locator('[data-com]')).toHaveAttribute('data-detent', 'half');
    const row = list.locator(`[data-mission="${HEAT_D}"]`);
    await expect(row).toContainText('posted by an agent');

    await row.click();
    const mission = page.locator(`[data-screen="mission"][data-mission="${HEAT_D}"]`);
    await expect(mission).toBeVisible();
    await expect(page.locator('[data-com]')).toHaveAttribute('data-detent', 'half');
    // Invariant 4, said on the mission itself.
    await expect(mission.locator('[data-slot="posted-by"]')).toContainText('Mecha Jono');
    await expect(mission.locator('[data-slot="posted-by"]')).toContainText('an agent, not a person');
    // The limits, verbatim, above the ask, on every objective [spec §4.3].
    const objectives = mission.locator('[data-objective]');
    await expect(objectives).toHaveCount(4);
    const order = await objectives.evaluateAll((els) =>
      els.map((el) => {
        const limits = el.querySelector('[data-limits]');
        const ask = el.querySelector('[data-ask]');
        return !!limits && !!ask && !!(limits.compareDocumentPosition(ask) & Node.DOCUMENT_POSITION_FOLLOWING);
      })
    );
    expect(order).toEqual([true, true, true, true]);
    // A count of people the package carried is left out, and the page says so.
    await expect(mission.locator('[data-omitted]')).toContainText('counted people');
  });

  test('tapping a lit province opens its missions; Back and Escape step out again', async ({ page }) => {
    await withHeat(page);
    const canvas = page.locator('.grid canvas');
    await expect(page.locator('[data-grid="ready"]')).toBeVisible();
    // Where central California is on screen, from the view the map is drawing right now.
    const spot = await canvas.evaluate((c: HTMLCanvasElement) => {
      const [cx, cy, scale] = (c.dataset.view ?? '').split(' ').map(Number) as [number, number, number];
      const r = c.getBoundingClientRect();
      const lat = 36.8 * (Math.PI / 180);
      const ux = (-119.4 + 180) / 360;
      const uy = (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2;
      const x = r.left + (ux - cx) * scale + r.width / 2;
      const y = r.top + (uy - cy) * scale + r.height / 2;
      // Only a tap the map itself would receive: nothing may be over it there.
      return document.elementFromPoint(x, y) === c ? { x, y } : null;
    });
    expect(spot, 'California should be on screen and uncovered').not.toBeNull();
    await page.mouse.click(spot!.x, spot!.y);
    const list = page.locator('[data-screen="missions"][data-province="us-ca"]');
    await expect(list).toBeVisible();
    await expect(list.locator('[data-post]')).toHaveText('California');

    await page.locator('[data-back]').click();
    await expect(page.getByLabel(/where are you, or what do you need/i)).toBeVisible();

    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await expect(page.locator('[data-screen="mission"]')).toBeVisible();
    // Focus moved to the screen that opened, so Escape belongs to Com.
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-screen="missions"]')).toBeVisible();
  });

  test('an operator can still reach Distress, uncovered, with a mission open', async ({ page }) => {
    // Storage this time: an operator is somebody with a key on this device.
    await withHeat(page, { __noStorage: false, callsign: 'kestrel' });
    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await expect(page.locator('[data-screen="mission"]')).toBeVisible();
    const distress = page.locator('.distress-layer a');
    await expect(distress).toBeVisible();
    expect(await uncovered(distress)).toBe(true);
  });

  test('when the screens’ own code cannot arrive, the sheet says so instead of a blank', async ({ page }) => {
    await page.route(chunkOf('src/lib/components/missions/index.ts'), (r) => r.abort());
    await withHeat(page);
    await page.locator('[data-missions="open"]').click();
    await expect(page.locator('[data-screen-failed]')).toContainText('needs one visit with a connection');
  });

  test('no axe violations with a mission open', async ({ page }) => {
    await withHeat(page);
    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await expect(page.locator('[data-screen="mission"]')).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  test('signed out, taking part asks for sign-on first, and the mission waits for them', async ({ page }) => {
    await withHeat(page);
    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    const signon = page.locator('[data-signon]');
    await expect(signon).toContainText('Sign on to take part');
    await signon.click();
    await page.waitForURL('**/terminal/**');
    // The mission they chose is remembered for when they come back signed on.
    const pending = await page.evaluate(() => sessionStorage.getItem('navcom.pending-mission'));
    expect(pending).toContain(HEAT_D);
  });

  test('an operator chooses who sees it, with nothing preselected, takes part, and lets it go', async ({ page }) => {
    await withHeat(page, { __noStorage: false, callsign: 'kestrel' });
    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await page.getByRole('button', { name: 'Take part' }).click();
    const open = page.locator('[data-visibility="open"]');
    const sealed = page.locator('[data-visibility="sealed"]');
    await expect(open).toBeVisible();
    await expect(sealed).toContainText('Only Mecha Jono');
    // Two equal options and no default: neither is pressed, checked or focused for them.
    for (const b of [open, sealed]) {
      expect(await b.getAttribute('aria-pressed')).toBeNull();
      expect(await b.evaluate((el) => el === document.activeElement)).toBe(false);
    }

    await open.click();
    const you = page.locator('[data-slot="you"]');
    await expect(you).toContainText('Taking part');
    await expect(you).toContainText('everyone can see');
    // What left the phone: one label — sent to each of the operator's relays, so counted by id —
    // in navcom.mission, naming the package and nothing else.
    const labels = await page.evaluate(() => {
      const sent = (globalThis as unknown as { __navcomPublished?: { id: string; kind: number; tags: string[][] }[] })
        .__navcomPublished ?? [];
      return [...new Map(sent.filter((e) => e.kind === 1985).map((e) => [e.id, e])).values()];
    });
    expect(labels).toHaveLength(1);
    expect(labels[0]!.tags.map((t) => t[0]).sort()).toEqual(['L', 'a', 'expiration', 'l']);

    await page.locator('[data-letgo]').click();
    await expect(page.getByRole('button', { name: 'Take part' })).toBeVisible();
  });

  test('a private claim with no inbox to send it to says nothing was sent', async ({ page }) => {
    await withHeat(page, { __noStorage: false, callsign: 'kestrel' });
    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await page.getByRole('button', { name: 'Take part' }).click();
    await page.locator('[data-visibility="sealed"]').click();
    await expect(page.locator('[data-takepart]')).toContainText('Not sent');
    await expect(page.locator('[data-takepart]')).toContainText('inbox could not be found');
    await expect(page.locator('[data-slot="you"]')).toHaveCount(0);
  });

  test('an operator reports the work the day after, and sees it wait to settle', async ({ page }) => {
    await withHeat(page, { __noStorage: false, callsign: 'kestrel' });
    // Signed on, Com's root starts with your own situation [com.md §2].
    await expect(page.locator('[data-yours]')).toBeVisible();
    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await page.getByRole('button', { name: 'Take part' }).click();
    await page.locator('[data-visibility="open"]').click();
    await expect(page.locator('[data-slot="you"]')).toContainText('Taking part');

    // Back to the root, and into your own missions.
    await page.locator('[data-back]').click();
    await page.locator('[data-back]').click();
    await page.locator('[data-yours]').click();
    await expect(page.locator('[data-screen="yours"]')).toContainText('Heat relief');
    await page.locator(`[data-report-mission="${HEAT_D}"]`).click();

    const report = page.locator('[data-screen="report"]');
    await expect(report).toBeVisible();
    // Today is not a day a report can tell of.
    const today = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    const offered = await report.locator('[data-day] option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(offered).not.toContain(today);
    // Nothing is ticked for them, and nothing sends until they say what they did.
    await expect(report.locator('input[type="checkbox"]:checked')).toHaveCount(0);
    await expect(report.getByRole('button', { name: 'Send report' })).toBeDisabled();

    await report.locator('[data-day]').selectOption({ index: 1 });
    await report.locator('[data-ask]').first().check();
    await report.getByRole('button', { name: 'Send report' }).click();
    await report.locator('[data-visibility="open"]').click();

    // Back on your missions: sent, and waiting for its seven days.
    const listed = page.locator('[data-screen="yours"] [data-sent]');
    await expect(listed).toHaveCount(1);
    await expect(listed).toContainText('Waiting');
    // What left: one report, naming the mission and what was done, and no words.
    const reports = await page.evaluate(() => {
      const sent = (globalThis as unknown as { __navcomPublished?: { id: string; kind: number; tags: string[][]; content: string }[] })
        .__navcomPublished ?? [];
      return [...new Map(sent.filter((e) => e.kind === 1912).map((e) => [e.id, e])).values()];
    });
    expect(reports).toHaveLength(1);
    expect(reports[0]!.tags.map((t) => t[0])).toEqual(['a', 'ask']);
    expect(Object.keys(JSON.parse(reports[0]!.content)).sort()).toEqual(['callsign', 'date']);

    // Withdrawn honestly: the screen says relays were asked, not that it is gone.
    await listed.locator('[data-withdraw]').click();
    await expect(listed).toContainText('Withdrawn');
    await expect(listed).toContainText('copies already taken stay');
  });

  /** Another operator's open report on the heat mission, the day before, signed in Node where keys belong. */
  const ADDRESS = `30079:${HEAT.pubkey}:${HEAT_D}`;
  const wrens = () =>
    finalizeEvent(
      {
        kind: 1912,
        created_at: Math.floor(DURING.getTime() / 1000) - 3_600,
        content: JSON.stringify({ callsign: 'Wren', date: '2026-10-05' }),
        tags: [['a', ADDRESS], ['ask', 'field:heat_relief:CA:2026-10-02#handout:water']]
      },
      generateSecretKey()
    );
  const labelsSent = (page: Page) =>
    page.evaluate(() => {
      const sent = (globalThis as unknown as { __navcomPublished?: { id: string; kind: number; tags: string[][]; content: string }[] })
        .__navcomPublished ?? [];
      return [...new Map(sent.filter((e) => e.kind === 1985 && e.tags.some((t) => t[0] === 'e')).map((e) => [e.id, e])).values()];
    });

  test('somebody who took part can say they were there, under their own card, and it settles the report', async ({ page }) => {
    const theirs = wrens();
    await withHeat(page, { __noStorage: false, callsign: 'kestrel', relayEvents: [HEAT, theirs] });
    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await page.getByRole('button', { name: 'Take part' }).click();
    await page.locator('[data-visibility="open"]').click();
    await expect(page.locator('[data-slot="you"]')).toContainText('Taking part');

    await page.locator('[data-reports]').click();
    const item = page.locator(`[data-screen="reports"] [data-report="${theirs.id}"]`);
    await expect(item).toContainText('Wren');
    await expect(item).toContainText('Waiting');
    await item.locator('[data-witness]').click();
    await expect(item).toContainText('It settles this report now');
    await item.locator('[data-confirm="witnessed"]').click();
    await expect(item).toContainText('by a witness, kestrel');

    // What left: one label, naming the report and the mission, and no words.
    const sent = await labelsSent(page);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.tags).toEqual([['L', 'navcom.mission'], ['l', 'witnessed', 'navcom.mission'], ['e', theirs.id], ['a', ADDRESS]]);
    expect(sent[0]!.content).toBe('');
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  test('without having taken part, only a challenge is offered, by name, and it reverses nothing', async ({ page }) => {
    const theirs = wrens();
    await withHeat(page, { __noStorage: false, callsign: 'kestrel', relayEvents: [HEAT, theirs] });
    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await page.locator('[data-reports]').click();
    const item = page.locator(`[data-screen="reports"] [data-report="${theirs.id}"]`);
    await expect(item).toContainText('Wren');
    await expect(item.locator('[data-witness]')).toHaveCount(0);
    await item.locator('[data-challenge]').click();
    await expect(item).toContainText('reverses nothing');
    await item.locator('[data-confirm="challenged"]').click();
    await expect(item).toContainText('challenged by kestrel');
    await expect(item).toContainText('Waiting');
    expect((await labelsSent(page)).map((l) => l.tags[1])).toEqual([['l', 'challenged', 'navcom.mission']]);
  });

  test('signed out, reports can be read and nothing can be said about them', async ({ page }) => {
    const theirs = wrens();
    await withHeat(page, { relayEvents: [HEAT, theirs] });
    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await page.locator('[data-reports]').click();
    const item = page.locator(`[data-screen="reports"] [data-report="${theirs.id}"]`);
    await expect(item).toContainText('Wren');
    await expect(item.locator('button')).toHaveCount(0);
  });

  test('an operator’s Distress bar is legible, and a landmark, in both signatures', async ({ page }) => {
    /*
     * Every axe check on this page ran signed out, where there is no Distress bar — so its label
     * shipped at 3.68:1 in low signature, the mode every operator gets by default, and 4.26:1 in
     * the other. Found the first time a test opened the page signed on.
     */
    await withHeat(page, { __noStorage: false, callsign: 'kestrel' });
    await expect(page.locator('#distress-early')).toBeVisible();
    for (const mode of ['low', 'document']) {
      await expect(page.locator('html')).toHaveAttribute('data-signature', mode);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.map((v) => v.id), mode).toEqual([]);
      await page.locator('[data-signature-toggle]').click();
    }
  });

  test('signed out, Com’s root is the search, with no missions of your own above it', async ({ page }) => {
    await withHeat(page);
    await expect(page.locator('[data-yours]')).toHaveCount(0);
  });
});
