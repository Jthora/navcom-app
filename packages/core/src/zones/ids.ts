/**
 * The ids of Starcom's Zone and Sector Protocol 2.0, as the format writes them [Starcom D-ZR, ZR2, ZR9].
 *
 * Four levels, each known by its id alone: a Terra (`terra:africana`) or a Mare (`mare:pacificum`)
 * contains Zones (`zone:east-african-rift`), and a Zone contains Sectors, whose id carries their Zone's
 * (`zone:east-african-rift/sector:afar`). Slugs are lower-case letters and digits in words joined by
 * single hyphens. NavCom's own reading of the published format, not Starcom's code.
 */

export type ZspLevel = 'terra' | 'mare' | 'zone' | 'sector';
export type ZspContainerLevel = 'terra' | 'mare';

const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*';
const RULES: [ZspLevel, RegExp][] = [
  ['terra', new RegExp(`^terra:${SLUG}$`)],
  ['mare', new RegExp(`^mare:${SLUG}$`)],
  ['zone', new RegExp(`^zone:${SLUG}$`)],
  ['sector', new RegExp(`^zone:${SLUG}/sector:${SLUG}$`)]
];

/** The level an id names, or null for anything that is not a well-formed ZSP 2.0 id. */
export function zspLevelOf(id: unknown): ZspLevel | null {
  if (typeof id !== 'string') return null;
  for (const [level, rule] of RULES) if (rule.test(id)) return level;
  return null;
}

/** Whether `id` is a well-formed id at `level`, or at one of `levels`. */
export function isZspId(id: unknown, level?: ZspLevel | readonly ZspLevel[]): id is string {
  const found = zspLevelOf(id);
  if (found === null) return false;
  if (level === undefined) return true;
  return typeof level === 'string' ? found === level : level.includes(found);
}

/** Whether a level is a Terra's or a Mare's: the top of the partition. */
export const isContainerLevel = (level: unknown): level is ZspContainerLevel => level === 'terra' || level === 'mare';

/** The Zone a Sector's id names: `zone:a/sector:b` is in `zone:a`. Null for anything that is not a Sector's id. */
export function zoneOfSector(id: string): string | null {
  return zspLevelOf(id) === 'sector' ? id.slice(0, id.indexOf('/')) : null;
}

/** A container's id as a file name's stem, `terra:africana` → `terra-africana`, which no two containers share. */
export const zspStem = (id: string): string => id.replace(':', '-');
