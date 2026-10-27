import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { open, seedDevice } from './device';
import { frame, inkNear, mapReady, screenAt, seen, tapAt, toneNear, zoomAt } from './map';
import { admit, mission, standInKey, type StandIn } from './registry';
import { serveZones } from './zsp';

/**
 * Starcom's Zones on the landing map [docs/design/map.md, Layers and Zones; the owner's map decisions
 * D6, D7 and D10], against the build that deploys, on the phone.
 *
 * **The build ships Starcom's final partition** (vendored 26 Oct): one test asks without a route and
 * reads what the build carries, and one more says what a build without Zones shows. Every other test
 * serves NavCom's own fixture partition by route [./zsp.ts], with its stage set per test.
 *
 * What a person can reach is what is tested: the control, the choice, a tap that opens a Zone, the
 * lookup that answers which Sector the phone is in, and that none of it asks anybody but navcom.app,
 * or fetches anything because of what is on screen or where the phone is.
 */

// Routes must see every request; the worker would answer some from its cache first.
test.use({ serviceWorkers: 'block' });

/** Everything the page asks for over HTTP, by URL. */
function requests(page: Page): string[] {
  const all: string[] = [];
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) all.push(r.url());
  });
  return all;
}

async function landed(page: Page, seed: Parameters<typeof seedDevice>[1] = { __noStorage: true }) {
  await seedDevice(page, seed);
  await open(page, '/');
  await mapReady(page);
}

async function chooseZones(page: Page) {
  await page.getByRole('button', { name: 'Map layers' }).click();
  const screen = page.locator('[data-screen="layers"]');
  await expect(screen).toBeVisible();
  await screen.getByRole('radio', { name: /^Zones/ }).check();
  await expect(page.locator('[data-legend="zones"]')).toBeVisible();
  return screen;
}

test.describe('Starcom’s Zones on the map', () => {
  test('one control away, Nation States until somebody chooses, and nothing of any layer fetched before', async ({ page }) => {
    const all = requests(page);
    await landed(page);
    const control = page.getByRole('button', { name: 'Map layers' });
    await expect(control).toBeVisible();
    const box = (await control.boundingBox())!;
    expect(box.height, 'under the 48px thumb floor').toBeGreaterThanOrEqual(48);
    await control.click();
    await expect(page.locator('[data-screen="layers"]').getByRole('radio', { name: /^Nation States/ })).toBeChecked();
    expect(all.filter((u) => /\/grid\/(zsp\/|timezones|region-times)/.test(u)), 'a layer fetched before it was chosen').toEqual([]);
  });

  test('the Zones this build ships, final, from navcom.app, with their credit', async ({ page }) => {
    test.skip(!SHIPPED, 'this build carries no Zones');
    await landed(page);
    await chooseZones(page);
    // Final: no stage and no "view only" in the key, beside what it counts of the missions.
    await expect(page.locator('[data-legend="zones"]')).toHaveText(/^Zones\. Missions in Zones: \d+/);
    await expect(page.locator('[data-legend="zones"]')).not.toContainText('draft');
    await expect(page.locator('[data-credit]')).toContainText('Zones: Starcom ZSP 2.0, CC BY 4.0');
  });

  test('a build with no Zones says so rather than drawing nothing', async ({ page }) => {
    await page.route('**/grid/zsp/outlines.json', (route) => route.fulfill({ status: 404, body: '' }));
    await landed(page);
    const screen = await chooseZones(page);
    await expect(page.locator('[data-legend="zones"]')).toHaveText('Zones · not in this build yet');
    await expect(screen).toContainText(/not in this build/i);
  });

  test('choosing Zones fetches every outline once, from navcom.app only, and draws them in three weights', async ({ page }) => {
    const all = requests(page);
    const asked = await serveZones(page);
    await landed(page);
    await chooseZones(page);
    await expect(page.locator('[data-credit]')).toHaveText('Zones: NavCom test fixture, never shipped, CC BY 4.0');
    await frame(page);
    expect(asked).toEqual(['outlines.json']);
    const home = new URL(page.url()).origin;
    expect(all.filter((u) => new URL(u).origin !== home), 'asked somebody other than navcom.app').toEqual([]);
    // A container's edge is drawn heaviest, in the muted neutral; a line between two Zones of one container is not.
    // At 48°N, clear of Terra Laurentia's name, which is at its label point on the line between its Zones.
    const container = await screenAt(page, -30, 48);
    const zone = await screenAt(page, -90, 48);
    expect(await toneNear(page, container.x, container.y, 3, '--t-muted'), 'no container edge between Laurentia and Europaea').toBeGreaterThan(0);
    expect(await toneNear(page, zone.x, zone.y, 2, '--t-muted'), 'a Zone’s edge drawn as heavily as a container’s').toBe(0);
  });

  test('panning and zooming across the whole Earth asks for no container’s Sectors', async ({ page }) => {
    const asked = await serveZones(page);
    await landed(page);
    await chooseZones(page);
    await page.locator('[data-back]').click();
    const canvas = page.locator('.grid canvas');
    await canvas.focus();
    for (const key of ['+', '+', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown', '-', '-', '0']) {
      await page.keyboard.press(key);
    }
    await frame(page);
    expect(asked, 'what is on screen fetched a container').toEqual(['outlines.json']);
  });

  test('a tap on a Zone opens it and fetches exactly its container’s Sectors; a tap on a Sector then says where it sits', async ({ page }) => {
    const asked = await serveZones(page);
    await landed(page);
    await chooseZones(page);
    await page.locator('[data-back]').click();
    await tapAt(page, -120, 45, 'Laurentia West');
    const zone = page.locator('[data-screen="zone"][data-zone="zone:laurentia-west"]');
    await expect(zone).toBeVisible();
    await expect(zone.locator('[data-zone-open="zone:laurentia-west/sector:north"]')).toBeVisible();
    expect(asked).toEqual(['outlines.json', 'terra-laurentia.json']);
    await page.locator('[data-back]').click();
    await tapAt(page, -120, 45, 'Laurentia West, north');
    const sector = page.locator('[data-screen="zone"][data-zone="zone:laurentia-west/sector:north"]');
    await expect(sector).toBeVisible();
    await expect(sector.locator('[data-chain]')).toHaveText(/Terra Laurentia\s*›\s*Laurentia West Zone\s*›\s*Laurentia west, north/);
    await expect(sector).toContainText('Montes');
    // Opened once, and nothing else: the second tap was answered from what the first brought.
    expect(asked).toEqual(['outlines.json', 'terra-laurentia.json']);
  });

  test('a draft says so on the map and on every screen, and keeps nothing', async ({ page }) => {
    await serveZones(page, '2');
    await landed(page);
    const screen = await chooseZones(page);
    await expect(page.locator('[data-legend="zones"]')).toContainText('Zones · draft 2, view only');
    await expect(screen.locator('[data-key-full]')).toContainText('draft, stage 2, view only');
    // Seen, with the layers screen holding the sheet at half: the readout is in the map's key, at the top.
    await expect(page.locator('[data-com]')).toHaveAttribute('data-detent', 'half');
    expect(await seen(page.locator('[data-legend="zones"]')), 'the draft label is under the sheet').toBe(true);
    await expect(screen).toContainText(/draft, stage 2/i);
    await screen.locator('[data-zone-open="terra:africana"]').click();
    await page.locator('[data-zone-open="zone:africana-west"]').click();
    await page.locator('[data-zone-open="zone:africana-west/sector:north"]').click();
    const sector = page.locator('[data-screen="zone"][data-zone="zone:africana-west/sector:north"]');
    await expect(sector).toContainText(/not kept in a draft/i);
    await expect(sector.locator('[data-work-keep]')).toHaveCount(0);
  });

  test('which Sector this phone is in is looked up on the phone: the index, whole, and nothing that says where', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 45.25, longitude: -120.25 });
    const all = requests(page);
    const asked = await serveZones(page);
    await landed(page, {});
    const screen = await chooseZones(page);
    await expect(page.locator('[data-credit]')).toContainText('CC BY 4.0');
    const before = all.length;
    await screen.locator('[data-lookup-here]').click();
    const lookup = page.locator('[data-screen="lookup"]');
    await expect(lookup.locator('[data-found="zone:laurentia-west/sector:north"]')).toContainText('Laurentia west, north');
    await expect(lookup.locator('[data-found="zone:laurentia-west/sector:north"]')).toContainText('Terra Laurentia › Laurentia West Zone');
    await expect(lookup).toContainText(/looked up on this phone/i);
    // After the fix: the whole index, and no container chosen by where the phone is.
    const after = all.slice(before).map((u) => new URL(u).pathname).filter((p) => p.startsWith('/grid/'));
    expect(after).toEqual(['/grid/zsp/index.json']);
    expect(asked).not.toContain('terra-laurentia.json');
    expect(all.some((u) => /45\.2|120\.2/.test(u)), 'the position left the phone').toBe(false);

    // Opening what it found fetches nothing either: the Sector is named from the index, its Zone and
    // Terra from the outlines. One tap here used to fetch the container the phone is in (review, 2026-10-19).
    const sector = page.locator('[data-screen="zone"][data-zone="zone:laurentia-west/sector:north"]');
    await lookup.locator('[data-found="zone:laurentia-west/sector:north"] button').first().click();
    await expect(sector.locator('[data-chain]')).toHaveText(/Terra Laurentia\s*›\s*Laurentia West Zone\s*›\s*Laurentia west, north/);
    // What would fetch it is the person's own tap on its Zone, and the screen says what that tells the host.
    await expect(sector.locator('[data-slot="landform"]')).toContainText('tells navcom.app which Terra');
    await frame(page);
    expect(asked, 'opening the Sector the lookup found fetched its container').not.toContain('terra-laurentia.json');
    await page.locator('[data-back]').click();

    // Kept, on this phone, in the tier a panic wipe takes [D7; invariant 5].
    await lookup.locator('[data-work-keep]').click();
    await expect(lookup).toContainText(/where you work/i);
    const tiers = await page.evaluate(() => ({ wipeable: localStorage.getItem('navcom.wipeable') ?? '', accruing: localStorage.getItem('navcom.accruing') ?? '' }));
    expect(tiers.wipeable).toContain('zone:laurentia-west/sector:north');
    expect(tiers.accruing).not.toContain('laurentia');
    await page.locator('[data-back]').click();
    await page.locator('[data-back]').click();
    await page.getByRole('button', { name: 'Map layers' }).click();
    await expect(page.locator('[data-screen="layers"]')).toContainText('Laurentia west, north');
    // And where somebody works opens the same way, every time: from what the phone holds.
    await page.locator('[data-work-open]').click();
    await expect(sector.locator('[data-chain]')).toHaveText(/Terra Laurentia\s*›\s*Laurentia West Zone\s*›\s*Laurentia west, north/);
    await expect(sector).toContainText(/where you work/i);
    await frame(page);
    expect(asked, 'opening where somebody works fetched its container').not.toContain('terra-laurentia.json');
  });

  test('the CC BY credit is shown with the Zones', async ({ page }) => {
    await serveZones(page);
    await landed(page);
    const screen = await chooseZones(page);
    await expect(screen.locator('[data-slot="credit"]')).toContainText('CC BY 4.0');
    await expect(screen.locator('[data-slot="credit"]')).toContainText('NavCom test fixture, never shipped');
  });
});

/*
 * Open missions counted by Zone and by Sector [map.md, Missions on Zones]: missions, never people, from
 * the missions already on the phone, each placed by the point its package gives its subject. One filed
 * only by jurisdiction names no Zone, and is counted apart rather than put in one.
 */
const DESK_KEY = standInKey();
const DESK: StandIn = { id: 'zone-desk', name: 'Zone Desk', agent: true, inbox: ['wss://nos.lol', 'wss://relay.primal.net'], keys: [DESK_KEY] };
/** Inside the missions' campaign window, as the fixtures' dates are. */
const DURING = new Date('2026-10-06T20:00:00Z');
/** A depot in Manitoba, located at its address as a public facility is: in Laurentia West, Sector north, of the fixture. */
const PLACED_D = 'test-zone-depot';
const placed = () =>
  mission(DESK_KEY, PLACED_D, {
    title: 'Water at the depot',
    jurisdiction: 'ca-mb',
    extra: [['geo', 'lat:55,lon:-100'], ['geo_kind', 'subject_location'], ['geo_precision', 'address']]
  });
/** Filed nationally, with no point: in no Zone. */
const FILED_D = 'test-zone-recall';
const filed = () => mission(DESK_KEY, FILED_D, { title: 'Recall check', jurisdiction: 'us' });
/** Laurentia West's label in the fixture, where its count hangs, as the vendoring stamped it. */
const WEST_LABEL = [-120, 30] as const;
const EAST_LABEL = [-60, 30] as const;
/** 0.01° west of the line between the two Laurentian Zones, about 790 m: inside what the drawn lines drift. */
const EDGE_D = 'test-zone-edge';
const onTheEdge = () =>
  mission(DESK_KEY, EDGE_D, {
    title: 'Blankets at the line',
    jurisdiction: 'ca-mb',
    extra: [['geo', 'lat:45,lon:-90.01'], ['geo_kind', 'subject_location'], ['geo_precision', 'address']]
  });
/** Well inside Laurentia East, with nothing near an edge. */
const CLEAR_D = 'test-zone-clear';
const clearOfIt = () =>
  mission(DESK_KEY, CLEAR_D, {
    title: 'Water in the east',
    jurisdiction: 'ca-qc',
    extra: [['geo', 'lat:50,lon:-45'], ['geo_kind', 'subject_location'], ['geo_precision', 'address']]
  });

/** No point, and its package names its Sector in Laurentia East [interchange rev 9]: placed by that name. */
const NAMED_D = 'test-zone-named';
const named = () =>
  mission(DESK_KEY, NAMED_D, {
    title: 'Sandbags along the river',
    jurisdiction: 'ca-qc',
    extra: [['zone_sector', 'zone:laurentia-east/sector:north', 'Laurentia east, north'], ['city', 'Gatineau', 'ca-qc'], ['poi', 'Gatineau river launch']]
  });

async function withMissions(page: Page, seed: Parameters<typeof seedDevice>[1]) {
  await page.clock.setFixedTime(DURING);
  await seedDevice(page, seed);
  await open(page, '/');
  await mapReady(page);
}

test.describe('open missions counted by Zone', () => {
  test.beforeEach(async ({ page }) => void (await admit(page, [DESK])));

  test('a mission placed in Laurentia West is a count of one at its label; the one filed by jurisdiction is counted apart', async ({ page }) => {
    await serveZones(page);
    await withMissions(page, { relayEvents: [placed(), filed()], __noStorage: true });
    await expect(page.locator('[data-missions="open"]')).toContainText('live');
    await chooseZones(page);
    // How many are in a Zone and how many are filed by jurisdiction alone; how old, in the key's missions line.
    await expect(page.locator('[data-legend="zones"]')).toContainText('Missions in Zones: 1 · by jurisdiction: 1');
    await expect(page.locator('[data-missions="open"]')).toContainText('Open missions · live');
    await frame(page);
    // Read where it is once the key has its lines: a taller key moves the opening view.
    const label = await screenAt(page, ...WEST_LABEL);
    expect(label.uncovered, 'Laurentia West’s label should be in view').toBe(true);
    expect(await inkNear(page, label.x, label.y, 8), 'no count at Laurentia West’s label').toBeGreaterThan(20);
    // Laurentia East holds nothing, and has no badge.
    const east = await screenAt(page, -60, 30);
    expect(await inkNear(page, east.x, east.y, 8), 'a badge where nothing is open').toBe(0);
  });

  test('its Zone lists it, as a way to it, and says what it could not place', async ({ page }) => {
    await serveZones(page);
    await withMissions(page, { relayEvents: [placed(), filed()], __noStorage: true });
    await expect(page.locator('[data-missions="open"]')).toContainText('live');
    const screen = await chooseZones(page);
    await screen.locator('[data-zone-open="terra:laurentia"]').click();
    await page.locator('[data-zone-open="zone:laurentia-west"]').click();
    const zone = page.locator('[data-screen="zone"][data-zone="zone:laurentia-west"]');
    await expect(zone.locator('[data-slot="open-missions"]')).toContainText('1 open mission');
    await expect(zone.locator('[data-slot="open-missions"]')).toContainText('live');
    await expect(zone.locator('[data-slot="not-placed"]')).toContainText('1 by jurisdiction only');
    await zone.locator(`[data-zone-mission$="${PLACED_D}"]`).click();
    await expect(page.locator(`[data-screen="mission"][data-mission="${PLACED_D}"]`)).toBeVisible();
    // Laurentia East: nothing open, said in words.
    await page.locator('[data-back]').click();
    await page.locator('[data-back]').click();
    await page.locator('[data-zone-open="zone:laurentia-east"]').click();
    await expect(page.locator('[data-screen="zone"][data-zone="zone:laurentia-east"] [data-slot="open-missions"]')).toContainText('Nothing open');
  });

  test('a mission with no point is counted in the Zone its package names, listed there, and its screen names its places', async ({ page }) => {
    await serveZones(page);
    await withMissions(page, { relayEvents: [named(), filed()], __noStorage: true });
    await expect(page.locator('[data-missions="open"]')).toContainText('live');
    const screen = await chooseZones(page);
    // Placed by its name, so it is in a Zone; the national one is still by jurisdiction alone.
    await expect(page.locator('[data-legend="zones"]')).toContainText('Missions in Zones: 1 · by jurisdiction: 1');
    await frame(page);
    const east = await screenAt(page, ...EAST_LABEL);
    expect(east.uncovered, 'Laurentia East’s label should be in view').toBe(true);
    expect(await inkNear(page, east.x, east.y, 8), 'no count at Laurentia East’s label').toBeGreaterThan(20);
    await screen.locator('[data-zone-open="terra:laurentia"]').click();
    await page.locator('[data-zone-open="zone:laurentia-east"]').click();
    const zone = page.locator('[data-screen="zone"][data-zone="zone:laurentia-east"]');
    await expect(zone.locator('[data-slot="open-missions"]')).toContainText('1 open mission');
    await expect(zone.locator('[data-slot="not-placed"]')).toContainText('1 by jurisdiction only');
    await zone.locator(`[data-zone-mission$="${NAMED_D}"]`).click();
    const page_ = page.locator(`[data-screen="mission"][data-mission="${NAMED_D}"]`);
    await expect(page_.locator('[data-slot="where"]')).toContainText('Gatineau');
    await expect(page_.locator('[data-slot="place"]')).toContainText('Gatineau river launch');
    await expect(page_.locator('[data-slot="sector"]')).toContainText('Laurentia east, north');
  });

  test('a count with a mission near its edge is dashed, where one clear of any edge is solid', async ({ page }) => {
    await serveZones(page);
    await withMissions(page, { relayEvents: [onTheEdge(), clearOfIt()], __noStorage: true });
    await expect(page.locator('[data-missions="open"]')).toContainText('live');
    await chooseZones(page);
    await expect(page.locator('[data-legend="zones"]')).toContainText('Missions in Zones: 2');
    await page.locator('[data-back]').click();
    // In to ×2, where neither count is moved off a mission's ring, which is drawn over everything.
    await zoomAt(page, -90, 30, 2);
    const west = await screenAt(page, ...WEST_LABEL);
    const east = await screenAt(page, ...EAST_LABEL);
    expect(west.uncovered && east.uncovered, 'both labels in view').toBe(true);
    // Both read "1"; the one whose mission the drawn line cannot settle has a broken ring.
    const dashed = await inkNear(page, west.x, west.y, 12);
    const solid = await inkNear(page, east.x, east.y, 12);
    expect(dashed, 'no count at Laurentia West').toBeGreaterThan(20);
    expect(dashed / solid, `west ${dashed} against east ${solid}: the near-edge count is not dashed`).toBeLessThan(0.85);
    // And its Zone's screen names it, and the neighbour it may be in instead.
    const screen = await chooseZones(page);
    await screen.locator('[data-zone-open="terra:laurentia"]').click();
    await page.locator('[data-zone-open="zone:laurentia-west"]').click();
    const zone = page.locator('[data-screen="zone"][data-zone="zone:laurentia-west"]');
    await expect(zone.locator('[data-slot="near-an-edge"]')).toContainText('Blankets at the line: may be in Laurentia East Zone instead');
    // Its container is open now, so its Sectors count too: the Zone still says it, not only the Sector.
    await expect(zone.locator('[data-zone-open="zone:laurentia-west/sector:north"]')).toBeVisible();
    await expect(zone.locator('[data-slot="near-an-edge"]')).toHaveCount(1);
  });

  test('with the relays out of reach, no count is drawn and the key says the missions were not read', async ({ page }) => {
    await serveZones(page);
    // No relay answers: unknown, which is not none.
    await withMissions(page, {});
    await expect(page.locator('[data-missions="unavailable"]')).toBeVisible({ timeout: 15_000 });
    await chooseZones(page);
    await expect(page.locator('[data-legend="zones"]')).toContainText('Missions by Zone · not read yet');
    await frame(page);
    const label = await screenAt(page, ...WEST_LABEL);
    expect(label.uncovered).toBe(true);
    expect(await inkNear(page, label.x, label.y, 8), 'a count drawn from missions nobody read').toBe(0);
  });
});

test.describe('open missions counted by Zone, on a desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
  test.beforeEach(async ({ page }) => void (await admit(page, [DESK])));

  test('a hover over a Zone says how many missions are open in it', async ({ page }) => {
    await serveZones(page);
    await withMissions(page, { relayEvents: [placed(), filed()], __noStorage: true });
    await expect(page.locator('[data-missions="open"]')).toContainText('live');
    await chooseZones(page);
    await expect(page.locator('[data-legend="zones"]')).toContainText('Missions in Zones: 1');
    const west = await screenAt(page, -125, 15);
    await page.mouse.move(west.x, west.y);
    await expect(page.locator('[data-chip]')).toHaveText('Laurentia West Zone · Terra Laurentia · 1 open mission');
    const east = await screenAt(page, -60, 15);
    await page.mouse.move(east.x, east.y);
    await expect(page.locator('[data-chip]')).toHaveText('Laurentia East Zone · Terra Laurentia · Nothing open');
  });

  test('a hover over a Zone says how many of its missions are near an edge', async ({ page }) => {
    await serveZones(page);
    await withMissions(page, { relayEvents: [onTheEdge()], __noStorage: true });
    await expect(page.locator('[data-missions="open"]')).toContainText('live');
    await chooseZones(page);
    await expect(page.locator('[data-legend="zones"]')).toContainText('Missions in Zones: 1');
    const west = await screenAt(page, -125, 15);
    await page.mouse.move(west.x, west.y);
    await expect(page.locator('[data-chip]')).toHaveText('Laurentia West Zone · Terra Laurentia · 1 open mission · 1 near an edge');
  });
});


/** The Zones this build ships, if a stage has been vendored: none is synthetic, so until then there are none. */
const SHIPPED = (() => {
  try {
    return JSON.parse(readFileSync('build/grid/zsp/outlines.json', 'utf8')) as {
      navcom: { containers: { id: string; sectors: number }[] };
      objects: { containers: { geometries: { properties: { id: string; label: [number, number] } }[] } };
    };
  } catch {
    return null;
  }
})();

test.describe('the Zones this build ships, on a phone six times slower', () => {
  test.skip(!SHIPPED, 'no stage of Zones is vendored in this build, and the fixture is too small to measure');

  test('opening the container with the most Sectors and panning over it at ×4: no frame a pan ends on over 100 ms', async ({ page }) => {
    /*
     * Starcom's whole draft (797b8575, measured 26 Oct) was 2,632 Sectors: opening Mare Pacificum's 658
     * was three tasks of 125 to 164 ms, and its edges were stroked once for each ring that had them. Each
     * edge stroked once took that to 87 ms, and a ×4 pan's end to 66.
     */
    const biggest = [...SHIPPED!.navcom.containers].sort((a, b) => b.sectors - a.sectors)[0]!;
    await page.addInitScript(() => {
      const w = window as unknown as { __long: number[]; __rec: boolean };
      w.__long = [];
      w.__rec = false;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (w.__rec) w.__long.push(e.duration);
      }).observe({ type: 'longtask', buffered: false });
    });
    const record = (on: boolean) =>
      page.evaluate((on) => {
        const w = window as unknown as { __long: number[]; __rec: boolean };
        if (on) w.__long = [];
        w.__rec = on;
        return w.__long;
      }, on);
    await landed(page);
    await chooseZones(page);
    await page.locator('[data-back]').click();
    const [lon, lat] = SHIPPED!.objects.containers.geometries.find((g) => g.properties.id === biggest.id)!.properties.label;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    await page.waitForTimeout(500);
    const file = page.waitForResponse((r) => /\/grid\/zsp\/[a-z-]+\.json$/.test(r.url()) && !r.url().endsWith('outlines.json'));
    await record(true);
    await tapAt(page, lon, lat, biggest.id);
    await file;
    await frame(page);
    const opening = await record(false);
    await page.locator('[data-back]').click();
    await zoomAt(page, lon, lat, 4);
    await page.waitForTimeout(400);
    await frame(page);
    const box = (await page.locator('.grid canvas').boundingBox())!;
    const keyFoot = (await page.locator('.nav-key').boundingBox())!;
    const sheet = (await page.locator('[data-com]').boundingBox())!;
    const [x, y] = [box.x + box.width / 2 - 60, (keyFoot.y + keyFoot.height + sheet.y) / 2];
    await record(true);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    for (let i = 1; i <= 20; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 10 * i, y: y - 2 * i, id: 1 }] });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))));
    await page.waitForTimeout(200);
    const panned = await record(false);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const all = [...opening, ...panned];
    expect(Math.max(0, ...all), `long tasks opening ${biggest.id}: ${opening.map(Math.round).join(', ')} | the pan and its end: ${panned.map(Math.round).join(', ')} ms`).toBeLessThanOrEqual(100);
  });
});
