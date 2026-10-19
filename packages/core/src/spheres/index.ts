/**
 * The Spheres' membership lists, read by NavCom's own code [docs/design/map.md, Spheres; the owner's
 * map decision D9].
 *
 * A Sphere is a domain of influence, a language's, a civilisation's or a political community's, and
 * Spheres overlap. Each is a list of countries by ISO 3166-1 alpha-2 code, cited, with no geometry of its
 * own: the map draws a member over the world's own outlines, and a small state with no outline at the
 * map's scale as a circle at Natural Earth's label point (D9).
 *
 * Written against the published shape of the lists (edition 1.0), which Starcom's Spheres mode also
 * reads: `{ lists, licence, spheres: [{ id: 'sphere:<slug>', name, family, members: [{ code, source? }],
 * groups?, sources: [{ name, url?, licence? }], read? }] }`. Starcom's reader is under another licence,
 * and none of it is here; `spheres.test.ts` fails if anything under this directory names it.
 *
 * Lenient where a phone reads it and strict where a build vendors it: a Sphere this cannot read is left
 * out and counted, never dropped unsaid, and every reason is in `problems`, which the vendoring script
 * refuses to write past.
 */

import { licenceAllowed } from '../zones/partition.js';

export const SPHERE_LISTS_EDITION = '1.0';

export type SphereFamily = 'language' | 'civilisation' | 'political';
const FAMILIES: ReadonlySet<string> = new Set<SphereFamily>(['language', 'civilisation', 'political']);

export interface SphereSource {
  name: string;
  url: string | null;
  licence: string | null;
}

export interface Sphere {
  id: string;
  name: string;
  family: SphereFamily;
  /** Each member by its ISO 3166-1 alpha-2 code, lower-cased as a mission files a country, and where the list says so. */
  members: { code: string; source: string | null }[];
  /** Where the source divides the Sphere further, each group by its members' codes, all of them the Sphere's own. */
  groups: { id: string; name: string; members: string[] }[];
  sources: SphereSource[];
  /** When the lists were read, YYYY-MM-DD, or null where they do not say. */
  read: string | null;
}

export interface SphereLists {
  lists: typeof SPHERE_LISTS_EDITION;
  licence: string | null;
  /** The attribution the licence asks for, as the lists give it. */
  attribution: string | null;
  spheres: Sphere[];
  /** Spheres the file carried that this could not read: counted, and named in `problems`. */
  unread: number;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`));

/**
 * Whether a link is an https URL, and nothing else: a `javascript:` or `data:` link would run in
 * navcom.app's origin on one tap, and an `http:` one hands whoever is on the path the page it opens.
 */
export function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** One Sphere as the file gives it: the Sphere, or every reason it cannot be one. */
function sphereOf(raw: unknown, taken: ReadonlySet<string>): { sphere: Sphere | null; problems: string[] } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const id = text(r.id) ?? '(no id)';
  const problems: string[] = [];
  const say = (why: string) => problems.push(`${id}: ${why}`);
  if (!/^sphere:[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) say('an id is sphere:<slug>, lower case');
  if (taken.has(id)) say('named twice');
  const name = text(r.name);
  if (!name) say('no name');
  const family = text(r.family);
  if (!family || !FAMILIES.has(family)) say(`a family is language, civilisation or political, not ${String(r.family)}`);
  const members: Sphere['members'] = [];
  const bad: string[] = [];
  for (const m of Array.isArray(r.members) ? r.members : []) {
    const code = text((m as Record<string, unknown>)?.code)?.toLowerCase() ?? '';
    if (!/^[a-z]{2}$/.test(code)) bad.push(code || '(none)');
    else if (!members.some((x) => x.code === code)) members.push({ code, source: text((m as Record<string, unknown>).source) });
  }
  if (bad.length > 0) say(`not ISO 3166-1 alpha-2 codes: ${bad.join(', ')}`);
  if (members.length === 0) say('no members');
  const sources: SphereSource[] = [];
  for (const s of Array.isArray(r.sources) ? r.sources : []) {
    const o = (s ?? {}) as Record<string, unknown>;
    const n = text(o.name);
    if (!n) continue;
    const licence = text(o.licence);
    if (licence !== null && !licenceAllowed(licence)) say(`source ${n} is licensed ${licence}, which NavCom may not vendor`);
    // A link a person follows from navcom.app's own origin, where their keys are: https, or nothing.
    const url = text(o.url);
    if (url !== null && !isHttps(url)) say(`source ${n} links to ${url.slice(0, 40)}, and a source's link is https or none`);
    sources.push({ name: n, url, licence });
  }
  if (sources.length === 0) say('cites no source');
  const groups: Sphere['groups'] = [];
  for (const g of Array.isArray(r.groups) ? r.groups : []) {
    const o = (g ?? {}) as Record<string, unknown>;
    const gid = text(o.id);
    const gname = text(o.name);
    const codes = (Array.isArray(o.members) ? o.members : []).map((c) => String(c).toLowerCase());
    const strays = codes.filter((c) => !members.some((m) => m.code === c));
    if (!gid || !gname) say('a group with no id or name');
    else if (strays.length > 0) say(`group ${gid} names countries not in the Sphere: ${strays.join(', ')}`);
    else if (codes.length > 0) groups.push({ id: gid, name: gname, members: codes });
  }
  const read = text(r.read);
  if (read !== null && !isDay(read)) say(`a read date is YYYY-MM-DD, not ${read}`);
  if (problems.length > 0) return { sphere: null, problems };
  return { sphere: { id, name: name!, family: family as SphereFamily, members, groups, sources, read }, problems };
}

/**
 * The lists, and every problem with them. `lists` is null only when the file is not a list of Spheres
 * at this edition at all; a licence NavCom may not vendor is a problem either way.
 */
export function checkSpheres(manifest: unknown): { lists: SphereLists | null; problems: string[] } {
  const m = (manifest ?? {}) as Record<string, unknown>;
  if (m.lists !== SPHERE_LISTS_EDITION) return { lists: null, problems: [`not a list of Spheres at edition ${SPHERE_LISTS_EDITION}: ${String(m.lists)}`] };
  if (!Array.isArray(m.spheres) || m.spheres.length === 0) return { lists: null, problems: ['no spheres'] };
  const problems: string[] = [];
  const licence = text(m.licence);
  if (!licenceAllowed(licence)) problems.push(`the lists are licensed ${licence ?? '(not said)'}, which NavCom may not vendor`);
  const spheres: Sphere[] = [];
  const taken = new Set<string>();
  let unread = 0;
  for (const raw of m.spheres) {
    const { sphere, problems: own } = sphereOf(raw, taken);
    problems.push(...own);
    if (sphere) {
      spheres.push(sphere);
      taken.add(sphere.id);
    } else unread += 1;
  }
  return { lists: { lists: SPHERE_LISTS_EDITION, licence, attribution: text(m.attribution) ?? text(m.credit), spheres, unread }, problems };
}
