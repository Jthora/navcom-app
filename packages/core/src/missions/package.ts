/**
 * Mission Packages, read from Starcom's relay and turned into missions NavCom can show.
 *
 * NavCom's side of the boundary is `docs/spec/mission-interchange.spec.md`; this module is that
 * document's §3–§4 and §7.1 in code. Read it first. Everything here is a *reading* — NavCom never
 * publishes a kind-30079 event, so nothing in this file signs anything.
 *
 * ## What a package has to be to become a mission
 *
 * Three outcomes, kept apart because they mean different things to whoever is counting them:
 *
 * - **`not-a-package`** — malformed, or not a Starcom package at all. Noise.
 * - **`desk`** — a valid package that is not field work. Starcom's, and correct; just not for the
 *   grid. Most of what The Record holds is this.
 * - **`refused`** — a package that crosses one of the lines in §2 of the spec. NavCom will not show
 *   it, and the reason says which line, so the publisher can be told.
 *
 * ## What it refuses, and why each is a refusal rather than a repair
 *
 * - **A signature that does not verify**, or **a publisher NavCom does not read**. The Record only
 *   accepts writes from an allowlist, but the same event can be carried by any mirror; the
 *   signature and the key are what make it Mecha Jono's.
 * - **A `p` tag.** A package addressed to a person is an assignment, and *no mission may be
 *   assigned to a named person who did not claim it* [invariant 8].
 * - **A reference to `Distress`** — a `k` tag naming kinds 20910–20914. *Nothing in the mission
 *   system may borrow that channel* [invariant 2].
 * - **No `valid_until`.** A field mission with no end is volatile data with no age [invariant 7].
 * - **A state that is not one of the three**, or `claimed` on a campaign. A state nobody can trust
 *   is worse than none [invariant 9].
 *
 * ## What it repairs instead, and says so
 *
 * - **A coordinate finer than its declared precision** is coarsened to it — `1km` to two
 *   decimals, `city` to one — because precision is the defect, not the mission.
 * - **A coordinate of a kind it does not know** is dropped. Only `subject_location` and
 *   `jurisdiction` are understood; anything else might be a person's location, and a mission
 *   without a point is still a mission.
 * - **A count of people** in what the package says it measures is omitted — count things, never
 *   people (§7.1). Starcom accepted the rule; until every package follows it, the reader enforces it.
 */

import { verifyEvent } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';

/** Starcom's kind. NavCom reads it and never publishes one. */
export const MISSION_PACKAGE_KIND = 30079;

/** Where packages are published. Authoritative per Starcom's answer to Q8. */
export const THE_RECORD = 'wss://record.cosmiccodex.app';

/**
 * Where a device reads packages: The Record, and the mirrors that copy it [docs/design/grid.md].
 *
 * Read all at once, and the newest signed copy of each package wins, so a mirror can fall behind but
 * cannot forge one. The Record stays authoritative (Q8); a mirror is what still answers when it
 * cannot. A list written here until relay lists ship [build order G3], when the publisher's own
 * list says where its packages live.
 */
export const MISSION_RELAYS: readonly string[] = [THE_RECORD, 'wss://blackpi.cosmiccodex.app'];

/**
 * Who NavCom reads packages from, and whether each is an agent.
 *
 * A registry rather than trusting the `agent` tag alone: invariant 4 says agents are always
 * identified, and that cannot depend on an agent choosing to say so. The tag is honoured too — a
 * publisher that declares itself an agent is one.
 */
export const MISSION_PUBLISHERS: Readonly<Record<string, { name: string; agent: boolean }>> = {
  '6301c4d09a014909e5a48b7d0c9aa859eec18804c2fc87eab4e414aa5a319692': { name: 'Mecha Jono', agent: true }
};

export type MissionState = 'open' | 'claimed' | 'closed';

export interface MissionObjective {
  id: string;
  /** Verbatim. Written to be read as it is. */
  ask: string;
  /** Verbatim, and shown above the ask every time (§4.3). */
  limits: string[];
  effortMinutes: number | null;
  /** Who the work helps. Never an individual. */
  for: string | null;
  /** The publisher's view of the ask, never the claimant's. */
  done: boolean;
  tier: string | null;
  presence: string | null;
}

export interface MissionPlacement {
  /** `us-ca`, as the package files it. Drawn as that province. */
  jurisdiction: string | null;
  /** Never finer than ~1 km, whatever the package carried. */
  point: { lat: number; lon: number; precision: 'city' | '1km'; coarsened: boolean } | null;
}

export interface Mission {
  /** The package's addressable coordinate, `30079:<pubkey>:<d>` — what a claim's `a` tag names. */
  address: string;
  d: string;
  publisher: { pubkey: string; name: string; agent: true } | { pubkey: string; name: string; agent: false };
  title: string;
  summary: string | null;
  state: MissionState;
  /** `many` when the package says nothing: a campaign nobody can lock (§4.5). */
  claims: 'one' | 'many';
  /** Unix seconds. Always present on a mission; see the refusals above. */
  validUntil: number;
  placement: MissionPlacement;
  family: string | null;
  categories: string[];
  variant: string | null;
  /** Topics to check before going — never answers (§4.3). */
  checks: string[];
  citizenSafe: boolean;
  priority: number | null;
  objectives: MissionObjective[];
  /** Time-bound context the publisher attached, e.g. a weather warning's end. */
  clock: string[];
  /** What the mission counts, with any count of people removed. */
  effect: string[];
  /** How many lines of `effect` were removed for counting people. Shown, never silent. */
  omittedPeopleCounts: number;
  /**
   * Who is taking part, as the poster counts them: operators and agents apart, private claims
   * included, which only the poster can see. Never names. `null` until the poster says
   * [PROPOSED, interchange spec §5.1] — and unknown is what the screen then shows.
   */
  takingPart: { operators: number; agents: number } | null;
  publishedAt: number;
}

export type MissionReading =
  | { ok: true; mission: Mission }
  | {
      ok: false;
      kind: 'not-a-package' | 'desk' | 'refused';
      because: string;
      /**
       * Present when the event is genuinely a known publisher's, signature checked: such a version
       * still supersedes an older one of the same package, so a newer version NavCom cannot read
       * hides the old one rather than leaving it on the map. A forged one carries nothing, so it
       * can hide nothing.
       */
      from?: { address: string; at: number; id: string };
    };

/**
 * How long one of the poster's `effect` lines may be, and so how long a counted line in a report
 * may be [events/report.ts]. Here, where packages are read, so the reader refuses what a report
 * could never answer instead of letting an operator do the work first and fail at the end.
 */
export const EFFECT_LINE_MAX = 200;
/** What an objective id may be, for the same reason: a report names objectives by these. */
export const OBJECTIVE_ID = /^\S{1,200}$/;
/** How long a package's `d` may be, for the same reason: a claim and a report name the package by it. */
export const D_TAG_MAX = 256;

const tag = (e: Event, name: string) => e.tags.find((t) => t[0] === name)?.[1];
const tags = (e: Event, name: string) => e.tags.filter((t) => t[0] === name).map((t) => t[1] ?? '');
const flag = (e: Event, value: string) => e.tags.some((t) => t[0] === 't' && t[1] === value);
const prefixed = (e: Event, prefix: string) =>
  tags(e, 't').filter((v) => v.startsWith(prefix)).map((v) => v.slice(prefix.length));

const STATES: readonly MissionState[] = ['open', 'claimed', 'closed'];
const DISTRESS_KINDS = /^2091[0-4]$/;
const JURISDICTION = /^[a-z]{2}(-[a-z0-9]{1,3})?$/;
/** Words that make a line of `effect` a count of people. Deliberately plain. */
const PEOPLE = /\b(people|persons?|individuals?|residents|clients|guests)\b/i;
const D_TAG = new RegExp(`^\\S{1,${D_TAG_MAX}}$`);
/** 2100-01-01, in unix seconds: no field mission is planned further out than this. */
const LAST_END = 4_102_444_800;

function takingPartOf(e: Event): Mission['takingPart'] {
  const t = e.tags.find((x) => x[0] === 'taking_part');
  if (!t) return null;
  const operators = Number(t[1]);
  const agents = Number(t[2] ?? '0');
  const count = (n: number) => Number.isInteger(n) && n >= 0;
  return count(operators) && count(agents) ? { operators, agents } : null;
}

/**
 * Where a package is filed, from every `jurisdiction` tag it carries [audit 11, second grid]. The
 * most specific wins — Mecha Jono writes the country and then the state, and the first tag alone
 * filed a state's mission under the whole country. Two that disagree (two states, or a state and
 * another country) file it nowhere rather than guess: a mission with no place is still a mission.
 */
function jurisdictionOf(e: Event): string | null {
  const codes = [...new Set(tags(e, 'jurisdiction').map((v) => v.toLowerCase()).filter((v) => JURISDICTION.test(v)))];
  if (new Set(codes.map((c) => c.split('-')[0])).size !== 1) return null;
  const subdivisions = codes.filter((c) => c.includes('-'));
  if (subdivisions.length > 1) return null;
  return subdivisions[0] ?? codes[0]!;
}

function placementOf(e: Event): MissionPlacement {
  const jurisdiction = jurisdictionOf(e);

  const geo = tag(e, 'geo');
  const kind = tag(e, 'geo_kind');
  const m = geo ? /^lat:(-?\d+(?:\.\d+)?),lon:(-?\d+(?:\.\d+)?)$/.exec(geo) : null;
  if (!m || (kind !== 'subject_location' && kind !== 'jurisdiction')) return { jurisdiction, point: null };

  const declared = tag(e, 'geo_precision');
  const precision: 'city' | '1km' = declared === 'city' ? 'city' : '1km';
  const places = precision === 'city' ? 1 : 2;
  const round = (v: string) => Number(Number(v).toFixed(places));
  const lat = round(m[1]!);
  const lon = round(m[2]!);
  const coarsened =
    (declared !== 'city' && declared !== '1km') || lat !== Number(m[1]) || lon !== Number(m[2]);
  return { jurisdiction, point: { lat, lon, precision, coarsened } };
}

function objectivesOf(manifest: Record<string, unknown>): MissionObjective[] {
  const list = Array.isArray(manifest['objectives']) ? manifest['objectives'] : [];
  const out: MissionObjective[] = [];
  for (const o of list as Record<string, unknown>[]) {
    if (!o || typeof o.ask !== 'string' || typeof o.id !== 'string') continue;
    const limits = Array.isArray(o.limits)
      ? o.limits.filter((l): l is string => typeof l === 'string')
      : typeof o.limits === 'string'
        ? [o.limits]
        : [];
    out.push({
      id: o.id,
      ask: o.ask,
      limits,
      effortMinutes: typeof o.effortMinutes === 'number' ? o.effortMinutes : null,
      for: typeof o.for === 'string' ? o.for : null,
      done: o.done === true,
      tier: typeof o.tier === 'string' ? o.tier : null,
      presence: typeof o.presence === 'string' ? o.presence : null
    });
  }
  return out;
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : typeof v === 'string' ? [v] : [];

/** One event in, one reading out. Pure: no network, no clock. */
export function readMissionPackage(
  input: unknown,
  publishers: Readonly<Record<string, { name: string; agent: boolean }>> = MISSION_PUBLISHERS
): MissionReading {
  const raw = input as Event;
  if (
    !raw || typeof raw !== 'object' || raw.kind !== MISSION_PACKAGE_KIND || typeof raw.pubkey !== 'string' ||
    typeof raw.id !== 'string' || typeof raw.created_at !== 'number' ||
    !Array.isArray(raw.tags) || typeof raw.content !== 'string' || typeof raw.sig !== 'string'
  ) {
    return { ok: false, kind: 'not-a-package', because: 'Not a kind-30079 event.' };
  }
  /*
   * Every tag a list of strings, checked before any tag is read [11.R]. One `null` among the tags
   * threw in the flag scan below — before the signature check, so from anybody — and the live feed
   * had already stored the event, so the map stopped updating and stayed stopped across reloads.
   */
  if (!raw.tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === 'string'))) {
    return { ok: false, kind: 'not-a-package', because: 'Its tags are not lists of strings.' };
  }
  /*
   * Rebuilt from its seven NIP-01 fields before anything is checked, and only this copy is read.
   *
   * nostr-tools marks an event object it has verified with a symbol and trusts the mark from then
   * on — and an object spread copies symbols. So a verified event, copied with a change, "verifies"
   * without being checked: measured on 2.24.2, where a package with its content altered after
   * signing passed. Relay data arrives as fresh JSON and cannot carry a symbol, so this is a guard
   * against NavCom's own code rather than an attacker; it is cheap, and a signature check that can
   * be skipped by accident is not one.
   */
  const e: Event = {
    id: raw.id, pubkey: raw.pubkey, created_at: raw.created_at, kind: raw.kind,
    tags: raw.tags, content: raw.content, sig: raw.sig
  };
  const signed = verifyEvent(e);
  const known = publishers[e.pubkey];
  const from = signed && known ? { address: `${MISSION_PACKAGE_KIND}:${e.pubkey}:${tag(e, 'd') ?? ''}`, at: e.created_at, id: e.id } : null;
  const no = (kind: 'not-a-package' | 'desk' | 'refused', because: string): MissionReading =>
    from ? { ok: false, kind, because, from } : { ok: false, kind, because };

  if (!flag(e, 'starcom_mission_package') || !flag(e, 'navcom_handoff')) return no('not-a-package', 'Not handed off to NavCom.');
  if (!signed) return no('refused', 'The signature does not verify.');
  if (!known) return no('refused', 'Not a publisher NavCom reads.');

  if (!flag(e, 'navcom_mission')) return no('desk', 'Not field work.');

  if (e.tags.some((t) => t[0] === 'p')) return no('refused', 'Addressed to a person — a mission is an offer, never an assignment.');
  if (tags(e, 'k').some((k) => DISTRESS_KINDS.test(k))) {
    return no('refused', 'References Distress, which nothing in the mission system may borrow.');
  }

  const until = Number(tag(e, 'valid_until'));
  if (!Number.isInteger(until) || until <= 0) return no('refused', 'A field mission has to say when it ends.');
  // An end past 2100 never comes, and draws as no date at all [11.R]: a mission that cannot end is not one.
  if (until > LAST_END) return no('refused', 'Its end is not a date a mission could have.');

  const state = tag(e, 'mission_state') as MissionState | undefined;
  if (!state || !STATES.includes(state)) return no('refused', 'Its state is not open, claimed or closed.');
  const claims = tag(e, 'claims') === 'one' ? 'one' : 'many';
  if (state === 'claimed' && claims !== 'one') return no('refused', 'A campaign cannot be claimed; only a task can.');

  const d = tag(e, 'd') ?? '';
  if (!D_TAG.test(d)) return no('refused', 'Its d tag is not one a claim or a report could name.');

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(e.content) as Record<string, unknown>;
  } catch {
    return no('refused', 'Its content is not a package manifest.');
  }
  if (!manifest || typeof manifest !== 'object') return no('refused', 'Its content is not a package manifest.');

  /*
   * What a report will be held to, checked now rather than after the work [11.X]. A package an
   * operator could take part in but never report — no objectives, or ids a report cannot name, or
   * a line too long to count — was accepted, and the operator found out at the end.
   */
  const objectives = objectivesOf(manifest);
  if (objectives.length === 0) return no('refused', 'A field mission needs at least one objective.');
  if (!objectives.every((o) => OBJECTIVE_ID.test(o.id))) return no('refused', 'An objective id is not one a report could name.');
  if (new Set(objectives.map((o) => o.id)).size !== objectives.length) return no('refused', 'Two of its objectives share an id.');

  const mechaJono = ((manifest['metadata'] as Record<string, unknown> | undefined)?.['mechaJono'] ?? {}) as Record<string, unknown>;
  const format = (mechaJono['format'] ?? {}) as Record<string, unknown>;
  // The same line twice is one line, and a blank one says nothing to count.
  const effectAll = [...new Set(strings(format['effect']).map((l) => l.trim()).filter(Boolean))];
  if (effectAll.some((l) => l.length > EFFECT_LINE_MAX)) return no('refused', 'An effect line is longer than a count could answer.');
  const effect = effectAll.filter((line) => !PEOPLE.test(line));
  const priority = Number(tag(e, 'priority'));
  const agent = known.agent || tag(e, 'agent') !== undefined;

  return {
    ok: true,
    mission: {
      address: `${MISSION_PACKAGE_KIND}:${e.pubkey}:${d}`,
      d,
      publisher: agent ? { pubkey: e.pubkey, name: known.name, agent: true } : { pubkey: e.pubkey, name: known.name, agent: false },
      title: typeof manifest['name'] === 'string' && manifest['name'] ? manifest['name'] : d,
      summary: typeof manifest['description'] === 'string' ? manifest['description'] : null,
      state,
      claims,
      validUntil: until,
      placement: placementOf(e),
      family: tag(e, 'mission_family') ?? null,
      categories: prefixed(e, 'category:'),
      variant: prefixed(e, 'variant:')[0] ?? null,
      checks: tags(e, 'check'),
      citizenSafe: flag(e, 'citizen_safe'),
      priority: Number.isFinite(priority) ? priority : null,
      objectives,
      clock: strings(format['clock']),
      effect,
      omittedPeopleCounts: effectAll.length - effect.length,
      takingPart: takingPartOf(e),
      publishedAt: e.created_at
    }
  };
}

/** Past its `valid_until`. An expired mission says so; it is never shown as current [invariant 7]. */
export const missionExpired = (m: Mission, now: Date): boolean => now.getTime() / 1000 > m.validUntil;

/** Somebody could take part in it now: not closed, not expired. */
export const missionActive = (m: Mission, now: Date): boolean => m.state !== 'closed' && !missionExpired(m, now);
