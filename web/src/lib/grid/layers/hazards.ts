/**
 * Hazards over the map: fires, volcanoes, storms, floods, droughts and earthquakes, from three public
 * feeds, drawn over whichever layer is chosen [docs/design/map.md §8, Hazards].
 *
 * The map line `hazards` in `scripts/lib/budget.mjs`: loaded by `import()` when its box is ticked on
 * the layers screen, and **the only thing on the landing page that asks anybody outside navcom.app and
 * the relays**, which the screen says in plain words before the box is ticked [$lib/outside]. Each
 * feed is asked for its **whole-world list**, as written in `outside.ts`, and never for anything chosen
 * by where somebody looks: a host learns this phone's address, the time and that it asked from
 * navcom.app, and nothing about the map.
 *
 * **When it asks.** Every feed once when turned on; then each again 10 minutes after it was last
 * asked, whether that ask answered or failed, and never sooner; never while the page is hidden, and
 * on coming back into view only what is due. A toggle off and on inside 10 minutes asks nothing:
 * when each feed was last asked outlives the overlay being stopped. Stopped, it keeps no timer and no
 * listener, and gives up whatever was on its way. An answer that passed its cap is not asked again on
 * this page, so a phone does not pay every 10 minutes for an answer it drops.
 *
 * **What it says** [invariant 7]. Each feed's age in the map's key; a feed with no answer, failed or
 * too large, or one that listed entries and could read none of them, *not read: unknown*, never
 * *none*; one of a feed's asks that did not answer, by what it lists, *EONET just now, wildfires not
 * read: unknown*, the others still drawn; and a map on which every feed read and listed nothing, and
 * left nothing out, *not the same as safe*. These lists hold some events, never all.
 *
 * **What it draws.** A mark per event, at the point the source gave, in screen space so it is the same
 * size at every zoom, in the neutrals only: every hue on these screens is a watch state, and a feed's
 * own alert colour is quoted as its word, never drawn. Six kinds, told apart by shape and hatching and
 * never by tone, none of them a circle (the missions' rings, the regions', the sun) or a square or a
 * disc (the directory's ages): an asterisk for an earthquake, a triangle for a wildfire and a hatched
 * one for a volcano, a hexagon for a storm or cyclone, a diamond for a flood and a hatched one for a
 * drought. Marks closer than 11 px share a cell, which draws one of them and how many more; a hover
 * or a tap lists every mark in it.
 *
 * **It is the one overlay that answers a tap**, after the places of record and before a lit shape: a
 * tap opens what it landed on, in Com, with the source's own words, quoted and never paraphrased, and
 * its links, only where they are https [the Spheres rule].
 *
 * Nothing about the people being served is drawn or asked: these are natural events on public
 * record, at the points their sources published [invariant 1].
 */

import { project } from '../topology';
import type { View } from '../pick';
import { layerData, loaded, mapLayers, overlaps, type Box, type Overlay, type Swatch } from '../layer.svelte';
import {
  CAPS,
  HAZARD_FEEDS,
  HAZARDS_EVERY,
  agoOf,
  linkable,
  quoted,
  readOutside,
  type HazardFeed,
  type HazardFeedId
} from '$lib/outside';

export type HazardKind = 'earthquake' | 'wildfire' | 'volcano' | 'storm' | 'flood' | 'drought';

/** One event, as its source gave it, and where the map draws it. */
export interface Hazard {
  /** `usgs:us6000u3ch`, `eonet:EONET_25340`, `gdacs:TC-1001338`. */
  id: string;
  feed: HazardFeedId;
  kind: HazardKind;
  /** What the kind is called on a screen. */
  word: string;
  /** The source's own title, as given. */
  title: string;
  /** The source's own measure: `4.8 mb`, `45 kts`, `751 acres`, or GDACS's severity in its words. */
  measure: string | null;
  /** The source's own alert, quoted: `PAGER alert: green`, `GDACS alert: Red`. Never drawn as a colour. */
  alert: string | null;
  /** When, as the source gives it: what that time means is the feed's own [HazardFeed `time`]. */
  time: string | null;
  /** The same, in ms, for its age; null when it gave none that reads. */
  at: number | null;
  /** More the source said, as given: GDACS's countries and dates, EONET's description. */
  more: { k: string; v: string }[];
  /**
   * An event over an area, which GDACS gives as one point, a flood's or a drought's: drawn dashed and
   * said to be the area's centre, since a mark at a point reads as a place [the audit, 2026-10-19].
   */
  area?: boolean;
  /** A link only where it is https; anything else is its label as text. */
  links: { label: string; url: string | null }[];
  lon: number;
  lat: number;
  /** In map units [topology.ts project]. */
  x: number;
  y: number;
}

/** What one round's answers held, for one feed. */
export interface Parsed {
  marks: Hazard[];
  /** Entries it could not read: no position, no title. */
  dropped: number;
  /** Events given only as an area, which a mark at a point would misplace. */
  notDrawn: number;
  /** Past the per-feed cap, left out. */
  capped: number;
  /** The feed's own time for its list, where it gives one: the older, of two. */
  generated: number | null;
  /** The answer was not the shape it was measured in: nothing of it is drawn. */
  malformed: boolean;
}

/** `unread`: never asked, or stopped before an answer, which is unknown and not none. */
export type FeedStateName = 'unread' | 'loading' | 'ready' | 'failed' | 'too-large';
/** One of a feed's asks that did not answer, by what it lists, while the others did. */
export interface Missing {
  part: string;
  why: 'failed' | 'too-large';
}
export interface FeedState {
  state: FeedStateName;
  /** When this phone read it, in ms. */
  readAt: number | null;
  generated: number | null;
  count: number;
  dropped: number;
  notDrawn: number;
  capped: number;
  malformed: boolean;
  /** Ready, and these of its asks not read: unknown, never none. */
  missing: Missing[];
}

/** What the map and the screens read: every mark, and each feed's state [layer.svelte.ts layerData]. */
export interface HazardsHeld {
  marks: Hazard[];
  feeds: Record<HazardFeedId, FeedState>;
}

/** The most marks one feed may draw: the excess is counted, never silently dropped. */
export const MARK_CAP = 3_000;

const WORDS: Record<HazardKind, string> = {
  earthquake: 'Earthquake',
  wildfire: 'Wildfire',
  volcano: 'Volcano',
  storm: 'Storm or cyclone',
  flood: 'Flood',
  drought: 'Drought'
};
/** Short, for the swatches under the map's key, which share a line: a taller key leaves less room for the Earth. */
const PLURAL: Record<HazardKind, string> = {
  earthquake: 'Quakes',
  wildfire: 'Fires',
  volcano: 'Volcanoes',
  storm: 'Storms',
  flood: 'Floods',
  drought: 'Droughts'
};
/** Which kind a shared cell draws, first first. */
const KIND_ORDER: readonly HazardKind[] = ['storm', 'flood', 'earthquake', 'wildfire', 'volcano', 'drought'];
const SHAPE: Record<HazardKind, Swatch['mark']> = {
  earthquake: 'asterisk',
  wildfire: 'triangle',
  volcano: 'triangle-hatched',
  storm: 'hexagon',
  flood: 'diamond',
  drought: 'diamond-hatched'
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A point the source gave as `[lon, lat, …]`, if it is one on the Earth. */
function pointOf(c: unknown): [number, number] | null {
  if (!Array.isArray(c)) return null;
  const [lon, lat] = [num(c[0]), num(c[1])];
  if (lon === null || lat === null || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  return [lon, lat];
}

/** A time a source gave, in ms. GDACS gives its own with no zone, and is read as UTC; it is shown as given. */
function msOf(time: string | null): number | null {
  if (!time) return null;
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/.test(time) ? time : `${time}Z`;
  const ms = Date.parse(zoned);
  return Number.isFinite(ms) ? ms : null;
}

function blank(): Parsed {
  return { marks: [], dropped: 0, notDrawn: 0, capped: 0, generated: null, malformed: false };
}
const malformed = (): Parsed => ({ ...blank(), malformed: true });
/**
 * A feed that listed entries and could read none of them has not been read: a field renamed, a point
 * given another way, a flag sent as another type. That is *not read: unknown*, never *nothing listed*.
 */
const settled = (out: Parsed): Parsed => (out.marks.length === 0 && out.dropped > 0 ? malformed() : out);

function hazard(h: Omit<Hazard, 'x' | 'y' | 'word'>): Hazard {
  const [x, y] = project(h.lon, h.lat);
  return { ...h, word: WORDS[h.kind], x, y };
}

/** Keeps a feed's marks to the cap, counting the rest. */
function keep(out: Parsed, m: Hazard): void {
  if (out.marks.length >= MARK_CAP) out.capped += 1;
  else out.marks.push(m);
}

/** USGS's two GeoJSON summaries, the past day's M4.5+ and its significant list, merged by id. */
export function usgsOf(answers: readonly unknown[]): Parsed {
  const out = blank();
  const seen = new Set<string>();
  for (const a of answers) if (!isObj(a) || !Array.isArray(a['features'])) return malformed();
  for (const a of answers as Record<string, unknown>[]) {
    const g = isObj(a['metadata']) ? num(a['metadata']['generated']) : null;
    if (g !== null) out.generated = out.generated === null ? g : Math.min(out.generated, g);
    for (const f of a['features'] as unknown[]) {
      const id = isObj(f) && typeof f['id'] === 'string' ? f['id'] : null;
      if (id !== null && seen.has(id)) continue;
      const p = isObj(f) && isObj(f['properties']) ? f['properties'] : null;
      const at = isObj(f) && isObj(f['geometry']) && f['geometry']['type'] === 'Point' ? pointOf(f['geometry']['coordinates']) : null;
      const title = quoted(p?.['title']);
      if (id === null || !p || !at || !title) {
        out.dropped += 1;
        continue;
      }
      seen.add(id);
      const mag = num(p['mag']);
      const type = quoted(p['magType'], 20);
      const ms = num(p['time']);
      const alert = quoted(p['alert'], 20);
      const url = p['url'];
      keep(
        out,
        hazard({
          id: `usgs:${id}`,
          feed: 'usgs',
          kind: 'earthquake',
          title,
          measure: mag === null ? null : type ? `${mag} ${type}` : String(mag),
          alert: alert ? `PAGER alert: ${alert}` : null,
          time: ms === null ? null : new Date(ms).toISOString(),
          at: ms,
          more: [],
          links: typeof url === 'string' ? [{ label: 'USGS event page', url: linkable(url) ? url : null }] : [],
          lon: at[0],
          lat: at[1]
        })
      );
    }
  }
  return settled(out);
}

/** A Map, so a feed's `constructor` or `__proto__` is no kind at all [the same for GDACS's]. */
const EONET_KINDS = new Map<string, HazardKind>([
  ['wildfires', 'wildfire'],
  ['volcanoes', 'volcano'],
  ['severeStorms', 'storm']
]);

/** EONET's open events, each at its latest point, with its units as given. */
export function eonetOf(answers: readonly unknown[]): Parsed {
  const out = blank();
  const seen = new Set<string>();
  for (const a of answers) if (!isObj(a) || !Array.isArray(a['events'])) return malformed();
  for (const a of answers as Record<string, unknown>[]) {
    for (const e of a['events'] as unknown[]) {
      if (!isObj(e) || typeof e['id'] !== 'string' || seen.has(e['id'])) {
        if (!isObj(e) || typeof e['id'] !== 'string') out.dropped += 1;
        continue;
      }
      const category = Array.isArray(e['categories']) && isObj(e['categories'][0]) ? e['categories'][0]['id'] : null;
      const kind = typeof category === 'string' ? EONET_KINDS.get(category) : undefined;
      const title = quoted(e['title']);
      if (!kind || !title) {
        out.dropped += 1;
        continue;
      }
      const geometry = Array.isArray(e['geometry']) ? e['geometry'].filter(isObj) : [];
      const points = geometry
        .filter((g) => g['type'] === 'Point' && pointOf(g['coordinates']))
        .sort((x, y) => String(x['date'] ?? '').localeCompare(String(y['date'] ?? '')));
      const latest = points.at(-1);
      if (!latest) {
        if (geometry.length > 0) out.notDrawn += 1;
        else out.dropped += 1;
        continue;
      }
      seen.add(e['id']);
      const [lon, lat] = pointOf(latest['coordinates'])!;
      const value = num(latest['magnitudeValue']);
      const unit = quoted(latest['magnitudeUnit'], 20);
      const time = quoted(latest['date'], 40);
      const about = quoted(e['description']);
      const sources = Array.isArray(e['sources']) ? e['sources'].filter(isObj) : [];
      keep(
        out,
        hazard({
          id: `eonet:${e['id']}`,
          feed: 'eonet',
          kind,
          title,
          measure: value === null ? null : unit ? `${value} ${unit}` : String(value),
          alert: null,
          time,
          at: msOf(time),
          more: about ? [{ k: 'About', v: about }] : [],
          links: sources.map((s) => ({ label: quoted(s['id'], 80) ?? 'Source', url: linkable(s['url']) ? (s['url'] as string) : null })),
          lon,
          lat
        })
      );
    }
  }
  return settled(out);
}

const GDACS_KINDS = new Map<string, HazardKind>([
  ['FL', 'flood'],
  ['DR', 'drought'],
  ['TC', 'storm']
]);
/** Kinds GDACS lists that USGS and EONET draw here, so one event is not two marks of two shapes. */
const GDACS_ELSEWHERE = new Set(['EQ', 'WF', 'VO']);

/**
 * GDACS's list: its floods, droughts and tropical cyclones that are current, and nothing else. Its
 * list unasked holds only its orange and red alerts [outside.ts]. Earthquakes, fires and volcanoes it
 * also lists are USGS's and EONET's to draw, and an event it says is over is its history, not ours to
 * draw: both left out on purpose. Anything else it lists that cannot be read is counted: a current flag
 * that is neither `true` nor `'true'`, nor `false` nor `'false'`, or a kind nobody here knows. Its alert
 * level is quoted as its word.
 */
export function gdacsOf(answers: readonly unknown[]): Parsed {
  const out = blank();
  const seen = new Set<string>();
  for (const a of answers) if (!isObj(a) || !Array.isArray(a['features'])) return malformed();
  for (const a of answers as Record<string, unknown>[]) {
    for (const f of a['features'] as unknown[]) {
      const p = isObj(f) && isObj(f['properties']) ? f['properties'] : null;
      const type = typeof p?.['eventtype'] === 'string' ? (p['eventtype'] as string) : '';
      const current = p?.['iscurrent'];
      if (current === false || current === 'false') continue;
      if (GDACS_ELSEWHERE.has(type) && (current === true || current === 'true')) continue;
      const kind = GDACS_KINDS.get(type);
      if (!p || !kind || (current !== true && current !== 'true')) {
        out.dropped += 1;
        continue;
      }
      const at = isObj(f) && isObj(f['geometry']) && f['geometry']['type'] === 'Point' ? pointOf(f['geometry']['coordinates']) : null;
      const event = num(p['eventid']);
      const title = quoted(p['name']);
      const id = `gdacs:${type}-${event}`;
      if (!at || event === null || !title) {
        out.dropped += 1;
        continue;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      const level = quoted(p['alertlevel'], 20);
      const severity = isObj(p['severitydata']) ? quoted(p['severitydata']['severitytext']) : null;
      const time = quoted(p['datemodified'], 40);
      const report = isObj(p['url']) ? p['url']['report'] : null;
      const more: { k: string; v: string }[] = [];
      for (const [k, field] of [['Where', 'country'], ['From', 'fromdate'], ['To', 'todate']] as const) {
        const v = quoted(p[field]);
        if (v) more.push({ k, v });
      }
      keep(
        out,
        hazard({
          id,
          feed: 'gdacs',
          kind,
          title,
          measure: severity,
          alert: level ? `GDACS alert: ${level}` : null,
          time,
          at: msOf(time),
          more,
          links: typeof report === 'string' ? [{ label: 'GDACS report', url: linkable(report) ? report : null }] : [],
          lon: at[0],
          lat: at[1],
          area: kind === 'flood' || kind === 'drought'
        })
      );
    }
  }
  return settled(out);
}

const READERS: Record<HazardFeedId, (answers: readonly unknown[]) => Parsed> = { usgs: usgsOf, eonet: eonetOf, gdacs: gdacsOf };
const NAME = Object.fromEntries(HAZARD_FEEDS.map((f) => [f.id, f.name])) as Record<HazardFeedId, string>;
const FEED = Object.fromEntries(HAZARD_FEEDS.map((f) => [f.id, f])) as Record<HazardFeedId, HazardFeed>;

/** `USGS, EONET and GDACS`, or with `or`. */
const listOf = (names: string[], and: 'and' | 'or') => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} ${and} ${names.at(-1)}`);

/** What every line of the key says but *nothing listed*'s: the feeds' lists are not the world's. */
const SOME = 'some events, never all';

/** Nothing listed, read whole, and nothing in it left out: the one state that may say *nothing listed*. */
export const listedNothing = (f: FeedState): boolean =>
  f.state === 'ready' && f.count + f.dropped + f.notDrawn + f.capped === 0 && f.missing.length === 0;

/**
 * The map's key line: each feed's age, *not read: unknown* for a feed with no answer, and, when every
 * feed read and listed nothing, *not the same as safe*. Never *none*, never *0*. Feeds next to each other
 * that say the same are said once, *USGS and EONET 3 min ago*, and all three alike as *3 feeds 3 min
 * ago*, since a longer key leaves less of the Earth above the sheet; the layers screen names them. That
 * these lists hold **some events, never all** stays on the map, whatever else is cut: it is what keeps a
 * place with no mark from reading as a place with no fire.
 */
export function legendOf(feeds: Readonly<Record<HazardFeedId, FeedState>>, now: number): string {
  const ids = HAZARD_FEEDS.map((f) => f.id);
  const states = ids.map((id) => feeds[id]);
  const names = ids.map((id) => NAME[id]);
  if (states.every((s) => s.state === 'loading')) return `Hazards · asking ${ids.length} feeds · ${SOME}`;
  if (states.every(listedNothing)) {
    const oldest = Math.min(...states.map((s) => s.readAt ?? now));
    return `Hazards · nothing listed by ${listOf(names, 'or')}, read ${agoOf(oldest, now)} · not the same as safe`;
  }
  const groups: { said: string; names: string[] }[] = [];
  for (const id of ids) {
    const said = feedSaid(feeds[id], now);
    const last = groups.at(-1);
    if (last && last.said === said) last.names.push(NAME[id]);
    else groups.push({ said, names: [NAME[id]] });
  }
  return `Hazards · ${groups.length === 1 ? `${ids.length} feeds ${groups[0]!.said}` : groups.map((g) => `${listOf(g.names, 'and')} ${g.said}`).join(' · ')} · ${SOME}`;
}

/** One feed's state, as the key and the layers screen say it: an ask of it that did not answer by what it lists. */
export function feedSaid(f: FeedState, now: number): string {
  if (f.state === 'ready' && f.readAt !== null) {
    const age = agoOf(f.readAt, now);
    return f.missing.length === 0 ? age : `${age}, ${listOf(f.missing.map((m) => m.part), 'and')} not read: unknown`;
  }
  if (f.state === 'loading') return 'asking';
  return 'not read: unknown';
}

/** How far apart two marks are kept before they share a cell, and how near a tap must be, in CSS px. */
const GAP = 11;
/**
 * Below this many CSS px to the world's width, about 23 km a pixel and so the whole Earth to about ×4 on
 * a phone, marks gather by kind into cells `WIDE_GAP` px wide, each one glyph and how many on a pill.
 */
const WIDE = 1500;
const WIDE_GAP = 24;
const HIT = 10;
/** How many marks one tap's screen names: history holds it, so it stays small. */
const MAX_IDS = 12;

export interface Cell {
  x: number;
  y: number;
  lead: Hazard;
  members: Hazard[];
}

const screenOf = (m: Hazard, v: View): [number, number] => [(m.x - v.cx) * v.scale + v.width / 2, (m.y - v.cy) * v.scale + v.height / 2];

/**
 * Marks that would crowd, gathered: each into the nearest cell within `GAP` px, by a grid of cells so
 * a frame is one pass however many there are. A cell is led by its first mark in `KIND_ORDER`.
 */
export function cellsOf(marks: readonly Hazard[], v: View): Cell[] {
  // Further out, wider cells of one kind each: a fire season drew the US West as a carpet of triangles.
  const wide = v.scale < WIDE;
  const gap = wide ? WIDE_GAP : GAP;
  const shown: { m: Hazard; x: number; y: number }[] = [];
  for (const m of marks) {
    const [x, y] = screenOf(m, v);
    if (x < -gap || y < -gap || x > v.width + gap || y > v.height + gap) continue;
    shown.push({ m, x, y });
  }
  shown.sort((a, b) => KIND_ORDER.indexOf(a.m.kind) - KIND_ORDER.indexOf(b.m.kind) || (a.m.id < b.m.id ? -1 : a.m.id > b.m.id ? 1 : 0));
  const cells: Cell[] = [];
  const grid = new Map<string, Cell[]>();
  for (const p of shown) {
    const gx = Math.floor(p.x / gap);
    const gy = Math.floor(p.y / gap);
    const kind = wide ? p.m.kind : '';
    let home: Cell | null = null;
    let best = gap;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const c of grid.get(`${kind} ${gx + dx} ${gy + dy}`) ?? []) {
          const d = Math.hypot(c.x - p.x, c.y - p.y);
          if (d < best) {
            best = d;
            home = c;
          }
        }
      }
    }
    if (home) {
      home.members.push(p.m);
      continue;
    }
    const cell = { x: p.x, y: p.y, lead: p.m, members: [p.m] };
    cells.push(cell);
    const key = `${kind} ${gx} ${gy}`;
    const list = grid.get(key);
    if (list) list.push(cell);
    else grid.set(key, [cell]);
  }
  return cells;
}

/**
 * What a hover over one mark says: the source's own title, its measure or alert, what its time is and
 * how old, *origin 1 h ago*, *updated 2 h ago*, and whose. A time is named, never bare, since each
 * source's means something else and none is simply the event's age.
 */
export function chipOf(m: Hazard, now: number): string {
  const time = m.at === null ? 'time not given' : `${FEED[m.feed].time.chip} ${agoOf(m.at, now)}`;
  return [m.title, m.alert ?? m.measure, time, NAME[m.feed], m.area && 'an area event; this is its centre, as GDACS gives it'].filter(Boolean).join(' · ');
}

/**
 * Every mark in each cell within a thumb of `at`, nearest first, or null where there is none. `ids`
 * names the first `MAX_IDS` of them and `of` how many there were, so the screen says what it left out.
 */
export function hitOf(
  marks: readonly Hazard[],
  v: View,
  [sx, sy]: readonly [number, number],
  now: number,
  cells: readonly Cell[] = cellsOf(marks, v)
): { ids: string; say: string; of: number } | null {
  // Where each cell's glyph is drawn, which a ring may have moved it to [place].
  const near = cells.filter((c) => Math.hypot(c.x - sx, c.y - sy) <= HIT);
  if (near.length === 0) return null;
  const found = near
    .flatMap((c) => c.members)
    .map((m) => {
      const [x, y] = screenOf(m, v);
      return { m, d: Math.hypot(x - sx, y - sy) };
    })
    .sort((a, b) => a.d - b.d)
    .map((e) => e.m);
  const more = found.length - 1;
  return {
    ids: found.slice(0, MAX_IDS).map((m) => m.id).join(','),
    say: chipOf(found[0]!, now) + (more > 0 ? ` · and ${more} more` : ''),
    of: found.length
  };
}

/** One kind's outline, about 12 px across, at (x, y), as a path on `ctx`. */
function outline(ctx: CanvasRenderingContext2D, kind: HazardKind, x: number, y: number): void {
  ctx.beginPath();
  if (kind === 'earthquake') {
    for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
      const [dx, dy] = [Math.cos(a) * 6, Math.sin(a) * 6];
      ctx.moveTo(x - dx, y - dy);
      ctx.lineTo(x + dx, y + dy);
    }
  } else if (kind === 'wildfire' || kind === 'volcano') {
    ctx.moveTo(x, y - 6);
    ctx.lineTo(x + 6, y + 4.5);
    ctx.lineTo(x - 6, y + 4.5);
    ctx.closePath();
  } else if (kind === 'storm') {
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 3;
      if (i === 0) ctx.moveTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6);
      else ctx.lineTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6);
    }
    ctx.closePath();
  } else {
    ctx.moveTo(x, y - 6.5);
    ctx.lineTo(x + 6.5, y);
    ctx.lineTo(x, y + 6.5);
    ctx.lineTo(x - 6.5, y);
    ctx.closePath();
  }
}

/**
 * One mark: a casing of the ground, then the outline in ink, hatched inside for a volcano or a drought,
 * and dashed for an event over an area, which is its centre and not a place.
 */
function drawMark(ctx: CanvasRenderingContext2D, kind: HazardKind, x: number, y: number, ink: { ink: string; ground: string }, heavy: boolean, area = false): void {
  const width = heavy ? 2.5 : 1.5;
  outline(ctx, kind, x, y);
  ctx.lineWidth = width + 3;
  ctx.strokeStyle = ink.ground;
  ctx.stroke();
  if (kind === 'volcano' || kind === 'drought') {
    ctx.save();
    ctx.clip();
    ctx.beginPath();
    // 45° lines 3 px apart, in screen space: the same at every zoom.
    for (let k = -12; k <= 12; k += 3) {
      ctx.moveTo(x + k - 7, y - 7);
      ctx.lineTo(x + k + 7, y + 7);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = ink.ink;
    ctx.stroke();
    ctx.restore();
    outline(ctx, kind, x, y);
  }
  ctx.lineWidth = width;
  ctx.strokeStyle = ink.ink;
  if (area) ctx.setLineDash([2.5, 2]);
  ctx.stroke();
  ctx.setLineDash([]);
}

// ─── Placing ──────────────────────────────────────────────────────────────────────────────

const FONT = '600 10px ui-monospace, monospace';
/** How far a cell's glyph may be moved to clear what is drawn over it, in CSS px: about one wide cell. */
const MOVE = 36;
const viewKey = (v: View) => `${v.cx} ${v.cy} ${v.scale} ${v.width} ${v.height}`;
const glyphBox = (x: number, y: number): Box => ({ l: x - 7.5, t: y - 7.5, r: x + 7.5, b: y + 7.5 });

/** This frame's cells, where each glyph and count is drawn, and the view they were laid out for. */
let laid: { at: string; cells: Cell[]; counts: { cell: Cell; box: Box; text: string }[] } | null = null;

/**
 * Where each cell's glyph and count are drawn at this view [Overlay place], the largest cell first. **A
 * cell a mission's ring, a Zone's count or the sun would be drawn over, or whose count would have nowhere
 * to go, is moved to the nearest spot where both are clear**, no further than `MOVE`: a cell further out is
 * already 24 px of the Earth gathered at one of its marks, and a fire season's 420 fires in the US West
 * were one cell, under three rings, its count left out (audit, 2026-10-24). A count sits beside its glyph,
 * on whichever side overlaps nothing placed, no other glyph and no other count. Only where no spot within
 * `MOVE` holds both is a cell left where it is, and then its count beside it clear of the rings at least.
 */
export function layout(marks: readonly Hazard[], v: View, taken: Box[], measure: (text: string) => number): NonNullable<typeof laid> {
  const wide = v.scale < WIDE;
  const before = taken.length;
  const under = (b: Box) => taken.some((t, i) => i < before && overlaps(b, t, 1));
  const cells = cellsOf(marks, v).sort((a, b) => b.members.length - a.members.length);
  const glyphs: Box[] = [];
  const counts: { cell: Cell; box: Box; text: string }[] = [];
  const countBoxes: Box[] = [];
  for (const cell of cells) {
    // All of them further out, where a cell is one kind; how many more closer in.
    const text = cell.members.length < 2 ? null : wide ? cell.members.length.toLocaleString('en-US') : `+${cell.members.length - 1}`;
    const w = text === null ? 0 : measure(text) + 6;
    const spots = (x: number, y: number): Box[] => {
      const at = (dx: number, dy: number): Box => ({ l: x + dx, t: y + dy, r: x + dx + w, b: y + dy + 12 });
      return [at(7, -13), at(7, 1), at(-7 - w, -13), at(-7 - w, 1), at(-w / 2, -21), at(-w / 2, 9), at(12, -6), at(-12 - w, -6)];
    };
    const fit = (x: number, y: number, moved: boolean): { g: Box; c: Box | null } | null => {
      const g = glyphBox(x, y);
      if (under(g) || countBoxes.some((o) => overlaps(g, o)) || (moved && glyphs.some((o) => overlaps(g, o)))) return null;
      if (text === null) return { g, c: null };
      const c = spots(x, y).find((b) => !under(b) && !countBoxes.some((o) => overlaps(b, o)) && !glyphs.some((o) => overlaps(b, o)));
      return c ? { g, c } : null;
    };
    let found = fit(cell.x, cell.y, false);
    find: for (let d = 4; !found && d <= MOVE; d += 4) {
      for (let k = 0; k < 16; k++) {
        const [x, y] = [cell.x + d * Math.cos((k * Math.PI) / 8), cell.y + d * Math.sin((k * Math.PI) / 8)];
        const f = fit(x, y, true);
        if (!f) continue;
        [cell.x, cell.y, found] = [x, y, f];
        break find;
      }
    }
    glyphs.push(found?.g ?? glyphBox(cell.x, cell.y));
    const c = found ? found.c : text === null ? null : (spots(cell.x, cell.y).find((b) => !under(b)) ?? null);
    if (c && text !== null) {
      countBoxes.push(c);
      counts.push({ cell, box: c, text });
    }
  }
  taken.push(...glyphs, ...countBoxes);
  return { at: viewKey(v), cells, counts };
}

// ─── Asking ────────────────────────────────────────────────────────────────────────────────

const BLANK: FeedState = { state: 'unread', readAt: null, generated: null, count: 0, dropped: 0, notDrawn: 0, capped: 0, malformed: false, missing: [] };
const feeds: Record<HazardFeedId, FeedState> = { usgs: { ...BLANK }, eonet: { ...BLANK }, gdacs: { ...BLANK } };
const held: Record<HazardFeedId, Hazard[]> = { usgs: [], eonet: [], gdacs: [] };
let all: Hazard[] = [];

/** When each feed was last asked, in ms: kept across a stop, so turning it off and on asks nothing new. */
const tried: Partial<Record<HazardFeedId, number>> = {};
/** URLs whose answer passed its cap: not asked again on this page, and read *not read: unknown*. */
const oversized = new Set<string>();
const asking = new Set<HazardFeedId>();
let controller: AbortController | null = null;
/** Bumped by every stop, so an answer to a round from before it is not kept. */
let generation = 0;
let live = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;

const hidden = () => typeof document !== 'undefined' && document.hidden;

/** What the map and the screens read, and a new picture. */
function publish(): void {
  all = [...held.usgs, ...held.eonet, ...held.gdacs];
  layerData.hazards = { marks: all, feeds: { usgs: { ...feeds.usgs }, eonet: { ...feeds.eonet }, gdacs: { ...feeds.gdacs } } };
  loaded();
}

async function ask(feed: HazardFeed, now: number): Promise<void> {
  const gen = generation;
  tried[feed.id] = now;
  asking.add(feed.id);
  if (feeds[feed.id].readAt === null) {
    feeds[feed.id] = { ...feeds[feed.id], state: 'loading' };
    publish();
  }
  controller ??= new AbortController();
  const signal = controller.signal;
  const asked = feed.urls.filter((url) => !oversized.has(url));
  const answers = await Promise.all(asked.map((url) => readOutside(url, CAPS[feed.id], { signal })));
  if (gen !== generation) return;
  asking.delete(feed.id);
  // Each ask on its own: one that did not answer is said by what it lists, and the rest are still drawn.
  const missing: Missing[] = [];
  feed.urls.forEach((url, i) => {
    const a = answers[asked.indexOf(url)];
    if (a && !a.ok && a.why === 'too-large') oversized.add(url);
    if (!a || !a.ok) missing.push({ part: feed.parts[i]!, why: a && !a.ok ? a.why : 'too-large' });
  });
  const ok = answers.flatMap((a) => (a.ok ? [a.json] : []));
  const parsed = ok.length > 0 ? READERS[feed.id](ok) : null;
  if (!parsed || parsed.malformed) {
    // Unknown, never none: what an earlier answer held is not drawn as if it were still the list.
    held[feed.id] = [];
    const state = !parsed && missing.every((m) => m.why === 'too-large') ? 'too-large' : 'failed';
    feeds[feed.id] = { ...BLANK, state, malformed: !!parsed?.malformed };
  } else {
    held[feed.id] = parsed.marks;
    feeds[feed.id] = {
      state: 'ready',
      readAt: Date.now(),
      generated: parsed.generated,
      count: parsed.marks.length,
      dropped: parsed.dropped,
      notDrawn: parsed.notDrawn,
      capped: parsed.capped,
      malformed: false,
      missing
    };
  }
  publish();
}

/** Asks every feed that is due, if anybody can see the page, then waits for the next one due. */
function round(): void {
  timer = null;
  if (!live || hidden()) return;
  const now = Date.now();
  for (const feed of HAZARD_FEEDS) {
    const last = tried[feed.id];
    if (feed.urls.every((url) => oversized.has(url))) continue;
    if (!asking.has(feed.id) && (last === undefined || now - last >= HAZARDS_EVERY)) void ask(feed, now);
  }
  if (timer) clearTimeout(timer);
  const next = Math.min(...HAZARD_FEEDS.map((f) => (tried[f.id] ?? now) + HAZARDS_EVERY));
  timer = setTimeout(round, Math.max(0, next - Date.now()) + 25);
}

/** Back in view: only what is due, and the ages in the key moved on. */
function seen(): void {
  if (hidden()) return;
  loaded();
  if (timer) clearTimeout(timer);
  round();
}

export const overlay: Overlay = {
  load() {
    if (live) return;
    live = true;
    mapLayers.hazardsCode = 'ready';
    document.addEventListener('visibilitychange', seen);
    // The ages in the key move on once a minute while somebody can see them; nothing is asked for it.
    ticker = setInterval(() => {
      if (!hidden()) loaded();
    }, 60_000);
    publish();
    round();
  },
  stop() {
    live = false;
    generation += 1;
    if (timer) clearTimeout(timer);
    if (ticker) clearInterval(ticker);
    timer = ticker = null;
    document.removeEventListener('visibilitychange', seen);
    controller?.abort();
    controller = null;
    for (const id of asking) if (feeds[id].state === 'loading') feeds[id] = { ...feeds[id], state: 'unread' };
    asking.clear();
    publish();
  },
  place(ctx, v, taken) {
    ctx.save();
    ctx.font = FONT;
    laid = all.length === 0 ? null : layout(all, v, taken, (t) => ctx.measureText(t).width);
    ctx.restore();
    return laid?.counts.map((c) => ({ of: c.cell.lead.kind, n: c.cell.members.length, x: c.cell.x, y: c.cell.y, box: c.box })) ?? [];
  },
  marks(ctx, v, ink, lifted) {
    if (!laid || laid.at !== viewKey(v)) return;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    for (const cell of laid.cells) drawMark(ctx, cell.lead.kind, cell.x, cell.y, ink, cell.members.some((m) => lifted.has(m.id)), cell.lead.area);
    for (const { box: b, text } of laid.counts) {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(b.l, b.t, b.r - b.l, b.b - b.t, 3);
      else ctx.rect(b.l, b.t, b.r - b.l, b.b - b.t);
      // Ground and no edge: an edged pill with a figure in it is a Zone's count [zone-missions.ts].
      ctx.fillStyle = ink.ground;
      ctx.fill();
      ctx.fillStyle = ink.ink;
      ctx.fillText(text, b.l + 3, (b.t + b.b) / 2 + 0.5);
    }
    ctx.restore();
  },
  // Where each cell is drawn, which a ring may have moved it to, when that is this view's.
  hit: (v, at) => hitOf(all, v, at, Date.now(), laid?.at === viewKey(v) ? laid.cells : undefined),
  legend: () => legendOf(feeds, Date.now()),
  credit: () => `${listOf(HAZARD_FEEDS.map((f) => f.name), 'and')}, their whole-world lists, asked every 10 minutes while the map is on screen; each answers on its own, and a feed that did not is named`,
  swatches() {
    const counts = new Map<HazardKind, number>();
    for (const m of all) counts.set(m.kind, (counts.get(m.kind) ?? 0) + 1);
    return KIND_ORDER.filter((k) => counts.has(k)).map((k) => ({ mark: SHAPE[k], tone: 'ink' as const, text: `${PLURAL[k]} · ${counts.get(k)!.toLocaleString('en-US')}`, inline: true }));
  }
};
