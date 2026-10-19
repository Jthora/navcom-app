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
