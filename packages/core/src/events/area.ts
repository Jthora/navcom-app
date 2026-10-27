/**
 * Where an operator says they are, on their card, at whatever level they choose [owner, 2026-10-27].
 *
 * **Earth by default, for everyone.** A card that names nowhere finer is complete: not a card waiting
 * for its region, and nothing anywhere may present it as unfinished. An operator may name one place
 * on each of two ladders, both optional:
 *
 * - **Nation, state or province, city or town**: an ISO 3166-1 country, an ISO 3166-2 subdivision, or a
 *   directory region, which is a metro and never anything smaller
 * - **Terra or Mare, Zone, Sector**: Starcom's ZSP 2.0 partition, by its ids, the same ones the map draws
 *
 * Each ladder gives one level, the one the operator chose, and nothing finer is derived from it: a card
 * that names Missouri does not name St. Louis, and one that names a Sector does not name a city.
 *
 * ## Why tags, and why the region stays
 *
 * A card's content is refuse-not-trim [public.ts `CARD_FIELDS`], so a new field there would empty the
 * board of every older build. These ride beside it as `["area", level, id, name]`, as links do
 * [links.ts], and an older build ignores them. The content's `region` stays, because every reader
 * requires it: the city's slug when the card names one, and `earth` when it does not, which an older
 * build shows as the word it is.
 *
 * ## Read as claims
 *
 * Nobody checks where anybody is, and nothing here pretends to: a card that names a Zone says its
 * holder says so. A level a reader does not know, an id not in its form, a second place on one ladder,
 * or a city that is not the card's own region is dropped, never the card.
 */

import { isZspId } from '../zones/ids.js';

/** The `region` a card carries when it names no city: the whole Earth, which is no board's. */
export const EARTH = 'earth';

export const AREA_LEVELS = ['nation', 'province', 'city', 'terra', 'mare', 'zone', 'sector'] as const;
export type AreaLevel = (typeof AREA_LEVELS)[number];

/** The two ladders: one place may be named on each. */
export const POLITICAL: readonly AreaLevel[] = ['nation', 'province', 'city'];
export const PARTITION: readonly AreaLevel[] = ['terra', 'mare', 'zone', 'sector'];

export interface CardArea {
  level: AreaLevel;
  /** `us`, `us-mo`, `st-louis`, `terra:laurentia`, `zone:east-african-rift/sector:afar`. */
  id: string;
  /** As the card gives it, for a reader without the tables: `United States`, `St. Louis metro`. */
  name: string | null;
}

/** The most a name may be. A longer one is dropped rather than cut. */
export const AREA_NAME_MAX = 80;

const FORM: Record<AreaLevel, (id: string) => boolean> = {
  nation: (id) => /^[a-z]{2}$/.test(id),
  province: (id) => /^[a-z]{2}-[a-z0-9]{1,3}$/.test(id),
  city: (id) => /^[a-z0-9-]+$/.test(id) && id !== EARTH,
  terra: (id) => isZspId(id, 'terra'),
  mare: (id) => isZspId(id, 'mare'),
  zone: (id) => isZspId(id, 'zone'),
  sector: (id) => isZspId(id, 'sector')
};

const isLevel = (v: unknown): v is AreaLevel => (AREA_LEVELS as readonly unknown[]).includes(v);
const ladderOf = (level: AreaLevel) => (POLITICAL.includes(level) ? 'political' : 'partition');

/** A name as a card gives it: one line, without control or format characters, or null. */
function nameOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return s && s.length <= AREA_NAME_MAX ? s : null;
}

/** Whether an area is one a card may carry. */
export function isArea(a: { level: unknown; id: unknown }): boolean {
  return isLevel(a.level) && typeof a.id === 'string' && FORM[a.level](a.id);
}

/**
 * The tags for what a card names: at most one area on each ladder, the first given. Refuses, rather
 * than drops, an area it could not read back, because the operator is looking at the choice now.
 */
export function areaTags(areas: readonly CardArea[], region: string): string[][] {
  const out: string[][] = [];
  const taken = new Set<string>();
  for (const a of areas) {
    if (!isArea(a)) throw new Error(`Not a place a card can name: ${a.level} ${a.id}`);
    if (a.level === 'city' && a.id !== region) throw new Error('A card names its own region as its city, or none.');
    const ladder = ladderOf(a.level);
    if (taken.has(ladder)) throw new Error('A card names one place on each ladder.');
    taken.add(ladder);
    const name = nameOf(a.name);
    out.push(['area', a.level, a.id, ...(name ? [name] : [])]);
  }
  return out;
}

/**
 * What a card names, as claims: at most one on each ladder, the first readable, and never a city but
 * its own region. **A card from before these tags names its region as its city**, since every card
 * then named a metro, and it reads as it always did. Kept apart from `readCard`, which every page that
 * shows a card loads, so a page that shows only the region pays nothing for this.
 */
export function readAreas(tags: readonly (readonly string[])[], region: string): CardArea[] {
  const out: CardArea[] = [];
  const taken = new Set<string>();
  for (const t of tags) {
    if (t[0] !== 'area') continue;
    const [, level, id] = t;
    if (!isArea({ level, id }) || (level === 'city' && id !== region)) continue;
    const ladder = ladderOf(level as AreaLevel);
    if (taken.has(ladder)) continue;
    taken.add(ladder);
    out.push({ level: level as AreaLevel, id: id!, name: nameOf(t[3]) });
  }
  if (!taken.has('political') && FORM.city(region)) out.unshift({ level: 'city', id: region, name: null });
  return out;
}
