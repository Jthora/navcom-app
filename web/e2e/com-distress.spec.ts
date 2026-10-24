import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { COM_ENTRIES } from '../scripts/lib/budget.mjs';
import { chunkOf, open, seedDevice } from './device';
import { mapReady, screenAt, tap, tapAt, zoomAt } from './map';
import { serveHazards, serveNws } from './hazards';
import { admit, resign, standInKey, type StandIn } from './registry';
import { serveSpheres } from './spheres';
import { serveZones } from './zsp';

/**
 * `Distress` on the landing page, with every screen Com can show, at every height of the sheet.
 *
 * com.md §4 puts Distress in a layer of its own that no sheet, map, detail or modal may cover, and
 * asks for "the test that `panicWipe` lacked: not that the component renders, but that the control
 * is reachable from every screen with the sheet at every detent". Until this file it was checked at
 * three heights with no screen open, and on one mission screen at one height.
 *
 * **The screens come from the code, not from a list kept here.** Com's screens are the members of
 * its `Screen` union in Com's registry, and this file reads them out of the source. A screen added
 * there without a way in here fails, by name, before it can ship unchecked; a way in here for a
 * screen that no longer exists fails too. If the union moves, point `SCREENS_SOURCE` at wherever it
 * went: the parse below refuses to find nothing. **So do the entries:** each one in `COM_ENTRIES`
 * (`scripts/lib/budget.mjs`, which `budget.test.ts` holds to the registry's own imports) has its
 * chunk aborted here, and an entry with no way in to one of its screens fails by name.
 *
 * Beside them, every state the sheet can be in that is no screen's own: Com's code arriving or
 * not, an entry's arriving, a screen another version left in history, and one that threw.
 *
 * Opened the way a person opens them, by tapping, against the build that deploys.
 *
 * Not modelled: the on-screen keyboard. `setViewportSize` is not what Chrome's keyboard does (it
 * shrinks the visual viewport only), so a focused field is a device check, not a claim made here.
 */

/**
 * With no service worker. The worker precaches every chunk and claims the page as soon as it
 * activates, and a route here does not see its requests: the way in that aborts the screens' code
 * raced it and, under load, opened the screens from the worker's cache instead. What is checked
 * here is layout, which no cache changes.
 */
test.use({ serviceWorkers: 'block' });

/** Where Com declares its screens: its registry, which the landing page itself no longer reads. */
const SCREENS_SOURCE = new URL('../src/lib/com/screens.ts', import.meta.url);

/** The `kind` of every member of Com's `Screen` union, in the order the source declares them. */
function comScreens(): string[] {
  const source = readFileSync(SCREENS_SOURCE, 'utf8');
  const union = /type Screen =\s*((?:\|\s*\{[^{}]*\}\s*)+);/.exec(source);
  const kinds = union ? [...union[1]!.matchAll(/kind:\s*'([^']+)'/g)].map((m) => m[1]!) : [];
  if (kinds.length === 0) {
    throw new Error(
      `No \`type Screen =\` union in ${SCREENS_SOURCE.pathname}. Com's screens moved: read them from ` +
        `where they went, so that no screen can skip the Distress check below.`
    );
  }
  return kinds;
}
const KINDS = comScreens();

/**
 * The California heat-relief campaign, signed again by a stand-in publisher added to the served
 * registry [registry.ts]: the real one is under Mecha Jono's frozen key, and cannot be taken.
 */
const HEAT_KEY = standInKey();
const HEAT_DESK: StandIn = { id: 'heat-desk', name: 'Heat Desk', agent: true, inbox: ['wss://nos.lol', 'wss://relay.primal.net'], keys: [HEAT_KEY] };
const HEAT = resign(
  JSON.parse(readFileSync(new URL('../../packages/core/test/fixtures/mission-packages.json', import.meta.url), 'utf8'))[0],
  HEAT_KEY
);
/** The fixtures are real and expire: the clock is fixed inside the campaign. */
const DURING = new Date('2026-10-06T20:00:00Z');
const HEAT_D = 'starcom_mission_package_field-heat_relief-CA-2026-10-02';
const ADDRESS = `30079:${HEAT!.pubkey}:${HEAT_D}`;

/** Somebody with a key on this phone — the only person who has a Distress bar — and a live mission. */
async function signedOnWithHeat(page: Page) {
  await page.clock.setFixedTime(DURING);
  await seedDevice(page, { relayEvents: [HEAT], callsign: 'kestrel' });
  await open(page, '/');
  await expect(page.locator('[data-missions="open"]')).toContainText('Open missions · live', { timeout: 15_000 });
}
async function toMission(page: Page) {
  await signedOnWithHeat(page);
  await page.locator('[data-missions="open"]').click();
  await page.locator(`[data-mission="${HEAT_D}"]`).click();
  await expect(page.locator(`[data-screen="mission"][data-mission="${HEAT_D}"]`)).toBeVisible();
}

interface WayIn {
  /** Which state of the screen, when one screen has several worth checking. */
  name: string;
  /** Gets the phone there by tapping, and returns what must still be showing while the sheet moves. */
  go: (page: Page) => Promise<Locator>;
}

/**
 * One way in to each screen Com declares, keyed by its `kind`.
 *
 * Typed loosely on purpose: a typo'd or stale key is caught by the coverage test below, against
 * the source, rather than by a type the union has to be exported for.
 */
const WAYS_IN: Record<string, WayIn[]> = {
  missions: [
    {
      name: 'the list',
      go: async (page) => {
        await signedOnWithHeat(page);
        await page.locator('[data-missions="open"]').click();
        return page.locator('[data-screen="missions"]');
      }
    },
  ],
  mission: [
    {
      name: 'an open mission',
      go: async (page) => {
        await toMission(page);
        return page.locator(`[data-screen="mission"][data-mission="${HEAT_D}"]`);
      }
    },
    {
      // Its weather warnings read, below it: what the tap shows must not reach Distress either.
      name: 'an open mission, with its NWS warnings read',
      go: async (page) => {
        await serveNws(page);
        await toMission(page);
        const screen = page.locator(`[data-screen="mission"][data-mission="${HEAT_D}"]`);
        await screen.locator('[data-nws-check]').click();
        await expect(screen.locator('[data-nws-warnings] li')).toHaveCount(3);
        return screen;
      }
    },
    {
      // The mission somebody left to sign on, back on a phone with no signal: not yet known, not gone.
      name: 'one this phone cannot read yet',
      go: async (page) => {
        await seedDevice(page, { callsign: 'kestrel' });
        await page.addInitScript((address) => sessionStorage.setItem('navcom.pending-mission', address), ADDRESS);
        await open(page, '/');
        const screen = page.locator('.com-screen');
        await expect(screen).toContainText(/loading|unknown/i, { timeout: 15_000 });
        return screen;
      }
    }
  ],
  yours: [
    {
      name: 'your missions',
      go: async (page) => {
        await signedOnWithHeat(page);
        await page.locator('[data-yours]').click();
        return page.locator('[data-screen="yours"]');
      }
    }
  ],
  reports: [
    {
      name: 'a mission’s reports',
      go: async (page) => {
        await toMission(page);
        await page.locator('[data-reports]').click();
        return page.locator('[data-screen="reports"]');
      }
    }
  ],
  place: [
    {
      // A country no region is in, tapped on the map: a place, with nothing open there.
      name: 'a country tapped on the map',
      go: async (page) => {
        await signedOnWithHeat(page);
        await mapReady(page);
        await tapAt(page, 36.82, -1.29, 'Nairobi');
        return page.locator('[data-screen="place"][data-place="ke"]');
      }
    },
    {
      name: 'a region’s circle, with Places on',
      go: async (page) => {
        await signedOnWithHeat(page);
        await mapReady(page);
        const arrived = page.waitForResponse((r) => r.url().endsWith('/grid/places.json'));
        await page.getByRole('button', { name: 'Places' }).click();
        await arrived;
        const b = await page.evaluate(async () => {
          const j = (await (await fetch('/console-regions.json')).json()) as { centroids: { region: string; lat: number; lon: number }[] };
          return j.centroids.find((c) => c.region === 'birmingham-uk')!;
        });
        await zoomAt(page, b.lon, b.lat, 16);
        const at = await screenAt(page, b.lon, b.lat);
        expect(at.uncovered, 'Birmingham should be on screen and uncovered').toBe(true);
        await tap(page, at.x, at.y);
        return page.locator('[data-screen="place"][data-place="birmingham-uk"]');
      }
    }
  ],
  layers: [
    {
      name: 'the map’s layers',
      go: async (page) => {
        await signedOnWithHeat(page);
        await mapReady(page);
        await page.getByRole('button', { name: 'Map layers' }).click();
        return page.locator('[data-screen="layers"]');
      }
    },
    {
      // The overlays' own key goes under the map's: it must not push anything over Distress either.
      name: 'the map’s layers, with day and night and the directory by last check ticked',
      go: async (page) => {
        await signedOnWithHeat(page);
        await mapReady(page);
        await page.getByRole('button', { name: 'Map layers' }).click();
        const screen = page.locator('[data-screen="layers"]');
        await screen.locator('[data-daylight]').check();
        await screen.locator('[data-ages]').check();
        await expect(page.locator('[data-swatches]')).toBeVisible();
        return screen;
      }
    },
    {
      // Hazards ticked: its disclosure and a row per feed, one of them failed, make the screen taller.
      name: 'the map’s layers, with Hazards ticked and one feed failed',
      go: async (page) => {
        await serveHazards(page, { fail: ['gdacs'] });
        await signedOnWithHeat(page);
        await mapReady(page);
        await page.getByRole('button', { name: 'Map layers' }).click();
        const screen = page.locator('[data-screen="layers"]');
        await screen.locator('[data-hazards]').check();
        await expect(screen.locator('[data-hazards-feeds] [data-hazard-feed]')).toHaveCount(3);
        await expect(screen.locator('[data-hazard-feed="gdacs"]')).toContainText('not read: unknown · the ask failed');
        await expect(screen.locator('[data-hazard-feed="usgs"]')).toContainText('listed');
        return screen;
      }
    }
  ],
  zone: [
    {
      // NavCom's fixture partition by route: the build has no Zones before Stage 1 [./zsp.ts].
      name: 'a Zone tapped on the map, with Zones drawn and its Sectors open',
      go: async (page) => {
        await serveZones(page);
        await signedOnWithHeat(page);
        await mapReady(page);
        await page.getByRole('button', { name: 'Map layers' }).click();
        await page.locator('[data-screen="layers"]').getByRole('radio', { name: /^Zones/ }).check();
        await expect(page.locator('[data-credit]')).toContainText('CC BY 4.0');
        await page.locator('[data-back]').click();
        // Clear of lit California's 12 px, which answers first in every layer [map.md §8].
        await tapAt(page, -100, 55, 'Laurentia West');
        const zone = page.locator('[data-screen="zone"][data-zone="zone:laurentia-west"]');
        await expect(zone.locator('[data-zone-open="zone:laurentia-west/sector:north"]')).toBeVisible();
        return zone;
      }
    }
  ],
  lookup: [
    {
      name: 'which Sector this phone is in',
      go: async (page) => {
        await page.context().grantPermissions(['geolocation']);
        await page.context().setGeolocation({ latitude: 45.25, longitude: -120.25 });
        await serveZones(page);
        await signedOnWithHeat(page);
        await mapReady(page);
        await page.getByRole('button', { name: 'Map layers' }).click();
        await page.locator('[data-screen="layers"]').getByRole('radio', { name: /^Zones/ }).check();
        await page.locator('[data-lookup-here]').click();
        const lookup = page.locator('[data-screen="lookup"]');
        await expect(lookup.locator('[data-found]').first()).toBeVisible();
        return lookup;
      }
    }
  ],
  sphere: [
    {
      // NavCom's fixture lists by route: the build has no Spheres before they are vendored [./spheres.ts].
      name: 'a Sphere opened from the layers, picked out on the map',
      go: async (page) => {
        await serveSpheres(page);
        await signedOnWithHeat(page);
        await mapReady(page);
        await page.getByRole('button', { name: 'Map layers' }).click();
        await page.locator('[data-screen="layers"]').getByRole('radio', { name: /^Spheres/ }).check();
        await expect(page.locator('[data-legend="spheres"]')).toContainText('draft lists');
        await page.locator('[data-sphere-open="sphere:test-anglosphere"]').click();
        const sphere = page.locator('[data-screen="sphere"][data-sphere="sphere:test-anglosphere"]');
        await expect(sphere.locator('[data-sphere-member]')).toHaveCount(8);
        return sphere;
      }
    }
  ],
  hazard: [
    {
      // The feeds by route, from recorded fixtures: no test asks the live services [./hazards.ts].
      name: 'a hazard tapped on the map, with Hazards on',
      go: async (page) => {
        await serveHazards(page);
        await signedOnWithHeat(page);
        await mapReady(page);
        await page.getByRole('button', { name: 'Map layers' }).click();
        await page.locator('[data-screen="layers"] [data-hazards]').check();
        await expect(page.locator('[data-legend]')).toContainText('3 feeds just now');
        await page.locator('[data-back]').click();
        await tapAt(page, -71.378, -36.868, 'the Chillán volcano');
        const screen = page.locator('[data-screen="hazard"]');
        await expect(screen.locator('[data-hazard-title]').first()).toHaveText('Nevados del Chillan Volcano, Chile');
        return screen;
      }
    }
  ],
  time: [
    {
      name: 'a time zone tapped on the map',
      go: async (page) => {
        await signedOnWithHeat(page);
        await mapReady(page);
        await page.getByRole('button', { name: 'Map layers' }).click();
        const arrived = page.waitForResponse((r) => r.url().endsWith('/grid/timezones.json'));
        await page.locator('[data-screen="layers"]').getByRole('radio', { name: /^Time zones/ }).check();
        await arrived;
        await page.locator('[data-back]').click();
        await tapAt(page, 36.82, -1.29, 'Nairobi');
        return page.locator('[data-screen="time"]');
      }
    }
  ],
  report: [
    {
      name: 'reporting the work',
      go: async (page) => {
        await toMission(page);
        await page.getByRole('button', { name: 'Take part' }).click();
        // The choices ignore a tap in their first 400 ms, which belongs to the gesture that opened them.
        await page.waitForTimeout(450);
        await page.locator('[data-visibility="open"]').click();
        await expect(page.locator('[data-slot="you"]')).toContainText('Taking part');
        await page.locator('[data-back]').click();
        await page.locator('[data-back]').click();
        await page.locator('[data-yours]').click();
        await page.locator(`[data-report-mission="${HEAT_D}"]`).click();
        return page.locator(`[data-screen="report"][data-mission="${HEAT_D}"]`);
      }
    }
  ]
};

/**
 * How to open one screen of each Com entry, for the state where that entry's code did not arrive:
 * every screen of an entry comes through its one chunk, so that failure is a state of all of them.
 * The chunk itself is aborted below, from `COM_ENTRIES`. Typed loosely, like `WAYS_IN`, and checked
 * against `COM_ENTRIES` instead.
 */
const OPEN_ONE_OF: Record<string, (page: Page) => Promise<void>> = {
  missions: async (page) => {
    await signedOnWithHeat(page);
    await page.locator('[data-missions="open"]').click();
  },
  layers: async (page) => {
    await signedOnWithHeat(page);
    await mapReady(page);
    await page.getByRole('button', { name: 'Map layers' }).click();
  }
};

/** Answers nothing it matches, ever: code still on its way, for as long as the test looks. */
const holdBack = (page: Page, module: string) => page.route(chunkOf(module), () => {});
const COM_CODE = 'src/lib/components/com/index.ts';

/**
 * States of the sheet that are no screen's own. Every screen of every entry comes through Com's own
 * code, loaded as the page mounts, and then through its entry's; history outlives a build, so Back
 * can land on an entry another version of NavCom wrote; and a screen can throw.
 */
const NOT_A_SCREEN: WayIn[] = [
  {
    name: 'Com’s own code cannot arrive',
    go: async (page) => {
      await page.route(chunkOf(COM_CODE), (r) => r.abort());
      await signedOnWithHeat(page);
      await page.locator('[data-missions="open"]').click();
      return page.locator('[data-screen-failed]');
    }
  },
  {
    name: 'Com’s own code still arriving',
    go: async (page) => {
      await holdBack(page, COM_CODE);
      await page.clock.setFixedTime(DURING);
      await seedDevice(page, { relayEvents: [HEAT], callsign: 'kestrel' });
      // Not `open()`: the load event waits on the code held back, and the page has hydrated without it.
      await page.goto('/', { waitUntil: 'commit' });
      await page.waitForSelector('html[data-hydrated="true"]', { timeout: 15_000 });
      await expect(page.locator('[data-missions="open"]')).toContainText('Open missions · live', { timeout: 15_000 });
      await page.locator('[data-missions="open"]').click();
      return page.locator('.com-screen [data-readout]', { hasText: 'Loading' });
    }
  },
  {
    name: 'an entry’s code still arriving',
    go: async (page) => {
      await holdBack(page, COM_ENTRIES['missions']!);
      await signedOnWithHeat(page);
      await page.locator('[data-missions="open"]').click();
      return page.locator('.com-screen [data-readout]', { hasText: 'Loading' });
    }
  },
  {
    name: 'a screen another version left in history',
    go: async (page) => {
      await signedOnWithHeat(page);
      await page.locator('[data-missions="open"]').click();
      await expect(page.locator('[data-screen="missions"]')).toBeVisible();
      // What a newer build would have pushed here, written into the entry the way SvelteKit keeps it.
      await page.evaluate(() =>
        history.replaceState({ ...history.state, 'sveltekit:states': { com: [{ kind: 'profile', handle: 'h1' }] } }, '')
      );
      await page.locator(`[data-mission="${HEAT_D}"]`).click();
      await expect(page.locator('[data-screen="mission"]')).toBeVisible();
      await page.locator('[data-back]').click();
      return page.locator('[data-screen-unknown]');
    }
  },
  {
    // What a host that throws shows, from the boundary around every host [ComScreen].
    name: 'a screen that threw',
    go: async (page) => {
      await signedOnWithHeat(page);
      await page.locator('[data-missions="open"]').click();
      await expect(page.locator('[data-screen="missions"]')).toBeVisible();
      /*
       * A province no build has, and its place name made to throw: nothing but this test reads it,
       * and no screen this version opens reaches the boundary on its own. A province that was not
       * text did, until `readScreen` checked it.
       */
      await page.evaluate(() => {
        const upper = String.prototype.toUpperCase;
        String.prototype.toUpperCase = function (this: string) {
          if (String(this) === 'xx-throws') throw new Error('a screen that throws, on purpose');
          return upper.call(this);
        };
        history.replaceState({ ...history.state, 'sveltekit:states': { com: [{ kind: 'missions', province: 'xx-throws' }] } }, '');
      });
      await page.locator(`[data-mission="${HEAT_D}"]`).click();
      await expect(page.locator('[data-screen="mission"]')).toBeVisible();
      await page.locator('[data-back]').click();
      return page.locator('[data-screen-failed]', { hasText: 'This screen could not be shown' });
    }
  }
];

const DETENTS = ['peek', 'half', 'full'] as const;
const detentOf = (page: Page) => page.locator('[data-com]').getAttribute('data-detent');
/** One tap on the handle moves one step: peek → half → full → peek. */
async function setDetent(page: Page, want: (typeof DETENTS)[number]) {
  for (let i = 0; i < 3 && (await detentOf(page)) !== want; i++) await page.locator('.grab').click();
  await expect(page.locator('[data-com]')).toHaveAttribute('data-detent', want);
}

/**
 * The control a person would reach for, by what it says rather than how it is styled: the Distress
 * link and nothing else that merely mentions Distress.
 */
const distressOf = (page: Page) => page.getByRole('link', { name: /^distress$/i });

/** On screen whole, at the thumb floor, and the thing a tap at its centre lands on. */
async function expectReachable(page: Page, where: string) {
  const distress = distressOf(page);
  await expect(distress, `${where}: one Distress control`).toHaveCount(1);
  await expect(distress, where).toBeVisible();
  await expect(distress, `${where}: not wholly on screen`).toBeInViewport({ ratio: 1 });
  const box = await distress.boundingBox();
  expect(box!.height, `${where}: under the 48px thumb floor`).toBeGreaterThanOrEqual(48);
  const onTop = await distress.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit === el || el.contains(hit);
  });
  expect(onTop, `${where}: something covers Distress`).toBe(true);
}

test('every screen Com declares has a way in here, and nothing here names a screen it no longer has', () => {
  // The positive control for everything below: without it, a new screen is simply not looped over.
  expect(Object.keys(WAYS_IN).sort(), `Com declares: ${KINDS.join(', ')}`).toEqual([...KINDS].sort());
  for (const kind of KINDS) expect(WAYS_IN[kind]?.length ?? 0, `no way in to '${kind}'`).toBeGreaterThan(0);
});

test('every entry Com loads has a way in here for when its code cannot arrive, and none it no longer loads', () => {
  const entries = Object.keys(COM_ENTRIES);
  expect(entries.length, 'COM_ENTRIES is empty: Com loads its entries from somewhere else now').toBeGreaterThan(0);
  expect(Object.keys(OPEN_ONE_OF).sort(), `Com loads: ${entries.join(', ')}`).toEqual([...entries].sort());
});

/**
 * The floor the project claims (an iPhone SE's 375×667, where Distress was once 220px below the
 * fold — distress-reachable.spec.ts) and the phone every other test here runs on.
 */
const PHONES = [
  { name: 'Pixel 5', viewport: null },
  { name: 'iPhone SE 4.7"', viewport: { width: 375, height: 667 } }
] as const;

for (const phone of PHONES) {
  test.describe(`Distress over Com — ${phone.name}`, () => {
    if (phone.viewport) test.use({ viewport: phone.viewport });
    test.beforeEach(async ({ page }) => void (await admit(page, [HEAT_DESK])));

    test('Com’s root, signed on: at every height, and nothing covers it', async ({ page }) => {
      // The test panicWipe never had [verification.md]: not that the control renders, but that a
      // person can reach it whatever state the interface is in [com.md §4, invariant 2].
      await signedOnWithHeat(page);
      await expect(page.locator('[data-yours]')).toBeVisible();
      for (const detent of DETENTS) {
        await setDetent(page, detent);
        await expectReachable(page, `the root at ${detent}`);
      }
    });

    for (const way of NOT_A_SCREEN) {
      test(`${way.name}: at every height, and nothing covers it`, async ({ page }) => {
        const state = await way.go(page);
        await expect(state, 'the state under test did not show').toBeVisible();
        for (const detent of DETENTS) {
          await setDetent(page, detent);
          await expect(state, `${detent}: the state under test went away`).toBeVisible();
          await expectReachable(page, `${way.name} at ${detent}`);
        }
      });
    }

    for (const [entry, module] of Object.entries(COM_ENTRIES)) {
      test(`the ${entry} entry, when its code cannot arrive: at every height, and nothing covers it`, async ({ page }) => {
        const openOne = OPEN_ONE_OF[entry];
        if (!openOne) throw new Error(`Com loads a '${entry}' entry and nothing here opens one of its screens: add it to OPEN_ONE_OF.`);
        await page.route(chunkOf(module), (r) => r.abort());
        await openOne(page);
        const state = page.locator('[data-screen-failed]');
        await expect(state, 'the entry’s failure did not show').toContainText('Not loaded');
        for (const detent of DETENTS) {
          await setDetent(page, detent);
          await expect(state, `${detent}: the state under test went away`).toBeVisible();
          await expectReachable(page, `${entry} failed at ${detent}`);
        }
      });
    }

    for (const kind of KINDS) {
      const ways = WAYS_IN[kind] ?? [];
      if (ways.length === 0) {
        test(`${kind}: at every height`, () => {
          throw new Error(`Com declares a '${kind}' screen and nothing here opens it: add a way in to WAYS_IN.`);
        });
        continue;
      }
      for (const way of ways) {
        test(`${kind}, ${way.name}: at every height, and nothing covers it`, async ({ page }) => {
          const screen = await way.go(page);
          await expect(screen, 'the screen under test did not open').toBeVisible();
          for (const detent of DETENTS) {
            await setDetent(page, detent);
            // Checked with the screen still showing, or this would test the root again.
            await expect(screen, `${detent}: the screen under test closed`).toBeVisible();
            await expectReachable(page, `${kind} at ${detent}`);
          }
        });
      }
    }
  });
}
