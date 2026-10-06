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
  publishedAt: number;
}

export type MissionReading =
  | { ok: true; mission: Mission }
  | { ok: false; kind: 'not-a-package' | 'desk' | 'refused'; because: string };

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

function placementOf(e: Event): MissionPlacement {
  const raw = tag(e, 'jurisdiction')?.toLowerCase() ?? null;
  const jurisdiction = raw && JURISDICTION.test(raw) ? raw : null;

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
  if (!flag(e, 'starcom_mission_package') || !flag(e, 'navcom_handoff')) {
    return { ok: false, kind: 'not-a-package', because: 'Not handed off to NavCom.' };
  }
  if (!verifyEvent(e)) return { ok: false, kind: 'refused', because: 'The signature does not verify.' };

  const known = publishers[e.pubkey];
  if (!known) return { ok: false, kind: 'refused', because: 'Not a publisher NavCom reads.' };

  if (!flag(e, 'navcom_mission')) return { ok: false, kind: 'desk', because: 'Not field work.' };

  if (e.tags.some((t) => t[0] === 'p')) {
    return { ok: false, kind: 'refused', because: 'Addressed to a person — a mission is an offer, never an assignment.' };
  }
  if (tags(e, 'k').some((k) => DISTRESS_KINDS.test(k))) {
    return { ok: false, kind: 'refused', because: 'References Distress, which nothing in the mission system may borrow.' };
  }

  const until = Number(tag(e, 'valid_until'));
  if (!Number.isInteger(until) || until <= 0) {
    return { ok: false, kind: 'refused', because: 'A field mission has to say when it ends.' };
  }

  const state = tag(e, 'mission_state') as MissionState | undefined;
  if (!state || !STATES.includes(state)) {
    return { ok: false, kind: 'refused', because: 'Its state is not open, claimed or closed.' };
  }
  const claims = tag(e, 'claims') === 'one' ? 'one' : 'many';
  if (state === 'claimed' && claims !== 'one') {
    return { ok: false, kind: 'refused', because: 'A campaign cannot be claimed; only a task can.' };
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(e.content) as Record<string, unknown>;
  } catch {
    return { ok: false, kind: 'refused', because: 'Its content is not a package manifest.' };
  }
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, kind: 'refused', because: 'Its content is not a package manifest.' };
  }

  const d = tag(e, 'd') ?? '';
  const mechaJono = ((manifest['metadata'] as Record<string, unknown> | undefined)?.['mechaJono'] ?? {}) as Record<string, unknown>;
  const format = (mechaJono['format'] ?? {}) as Record<string, unknown>;
  const effectAll = strings(format['effect']);
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
      objectives: objectivesOf(manifest),
      clock: strings(format['clock']),
      effect,
      omittedPeopleCounts: effectAll.length - effect.length,
      publishedAt: e.created_at
    }
  };
}

/** Past its `valid_until`. An expired mission says so; it is never shown as current [invariant 7]. */
export const missionExpired = (m: Mission, now: Date): boolean => now.getTime() / 1000 > m.validUntil;

/** Somebody could take part in it now: not closed, not expired. */
export const missionActive = (m: Mission, now: Date): boolean => m.state !== 'closed' && !missionExpired(m, now);
