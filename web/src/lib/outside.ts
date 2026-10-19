/**
 * Everything the landing page asks of anybody outside navcom.app and the relays, in one list
 * [docs/product/what-leaves.md, What it asks anyone else, only when you choose].
 *
 * Two things, and each only when a person chooses it. **Hazards**, on the map's layers screen: three
 * public feeds' whole-world lists, never anything chosen by where somebody looks, refreshed at most
 * every 10 minutes and never while the page is hidden [map.md §8, Hazards]. And **weather warnings
 * on a mission**: the US National Weather Service, asked for one state's issued warnings when the
 * person taps, and never otherwise.
 *
 * Every URL here is a constant, or a constant and a two-letter area. Nothing is built from the map's
 * view, its zoom, a tap or this phone's position, and `src/lib/boundaries.test.ts` holds that. The
 * hosts are the ones the root's `Content-Security-Policy` lets the page connect to (`vercel.json`), the
 * landing page's "talks to nobody" test allows by name once Hazards is chosen, and what-leaves.md
 * lists; `src/lib/outside.test.ts` holds all four to each other.
 *
 * A request carries this phone's internet address, which can place it roughly, often to a city; the
 * time; its browser's User-Agent; and an `Origin: https://navcom.app` that no fetch option can take
 * off. It carries no cookie, no referrer and nothing about the map. The service worker passes every
 * request to another origin straight through, so none of it is cached by NavCom.
 */

export type HazardFeedId = 'usgs' | 'eonet' | 'gdacs';

export interface HazardFeed {
  id: HazardFeedId;
  /** What the map's key and the screens call it. */
  name: 'USGS' | 'EONET' | 'GDACS';
  host: string;
  /** Asked together each round, whole-world, as written: never with a box, a point or a limit. */
  urls: readonly string[];
  /**
   * What each of `urls` lists, in the same order, as the key says it when that one alone did not
   * answer: *EONET just now, wildfires not read: unknown*. Each is read on its own, so one past its
   * cap does not take the others with it.
   */
  parts: readonly string[];
  /** Who to credit, by name, wherever a mark of theirs is shown. */
  credit: string;
  /** What it lists, as the layers screen says it before anybody turns Hazards on. */
  lists: string;
  /**
   * What the time it gives means, since each source's means something else, so an age is never read
   * as the event's own: `chip` before the age in a hover, `slot` as the hazard screen's key, `what`
   * under the time as given.
   */
  time: { chip: string; slot: string; what: string };
}

/**
 * The three feeds, and the variant of each that the device floor can carry [budget.mjs MAP_LINES
 * `hazards`, measured 2026-10-19, one GET of each URL here].
 *
 * - **USGS**: the past day's M4.5+ and its significant list, merged by id. `all_day` is every small
 *   quake on Earth and is not asked.
 * - **EONET**: two asks. Its whole open list was 4.88 MB, sent uncompressed, 7,148 of it wildfires
 *   whose median last report was two years old: about 49 s at the device floor's 0.8 Mbps. Volcanoes
 *   and severe storms are asked whole; wildfires only for the last 30 days, since `days` would also
 *   drop volcanoes, whose dates are eruption starts back to 2002. Both were fetched as written: both
 *   categories came back, and `days=30` kept the 31 fires dated in those 30 days. **That was October.**
 *   In August 2024 the same ask would have held at least 1,340 fires, about 922 kB, past its cap, so
 *   in a busy fire season the wildfires read *not read: unknown* while the volcanoes and storms still draw.
 * - **GDACS**: its `SEARCH` list, unparameterised, measured at 124,555 B. Unasked, it lists only its
 *   **orange and red alerts** (68 and 18 that day, none green, from May 2025 on), and the floods,
 *   droughts and cyclones still current are drawn from it on the phone. Its `MAP` list refused a
 *   request without an event type, and a narrower `SEARCH` is unmeasured, so it waits for a measurement.
 */
export const HAZARD_FEEDS: readonly HazardFeed[] = [
  {
    id: 'usgs',
    name: 'USGS',
    host: 'earthquake.usgs.gov',
    urls: [
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson',
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_day.geojson'
    ],
    parts: ['M4.5 and over', 'significant'],
    credit: 'U.S. Geological Survey, Earthquake Hazards Program; public domain',
    lists: 'earthquakes of the past day',
    time: { chip: 'origin', slot: 'Origin time', what: 'when it occurred' }
  },
  {
    id: 'eonet',
    name: 'EONET',
    host: 'eonet.gsfc.nasa.gov',
    urls: [
      'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=volcanoes,severeStorms',
      'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=wildfires&days=30'
    ],
    parts: ['volcanoes and storms', 'wildfires'],
    credit: 'NASA Earth Observatory Natural Event Tracker (EONET)',
    lists: 'open volcanoes and severe storms, and wildfires of the last 30 days',
    time: { chip: 'latest point', slot: 'Latest point', what: 'its latest point’s date, not the event’s; a volcano’s can be years old' }
  },
  {
    id: 'gdacs',
    name: 'GDACS',
    host: 'www.gdacs.org',
    urls: ['https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH'],
    parts: ['its list'],
    credit: 'GDACS, the Global Disaster Alert and Coordination System of the United Nations and the European Commission',
    lists: 'its orange- and red-alert floods, droughts and cyclones that are still current',
    time: { chip: 'updated', slot: 'Updated', what: 'GDACS’s last change, not the event’s; From and To are its dates' }
  }
];

/** How often Hazards asks again, at most: and only while the map is on screen. */
export const HAZARDS_EVERY = 10 * 60_000;
/**
 * What one round of Hazards costs on the wire, about, as the layers screen says before it is turned on:
 * 195,831 B measured from the live feeds on 2026-10-19, in a quiet month for fires [budget.mjs MAP_LINES
 * `hazards` `remote`, which `budget.test.ts` holds this to].
 */
export const HAZARDS_ROUND_KB = 196;
/**
 * The most a round costs when the wildfires grow past their cap, as in a busy fire season: everything
 * else as measured, and the wildfire answer read as far as its cap and then given up [`remote.peak`].
 */
export const HAZARDS_PEAK_KB = 700;

/** The US National Weather Service, asked for one state's active alerts when a person taps. */
export const NWS = {
  host: 'api.weather.gov',
  /** `CA`, `PR`: the NWS's own two-letter areas. Anything else is refused rather than sent. */
  alertsUrl(area: string): string {
    if (!/^[A-Z]{2}$/.test(area)) throw new Error(`not an NWS area: ${area}`);
    return `https://api.weather.gov/alerts/active?area=${area}`;
  }
};

/** Every host the landing page may ask outside navcom.app and the relays, and only these. */
export const OUTSIDE_HOSTS: readonly string[] = [...HAZARD_FEEDS.map((f) => f.host), NWS.host];

/**
 * The most each answer may be, decoded, before it is dropped and reads *not read: unknown*: a feed
 * that grew without warning must not fill a prepaid phone. Several times what each measured
 * (`MAP_LINES.hazards.remote`, which `budget.test.ts` holds equal to these).
 *
 * **EONET's is held below its own peak, on purpose** (re-derived 2026-10-19). Its wildfire ask was
 * 21,331 B in October, and at August 2024's count at least 1,340 fires, about 922 kB: some 9 s a round
 * at the device floor and 5.5 MB an hour. 512 KiB lets the wildfires grow some 24 times past October's,
 * room for what even 14 days of that August held (about 453 kB), and stops there: a round is then at
 * most about 700 kB (`HAZARDS_PEAK_KB`). Past it, the wildfires read *not read: unknown*, and are not
 * asked again on that page, so a phone does not pay for an answer it drops every 10 minutes.
 */
export const CAPS: Readonly<Record<HazardFeedId | 'nws', number>> = {
  usgs: 1024 * 1024,
  eonet: 512 * 1024,
  gdacs: 512 * 1024,
  nws: 4 * 1024 * 1024
};

/** How long one answer may take before it is given up on. */
export const TIMEOUT_MS = 20_000;

export type Read = { ok: true; json: unknown } | { ok: false; why: 'failed' | 'too-large' };

/**
 * One GET to a host outside navcom.app: no cookie, no referrer, read no further than `cap` decoded
 * bytes, and given up after `TIMEOUT_MS`. Never throws: an answer is JSON, or why there is none.
 */
export async function readOutside(
  url: string,
  cap: number,
  { signal, accept, fetcher = fetch }: { signal?: AbortSignal; accept?: string; fetcher?: typeof fetch } = {}
): Promise<Read> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal?.addEventListener('abort', stop);
  const timer = setTimeout(stop, TIMEOUT_MS);
  // Given up on means given up on, whatever the fetch does with its signal.
  const given = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  given.catch(() => undefined);
  try {
    if (signal?.aborted) return { ok: false, why: 'failed' };
    const response = await Promise.race([
      fetcher(url, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        mode: 'cors',
        signal: controller.signal,
        headers: accept ? { Accept: accept } : undefined
      }),
      given
    ]);
    if (!response.ok) return { ok: false, why: 'failed' };
    const text = await capped(response, cap, controller);
    if (text === null) return { ok: false, why: 'too-large' };
    return { ok: true, json: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, why: 'failed' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

/** The body as text, or null once it passes `cap` decoded bytes, when the rest is not read at all. */
async function capped(response: Response, cap: number, controller: AbortController): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    return new TextEncoder().encode(text).length > cap ? null : text;
  }
  const parts: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > cap) {
      controller.abort();
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** `just now`, `3 min ago`, `2 h ago`, `4 days ago`: how long ago `ms` was by this phone's clock. */
export function agoOf(ms: number, now: number): string {
  const s = Math.floor((now - ms) / 1000);
  if (s < -60) return 'in this phone’s future';
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 730) return `${d} days ago`;
  return `${Math.floor(d / 365)} years ago`;
}

/** `13:20 UTC`: a time this phone read something, to the minute. */
export const utcOf = (ms: number): string => `${new Date(ms).toISOString().slice(11, 16)} UTC`;

/**
 * Only an https URL is a link: a feed's text arrives in navcom.app's origin, where every operator's
 * keys are, and a `javascript:` or `data:` link there would run on one tap [the Spheres rule].
 */
export function linkable(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Text from a feed, as it gave it, but no longer than a screen can carry: cut with a visible `…`. */
export function quoted(value: unknown, max = 500): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
