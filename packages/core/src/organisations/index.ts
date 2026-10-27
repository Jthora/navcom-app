/**
 * The Organisations' membership lists, read by NavCom's own code [docs/design/map.md, Spheres].
 *
 * An organisation of states, a union, a bloc, a forum or an alliance, is a cited list of countries by
 * ISO 3166-1 alpha-2 code, each with its standing in it: a member, or a candidate, a partner, an
 * observer, one suspended. Like a Sphere it has no geometry of its own, and organisations overlap. **Only
 * a member is drawn**: the rest are listed beside it, never shaded, and never what a tap on that
 * country names, as the lists say of themselves (*27 members are drawn; the 10 candidates are listed,
 * not drawn*).
 *
 * Written against the published shape of Mecha Jono's Part 2 lists (edition 1.0), which Starcom's
 * Organisations mode also reads: `{ lists, licence, organisations: [{ id: 'union:<slug>', name, kind,
 * founded?, members: [{ code, status, since?, source? }], sources: [{ name, url?, licence? }], read?,
 * note? }] }`. Starcom's reader is under another licence, and none of it is here.
 *
 * A standing is any one lower-case word, and only `member` is drawn: the lists give five, and a sixth
 * is listed rather than refused, since a closed list of words the publisher never closed is how NavCom
 * refused Starcom's final Zones for a word that was fine [zones/partition.ts, ZSP_SYSTEM].
 */

import { isHttps } from '../spheres/index.js';
import { licenceAllowed } from '../zones/partition.js';

export const ORGANISATION_LISTS_EDITION = '1.0';

/** The standing that is drawn. Every other is listed beside it. */
export const DRAWN_STANDING = 'member';

export interface OrganisationSource {
  name: string;
  url: string | null;
  licence: string | null;
}

export interface Organisation {
  id: string;
  name: string;
  /** What kind of organisation of states, in one lower-case word: union, bloc, forum, alliance. */
  kind: string;
  /** The year it was founded, as the list gives it, or null. */
  founded: string | null;
  /** Each country by its code, lower-cased, with its standing, the year it took it, and its source. */
  members: { code: string; status: string; since: string | null; source: string | null }[];
  sources: OrganisationSource[];
  /** When the list was read, YYYY-MM-DD, or null where it does not say. */
  read: string | null;
  /** What the list says it holds, as it says it, or null. */
  note: string | null;
}

export interface OrganisationLists {
  lists: typeof ORGANISATION_LISTS_EDITION;
  licence: string | null;
  attribution: string | null;
  organisations: Organisation[];
  /** Organisations the file carried that this could not read: counted, and named in `problems`. */
  unread: number;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`));
const WORD = /^[a-z]+(?:-[a-z]+)*$/;

/** One organisation as the file gives it: the organisation, or every reason it cannot be one. */
function organisationOf(raw: unknown, taken: ReadonlySet<string>): { organisation: Organisation | null; problems: string[] } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const id = text(r.id) ?? '(no id)';
  const problems: string[] = [];
  const say = (why: string) => problems.push(`${id}: ${why}`);
  if (!/^union:[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) say('an id is union:<slug>, lower case');
  if (taken.has(id)) say('named twice');
  const name = text(r.name);
  if (!name) say('no name');
  const kind = text(r.kind);
  if (!kind || !WORD.test(kind)) say(`a kind is one lower-case word, not ${String(r.kind)}`);
  const members: Organisation['members'] = [];
  const bad: string[] = [];
  for (const m of Array.isArray(r.members) ? r.members : []) {
    const o = (m ?? {}) as Record<string, unknown>;
    const code = text(o.code)?.toLowerCase() ?? '';
    const status = text(o.status);
    if (!/^[a-z]{2}$/.test(code)) bad.push(code || '(none)');
    else if (!status || !WORD.test(status)) say(`${code}: a standing is one lower-case word, not ${String(o.status)}`);
    else if (!members.some((x) => x.code === code)) members.push({ code, status, since: text(o.since), source: text(o.source) });
  }
  if (bad.length > 0) say(`not ISO 3166-1 alpha-2 codes: ${bad.join(', ')}`);
  if (members.length === 0) say('no members');
  else if (!members.some((m) => m.status === DRAWN_STANDING)) say('has no member to draw');
  const sources: OrganisationSource[] = [];
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
  const read = text(r.read);
  if (read !== null && !isDay(read)) say(`a read date is YYYY-MM-DD, not ${read}`);
  if (problems.length > 0) return { organisation: null, problems };
  return {
    organisation: { id, name: name!, kind: kind!, founded: text(r.founded), members, sources, read, note: text(r.note) },
    problems
  };
}

/**
 * The lists, and every problem with them. `lists` is null only when the file is not a list of
 * organisations at this edition at all; a licence NavCom may not vendor is a problem either way.
 */
export function checkOrganisations(manifest: unknown): { lists: OrganisationLists | null; problems: string[] } {
  const m = (manifest ?? {}) as Record<string, unknown>;
  if (m.lists !== ORGANISATION_LISTS_EDITION) {
    return { lists: null, problems: [`not a list of organisations at edition ${ORGANISATION_LISTS_EDITION}: ${String(m.lists)}`] };
  }
  if (!Array.isArray(m.organisations) || m.organisations.length === 0) return { lists: null, problems: ['no organisations'] };
  const problems: string[] = [];
  const licence = text(m.licence);
  if (!licenceAllowed(licence)) problems.push(`the lists are licensed ${licence ?? '(not said)'}, which NavCom may not vendor`);
  const organisations: Organisation[] = [];
  const taken = new Set<string>();
  let unread = 0;
  for (const raw of m.organisations) {
    const { organisation, problems: own } = organisationOf(raw, taken);
    problems.push(...own);
    if (organisation) {
      organisations.push(organisation);
      taken.add(organisation.id);
    } else unread += 1;
  }
  return {
    lists: { lists: ORGANISATION_LISTS_EDITION, licence, attribution: text(m.attribution) ?? text(m.credit), organisations, unread },
    problems
  };
}
