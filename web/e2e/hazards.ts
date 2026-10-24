import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { HAZARD_FEEDS, NWS } from '../src/lib/outside';

/**
 * The three hazard feeds and the NWS for a browser test, by route, from recorded fixtures in the
 * shapes measured on 2026-10-19 (`fixtures/hazards/`). **No test asks the live services**: a test
 * that can fail because a stranger's server is slow is not a test, and every request a test makes
 * to them would be one more visitor they never had.
 *
 * Fulfilled with `access-control-allow-origin: *`, which every one of them sends, and the content type
 * each sends, EONET's `application/rss+xml` for what is JSON among them, so the page reads the answer
 * exactly as it would read theirs.
 *
 * Returns every URL the page asked of those hosts, in order. `fail` aborts a feed's requests, as a
 * phone with no route to it would see; `empty` answers each feed with nothing listed; `hold` answers
 * nothing at all, as a request still on its way; `bodies` answers a URL with a body of the test's own.
 */
const FIXTURES = new URL('./fixtures/hazards/', import.meta.url);
const fixture = (name: string) => readFileSync(new URL(`${name}.json`, FIXTURES), 'utf8');
/** A recorded answer, parsed, for a test that changes it before serving it [`bodies`]. */
export const hazardFixture = (name: string): unknown => JSON.parse(fixture(name));

/** Which fixture answers each URL the overlay asks, by feed. */
const ANSWERS: Record<string, string> = {
  [HAZARD_FEEDS[0]!.urls[0]!]: 'usgs-45',
  [HAZARD_FEEDS[0]!.urls[1]!]: 'usgs-sig',
  [HAZARD_FEEDS[1]!.urls[0]!]: 'eonet-open',
  [HAZARD_FEEDS[1]!.urls[1]!]: 'eonet-fires',
  [HAZARD_FEEDS[2]!.urls[0]!]: 'gdacs-search'
};
const EMPTY: Record<string, string> = { usgs: 'usgs-empty', eonet: 'eonet-empty', gdacs: 'gdacs-empty' };

export const HAZARD_HOSTS = HAZARD_FEEDS.map((f) => f.host);
/** As measured on 2026-10-19: EONET labels its JSON as RSS. */
const TYPES: Record<string, string> = { eonet: 'application/rss+xml; charset=utf-8' };

export async function serveHazards(
  page: Page,
  o: { fail?: readonly string[]; empty?: boolean; hold?: readonly string[]; bodies?: Readonly<Record<string, string>> } = {}
): Promise<string[]> {
  const asked: string[] = [];
  for (const feed of HAZARD_FEEDS) {
    await page.route(`https://${feed.host}/**`, async (route) => {
      const url = route.request().url();
      asked.push(url);
      if (o.hold?.includes(feed.id)) return;
      if (o.fail?.includes(feed.id)) return route.abort('failed');
      const name = o.empty ? EMPTY[feed.id] : ANSWERS[url];
      const own = o.bodies?.[url];
      // A URL the overlay should never ask: answered 404, and the test reading `asked` says so.
      if (!name && own === undefined) return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' });
      return route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': '*', 'content-type': TYPES[feed.id] ?? 'application/json; charset=utf-8' },
        body: own ?? fixture(name!)
      });
    });
  }
  return asked;
}

/** The NWS's answer for an area, from `fixtures/hazards/nws-<area>.json`, or a failure. */
export async function serveNws(page: Page, o: { fail?: boolean; empty?: boolean } = {}): Promise<string[]> {
  const asked: string[] = [];
  await page.route(`https://${NWS.host}/**`, async (route) => {
    asked.push(route.request().url());
    if (o.fail) return route.abort('failed');
    const area = new URL(route.request().url()).searchParams.get('area')?.toLowerCase();
    let body: string;
    try {
      body = fixture(o.empty ? 'nws-empty' : `nws-${area}`);
    } catch {
      body = fixture('nws-empty');
    }
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/geo+json' }, body });
  });
  return asked;
}

/**
 * A fire season, for the tests of what the map does under one: **synthetic, made here, never served to
 * anybody but a test**, in the shapes the recorded answers have. 420 wildfires across the US West in
 * the last 20 days, below the 1,340 that map.md cites for the 30 days to 15 August 2024, and 70
 * earthquakes round the Pacific. Deterministic, so a failure is the same failure on every run.
 * Answers EONET's wildfires and USGS's past day; pass it as `bodies` to `serveHazards`.
 */
export function busySeason(now = Date.now()): Record<string, string> {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const fires = Array.from({ length: 420 }, (_, i) => ({
    id: `EONET_F${i}`,
    title: `Fixture fire ${i}, synthetic`,
    description: null,
    link: `https://eonet.gsfc.nasa.gov/api/v3/events/EONET_F${i}`,
    closed: null,
    categories: [{ id: 'wildfires', title: 'Wildfires' }],
    sources: [{ id: 'IRWIN', url: 'https://irwin.doi.gov/observer/incidents/fixture' }],
    geometry: [{ magnitudeValue: 100 + i, magnitudeUnit: 'acres', date: new Date(now - rnd() * 20 * 86_400_000).toISOString(), type: 'Point', coordinates: [-124 + rnd() * 20, 32 + rnd() * 16] }]
  }));
  const quakes = Array.from({ length: 70 }, (_, i) => {
    const east = rnd() < 0.5;
    const lon = east ? 120 + rnd() * 30 : -180 + rnd() * 110;
    const lat = east ? -10 + rnd() * 50 : -40 + rnd() * 100;
    const mag = Math.round((4.5 + rnd() * 2) * 10) / 10;
    return {
      type: 'Feature',
      properties: { mag, place: `synthetic ${i}`, time: now - rnd() * 86_400_000, updated: now, url: 'https://earthquake.usgs.gov/earthquakes/eventpage/fixture', alert: null, title: `M ${mag} - synthetic quake ${i}`, magType: 'mb', type: 'earthquake' },
      geometry: { type: 'Point', coordinates: [lon, lat, 10] },
      id: `synth${i}`
    };
  });
  return {
    [HAZARD_FEEDS[1]!.urls[1]!]: JSON.stringify({ title: 'EONET Events', description: 'Natural events from EONET.', link: 'https://eonet.gsfc.nasa.gov/api/v3/events', events: fires }),
    [HAZARD_FEEDS[0]!.urls[0]!]: JSON.stringify({ type: 'FeatureCollection', metadata: { generated: now, title: 'USGS Magnitude 4.5+ Earthquakes, Past Day', status: 200, count: quakes.length }, features: quakes })
  };
}
