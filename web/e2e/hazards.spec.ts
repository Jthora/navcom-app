import { expect, test, type Page } from '@playwright/test';
import { chunkOf, open, seedDevice } from './device';
import { hazardFixture, serveHazards } from './hazards';
import { bring, frame, inkNear, mapReady, screenAt, tap } from './map';
import { CAPS, HAZARD_FEEDS } from '../src/lib/outside';

/**
 * Hazards over the map [docs/design/map.md §8, Hazards], against the build that deploys, on the phone.
 *
 * Every feed is served by route from the recorded fixtures in the shapes measured on 2026-10-19
 * (`fixtures/hazards/`, `./hazards.ts`): no test asks the live services. What is held here is what a
 * person sees and what leaves the phone: the five URLs and nothing chosen by the view; marks drawn in
 * the neutrals at the points the sources gave; a feed with no answer reading *not read: unknown*; an
 * empty map reading *not the same as safe*; a round at most every 10 minutes and none while the page
 * is hidden; a tap opening the source's own words; and nothing asked again after a reload.
 */

test.use({ serviceWorkers: 'block' });

const URLS = HAZARD_FEEDS.flatMap((f) => f.urls);
/** Two of the fixture's events, far from anything else the map draws at the opening view. */
const RUTENG = [120.378, -8.1042] as const;
const CHILLAN = [-71.378, -36.868] as const;
const EUROPE_DROUGHT = [13.696, 48.764] as const;
const WATI = [-156.8, -20.7] as const;

async function landed(page: Page) {
  await seedDevice(page, { __noStorage: true });
  await open(page, '/');
  await mapReady(page);
}

/** The layers screen, Hazards ticked, and every feed's answer read and drawn. */
async function hazardsOn(page: Page, settled = /GDACS (just now|not read)/) {
  // Every feed answered: the key says so, in one line or several.
  await page.getByRole('button', { name: 'Map layers' }).click();
  const screen = page.locator('[data-screen="layers"]');
  await screen.locator('[data-hazards]').check();
  await expect(page.locator('[data-legend]')).toContainText(settled);
  await frame(page);
  return screen;
}

/** The widest spread between any pixel's channels in a box: a neutral is a few, any watch-state hue is over a hundred. */
const spread = (page: Page, x: number, y: number, half: number) =>
  page.locator('.grid canvas').evaluate(
    (c: HTMLCanvasElement, [x, y, half]) => {
      const r = c.getBoundingClientRect();
      const k = c.width / r.width;
      const d = c.getContext('2d')!.getImageData(Math.round((x! - half! - r.left) * k), Math.round((y! - half! - r.top) * k), Math.round(2 * half! * k), Math.round(2 * half! * k)).data;
      let most = 0;
      for (let i = 0; i < d.length; i += 4) most = Math.max(most, Math.max(d[i]!, d[i + 1]!, d[i + 2]!) - Math.min(d[i]!, d[i + 1]!, d[i + 2]!));
      return most;
    },
    [x, y, half] as [number, number, number]
  );

test('asks the three feeds for their whole-world lists, only once chosen, and nothing more for a pan or a zoom', async ({ page }) => {
  const asked = await serveHazards(page);
  await landed(page);
  await page.getByRole('button', { name: 'Map layers' }).click();
  const ask = page.locator('[data-hazards-ask]');
  await expect(ask).toBeVisible();
  // Before the box: that an address places a phone roughly, which is not the same as where it looks,
  // what else each host learns, and what a round costs now and in a busy season.
  await expect(ask).toContainText('which can place it roughly, often to a city; its browser; the time');
  await expect(ask).toContainText('not where you are looking on the map');
  await expect(ask).toContainText('about 196 kB each time now, more in a fire season, up to about 700 kB');
  await expect(ask).toContainText('www.gdacs.org (GDACS: its orange- and red-alert floods, droughts and cyclones that are still current)');
  expect(asked, 'asked before anybody chose it').toEqual([]);
  await page.locator('[data-hazards]').check();
  await expect.poll(() => asked.length, { timeout: 10_000 }).toBe(URLS.length);
  expect([...asked].sort()).toEqual([...URLS].sort());
  await expect(page.locator('[data-legend]')).toContainText('Hazards · USGS, EONET and GDACS just now · some events, never all');

  // Moving the map asks nothing: nothing it asks is chosen by what is on screen.
  await page.locator('[data-back]').click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.locator('.grid canvas').focus();
  for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight']) await page.keyboard.press(key);
  await page.getByRole('button', { name: 'Show the whole map' }).click();
  // And turning it off and on inside 10 minutes asks nothing either.
  await page.getByRole('button', { name: 'Map layers' }).click();
  await page.locator('[data-hazards]').uncheck();
  await page.locator('[data-hazards]').check();
  await expect(page.locator('[data-legend]')).toContainText('and GDACS just now');
  await page.waitForTimeout(500);
  expect(asked).toHaveLength(URLS.length);
});

test('draws each event at the point its source gave, in the neutrals, with a key of its shapes', async ({ page }) => {
  await serveHazards(page);
  await landed(page);
  await hazardsOn(page);
  await page.locator('[data-back]').click();
  await frame(page);
  for (const [name, [lon, lat]] of [['the Ruteng quake', RUTENG], ['the Chillán volcano', CHILLAN], ['Europe’s drought', EUROPE_DROUGHT], ['Cyclone Wati', WATI]] as const) {
    const at = await bring(page, lon, lat);
    expect(at.uncovered, `${name} is under something`).toBe(true);
    expect(await inkNear(page, at.x, at.y, 7), `${name} is not drawn`).toBeGreaterThan(4);
    // Every hue on these screens is a watch state: a mark is ink and ground, nothing else.
    expect(await spread(page, at.x, at.y, 8), `${name} is drawn in a hue`).toBeLessThanOrEqual(30);
  }
  // The key under the map's names the kinds there are, each by its shape.
  const swatches = page.locator('[data-swatches]');
  await expect(swatches.locator('[data-swatch="asterisk"]')).toHaveText('Quakes · 3');
  await expect(swatches.locator('[data-swatch="hexagon"]')).toHaveText('Storms · 2');
  await expect(swatches.locator('[data-swatch="triangle-hatched"]')).toHaveText('Volcanoes · 1');
  await expect(swatches.locator('[data-swatch="triangle"]')).toHaveText('Fires · 1');
  await expect(swatches.locator('[data-swatch="diamond-hatched"]')).toHaveText('Droughts · 1');
  // Sharing lines, so the key takes two lines for five kinds rather than five.
  const tops = new Set(await swatches.locator('li').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top))));
  expect(tops.size, 'a line a kind').toBeLessThanOrEqual(2);
});

test('a feed that does not answer reads not read: unknown, on the map and on the screen, never none', async ({ page }) => {
  await serveHazards(page, { fail: ['gdacs'] });
  await landed(page);
  const screen = await hazardsOn(page, /GDACS not read/);
  await expect(page.locator('[data-legend]')).toContainText('Hazards · USGS and EONET just now · GDACS not read: unknown · some events, never all');
  await expect(screen.locator('[data-hazard-feed="gdacs"]')).toContainText('not read: unknown · the ask failed');
  await expect(screen.locator('[data-hazard-feed="usgs"]')).toContainText('3 listed · read just now');
  await expect(page.locator('[data-legend]')).not.toContainText(/\bnone\b/);
});

test('a feed that listed entries and could read none of them reads not read: unknown, never nothing listed', async ({ page }) => {
  // Each answer the shape it was measured in, and nothing in it readable: every quake given another way
  // than a point, every EONET event without a title, GDACS's current flag sent as a number.
  type Body = { features?: Record<string, Record<string, unknown> | null>[]; events?: Record<string, unknown>[] };
  const unreadable = (name: string) => {
    const body = hazardFixture(name) as Body;
    for (const f of body.features ?? []) {
      f['geometry'] = { type: 'MultiPoint', coordinates: [[0, 0]] };
      if (f['properties'] && 'iscurrent' in f['properties']) f['properties']['iscurrent'] = 1;
    }
    for (const e of body.events ?? []) e['title'] = '';
    return JSON.stringify(body);
  };
  const names = ['usgs-45', 'usgs-sig', 'eonet-open', 'eonet-fires', 'gdacs-search'];
  await serveHazards(page, { bodies: Object.fromEntries(URLS.map((url, i) => [url, unreadable(names[i]!)])) });
  await landed(page);
  const screen = await hazardsOn(page, /GDACS not read/);
  await expect(page.locator('[data-legend]')).toContainText('Hazards · USGS, EONET and GDACS not read: unknown · some events, never all');
  await expect(page.locator('[data-legend]')).not.toContainText('nothing listed');
  for (const id of ['usgs', 'eonet', 'gdacs']) {
    await expect(screen.locator(`[data-hazard-feed="${id}"]`)).toContainText('not read: unknown · its answer was not in the shape it was measured in');
  }
});

test('EONET’s wildfires past their cap read not read, its volcanoes and storms are still drawn, and the wildfires are not asked again', async ({ page }) => {
  const fires = HAZARD_FEEDS[1]!.urls[1]!;
  // One byte past what the phone will read of an EONET answer, as a busy season's wildfires would be.
  const asked = await serveHazards(page, { bodies: { [fires]: 'x'.repeat(CAPS.eonet + 1) } });
  await page.clock.install({ time: new Date('2026-10-19T13:20:00Z') });
  await landed(page);
  const screen = await hazardsOn(page);
  await expect(page.locator('[data-legend]')).toContainText('EONET just now, wildfires not read: unknown');
  await expect(screen.locator('[data-hazard-feed="eonet"]')).toContainText(
    '2 listed · read just now · wildfires not read: unknown, its answer passed its cap, so it is not asked again on this page'
  );
  await page.locator('[data-back]').click();
  const at = await bring(page, ...CHILLAN);
  expect(await inkNear(page, at.x, at.y, 7), 'the volcano went with the wildfires').toBeGreaterThan(4);
  // The next round asks the rest again, and not the answer it dropped.
  await page.clock.runFor(10 * 60_000 + 1_000);
  await expect.poll(() => asked.filter((u) => u === HAZARD_FEEDS[1]!.urls[0]).length).toBe(2);
  expect(asked.filter((u) => u === fires)).toHaveLength(1);
});

test('a tap on a crowded spot says how many were there, not only the twelve it opens', async ({ page }) => {
  const swarm = {
    type: 'FeatureCollection',
    metadata: { generated: Date.parse('2026-10-19T13:00:00Z') },
    features: Array.from({ length: 40 }, (_, i) => ({
      type: 'Feature',
      id: `swarm${String(i).padStart(2, '0')}`,
      properties: { title: `M 4.5 - swarm ${i}`, mag: 4.5, magType: 'mb', time: Date.parse('2026-10-19T12:00:00Z'), url: null },
      geometry: { type: 'Point', coordinates: [...RUTENG, 10] }
    }))
  };
  await serveHazards(page, { bodies: { [URLS[0]!]: JSON.stringify(swarm) } });
  await landed(page);
  await hazardsOn(page);
  await page.locator('[data-back]').click();
  const at = await bring(page, ...RUTENG);
  await tap(page, at.x, at.y);
  const screen = page.locator('[data-screen="hazard"]');
  await expect(screen.locator('[data-hazard-mark]')).toHaveCount(12);
  await expect(screen.locator('[data-hazard-of]')).toContainText('12 of 40 here');
  await expect(screen.locator('[data-hazard-of]')).toContainText('zoom in for the rest');
});

test('when every feed lists nothing, the map says that is not the same as safe', async ({ page }) => {
  await serveHazards(page, { empty: true });
  await landed(page);
  const screen = await hazardsOn(page, /not the same as safe/);
  await expect(page.locator('[data-legend]')).toContainText('Hazards · nothing listed by USGS, EONET or GDACS, read just now · not the same as safe');
  await expect(screen.locator('[data-hazard-feed="eonet"]')).toContainText('nothing listed · read just now');
  await expect(screen.locator('[data-hazards-ask]')).toContainText('nothing drawn is not nothing happening');
});

test('asks again at 10 minutes and not before, and not at all while the page is hidden', async ({ page }) => {
  const asked = await serveHazards(page);
  await page.clock.install({ time: new Date('2026-10-19T13:20:00Z') });
  await landed(page);
  await hazardsOn(page);
  expect(asked).toHaveLength(URLS.length);
  await page.clock.runFor(9 * 60_000);
  expect(asked, 'asked again inside 10 minutes').toHaveLength(URLS.length);
  // The key's ages move on with the minutes, and nothing is asked for that.
  await expect(page.locator('[data-legend]')).toContainText(/GDACS (8|9) min ago/);
  await page.clock.runFor(60_000 + 1_000);
  await expect.poll(() => asked.length).toBe(2 * URLS.length);

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(35 * 60_000);
  expect(asked, 'asked while nobody could see the page').toHaveLength(2 * URLS.length);
  // Back in view, what is due is asked, once.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => asked.length).toBe(3 * URLS.length);
  await page.clock.runFor(1_000);
  expect(asked).toHaveLength(3 * URLS.length);
});

test('a tap opens what it landed on, in its source’s own words, with only an https link a link', async ({ page }) => {
  await serveHazards(page);
  await landed(page);
  await hazardsOn(page);
  await page.locator('[data-back]').click();
  const at = await bring(page, ...CHILLAN);
  const before = await inkNear(page, at.x, at.y, 7);
  await tap(page, at.x, at.y);
  const screen = page.locator('[data-screen="hazard"]');
  await expect(screen).toBeVisible();
  const mark = screen.locator('[data-hazard-mark="eonet:EONET_20710"]');
  await expect(mark.locator('[data-hazard-title]')).toHaveText('Nevados del Chillan Volcano, Chile');
  // Its time is named for what it is: EONET's latest point, which for a volcano is not the eruption's age.
  await expect(mark.locator('[data-slot="latest-point"]')).toContainText('as given: 2026-06-15T00:00:00Z · its latest point’s date, not the event’s');
  await expect(mark.locator('[data-slot="source"]')).toContainText('NASA Earth Observatory Natural Event Tracker (EONET)');
  const link = mark.locator('[data-hazard-links] a');
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute('href', 'https://volcano.si.edu/volcano.cfm?vn=357070');
  await expect(link).toHaveAttribute('rel', 'noreferrer noopener');
  // The fixture's javascript: source is its name as text, and nowhere a link.
  await expect(mark.locator('[data-hazard-unlinked]')).toHaveText('Fixture');
  expect(await page.locator('a[href^="javascript:"]').count()).toBe(0);
  // What the tap took is lifted while its screen is open: drawn heavier than before.
  await frame(page);
  const lifted = await screenAt(page, ...CHILLAN);
  expect(await inkNear(page, lifted.x, lifted.y, 7)).toBeGreaterThan(before);
});

test('is drawn over every layer, and asks nobody again after a reload, which leaves it off', async ({ page }) => {
  const asked = await serveHazards(page);
  await landed(page);
  const screen = await hazardsOn(page);
  for (const layer of [/^Zones/, /^Time zones/, /^None/, /^Nation States/]) {
    await screen.getByRole('radio', { name: layer }).check();
    // A layer's line in the key can move the opening view: read where the quake is once it has settled.
    await expect
      .poll(async () => {
        await frame(page);
        const at = await screenAt(page, ...RUTENG);
        return inkNear(page, at.x, at.y, 7);
      }, { message: `not drawn over ${layer}` })
      .toBeGreaterThan(4);
  }
  expect(asked).toHaveLength(URLS.length);
  await page.reload();
  await page.waitForSelector('html[data-hydrated="true"]');
  await mapReady(page);
  await page.waitForTimeout(500);
  expect(asked, 'a reload asked the feeds again').toHaveLength(URLS.length);
  await page.getByRole('button', { name: 'Map layers' }).click();
  await expect(page.locator('[data-hazards]')).not.toBeChecked();
});

test('opened again from history with Hazards off, its screen says so and asks nobody', async ({ page }) => {
  const asked = await serveHazards(page);
  await landed(page);
  await page.getByRole('button', { name: 'Map layers' }).click();
  await expect(page.locator('[data-screen="layers"]')).toBeVisible();
  // What this entry would hold had a hazard been tapped on an earlier visit, as SvelteKit keeps it.
  await page.evaluate(() =>
    history.replaceState({ ...history.state, 'sveltekit:states': { com: [{ kind: 'hazard', ids: 'usgs:us6000u3ch', of: '1' }] } }, '')
  );
  await page.getByRole('button', { name: 'Map layers' }).click();
  await page.goBack();
  const screen = page.locator('[data-screen="hazard"]');
  await expect(screen).toContainText('Off on this page');
  await expect(screen.locator('[data-hazard-layers]')).toBeVisible();
  await page.waitForTimeout(300);
  expect(asked, 'opening it asked the feeds').toEqual([]);
});

test('says when its own code did not arrive, rather than drawing nothing', async ({ page }) => {
  await page.route(chunkOf('src/lib/grid/layers/hazards.ts'), (r) => r.abort());
  const asked = await serveHazards(page);
  await landed(page);
  await page.getByRole('button', { name: 'Map layers' }).click();
  await page.locator('[data-hazards]').check();
  await expect(page.locator('[data-legend]')).toContainText('Hazards not loaded — it needs one visit with a connection');
  expect(asked).toEqual([]);
});

test.describe('on a desktop, a hover says what is under the pointer', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

  test('in the source’s words, with its measure, its age and whose, and how many more share the spot', async ({ page }) => {
    await serveHazards(page);
    await page.clock.setFixedTime(new Date('2026-10-19T13:20:00Z'));
    await landed(page);
    await hazardsOn(page);
    const at = await screenAt(page, ...RUTENG);
    expect(at.uncovered).toBe(true);
    await page.mouse.move(at.x, at.y);
    await expect(page.locator('[data-chip]')).toHaveText('M 4.8 - 56 km N of Ruteng, Indonesia · 4.8 mb · origin 1 h ago · USGS · and 1 more');
    const champi = await screenAt(page, 138.4, 14.3);
    await page.mouse.move(champi.x, champi.y);
    // GDACS's time is when it last updated the entry, which is not how old the cyclone is.
    await expect(page.locator('[data-chip]')).toHaveText('Tropical Cyclone CHAMPI-26 · GDACS alert: Red · updated 5 h ago · GDACS');
  });
});
