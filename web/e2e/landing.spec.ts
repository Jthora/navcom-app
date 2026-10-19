import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { blankDevice, chunkOf, open, seedDevice } from './device';
import { frame, inkNear, mapReady, pixelAt, screenAt, tap, tapAt, toneNear, zoomAt } from './map';
import { METRES_PER_UNIT } from '../src/lib/grid/topology';
import { admit, mission, resign, standInKey, type StandIn } from './registry';
import { serveZones } from './zsp';

/**
 * A person's deliberate tap on a visibility choice comes well after the tap that opened it. The
 * choices ignore a tap in their first 400 ms, which belongs to the gesture that opened them -- a
 * double tap would otherwise publish to everyone [audit 11.S] -- so a test waits as a person does.
 */
const settle = (page: Page) => page.waitForTimeout(450);

/**
 * The heat-relief campaign, as a publisher a test holds the key of would post it.
 *
 * The real package is signed by Mecha Jono's old key, whose secret leaked: from 2026-10-18 it is
 * frozen, cannot be taken until Mecha Jono confirms its list, and ends on 13 November on any build
 * made after it [core: missions/trust.ts]. These tests are about the map and the screens, not that
 * key, so the same words, tags and date are signed again by a stand-in publisher added to the served
 * registry [registry.ts]. What that key's rules do is e2e/key-compromise.spec.ts.
 */
const HEAT_KEY = standInKey();
const HEAT_DESK: StandIn = { id: 'heat-desk', name: 'Heat Desk', agent: true, inbox: ['wss://nos.lol', 'wss://relay.primal.net'], keys: [HEAT_KEY] };
const REAL_PACKAGES = JSON.parse(readFileSync(new URL('../../packages/core/test/fixtures/mission-packages.json', import.meta.url), 'utf8'));
const HEAT_PACKAGE = resign(REAL_PACKAGES[0], HEAT_KEY);
/** Its `d`, which every screen showing it marks. */
const HEAT_MISSION_D = 'starcom_mission_package_field-heat_relief-CA-2026-10-02';

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

/**
 * Somewhere on every inhabited continent, the corners of the map a key or a column of controls would
 * sit over (Anchorage, Tokyo, Wellington), and both ends of the Earth, which Web Mercator cut off at
 * 85° and Equal Earth draws [D1]. The opening view leaves every one of them on screen and uncovered.
 */
const EVERYWHERE = [
  ['Lagos', 3.38, 6.52], ['Nairobi', 36.82, -1.29], ['Delhi', 77.21, 28.61], ['Beijing', 116.4, 39.9],
  ['Tokyo', 139.69, 35.69], ['Sydney', 151.21, -33.87], ['Wellington', 174.78, -41.29], ['São Paulo', -46.63, -23.55],
  ['London', -0.13, 51.51], ['Reykjavík', -21.9, 64.1], ['New York', -74.0, 40.71], ['Anchorage', -149.9, 61.2],
  ['80°N', 0, 80], ['80°S', 0, -80], ['the South Pole', 30, -89.5]
] as const;

/*
 * The opening view on the phones the project claims, where the world is a short band and the key and
 * the map's controls take a real share of the screen. Signed on, the Distress strip takes its height
 * too. Equal Earth made the world half as tall as it is wide, and centred above the sheet it sat under
 * the key: Britain was under it on a 375 × 667 phone, and Tokyo under the controls (2026-10-19). And at
 * half, where every screen the map opens comes up, the layer picker among them, the sheet covered the
 * southern half of it. The world now sits clear of all of them, narrower where it has to be.
 */
for (const viewport of [{ width: 393, height: 727 }, { width: 375, height: 667 }, { width: 320, height: 568 }]) {
  test.describe(`the opening view on a ${viewport.width} × ${viewport.height} phone`, () => {
    test.use({ viewport });

    for (const signedOn of [false, true]) {
      test(`${signedOn ? 'signed on' : 'not signed on'}: the whole Earth, and none of it under the key, the controls or the sheet`, async ({ page }) => {
        await seedDevice(page, signedOn ? { callsign: 'kestrel', relayEvents: [] } : { __noStorage: true });
        await open(page, '/');
        await mapReady(page);
        await frame(page);
        await expect(page.locator('[data-com]')).toHaveAttribute('data-detent', 'peek');
        for (const [name, lon, lat] of EVERYWHERE) {
          expect((await screenAt(page, lon, lat)).uncovered, `${name} is on screen and uncovered`).toBe(true);
        }
        // With the layer picker open, at half: what a choice there draws is in view while it is made.
        await page.getByRole('button', { name: 'Map layers' }).click();
        await expect(page.locator('[data-com]')).toHaveAttribute('data-detent', 'half');
        await frame(page);
        for (const [name, lon, lat] of EVERYWHERE) {
          expect((await screenAt(page, lon, lat)).uncovered, `${name}, with the sheet at half`).toBe(true);
        }
        // And it is still the whole map: the ⌂ button shows exactly this, and zooming out goes no further.
        const canvas = page.locator('.grid canvas');
        const opened = await canvas.getAttribute('data-view');
        await page.getByRole('button', { name: 'Zoom out' }).click();
        await frame(page);
        expect(await canvas.getAttribute('data-view')).toBe(opened);
        await page.getByRole('button', { name: 'Zoom in' }).click();
        await page.getByRole('button', { name: 'Show the whole map' }).click();
        await frame(page);
        expect(await canvas.getAttribute('data-view')).toBe(opened);
      });
    }
  });
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

  test('it opens on the whole Earth, above the sheet, and nothing moves it until a person does', async ({ page }) => {
    /*
     * Rewritten on purpose (2026-10-18). It was "it opens on the regions, not on Greenwich": the
     * opening view framed where most regions are, and 1,889 of the 1,912 are in the US, so it
     * opened on the US. NavCom is an Earth Alliance app, and opens on the Earth [the owner's
     * direction, 2026-10-17; map.md §6]. Signed on, so the Distress strip takes its height too.
     */
    await seedDevice(page, { callsign: 'kestrel', relayEvents: [] });
    const regions = page.waitForResponse((r) => r.url().endsWith('/console-regions.json'));
    await open(page, '/');
    await mapReady(page);
    const canvas = page.locator('.grid canvas');
    const opened = await canvas.getAttribute('data-view');
    await regions;
    await frame(page);
    expect(await canvas.getAttribute('data-view'), 'the regions arriving moved the map').toBe(opened);
    // Every inhabited continent, above the sheet at peek, and none of it under the map's key.
    await expect(page.locator('[data-com]')).toHaveAttribute('data-detent', 'peek');
    for (const [name, lon, lat] of EVERYWHERE) {
      expect((await screenAt(page, lon, lat)).uncovered, `${name} is on screen and uncovered`).toBe(true);
    }
    await page.getByRole('button', { name: 'Show the whole map' }).click();
    await frame(page);
    expect(await canvas.getAttribute('data-view'), 'the opening view is the whole map').toBe(opened);
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
    // With no map, a switch that changes what the map draws does nothing: it is not offered.
    await expect(page.getByRole('button', { name: 'Places' })).toBeDisabled();
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
    // Places are map-only doors, so with no map they are not offered, and the directory is.
    await expect(page.getByRole('button', { name: 'Places' })).toBeDisabled();
    const way = page.locator('.nav-loading a[href="/directory/"]');
    await expect(way).toBeVisible();
    expect(await uncovered(way)).toBe(true);
  });

  test('the map centres above the sheet by the sheet’s own height, given once', async ({ page }) => {
    await ready(page);
    await expect(page.locator('[data-com]')).toHaveAttribute('data-detent', 'peek');
    const [inset, sheet] = await page.evaluate(() =>
      ['.grid .inset', '[data-com]'].map((q) => document.querySelector(q)!.getBoundingClientRect().height)
    );
    expect(Math.abs(inset! - sheet!), `the map keeps ${inset}px clear, and the sheet is ${sheet}px`).toBeLessThanOrEqual(1);
    // One number, so a change to the sheet cannot leave the map centring above where it was.
    const copies = await page.evaluate(() =>
      [...document.styleSheets]
        .flatMap((s) => {
          try {
            return [...s.cssRules].map((r) => r.cssText);
          } catch {
            return [];
          }
        })
        .join('\n')
        .match(/12\.75rem/g)?.length ?? 0
    );
    expect(copies).toBe(1);
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
    // The opening view is the whole map, so the corner is above the Arctic: ground, which low
    // signature makes black. Pressed anyway, so the corner is read at the view the button promises.
    await page.getByRole('button', { name: 'Show the whole map' }).click();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    expect(await corner(page)).toEqual([0, 0, 0]);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test.describe('missions, read live from The Record', () => {
    // The worker would serve the build's own code past the registry splice.
    test.use({ serviceWorkers: 'block' });
    test.beforeEach(async ({ page }) => void (await admit(page, [HEAT_DESK])));
    /** The California heat-relief campaign, signed again by the stand-in [`HEAT_PACKAGE`]. */
    const HEAT = HEAT_PACKAGE;
    const HEAT_ENDS = Number(HEAT.tags.find((t: string[]) => t[0] === 'valid_until')![1]);
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

test.describe('the landing map without its script', () => {
  test.use({ javaScriptEnabled: false });

  test('says where the directory is without the map, and offers no switch that would do nothing', async ({ page }) => {
    await page.goto('/');
    const way = page.locator('.nav-loading a[href="/directory/"]');
    await expect(way).toBeVisible();
    expect(await uncovered(way)).toBe(true);
    await expect(page.getByRole('button', { name: 'Places' })).toBeDisabled();
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

  // Distress at every height, with and without a screen open, is com-distress.spec.ts.

  test('places are one switch away, and off until somebody asks', async ({ page }) => {
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
    const coverage = page.getByRole('button', { name: 'Places' });
    await expect(coverage).toHaveAttribute('aria-pressed', 'false');
    const off = await mutedPixels();
    await coverage.click();
    await expect(coverage).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(mutedPixels, { timeout: 5_000 }).toBeGreaterThan(off + 1000);
  });
});


test.describe('the landing page: missions you can open', () => {
  // The worker would serve the build's own code past the registry splice.
  test.use({ serviceWorkers: 'block' });
  test.beforeEach(async ({ page }) => void (await admit(page, [HEAT_DESK])));
  /** The California heat-relief campaign, signed again by the stand-in [`HEAT_PACKAGE`]. */
  const HEAT = HEAT_PACKAGE;
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
    await expect(mission.locator('[data-slot="posted-by"]')).toContainText('Heat Desk');
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

  test('tapping a lit province opens it, with its missions; Back and Escape step out again', async ({ page }) => {
    await withHeat(page);
    await mapReady(page);
    // Where central California is on screen at the opening view, from the view the map is drawing.
    await tapAt(page, -119.4, 36.8, 'California');
    // A place screen since 2026-10-18 [map.md §6: every shape is a door], listing what is filed there.
    const place = page.locator('[data-screen="place"][data-place="us-ca"]');
    await expect(place).toBeVisible();
    await expect(place.locator('[data-post]').first()).toHaveText('California');
    await expect(place.locator(`[data-mission="${HEAT_D}"]`)).toBeVisible();

    await page.locator('[data-back]').click();
    await expect(page.getByLabel(/where are you, or what do you need/i)).toBeVisible();

    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await expect(page.locator('[data-screen="mission"]')).toBeVisible();
    // Focus moved to the screen that opened, so Escape belongs to Com.
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-screen="missions"]')).toBeVisible();
  });

  test('a screen another version left in history says so, and Back still leaves it', async ({ page }) => {
    // History outlives a build: Back after an update lands on entries the other version wrote.
    await withHeat(page);
    await page.locator('[data-missions="open"]').click();
    await expect(page.locator('[data-screen="missions"]')).toBeVisible();
    await page.evaluate(() =>
      history.replaceState({ ...history.state, 'sveltekit:states': { com: [{ kind: 'profile', handle: 'h1' }] } }, '')
    );
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await expect(page.locator('[data-screen="mission"]')).toBeVisible();
    await page.locator('[data-back]').click();
    const unknown = page.locator('[data-screen-unknown]');
    await expect(unknown).toContainText('Not in this version');
    await expect(unknown).toContainText('another version of NavCom opened this screen');
    await page.locator('[data-back]').click();
    await expect(page.getByLabel(/where are you, or what do you need/i)).toBeVisible();
  });

  test.describe('when the code for Com’s screens cannot arrive', () => {
    // The worker would serve the code from its cache and the routes below would block nothing.
    test.use({ serviceWorkers: 'block' });

    /** Aborts the chunk `module` was split into the first time it is asked for, and lets it through after. */
    async function failOnce(page: Page, module: string) {
      let failed = false;
      // Falls back to the registry splice once it has failed, rather than past it.
      await page.route(chunkOf(module), (r) => (failed ? r.fallback() : ((failed = true), r.abort())));
    }
    /**
     * Opening the screen again changes nothing: the browser keeps a module's failure and answers a
     * second import from it [$lib/com/entries]. The reload on the screen is what fetches it, and with
     * the connection back, the screens open.
     */
    async function reloadIntoMissions(page: Page) {
      await page.locator('[data-back]').click();
      await page.locator('[data-missions="open"]').click();
      await expect(page.locator('[data-screen-failed]'), 'opened again, and asked again').toBeVisible();
      // The new document's load, not a selector: the page being left already matches any of them.
      const reloaded = page.waitForEvent('load');
      await page.locator('[data-reload]').click();
      await reloaded;
      await page.waitForSelector('html[data-hydrated="true"]');
      await expect(page.locator('[data-missions="open"]')).toContainText('Open missions · live', { timeout: 15_000 });
      await page.locator('[data-missions="open"]').click();
      await expect(page.locator('[data-screen="missions"]')).toBeVisible();
    }

    /*
     * KNOWN GAP on WebKit, every browser on iOS (2026-10-17) [com.md §6]. Its failure outlives the
     * page: after the reload, and after a fresh navigation, an import of the chunk fails with no
     * request made, against an aborted request, a 503 and a real 404 from the server alike. Only the
     * same URL with a query loads. Playwright fails these the day WebKit fetches it: then delete it.
     */
    test.fail(({ browserName }) => browserName === 'webkit', 'KNOWN GAP: WebKit keeps a failed module past a reload');

    test('the mission screens’ code: the sheet says so instead of a blank, and its reload brings them', async ({ page }) => {
      await failOnce(page, 'src/lib/components/missions/index.ts');
      await withHeat(page);
      await page.locator('[data-missions="open"]').click();
      await expect(page.locator('[data-screen-failed]')).toContainText('Not loaded — it needs one visit with a connection');
      await reloadIntoMissions(page);
    });

    test('Com’s own code: the map and its key still work, a screen says it is not loaded, and its reload brings it', async ({ page }) => {
      await failOnce(page, 'src/lib/components/com/index.ts');
      await withHeat(page);
      await expect(page.locator('[data-grid="ready"]')).toBeVisible();
      await page.locator('[data-missions="open"]').click();
      await expect(page.locator('[data-screen-failed]')).toContainText('Not loaded — it needs one visit with a connection');
      await page.locator('[data-back]').click();
      await expect(page.getByLabel(/where are you, or what do you need/i)).toBeVisible();
      await page.locator('[data-missions="open"]').click();
      await reloadIntoMissions(page);
    });
  });

  test('no axe violations with a mission open', async ({ page }) => {
    await withHeat(page);
    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await expect(page.locator('[data-screen="mission"]')).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  test('signed out, taking part asks for a callsign first, and a control takes them back to the mission', async ({ page }) => {
    await withHeat(page);
    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    const signon = page.locator('[data-signon]');
    // By the word the terminal uses for it: "Sign on" there starts a patrol [finding 51].
    await expect(signon).toContainText('Choose a callsign to take part');
    await signon.click();
    await page.waitForURL('**/terminal/setup/');
    await page.locator('#callsign').fill('kestrel');
    await page.getByRole('button', { name: /generate keypair/i }).click();
    await expect(page.locator('#rename')).toBeVisible();
    // Controls only, never the browser's Back: an installed app on iOS has none [findings 35, 47].
    const back = page.locator('[data-back-to-mission]');
    await expect(back).toContainText('Back to Heat relief');
    await back.click();
    await page.waitForURL((u) => u.pathname === '/');
    await expect(page.locator(`[data-screen="mission"][data-mission="${HEAT_D}"]`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Take part' })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('navcom.pending-mission'))).toBeNull();
  });

  test('Status takes somebody who left a mission back to it, and always leads to the map', async ({ page }) => {
    await withHeat(page);
    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await page.locator('[data-signon]').click();
    await page.waitForURL('**/terminal/setup/');
    await page.locator('#callsign').fill('kestrel');
    await page.getByRole('button', { name: /generate keypair/i }).click();
    await expect(page.locator('#rename')).toBeVisible();
    await page.getByRole('link', { name: /status/i }).first().click();
    await page.waitForURL((u) => u.pathname === '/terminal/');
    // The one lit action is the way back, ahead of Sign on, which would start a patrol.
    await expect(page.locator('[data-back-to-mission]')).toContainText('Back to Heat relief');
    await expect(page.getByRole('link', { name: 'Sign on', exact: true })).toHaveCount(0);
    await expect(page.locator('[data-map-link]')).toHaveAttribute('href', '/');
    await page.locator('[data-back-to-mission] a').click();
    await expect(page.locator(`[data-screen="mission"][data-mission="${HEAT_D}"]`)).toBeVisible({ timeout: 15_000 });
  });

  test('with no relay reachable and nothing remembered, a mission reads unknown, never gone [invariant 7]', async ({ page }) => {
    // It read "Gone · No longer open · it ended or was closed": a claim nobody could check.
    await seedDevice(page, { callsign: 'kestrel' } as Parameters<typeof seedDevice>[1]);
    await page.addInitScript((address) => sessionStorage.setItem('navcom.pending-mission', address), `30079:${HEAT.pubkey}:${HEAT_D}`);
    await open(page, '/');
    await expect(page.locator('[data-missions="unavailable"]')).toBeVisible({ timeout: 20_000 });
    const screen = page.locator('[data-com]');
    await expect(screen.locator('[data-slot="open"]')).toContainText('Unknown');
    await expect(screen).not.toContainText(/no longer open|ended or was closed/i);
  });

  test('an operator chooses who sees it, with nothing preselected, takes part, and lets it go', async ({ page }) => {
    await withHeat(page, { __noStorage: false, callsign: 'kestrel' });
    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await page.getByRole('button', { name: 'Take part' }).click();
    const open = page.locator('[data-visibility="open"]');
    const sealed = page.locator('[data-visibility="sealed"]');
    await expect(open).toBeVisible();
    // Sealed to a key whose secret did not leak: the poster alone. A leaked one is e2e/key-compromise.spec.ts.
    await expect(sealed).toContainText('Only Heat Desk');
    await expect(sealed).toBeEnabled();
    // Two equal options and no default: neither is pressed, checked or focused for them.
    for (const b of [open, sealed]) {
      expect(await b.getAttribute('aria-pressed')).toBeNull();
      expect(await b.evaluate((el) => el === document.activeElement)).toBe(false);
    }

    await settle(page);
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
    // Letting go recalls nothing anybody already has, and is public too: said, where it was done [audit 11.S].
    await expect(page.locator('[data-takepart]')).toContainText('anyone who saw the claim keeps it, and letting go is public too');
  });

  test('a tap on Take part opens the choice and publishes nothing, and the sealed choice is reachable by touch [audit 11.S]', async ({ page }) => {
    // The act fired on the press, so the choices appeared under the finger and the same tap's
    // click landed on "Everyone": an open claim nobody chose, and no way to reach the sealed one.
    await withHeat(page, { __noStorage: false, callsign: 'kestrel' });
    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await page.getByRole('button', { name: 'Take part' }).tap();
    await expect(page.locator('[data-visibility="sealed"]')).toBeVisible();
    const claims = () =>
      page.evaluate(
        () => ((globalThis as unknown as { __navcomPublished?: { kind: number }[] }).__navcomPublished ?? []).filter((e) => e.kind === 1985).length
      );
    expect(await claims(), 'the tap that opened the choice published a claim').toBe(0);
    // A second tap straight after is the same gesture, not a choice.
    await page.locator('[data-visibility="open"]').tap();
    expect(await claims(), 'a double tap chose Everyone').toBe(0);
    await settle(page);
    await page.locator('[data-visibility="sealed"]').tap();
    await expect(page.locator('[data-slot="you"]')).toContainText('only Heat Desk can see');
  });

  test('Take part answers a keyboard, which never sends a press [audit 11.I]', async ({ page }) => {
    await withHeat(page, { __noStorage: false, callsign: 'kestrel' });
    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await page.getByRole('button', { name: 'Take part' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-visibility="open"]')).toBeVisible();
  });

  /*
   * Mecha Jono's old secret was exposed on 2026-09-28. A private claim went to the inbox in its
   * newest kind-10050 list by date, which whoever holds the secret could sign for next year, and the
   * question went out over the connection carrying the card a moment before the seal (Q16). Since
   * 2026-10-17 the inbox is pinned in the release [interchange spec §5.0].
   */
  test('a private claim goes to the inbox NavCom pins for its poster, and asks no relay where that is', async ({ page }) => {
    await withHeat(page, { __noStorage: false, callsign: 'kestrel' });
    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await page.getByRole('button', { name: 'Take part' }).click();
    await settle(page);
    // Every frame each socket sends from here on, with the relay it went to.
    await page.evaluate(() => {
      const w = globalThis as unknown as { __frames: { url: string; message: unknown[] }[]; WebSocket: { prototype: { send(raw: string): void } } };
      w.__frames = [];
      const send = w.WebSocket.prototype.send;
      w.WebSocket.prototype.send = function (this: { url: string }, raw: string) {
        try {
          w.__frames.push({ url: this.url, message: JSON.parse(raw) as unknown[] });
        } catch {
          /* not JSON: not a relay frame */
        }
        return send.call(this, raw);
      };
    });
    await page.locator('[data-visibility="sealed"]').click();
    const you = page.locator('[data-slot="you"]');
    await expect(you).toContainText('only Heat Desk can see');
    const frames = await page.evaluate(() => (globalThis as unknown as { __frames: { url: string; message: unknown[] }[] }).__frames);
    const asked = frames.filter((f) => f.message[0] === 'REQ').flatMap((f) => f.message.slice(2) as { kinds?: number[] }[]);
    expect(asked.filter((filter) => filter.kinds?.includes(10050)), 'a kind-10050 list was asked for').toEqual([]);
    const wraps = frames.filter((f) => f.message[0] === 'EVENT' && (f.message[1] as { kind: number }).kind === 1059);
    expect([...new Set(wraps.map((f) => new URL(f.url).host))].sort()).toEqual(['nos.lol', 'relay.primal.net']);
  });

  test('an operator reports the work the day after, and sees it wait to settle', async ({ page }) => {
    await withHeat(page, { __noStorage: false, callsign: 'kestrel' });
    // Signed on, Com's root starts with your own situation [com.md §2].
    await expect(page.locator('[data-yours]')).toBeVisible();
    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await page.getByRole('button', { name: 'Take part' }).click();
    await settle(page);
    await page.locator('[data-visibility="open"]').click();
    await expect(page.locator('[data-slot="you"]')).toContainText('Taking part');

    // The same evening it waits: a report tells of a day that has ended.
    await page.locator('[data-back]').click();
    await expect(page.locator('[data-screen="missions"]')).toBeVisible();
    await page.locator('[data-back]').click();
    await page.locator('[data-yours]').click();
    await expect(page.locator(`[data-report-mission="${HEAT_D}"]`)).toContainText('reports open tomorrow');

    // The next day, back on the same phone, into your own missions.
    await page.clock.setFixedTime(new Date(DURING.getTime() + 86_400_000));
    await open(page, '/');
    await expect(page.locator('[data-missions="open"]')).toContainText('Open missions · live', { timeout: 15_000 });
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
    await settle(page);
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

    // Withdrawn honestly: the screen says relays were asked, not that it is gone — and that the
    // asking is itself public, under the same card [audit 11.S].
    const withdraw = listed.locator('[data-withdraw]');
    await expect(withdraw).toContainText('a request anyone can see');
    expect((await withdraw.boundingBox())!.height, 'Withdraw is under the thumb floor').toBeGreaterThanOrEqual(48);
    await withdraw.click();
    await expect(listed).toContainText('Withdrawn');
    await expect(listed).toContainText('copies already taken stay');
    await expect(listed).toContainText('the request is public');
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
      const sent = (globalThis as unknown as { __navcomPublished?: { id: string; pubkey: string; kind: number; tags: string[][]; content: string }[] })
        .__navcomPublished ?? [];
      return [...new Map(sent.filter((e) => e.kind === 1985 && e.tags.some((t) => t[0] === 'e')).map((e) => [e.id, e])).values()];
    });

  test('somebody who took part can say they were there, under their own card, and it settles the report', async ({ page }) => {
    const theirs = wrens();
    await withHeat(page, { __noStorage: false, callsign: 'kestrel', relayEvents: [HEAT, theirs] });
    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await page.getByRole('button', { name: 'Take part' }).click();
    await settle(page);
    await page.locator('[data-visibility="open"]').click();
    await expect(page.locator('[data-slot="you"]')).toContainText('Taking part');

    await page.locator('[data-reports]').click();
    const item = page.locator(`[data-screen="reports"] [data-report="${theirs.id}"]`);
    await expect(item).toContainText('Wren');
    await expect(item).toContainText('Waiting');
    await item.locator('[data-witness]').click();
    await expect(item).toContainText('It settles this report now');
    // What others will read it under, said before it is signed. Kestrel has published no card, so
    // readers see a key, not her callsign — and her own screen says the same [audit 11.S].
    await expect(item.locator('[data-signed-as]')).toContainText('no card of yours is published');
    expect((await item.locator('[data-confirm="witnessed"]').boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await item.locator('[data-confirm="witnessed"]').click();
    await expect(item).toContainText('Settled');

    // What left: one label, naming the report and the mission, and no words.
    const sent = await labelsSent(page);
    expect(sent).toHaveLength(1);
    await expect(item).toContainText(`by a witness, ${sent[0]!.pubkey.slice(0, 8)}`);
    await expect(item).not.toContainText('kestrel');
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
    expect((await item.locator('[data-challenge]').boundingBox())!.height, 'Challenge is under the thumb floor').toBeGreaterThanOrEqual(48);
    await item.locator('[data-challenge]').click();
    await expect(item).toContainText('reverses nothing');
    // Not "by name": no card names the key it is signed with, and nothing before it made one.
    await expect(item.locator('[data-signed-as]')).toContainText('under a new key with no name');
    await item.locator('[data-confirm="challenged"]').click();
    await expect(item).toContainText('Waiting');
    const sent = await labelsSent(page);
    expect(sent.map((l) => l.tags[1])).toEqual([['l', 'challenged', 'navcom.mission']]);
    // As a reader will see it: the key's first characters, not a callsign no reader has.
    await expect(item).toContainText(`challenged by ${sent[0]!.pubkey.slice(0, 8)}`);
    await expect(item).not.toContainText('kestrel');
  });

  /** A report of this device's own on the heat mission, signed by `secret`, the day before. */
  const ownReport = (secret: Uint8Array) =>
    finalizeEvent(
      {
        kind: 1912,
        created_at: Math.floor(DURING.getTime() / 1000) - 7_200,
        content: JSON.stringify({ callsign: 'kestrel', date: '2026-10-05' }),
        tags: [['a', ADDRESS], ['ask', 'field:heat_relief:CA:2026-10-02#handout:water']]
      },
      secret
    );
  const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
  async function challengeWrens(page: Page, theirs: { id: string }) {
    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await page.locator('[data-reports]').click();
    const item = page.locator(`[data-screen="reports"] [data-report="${theirs.id}"]`);
    await expect(item).toContainText('Wren', { timeout: 15_000 });
    await item.locator('[data-challenge]').click();
    return item;
  }

  test('with her own report on the mission and no card, the confirmation says where her name shows and where only her key does [review]', async ({ page }) => {
    // A reporter reads who challenged her on Your missions, which names a key from a card alone:
    // "as kestrel" there was a promise only this screen kept [audit 11.S, review].
    const contact = generateSecretKey();
    const theirs = wrens();
    await withHeat(page, { __noStorage: false, callsign: 'kestrel', relayEvents: [HEAT, ownReport(contact), theirs], accruing: { contact_secret: hex(contact) } });
    const item = await challengeWrens(page, theirs);
    const said = item.locator('[data-signed-as]');
    await expect(said).toContainText("as kestrel on this mission's reports");
    await expect(said).toContainText(`elsewhere under the key ${getPublicKey(contact).slice(0, 8)}`);
    await expect(said).toContainText('no card of yours is known to be published');
  });

  test('with a card nobody knows reached a relay, the confirmation says the name is not known to be on it [review]', async ({ page }) => {
    // A card saved before send outcomes were kept, or restored from a backup, has none: the card
    // screen calls that "not known if sent", and this screen called it "no card of yours is published".
    const contact = generateSecretKey();
    const theirs = wrens();
    await withHeat(page, { __noStorage: false, callsign: 'kestrel', relayEvents: [HEAT, theirs], accruing: { contact_secret: hex(contact), card: { region: 'us-ca' } } });
    const item = await challengeWrens(page, theirs);
    const said = item.locator('[data-signed-as]');
    await expect(said).toContainText(`under the key ${getPublicKey(contact).slice(0, 8)}`);
    await expect(said).toContainText('as kestrel if your card reached a relay, which this phone has no record of');
    await expect(said).not.toContainText('no card of yours is published');
  });

  test('a report filed here under a card withdrawn since is still hers: marked so, and nothing to say about it [audit 11, second grid]', async ({ page }) => {
    const old = generateSecretKey();
    const mine = ownReport(old);
    await page.clock.setFixedTime(DURING);
    await seedDevice(page, { relayEvents: [HEAT, mine], callsign: 'kestrel' });
    // What this device kept when it sent the report, under the card it held then. That card is gone.
    await page.addInitScript((kept) => {
      if (localStorage.getItem('zz.kept-report') === '1') return;
      localStorage.setItem('zz.kept-report', '1');
      const wipeable = JSON.parse(localStorage.getItem('navcom.wipeable') ?? '{}');
      wipeable.mission_reports = [kept];
      localStorage.setItem('navcom.wipeable', JSON.stringify(wipeable));
    }, {
      id: mine.id, address: ADDRESS, title: 'Heat relief', jurisdiction: 'us-ca', poster: HEAT.pubkey, date: '2026-10-05',
      at: mine.created_at, visibility: 'open', relays: ['wss://relay.damus.io'], signer: getPublicKey(old)
    });
    await open(page, '/');
    await expect(page.locator('[data-missions="open"]')).toContainText('Open missions · live', { timeout: 15_000 });
    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await page.locator('[data-reports]').click();
    const item = page.locator(`[data-screen="reports"] [data-report="${mine.id}"]`);
    await expect(item).toContainText('kestrel', { timeout: 15_000 });
    await expect(item).toContainText('yours');
    await expect(item.locator('[data-challenge]')).toHaveCount(0);
    await expect(item.locator('[data-witness]')).toHaveCount(0);
  });

  test('with only The Record answering, a mission’s reports read unknown, not none: reports go only to operators’ relays [audit 11, second grid]', async ({ page }) => {
    await page.clock.setFixedTime(DURING);
    // The Record holds the mission and, like every relay a report never goes to, no reports.
    await seedDevice(page, { relayEvents: [HEAT], __noStorage: true } as Parameters<typeof seedDevice>[1]);
    // Every other relay is out of reach, failing the way a browser's socket does.
    await page.addInitScript(() => {
      const g = globalThis as unknown as { WebSocket: new (u: string, p?: string | string[]) => object };
      const Inner = g.WebSocket;
      class Unreachable extends EventTarget {
        readyState = 0;
        onopen: ((e: Event) => void) | null = null;
        onerror: ((e: Event) => void) | null = null;
        onclose: ((e: Event) => void) | null = null;
        onmessage: ((e: Event) => void) | null = null;
        constructor(readonly url: string) {
          super();
          setTimeout(() => {
            this.readyState = 3;
            const error = new Event('error');
            this.onerror?.(error);
            this.dispatchEvent(error);
            const close = new CloseEvent('close', { code: 1006 });
            this.onclose?.(close);
            this.dispatchEvent(close);
          }, 0);
        }
        send(): void {}
        close(): void {}
      }
      const Only = function (url: string | URL, protocols?: string | string[]) {
        return /cosmiccodex\.app/.test(String(url)) ? new Inner(String(url), protocols) : new Unreachable(String(url));
      } as unknown as Record<string, number>;
      Object.assign(Only, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
      g.WebSocket = Only as unknown as typeof g.WebSocket;
    });
    await open(page, '/');
    await expect(page.locator('[data-missions="open"]')).toContainText('Open missions · live', { timeout: 15_000 });
    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await page.locator('[data-reports]').click();
    const reports = page.locator('[data-screen="reports"]');
    await expect(reports).toContainText('Unknown', { timeout: 15_000 });
    await expect(reports).toContainText('the relays reports go to did not answer');
    await expect(reports).not.toContainText('None found');
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
     * Two full-page axe passes on a signed-in page, each ~3 s of CPU idle — 80% of it the 1,913
     * options of the region picker — so this is the most CPU-bound test in the file and the first
     * to slow under load. It timed out once at load 54 and passed alone straight after: the 9.S
     * shape, a flake on the Distress path, which trains people to re-run rather than look. Given a
     * budget with its reason rather than a narrower check, because the check is the point
     * [measured 2026-10-07: 5.7–8.5 s at load 17, 12.3–14.5 s under contention].
     */
    test.setTimeout(60_000);
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

  /** The Yours panel's header on the signed-in root. */
  const yoursPost = (page: Page) => page.locator('section.nc-panel', { has: page.locator('[data-yours]') }).locator('[data-post]');

  test('the claim slot reads nothing claimed rather than disappearing [com.md §7; audit 11.I]', async ({ page }) => {
    await withHeat(page, { __noStorage: false, callsign: 'kestrel' });
    await expect(yoursPost(page)).toHaveText('nothing claimed');
    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await page.getByRole('button', { name: 'Take part' }).click();
    await settle(page);
    await page.locator('[data-visibility="open"]').click();
    await expect(page.locator('[data-slot="you"]')).toContainText('Taking part');
    await page.locator('[data-back]').click();
    await page.locator('[data-back]').click();
    await expect(yoursPost(page)).toHaveText('1 held');
    // Letting go puts the same slot back to the same words, in the same place.
    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await page.locator('[data-letgo]').click();
    await expect(page.getByRole('button', { name: 'Take part' })).toBeVisible();
    await page.locator('[data-back]').click();
    await page.locator('[data-back]').click();
    await expect(yoursPost(page)).toHaveText('nothing claimed');
  });

  test('a release no relay confirmed stays on the mission, with a control that sends it once there is signal [audit 11.S, finding 66]', async ({ page }) => {
    // In the crowd her signal dropped and she let go: the claim was forgotten before the release
    // went, and an hour later the mission offered only "Take part" while her claim stayed public.
    test.setTimeout(60_000);
    await withHeat(page, { __noStorage: false, callsign: 'kestrel' });
    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await page.getByRole('button', { name: 'Take part' }).click();
    await settle(page);
    await page.locator('[data-visibility="open"]').click();
    await expect(page.locator('[data-slot="you"]')).toContainText('Taking part');

    // The relays stop answering: what is published is swallowed, as on a congested cell.
    await page.evaluate(() => {
      const g = globalThis as unknown as { WebSocket: { prototype: { send(raw: string): void } }; __swallow?: boolean };
      const send = g.WebSocket.prototype.send;
      g.__swallow = true;
      g.WebSocket.prototype.send = function (this: unknown, raw: string) {
        if (g.__swallow && String(raw).startsWith('["EVENT"')) return;
        return send.call(this, raw);
      };
    });
    await page.locator('[data-letgo]').click();
    const takepart = page.locator('[data-takepart]');
    // Walking away is never refused: once the relays have had their wait, the mission is hers to take again.
    await expect(page.getByRole('button', { name: 'Take part' })).toBeVisible({ timeout: 15_000 });
    await expect(takepart).toContainText('Release unconfirmed', { timeout: 15_000 });
    await expect(takepart).toContainText('it may have arrived');

    // Signal again, and the release goes from the mission's own screen.
    await page.evaluate(() => void ((globalThis as unknown as { __swallow?: boolean }).__swallow = false));
    await takepart.locator('[data-sendrelease]').click();
    await expect(takepart).toContainText('anyone who saw the claim keeps it', { timeout: 15_000 });
    await expect(takepart.locator('[data-sendrelease]')).toHaveCount(0);
    const released = await page.evaluate(
      () =>
        ((globalThis as unknown as { __navcomPublished?: { kind: number; tags: string[][] }[] }).__navcomPublished ?? []).filter(
          (e) => e.kind === 1985 && e.tags.some((t) => t[0] === 'l' && t[1] === 'released')
        ).length
    );
    expect(released, 'the release reached a relay once there was signal').toBeGreaterThan(0);
  });

  test('the phone’s back gesture steps back through Com, and never off the page [audit 11.I]', async ({ page }) => {
    // The system back is history.back(). With the stack kept only in component state it left the
    // page with a mission open — to the page before, or to a blank tab — and the mission, the list
    // and the Distress bar went with it.
    await withHeat(page, { __noStorage: false, callsign: 'kestrel' });
    await page.locator('[data-missions="open"]').click();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await expect(page.locator('[data-screen="mission"]')).toBeVisible();
    await page.goBack();
    await expect(page.locator('[data-screen="missions"]')).toBeVisible();
    await expect(page.locator('.distress-layer a')).toBeVisible();
    await page.goBack();
    await expect(page.getByLabel(/where are you, or what do you need/i)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
    // Forward walks the same history back in, and the in-sheet Back still steps one screen.
    await page.goForward();
    await expect(page.locator('[data-screen="missions"]')).toBeVisible();
    await page.locator(`[data-mission="${HEAT_D}"]`).click();
    await page.locator('[data-back]').click();
    await expect(page.locator('[data-screen="missions"]')).toBeVisible();
    // A reload keeps the entry's history state while the page opens at its root. The next Back
    // must go to the root too, not into the screen that was open before the reload.
    await page.reload();
    await page.waitForSelector('html[data-hydrated="true"]', { timeout: 15_000 });
    const root = page.getByLabel(/where are you, or what do you need/i);
    await expect(root).toBeVisible();
    await page.locator('[data-missions="open"]').click();
    await expect(page.locator('[data-screen="missions"]')).toBeVisible();
    await page.locator('[data-back]').click();
    await expect(root).toBeVisible();
  });

  test('Com’s own controls are at the terminal’s thumb floor [tokens.css; audit 11.I]', async ({ page }) => {
    // 48px is the floor. The handle was 36px and the only way to move the sheet by touch; a tap
    // that missed it landed on the map, where a lit province opens a different screen.
    await withHeat(page, { __noStorage: false, callsign: 'kestrel' });
    await page.locator('[data-yours]').click();
    for (const [name, sel] of [
      ['the sheet handle', '.grab'],
      ['Back', '[data-back]'],
      ['the display toggle', '[data-signature-toggle]'],
      ['the missions line', '[data-missions="open"]']
    ]) {
      const box = await page.locator(sel).boundingBox();
      expect(box, name).not.toBeNull();
      expect(box!.height, name).toBeGreaterThanOrEqual(48);
    }
  });

  test.describe('on a slow cell, what was done before the page woke up survives it [audit 11.I]', () => {
    /** Scripts held back, as a congested cell delivers them: the page is there and not yet live. */
    async function slowScripts(page: Page) {
      await page.route('**/_app/immutable/**/*.js', async (route) => {
        await new Promise((r) => setTimeout(r, 3_000));
        await route.continue();
      });
      await blankDevice(page);
      await page.goto('/', { waitUntil: 'commit' });
      await page.locator('#lookup').waitFor({ state: 'attached' });
    }
    const awake = (page: Page) => page.locator('html[data-hydrated="true"]').count();

    test('a region picked before hydration stays picked, and loads', async ({ page }) => {
      // The picker's own label names this case: "No signal, or geolocation said no?"
      const index = page.waitForRequest('**/console-index/philadelphia.json', { timeout: 15_000 });
      await slowScripts(page);
      await page.locator('#region-pick').selectOption('philadelphia');
      expect(await awake(page), 'the pick has to land before the page hydrates, or this tests nothing').toBe(0);
      await page.waitForSelector('html[data-hydrated="true"]', { timeout: 15_000 });
      await expect(page.locator('#region-pick')).toHaveValue('philadelphia');
      await index;
    });

    test('words typed before hydration lift the sheet so the results can be seen', async ({ page }) => {
      await slowScripts(page);
      await page.locator('#lookup').fill('Philadelphia');
      expect(await awake(page), 'the typing has to land before the page hydrates, or this tests nothing').toBe(0);
      await page.waitForSelector('html[data-hydrated="true"]', { timeout: 15_000 });
      await expect(page.locator('#lookup')).toHaveValue('Philadelphia');
      await expect(page.locator('[data-com]')).toHaveAttribute('data-detent', 'half');
    });
  });

  test.describe('when the missions’ own code cannot arrive [audit 11.I]', () => {
    // The worker would serve the code from its cache and the route below would block nothing.
    test.use({ serviceWorkers: 'block' });

    test('a claim held here reads as held, not as over, and its mission says why it cannot open', async ({ page }) => {
      await withHeat(page, { __noStorage: false, callsign: 'kestrel' });
      await page.locator('[data-missions="open"]').click();
      await page.locator(`[data-mission="${HEAT_D}"]`).click();
      await page.getByRole('button', { name: 'Take part' }).click();
      await settle(page);
      await page.locator('[data-visibility="open"]').click();
      await expect(page.locator('[data-slot="you"]')).toContainText('Taking part');

      await page.route(chunkOf('src/lib/missions/live.ts'), (r) => r.abort());
      await open(page, '/');
      await expect(page.locator('[data-missions="unloaded"]')).toBeVisible({ timeout: 15_000 });
      await page.locator('[data-yours]').click();
      const held = page.locator(`[data-held$="${HEAT_D}"]`);
      // Which missions are open is not known on this phone right now: that is not "over" [invariant 7].
      await expect(held).toContainText(/ends in/i);
      await expect(held).not.toContainText(/over/i);
      await held.click();
      // And not a "Loading" that never ends: the key's own words for the same failure.
      await expect(page.locator('[data-mission-unloaded]')).toContainText('Missions not loaded — they need one visit with a connection', { timeout: 5_000 });
    });
  });

  test.describe('on a small phone held sideways [audit 11.I]', () => {
    for (const viewport of [{ width: 667, height: 375 }, { width: 640, height: 360 }]) {
      test.describe(`${viewport.width}×${viewport.height}`, () => {
        test.use({ viewport });

        test('Com sits beside the map, and covers none of its controls', async ({ page }) => {
          // A fixed peek was most of a short screen: half came out shorter than peek, and the sheet
          // covered "Show the whole map" at every height.
          await withHeat(page, { __noStorage: false, callsign: 'kestrel' });
          await expect(page.locator('[data-grid="ready"]')).toBeVisible({ timeout: 15_000 });
          for (const name of ['Show the whole map', 'Zoom in', 'Zoom out', 'Map layers', 'Places']) {
            expect(await uncovered(page.getByRole('button', { name })), name).toBe(true);
          }
          // Com itself, and Distress, are both there to be reached.
          expect(await uncovered(page.locator('[data-yours]'))).toBe(true);
          expect(await uncovered(page.locator('.distress-layer a'))).toBe(true);
        });
      });
    }
  });
});

/*
 * The map's doors, on the phone and then on a desktop. Places, missions and helpers both read.
 */
const DURING = new Date('2026-10-06T20:00:00Z');
const NAIROBI = [36.82, -1.29] as const;
/**
 * Central Texas, about 17° of longitude from California: past the 12 px a lit shape answers within at
 * the whole-Earth view, which on a phone is about 317 px wide (2026-10-19), so the slack a lit
 * California is given is never what a test of Texas measures [pick.ts LIT_SLOP].
 */
const TEXAS = [-97.7, 31.0] as const;
const LONDON = [-0.13, 51.51] as const;
/** A mission filed under a Kenyan county, which no drawn province matches: it lights Kenya. */
const KENYA_D = 'test-water-points-ke-30';
const kenyan = () => mission(HEAT_KEY, KENYA_D, { title: 'Water points', jurisdiction: 'ke-30' });
/** A mission filed nationally, as real Starcom packages are (`recall_check-home` is `us`): it outlines the US. */
const NATIONAL_D = 'test-national-recall-check';
const national = () => mission(HEAT_KEY, NATIONAL_D, { title: 'Recall check', jurisdiction: 'us' });
/** A mission at a public facility, located at its address [interchange spec §4.2, rev 8]. */
const LIBRARY_D = 'test-cooling-centre-library';
const LIBRARY = [-119.7871, 36.7378] as const;
const library = () =>
  mission(HEAT_KEY, LIBRARY_D, {
    title: 'Cooling centre at the library',
    extra: [['geo', `lat:${LIBRARY[1]},lon:${LIBRARY[0]}`], ['geo_kind', 'subject_location'], ['geo_precision', 'address']]
  });

async function withMissions(page: Page, events: unknown[], seed: Record<string, unknown> = {}) {
  await page.clock.setFixedTime(DURING);
  await seedDevice(page, { relayEvents: events, __noStorage: true, ...seed } as Parameters<typeof seedDevice>[1]);
  await open(page, '/');
  await expect(page.locator('[data-missions="open"], [data-missions="none"]')).toContainText('live', { timeout: 15_000 });
  await mapReady(page);
}

/** Places on, once its file has arrived and been drawn. */
async function placesOn(page: Page) {
  const arrived = page.waitForResponse((r) => r.url().endsWith('/grid/places.json'));
  await page.getByRole('button', { name: 'Places' }).click();
  await arrived;
  await frame(page);
}

/** A region's centre and figures, as the page itself reads them. */
const regionOf = (page: Page, slug: string) =>
  page.evaluate(async (slug) => {
    const j = (await (await fetch('/console-regions.json')).json()) as {
      centroids: { region: string; name: string; lat: number; lon: number }[];
      figures: Record<string, { records: number }>;
    };
    return { ...j.centroids.find((c) => c.region === slug)!, records: j.figures[slug]!.records };
  }, slug);

/**
 * A region with records and none of them on the map (all held back until D5, say), the one standing
 * furthest from any drawn record and any other region, so a tap at its centre can only be its own.
 */
const heldBack = (page: Page) =>
  page.evaluate(async () => {
    const file = (await (await fetch('/grid/places.json')).json()) as { regions: Record<string, ([number, number] | null)[]> };
    const { centroids } = (await (await fetch('/console-regions.json')).json()) as {
      centroids: { region: string; name: string; lat: number; lon: number }[];
    };
    const drawn = Object.values(file.regions).flatMap((ps) => ps.filter((p): p is [number, number] => p !== null));
    let best = { gap: 0, c: null as null | (typeof centroids)[number] };
    for (const c of centroids) {
      const points = file.regions[c.region] ?? [];
      // Inside the band the opening view shows uncovered, so the test can reach it before it zooms.
      if (points.length === 0 || points.some((p) => p !== null) || c.lat > 60 || c.lat < 15) continue;
      const others = [...drawn, ...centroids.filter((o) => o !== c).map((o) => [o.lon, o.lat] as [number, number])];
      const gap = Math.min(...others.map(([lon, lat]) => Math.hypot(lon - c.lon, lat - c.lat)));
      if (gap > best.gap) best = { gap, c };
    }
    const c = best.c!;
    return { slug: c.region, name: c.name, lon: c.lon, lat: c.lat, records: file.regions[c.region]!.length };
  });

/** The region's record standing furthest from any other, among those whose own coordinates carry all five places. */
const isolatedRecord = (page: Page, slug: string) =>
  page.evaluate(async (slug) => {
    const file = (await (await fetch('/grid/places.json')).json()) as { regions: Record<string, ([number, number] | null)[]> };
    const index = (await (await fetch(`/console-index/${slug}.json`)).json()) as { id: string; name: string; at?: [number, number] }[];
    const points = file.regions[slug]!;
    const five = (n: number) => /\.\d{5}$/.test(String(n));
    let best = { i: -1, gap: 0 };
    points.forEach((p, i) => {
      const own = index[i]?.at;
      if (!p || !own || !five(own[0]) || !five(own[1])) return;
      const gap = Math.min(...points.map((q, j) => (q && j !== i ? Math.hypot(q[0] - p[0], q[1] - p[1]) : Infinity)));
      if (gap > best.gap) best = { i, gap };
    });
    return { i: best.i, point: points[best.i]!, entry: index[best.i]! };
  }, slug);

test.describe('the landing map: every shape and point is a door [map.md §6]', () => {
  // The worker would serve the build's own code past the registry splice.
  test.use({ serviceWorkers: 'block' });
  test.beforeEach(async ({ page }) => void (await admit(page, [HEAT_DESK])));

  test('with Zones drawn, a lit California is still a door: a tap on it opens its place, not the Zone under it', async ({ page }) => {
    // The missions light whichever layer is drawn [map.md §8], and a lit shape answers first in every
    // one, as it does under Nation States. It was painted and opened the Zone (review, 2026-10-19).
    await serveZones(page);
    await withMissions(page, [HEAT_PACKAGE]);
    await page.getByRole('button', { name: 'Map layers' }).click();
    await page.locator('[data-screen="layers"]').getByRole('radio', { name: /^Zones/ }).check();
    await expect(page.locator('[data-legend="zones"]')).toContainText('CC BY 4.0');
    await page.locator('[data-back]').click();
    await frame(page);
    await tapAt(page, -119.4, 36.8, 'California');
    const place = page.locator('[data-screen="place"][data-place="us-ca"]');
    await expect(place.locator(`[data-mission="${HEAT_MISSION_D}"]`)).toBeVisible();
    await expect(page.locator('[data-screen="zone"]')).toHaveCount(0);
    // Clear of the lit shape and its 12 px, the layer answers: the sea off Mexico, about 31 px from
    // California at this view, is the fixture's Laurentia West Zone.
    await page.locator('[data-back]').click();
    await tapAt(page, -130, 10, 'the sea off Mexico');
    await expect(page.locator('[data-screen="zone"][data-zone="zone:laurentia-west"]')).toBeVisible();
  });

  test('a tap on unlit Kenya opens Kenya, and says nothing is open there', async ({ page }) => {
    await withMissions(page, [HEAT_PACKAGE]);
    await tapAt(page, ...NAIROBI, 'Nairobi');
    const place = page.locator('[data-screen="place"][data-place="ke"]');
    await expect(place).toBeVisible();
    await expect(place).toContainText(/nothing open in Kenya/i);
    // Directory regions are listed by distance, and there are none within reach of Nairobi yet.
    await expect(place).toContainText(/no directory region within/i);
  });

  test('a finger’s tap lifts the outline of what it took while that place is open, and Back lets it go', async ({ page }) => {
    // Touch has no hover, so nothing else on the map says what a finger took [review, 2026-10-18].
    await withMissions(page, [HEAT_PACKAGE]);
    const at = await screenAt(page, ...NAIROBI);
    expect(await inkNear(page, at.x, at.y, 12), 'ink at Kenya before anything was tapped').toBe(0);
    await tapAt(page, ...NAIROBI, 'Nairobi');
    await expect(page.locator('[data-screen="place"][data-place="ke"]')).toBeVisible();
    await frame(page);
    await expect(page.locator('[data-chip]')).toHaveText('');
    expect(await inkNear(page, at.x, at.y, 12), 'Kenya’s outline was not lifted').toBeGreaterThan(20);
    await page.locator('[data-back]').click();
    await expect(page.locator('[data-screen="place"]')).toHaveCount(0);
    await frame(page);
    expect(await inkNear(page, at.x, at.y, 12), 'Kenya stayed lifted after its place closed').toBe(0);
  });

  test('a national mission takes no tap from the states it outlines: a finger on Texas opens Texas, and lists it', async ({ page }) => {
    await withMissions(page, [HEAT_PACKAGE, national()]);
    await tapAt(page, ...TEXAS, 'Texas');
    const place = page.locator('[data-screen="place"]');
    await expect(place).toHaveAttribute('data-place', 'us-tx');
    await expect(place.locator('[data-post]').first()).toHaveText('Texas');
    // Filed under `us`, so listed on every state's screen [filedUnder].
    await expect(place.locator(`[data-mission="${NATIONAL_D}"]`)).toBeVisible();
  });

  test('a mission filed under a Kenyan county lights Kenya, and a tap there lists it', async ({ page }) => {
    await withMissions(page, [HEAT_PACKAGE, kenyan()]);
    await expect(page.locator('[data-missions="open"]')).toContainText('Open missions · live');
    // A lift in brightness at Nairobi, against unlit Tanzania beside it: both are plain land otherwise.
    const nairobi = await screenAt(page, ...NAIROBI);
    const dodoma = await screenAt(page, 35.75, -6.16);
    const [lit, unlit] = [await pixelAt(page, nairobi.x, nairobi.y), await pixelAt(page, dodoma.x, dodoma.y)];
    expect(lit.reduce((a, b) => a + b), `Kenya ${lit} against Tanzania ${unlit}`).toBeGreaterThan(unlit.reduce((a, b) => a + b) + 15);
    await tapAt(page, ...NAIROBI, 'Nairobi');
    const place = page.locator('[data-screen="place"][data-place="ke"]');
    await expect(place.locator(`[data-mission="${KENYA_D}"]`)).toContainText('Water points');
    await place.locator(`[data-mission="${KENYA_D}"]`).click();
    await expect(page.locator(`[data-screen="mission"][data-mission="${KENYA_D}"]`)).toBeVisible();
  });

  test('a tap at the whole-Earth view lists what is near without distances it cannot know; zoomed in, it measures', async ({ page }) => {
    // At this zoom a thumb covers hundreds of kilometres, so "84 km" would be precision the tap does not have.
    await withMissions(page, [HEAT_PACKAGE]);
    await tapAt(page, ...LONDON, 'London');
    const near = page.locator('[data-screen="place"] [data-near]');
    await expect(near.locator('[data-near-region="london"]')).toBeVisible();
    await expect(near).toHaveAttribute('data-near', 'coarse');
    await expect(near.locator('.nc-near-km')).toHaveCount(0);
    await page.locator('[data-back]').click();
    await zoomAt(page, ...LONDON, 16);
    await tapAt(page, ...LONDON, 'London');
    await expect(near).toHaveAttribute('data-near', 'measured');
    await expect(near.locator('.nc-near-km').first()).toHaveText(/^\d+ km$/);
  });

  test('by keyboard alone: focus the map, pan to California, and Enter opens it', async ({ page }) => {
    await withMissions(page, [HEAT_PACKAGE]);
    const canvas = page.locator('.grid canvas');
    await canvas.focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press('+');
    // Pan until California is under the reticle, reading where both are from the map itself.
    for (let i = 0; i < 80; i++) {
      await frame(page);
      const [rx, ry] = ((await canvas.getAttribute('data-reticle')) ?? '').split(' ').map(Number) as [number, number];
      const box = (await canvas.boundingBox())!;
      const ca = await screenAt(page, -119.4, 36.8);
      const [dx, dy] = [ca.x - box.x - rx, ca.y - box.y - ry];
      const step = Math.min(box.width, box.height) * 0.15;
      if (Math.abs(dx) <= step / 2 && Math.abs(dy) <= step / 2) break;
      if (Math.abs(dx) > step / 2) await page.keyboard.press(dx < 0 ? 'ArrowLeft' : 'ArrowRight');
      else await page.keyboard.press(dy < 0 ? 'ArrowUp' : 'ArrowDown');
    }
    // The reticle's readout is a polite live region: what is under it, as the keys move it.
    const chip = page.locator('[data-chip]');
    await expect(chip).toHaveAttribute('role', 'status');
    await expect(chip).toHaveText('California · 1 open mission');
    await page.keyboard.press('Enter');
    const place = page.locator('[data-screen="place"][data-place="us-ca"]');
    await expect(place).toBeVisible();
    await expect(place.locator(`[data-mission="${HEAT_MISSION_D}"]`)).toBeVisible();
  });

  test('no axe violations with a place open', async ({ page }) => {
    await withMissions(page, [HEAT_PACKAGE]);
    await tapAt(page, ...NAIROBI, 'Nairobi');
    await expect(page.locator('[data-screen="place"][data-place="ke"]')).toContainText(/nothing open in Kenya/i);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  test('a mission at a public facility is a ring at its point, and a finger on it opens that mission', async ({ page }) => {
    await withMissions(page, [HEAT_PACKAGE, library()]);
    const at = await screenAt(page, ...LIBRARY);
    // The ring is drawn in ink, the brightest neutral there is; California's lift alone is far dimmer.
    expect(await inkNear(page, at.x, at.y, 10), 'no ring at the library').toBeGreaterThan(20);
    await tapAt(page, ...LIBRARY, 'the library');
    await expect(page.locator(`[data-screen="mission"][data-mission="${LIBRARY_D}"]`)).toBeVisible();
  });

  test('zoomed in to a street, a package’s address is still drawn no finer than a kilometre until D5 and Q19 are answered', async ({ page }) => {
    /*
     * A package carries no resource type, so a youth shelter and a library look alike to NavCom: the
     * same hold the directory's shelters are under, until D5 and Q19 [map.md §6; interchange spec §4.2].
     * Drawn at the 1 km point it rounds to, as a ring a kilometre across, however far in.
     */
    await withMissions(page, [HEAT_PACKAGE, library()]);
    await zoomAt(page, ...LIBRARY, 2048);
    // The wheel's pointer is a mouse, whose hover rings the mission: off the map, so only the ring is drawn.
    await page.locator('.nav-key h1').hover();
    await frame(page);
    const [lon, lat] = [Math.round(LIBRARY[0] * 100) / 100, Math.round(LIBRARY[1] * 100) / 100];
    const exact = await screenAt(page, ...LIBRARY);
    const centre = await screenAt(page, lon, lat);
    const scale = Number(((await page.locator('.grid canvas').getAttribute('data-view')) ?? '').split(' ')[2]);
    // Equal Earth keeps areas, so a kilometre's circle is drawn with a kilometre's area anywhere [topology.ts].
    const r = (1_113 * scale) / METRES_PER_UNIT;
    expect(r, 'the ring a kilometre covers is wider than the smallest ring').toBeGreaterThan(20);
    expect(await inkNear(page, exact.x, exact.y, 8), 'a ring drawn round the address itself').toBe(0);
    expect(await inkNear(page, centre.x + r, centre.y, 4), 'no kilometre ring round the point it rounds to').toBeGreaterThan(0);
  });

  test('Places fetches its file once, from navcom.app only, and never before it is switched on', async ({ page }) => {
    const requested: string[] = [];
    page.on('request', (r) => requested.push(r.url()));
    await withMissions(page, [HEAT_PACKAGE]);
    const places = () => requested.filter((u) => new URL(u).pathname === '/grid/places.json');
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await frame(page);
    expect(places(), 'fetched with Places off').toEqual([]);
    const button = page.getByRole('button', { name: 'Places' });
    const arrived = page.waitForResponse((r) => r.url().endsWith('/grid/places.json'));
    await button.click();
    await arrived;
    await button.click();
    await button.click();
    await frame(page);
    expect(places()).toHaveLength(1);
    const home = new URL(page.url()).origin;
    expect(requested.filter((u) => new URL(u).origin !== home)).toEqual([]);
  });

  test('when the places file cannot load, the key says so, and the next switch-on asks again', async ({ page }) => {
    await withMissions(page, [HEAT_PACKAGE]);
    let asked = 0;
    await page.route('**/grid/places.json', (r) => {
      asked += 1;
      return r.abort();
    });
    const button = page.getByRole('button', { name: 'Places' });
    await button.click();
    const failed = page.locator('[data-places="failed"]');
    await expect(failed).toContainText(/places not loaded/i);
    expect(await uncovered(failed)).toBe(true);
    expect(asked).toBe(1);
    await page.unroute('**/grid/places.json');
    await button.click();
    const arrived = page.waitForResponse((r) => r.url().endsWith('/grid/places.json'));
    await button.click();
    await arrived;
    await expect(failed).toHaveCount(0);
  });

  test('with Places on, regions are rings Earth-wide, hollow so no centre reads as a place; a finger on Birmingham’s opens it', async ({ page }) => {
    await withMissions(page, [HEAT_PACKAGE]);
    const melbourne = await regionOf(page, 'melbourne');
    const london = await regionOf(page, 'london');
    const muted = async (lon: number, lat: number) => {
      const at = await screenAt(page, lon, lat);
      return toneNear(page, at.x, at.y, 6, '--t-muted');
    };
    const before = [await muted(melbourne.lon, melbourne.lat), await muted(london.lon, london.lat)];
    await placesOn(page);
    // A ring is drawn in the muted neutral, which nothing else on the map is drawn in.
    expect(await muted(melbourne.lon, melbourne.lat), 'no ring at Melbourne').toBeGreaterThan(before[0]! + 10);
    expect(await muted(london.lon, london.lat), 'no ring at London').toBeGreaterThan(before[1]! + 10);

    const birmingham = await regionOf(page, 'birmingham-uk');
    // In close enough that Birmingham's ring is its own and not its neighbours'.
    await zoomAt(page, birmingham.lon, birmingham.lat, 16);
    const at = await screenAt(page, birmingham.lon, birmingham.lat);
    const button = page.getByRole('button', { name: 'Places' });
    await button.click();
    await frame(page);
    const bare = await pixelAt(page, at.x, at.y);
    await button.click();
    await frame(page);
    // A region's centre is a statistic of its records, not a place: never a dot like a record's.
    expect(await pixelAt(page, at.x, at.y), 'Birmingham’s centre is drawn as a dot').toEqual(bare);
    expect(await toneNear(page, at.x, at.y, 7, '--t-muted'), 'no ring round Birmingham').toBeGreaterThan(10);
    await tap(page, at.x, at.y);
    const place = page.locator('[data-screen="place"][data-place="birmingham-uk"]');
    await expect(place).toContainText(`${birmingham.records} places`);
    await place.locator('[data-area-link]').click();
    await page.waitForURL('**/directory/area/birmingham-uk/');
  });

  test('from about 2 km a pixel, a region’s records take over from its ring', async ({ page }) => {
    await withMissions(page, [HEAT_PACKAGE]);
    const birmingham = await regionOf(page, 'birmingham-uk');
    await placesOn(page);
    await zoomAt(page, birmingham.lon, birmingham.lat, 40);
    const pick = await isolatedRecord(page, 'birmingham-uk');
    expect(pick.i, 'a Birmingham record with five-place coordinates').toBeGreaterThanOrEqual(0);
    await tapAt(page, pick.point[0], pick.point[1], pick.entry.name);
    await expect(page.locator(`[data-screen="place"][data-record="${pick.i}"] [data-post]`).first()).toHaveText(pick.entry.name);
  });

  test('zoomed into Birmingham, a record’s point opens it, and Open in maps carries its own five places', async ({ page }) => {
    await withMissions(page, [HEAT_PACKAGE]);
    const birmingham = await regionOf(page, 'birmingham-uk');
    await placesOn(page);
    await zoomAt(page, birmingham.lon, birmingham.lat, 600);
    const pick = await isolatedRecord(page, 'birmingham-uk');
    expect(pick.i, 'a Birmingham record with five-place coordinates').toBeGreaterThanOrEqual(0);
    await tapAt(page, pick.point[0], pick.point[1], pick.entry.name);
    const place = page.locator(`[data-screen="place"][data-record="${pick.i}"]`);
    await expect(place.locator('[data-post]').first()).toHaveText(pick.entry.name);
    await expect(place.locator('[data-record-link]')).toHaveAttribute('href', `/directory/${pick.entry.id}/`);
    const [lon, lat] = pick.entry.at!;
    await expect(place.locator('[data-handoff]')).toHaveAttribute('href', new RegExp(`mlat=${lat}&mlon=${lon}#`.replace(/\./g, '\\.')));
    await expect(place.locator('[data-handoff]')).toHaveAttribute('rel', 'noreferrer');
  });

  test('zoomed in past where records take over, a region whose places are all held back keeps its ring, and says so', async ({ page }) => {
    // Blank must read unknown, not none [invariant 7]: a held-back region was a stretch of nothing.
    await withMissions(page, [HEAT_PACKAGE]);
    await placesOn(page);
    const held = await heldBack(page);
    await zoomAt(page, held.lon, held.lat, 200);
    await tapAt(page, held.lon, held.lat, held.name);
    const place = page.locator(`[data-screen="place"][data-place="${held.slug}"]`);
    await expect(place).toContainText(`${held.records} not on the map`);
    await expect(place.locator('[data-area-link]')).toBeVisible();
  });
});

test.describe('the landing map on a desktop: hover says what is under the pointer', () => {
  test.use({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
  test.beforeEach(async ({ page }) => void (await admit(page, [HEAT_DESK])));

  test('California with the heat mission, and Kenya with nothing, each say so, under Distress and inside the map', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-06T20:00:00Z'));
    await seedDevice(page, { relayEvents: [HEAT_PACKAGE], callsign: 'kestrel' });
    await open(page, '/');
    await expect(page.locator('[data-missions="open"]')).toContainText('Open missions · live', { timeout: 15_000 });
    await mapReady(page);
    const chip = page.locator('[data-chip]');
    const california = await screenAt(page, -119.4, 36.8);
    await page.mouse.move(california.x, california.y);
    await expect(chip).toHaveText('California · 1 open mission');
    const nav = (await page.locator('.nav').boundingBox())!;
    const box = (await chip.boundingBox())!;
    expect(box.x >= nav.x && box.y >= nav.y && box.x + box.width <= nav.x + nav.width && box.y + box.height <= nav.y + nav.height, 'the chip leaves the map').toBe(true);
    const distress = page.getByRole('link', { name: /^distress$/i });
    expect(
      await distress.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return hit === el || el.contains(hit);
      }),
      'something covers Distress'
    ).toBe(true);
    const kenya = await screenAt(page, 36.82, -1.29);
    await page.mouse.move(kenya.x, kenya.y);
    await expect(chip).toHaveText('Kenya · Nothing open');
  });

  test('with a national mission open, a state is still the state under the pointer, and says the mission is open there', async ({ page }) => {
    await withMissions(page, [HEAT_PACKAGE, national()]);
    const texas = await screenAt(page, ...TEXAS);
    await page.mouse.move(texas.x, texas.y);
    await expect(page.locator('[data-chip]')).toHaveText('Texas · 1 open mission');
  });

  test('a region’s ring says what it holds, and zoomed in, how many of its places are not on the map', async ({ page }) => {
    await withMissions(page, [HEAT_PACKAGE]);
    await placesOn(page);
    const chip = page.locator('[data-chip]');
    const birmingham = await regionOf(page, 'birmingham-uk');
    await zoomAt(page, birmingham.lon, birmingham.lat, 16);
    const at = await screenAt(page, birmingham.lon, birmingham.lat);
    await page.mouse.move(at.x, at.y);
    await expect(chip).toHaveText(`Birmingham · ${birmingham.records} places`);
    await page.getByRole('button', { name: 'Show the whole map' }).click();
    const held = await heldBack(page);
    await zoomAt(page, held.lon, held.lat, 200);
    const there = await screenAt(page, held.lon, held.lat);
    await page.mouse.move(there.x, there.y);
    await expect(chip).toHaveText(`${held.name} · ${held.records} ${held.records === 1 ? 'place' : 'places'} not on the map`);
  });
});
