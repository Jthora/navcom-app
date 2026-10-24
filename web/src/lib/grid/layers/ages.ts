/**
 * The directory by when it was last checked, over Nation States: each region's mark, and closer in
 * each record's point, by **how long ago it was checked** [docs/design/map.md, The directory by last
 * check; invariant 7].
 *
 * The map line `ages` in `scripts/lib/budget.mjs`: loaded by `import()` when its box is ticked, with
 * its one file, `/grid/region-ages.json`, fetched whole then and never by what is on screen. It holds
 * dates, not ages: each is read against this phone's clock, so the picture ages honestly between
 * deploys, and on the day a region's oldest check passes three months it turns, deploy or none.
 *
 * **It names an age, never what a page shows.** The file knows when each record was checked and
 * nothing of its fields: most records carry no hours at all, and a page with no hours shows none
 * whatever its age. So the classes are the windows a page turns at, 0–13 days, 14–89 and 90+, and a
 * record's own page says what its check still lets it show; the full key says what the windows mean
 * for a place that has hours, once, rather than every class claiming it.
 *
 * **A region reads as its oldest check**, the cautious statement: everything there was checked at
 * least this recently. It reads unknown only when none of its records carries a date, which is not the
 * same as old, and is drawn as a different shape rather than a dimmer one.
 *
 * Four classes, each carried by **shape, fill and size, never by tone alone**: in Low signature the
 * three text tones differ by less than the eye separates at a glance. **A family of squares**, since the
 * circle is a mission's alone and the ages' rings made a lattice the missions were lost in: 0–13 days
 * is a solid ink square; 14–89, a smaller solid muted one; 90+, a hollow one; no date, a hollow one with
 * a cross, because unknown is not old. Drawn at the size
 * the key draws them at every zoom, and **where they would crowd, the most cautious is drawn** and the
 * rest left out, rather than shrunk into one shape nobody can read: two thousand regions at the whole-
 * Earth view were a blob, and rings over discs read as fill.
 */

import { readingOf, isSeeded, type Reading, type ResourceRecord } from '@navcom/core';
import { layerData, loaded, mapLayers, type Overlay, type RegionAge, type Swatch } from '../layer.svelte';

/**
 * `/grid/region-ages.json`: every check date in the directory, oldest first, and for each region its
 * records in the order of its `console-index`, as runs: `[date index, how many]`, the index −1 for
 * records with no date. A region checked on one day is one run, so the file stays a few kilobytes
 * however many days the directory is re-checked on. Beside them, how many records a person confirmed
 * rather than a website or a second hand.
 */
export interface RegionAgesFile {
  v: 2;
  dates: string[];
  regions: Record<string, [number, number][]>;
  records: number;
  confirmed: number;
}

/** Builds the file at prerender, from each region's records in the order its index lists them. */
export function agesFileOf(regions: readonly { region: string; records: readonly Pick<ResourceRecord, 'last_verified' | 'verified_by' | 'method'>[] }[]): RegionAgesFile {
  const valid = (d: string | undefined): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(`${d}T00:00:00Z`));
  const dates = [...new Set(regions.flatMap((r) => r.records.map((x) => x.last_verified).filter(valid)))].sort();
  const at = new Map(dates.map((d, i) => [d, i]));
  const out: RegionAgesFile['regions'] = {};
  let records = 0;
  let confirmed = 0;
  for (const { region, records: list } of regions) {
    const runs: [number, number][] = [];
    for (const x of list) {
      const i = valid(x.last_verified) ? at.get(x.last_verified)! : -1;
      const last = runs.at(-1);
      if (last && last[0] === i) last[1] += 1;
      else runs.push([i, 1]);
    }
    out[region] = runs;
    records += list.length;
    // As the place screen's figures count it: checked by somebody, by a method that is not a website's.
    confirmed += list.filter((x) => x.verified_by && x.method && !isSeeded(x as ResourceRecord)).length;
  }
  return { v: 2, dates, regions: out, records, confirmed };
}

/** The file as the phone holds it: each region's records' date indices, laid out, and its oldest and newest. */
export interface Ages {
  dates: string[];
  regions: Map<string, Int32Array>;
  /** Each region's oldest and newest date index, both −1 when none of its records is dated. */
  span: Map<string, [number, number]>;
  records: number;
  confirmed: number;
}

/** Lays the runs out once, as the file arrives. Throws on a file this build did not write. */
export function agesOf(file: RegionAgesFile): Ages {
  if (file.v !== 2) throw new Error('not a version this build reads');
  const regions = new Map<string, Int32Array>();
  const span = new Map<string, [number, number]>();
  for (const [slug, runs] of Object.entries(file.regions)) {
    const n = runs.reduce((t, r) => t + r[1], 0);
    const list = new Int32Array(n);
    let k = 0;
    let lo = -1;
    let hi = -1;
    for (const [i, count] of runs) {
      if (!Number.isInteger(i) || i < -1 || i >= file.dates.length || !Number.isInteger(count) || count < 1) throw new Error(`${slug}: not a run`);
      list.fill(i, k, k + count);
      k += count;
      if (i >= 0) {
        lo = lo < 0 ? i : Math.min(lo, i);
        hi = Math.max(hi, i);
      }
    }
    regions.set(slug, list);
    span.set(slug, [lo, hi]);
  }
  return { dates: file.dates, regions, span, records: file.records, confirmed: file.confirmed };
}

/**
 * Each class's words, by the age of the check alone: in the full key, and shorter in the map's own row,
 * under *By last check*, where every class there is has to share one line or two on a phone: the 90+
 * row, which nearly every region is in by December, was cut from a key three lines tall.
 */
const WORDS: Record<Reading, { mark: Swatch['mark']; tone: Swatch['tone']; text: string; short: string }> = {
  current: { mark: 'square', tone: 'ink', text: '0–13 days ago', short: '0–13 days' },
  hours: { mark: 'square-small', tone: 'muted', text: '14–89 days ago', short: '14–89 days' },
  stale: { mark: 'square-ring', tone: 'muted', text: '90+ days ago', short: '90+ days' },
  unknown: { mark: 'square-cross', tone: 'faint', text: 'Unknown · no check date', short: 'no date' }
};
/** Least cautious first: where marks crowd, the later one is the one drawn. */
const ORDER: readonly Reading[] = ['current', 'hours', 'stale', 'unknown'];

/** What the windows mean, said once in the full key rather than claimed by every class. */
export const KEY_NOTE =
  'A region reads as its oldest check. Hours, where a place has them, read call first after 14 days; each place’s own page says what its check still lets it show. Where marks would crowd, the oldest is drawn.';

/**
 * A region's checks, read against `now`, and one record's when asked: its oldest and its newest, and
 * the reading of the oldest, the cautious word; a record's own reading, when one is asked for. Unknown
 * only when nothing there carries a date. Null for a region the file does not have.
 */
export function ageIn(ages: Ages, region: string, record: number | undefined, now: Date): RegionAge | null {
  const list = ages.regions.get(region);
  if (!list) return null;
  const [lo, hi] = ages.span.get(region)!;
  const oldest = lo >= 0 ? ages.dates[lo]! : null;
  const newest = hi >= 0 ? ages.dates[hi]! : null;
  const index = record === undefined ? -1 : (list[record] ?? -1);
  const own = index >= 0 ? ages.dates[index]! : null;
  return { oldest, newest, reading: readingOf(record === undefined ? oldest : own, now), record: own };
}

/**
 * Every region's reading and every record's, for one day, worked out once: a frame then only looks
 * them up. A record's is its position in `ORDER`, by its region in `console-index` order.
 */
export function readingsOf(ages: Ages, now: Date): { regions: Map<string, Reading>; records: Map<string, Uint8Array>; counts: Record<Reading, number> } {
  const byDate = ages.dates.map((d) => ORDER.indexOf(readingOf(d, now)));
  const unknown = ORDER.indexOf('unknown');
  const regions = new Map<string, Reading>();
  const records = new Map<string, Uint8Array>();
  const counts: Record<Reading, number> = { current: 0, hours: 0, stale: 0, unknown: 0 };
  for (const [slug, list] of ages.regions) {
    const own = new Uint8Array(list.length);
    for (let i = 0; i < list.length; i++) own[i] = list[i]! < 0 ? unknown : byDate[list[i]!]!;
    records.set(slug, own);
    // A region with no places yet is not on the map at all, and is not counted under any mark of it.
    if (list.length === 0) continue;
    const lo = ages.span.get(slug)![0];
    const reading = lo < 0 ? 'unknown' : ORDER[byDate[lo]!]!;
    regions.set(slug, reading);
    counts[reading] += 1;
  }
  return { regions, records, counts };
}

/**
 * Marks that would crowd, thinned: the most cautious first, each kept only if no kept mark is within
 * `gap` CSS px, by a grid of cells `gap` wide so a frame is one pass however many there are. Among
 * equals, the first is kept. What is left out is under what is kept: the cautious word wins.
 */
export function thin<T extends { x: number; y: number; rank: number }>(marks: readonly T[], gap: number): T[] {
  const kept: T[] = [];
  const cells = new Map<number, T[]>();
  const key = (cx: number, cy: number) => cx * 65_536 + cy;
  const ranks = [...new Set(marks.map((m) => m.rank))].sort((a, b) => b - a);
  for (const rank of ranks) {
    for (const m of marks) {
      if (m.rank !== rank) continue;
      const cx = Math.floor(m.x / gap);
      const cy = Math.floor(m.y / gap);
      let clear = true;
      for (let dx = -1; dx <= 1 && clear; dx++) {
        for (let dy = -1; dy <= 1 && clear; dy++) {
          for (const o of cells.get(key(cx + dx, cy + dy)) ?? []) {
            if (Math.hypot(o.x - m.x, o.y - m.y) < gap) {
              clear = false;
              break;
            }
          }
        }
      }
      if (!clear) continue;
      kept.push(m);
      const k = key(cx, cy);
      const cell = cells.get(k);
      if (cell) cell.push(m);
      else cells.set(k, [m]);
    }
  }
  return kept;
}

let ages: Ages | null = null;
let asked: Promise<void> | null = null;

/** The file, once; asked for again the next time the ages are shown, if it did not arrive. */
function loadAges(): Promise<void> {
  asked ??= (async () => {
    mapLayers.agesFile = 'loading';
    try {
      const r = await fetch('/grid/region-ages.json');
      if (!r.ok) throw new Error(String(r.status));
      ages = agesOf((await r.json()) as RegionAgesFile);
      classedOn = '';
      layerData.regionAges = ageOf;
      mapLayers.agesFile = 'ready';
      loaded();
    } catch {
      mapLayers.agesFile = 'failed';
      asked = null;
    }
  })();
  return asked;
}

/** The readings for today, by this phone's clock, worked out again only when the day turns. */
let classedOn = '';
let today: ReturnType<typeof readingsOf> = { regions: new Map(), records: new Map(), counts: { current: 0, hours: 0, stale: 0, unknown: 0 } };
function classify(): void {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  if (!ages || day === classedOn) return;
  classedOn = day;
  today = readingsOf(ages, now);
}

/** A region's checks, and one record's when asked for, by this phone's clock: what the place screen and a hover say. */
function ageOf(region: string, record?: number): RegionAge | null {
  return ages ? ageIn(ages, region, record, new Date()) : null;
}

/** `46 days ago`, from this phone's clock. */
export function daysAgo(date: string, now = Date.now()): string {
  const days = Math.floor((Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
  return days < 0 ? 'in this phone’s future' : days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

/** Each kind of mark, a square at the size the key draws it: a region's, or, smaller, a record's point; unknown crossed. */
function mark(path: Path2D, reading: Reading, x: number, y: number, small: boolean): void {
  const r = reading === 'hours' ? (small ? 2 : 3) : small ? 2.5 : 4.5;
  path.rect(x - r, y - r, 2 * r, 2 * r);
  if (reading !== 'unknown') return;
  path.moveTo(x - r, y - r);
  path.lineTo(x + r, y + r);
  path.moveTo(x + r, y - r);
  path.lineTo(x - r, y + r);
}

/** How far apart two regions' marks are kept, in CSS px: a ring's width and a little air. */
const GAP = 11;

export const overlay: Overlay = {
  load: () => void loadAges(),
  points(ctx, v, ink, points) {
    if (!ages) return false;
    classify();
    const paths: Record<Reading, Path2D> = { current: new Path2D(), hours: new Path2D(), stale: new Path2D(), unknown: new Path2D() };
    const regions: { x: number; y: number; rank: number }[] = [];
    for (const p of points) {
      if (p.kind === 'mission') continue;
      const x = (p.x - v.cx) * v.scale + v.width / 2;
      const y = (p.y - v.cy) * v.scale + v.height / 2;
      if (x < -6 || y < -6 || x > v.width + 6 || y > v.height + 6) continue;
      if (p.kind === 'region') {
        regions.push({ x, y, rank: ORDER.indexOf(today.regions.get(p.region) ?? 'unknown') });
        continue;
      }
      // A record, closer in: its own check, looked up, never worked out again in a frame.
      const reading = ORDER[today.records.get(p.region)?.[p.index] ?? ORDER.length - 1]!;
      mark(paths[reading], reading, x, y, true);
    }
    for (const m of thin(regions, GAP)) mark(paths[ORDER[m.rank]!], ORDER[m.rank]!, m.x, m.y, false);
    ctx.fillStyle = ink.ink;
    ctx.fill(paths.current);
    ctx.fillStyle = ink.muted;
    ctx.fill(paths.hours);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ink.muted;
    ctx.stroke(paths.stale);
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = ink.faint;
    ctx.stroke(paths.unknown);
    return true;
  },
  legend() {
    if (mapLayers.agesFile === 'failed') return 'Directory by last check not loaded — it needs one visit with a connection';
    if (!ages) return 'Directory by last check · loading';
    // Whether a person confirmed any of it, by phone, in person or at the place, rather than a website or
    // a second hand: none yet, today.
    const n = ages.confirmed;
    return `Directory by last check · ${n === 0 ? 'none' : n.toLocaleString('en-US')} by a person`;
  },
  credit: () => 'each region of the directory by its oldest check, read on this phone’s clock; by a person is a check confirmed by phone, in person or at the place, not by a website or a second hand',
  region(slug, record) {
    const age = ageOf(slug, record);
    if (!age) return null;
    if (record !== undefined) return age.record ? `checked ${daysAgo(age.record)}` : 'no check date';
    return age.oldest ? `oldest check ${daysAgo(age.oldest)}` : 'no check date';
  },
  swatches() {
    if (!ages) return [];
    classify();
    // Only the classes there are, each with how many regions it holds.
    return ORDER.filter((r) => today.counts[r] > 0).map((r) => ({
      mark: WORDS[r].mark,
      tone: WORDS[r].tone,
      text: `${WORDS[r].short} · ${today.counts[r].toLocaleString('en-US')}`
    }));
  }
};

/** Every class, with how many regions are in it now, for the layers screen's full key. */
export function key(): { reading: Reading; text: string; regions: number; mark: Swatch['mark'] }[] {
  classify();
  return ORDER.map((r) => ({ reading: r, text: WORDS[r].text, regions: ages ? today.counts[r] : 0, mark: WORDS[r].mark }));
}
