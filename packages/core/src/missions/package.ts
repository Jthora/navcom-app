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
 * - **A key NavCom does not trust to sign yet, or an event dated before its key's start** (rev 7).
 *   Neither carries proof of whose it is, so neither can hide a genuine version. Whether a key's
 *   window is open *now*, and whether a frozen key's event is on its list, is the reader's clock
 *   and the registry gate's [trust.ts], asked before anything is kept.
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
 * - **A coordinate finer than its declared precision** is coarsened to it — `address` to five
 *   decimals, `1km` to two, `city` to one — because precision is the defect, not the mission. A
 *   subject on public record may be placed at its address (rev 8, §4.2); a point that stands for a
 *   jurisdiction is coarsened to a city whatever it declares, because a jurisdiction has no doorstep.
 * - **A coordinate of a kind it does not know** is dropped. Only `subject_location` and
 *   `jurisdiction` are understood; anything else might be a person's location, and a mission
 *   without a point is still a mission.
 * - **A place it names that cannot be read is dropped** (rev 9, §4.2): a Zone or Sector that is not a
 *   ZSP 2.0 id, two that disagree, a Sector outside the Zone named beside it, a name over 80
 *   characters. Each is optional, so a mission naming none of them is not missing anything.
 * - **A count of people** in what the package says it measures is omitted — count things, never
 *   people (§7.1). Starcom accepted the rule; until every package follows it, the reader enforces it.
 */

import { verifyEvent } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import { isZspId, zoneOfSector } from '../zones/ids.js';

/** Starcom's kind. NavCom reads it and never publishes one. */
export const MISSION_PACKAGE_KIND = 30079;

// Where packages are published and read, in a module of their own [../mission-relays.ts]: the relay
// picker needs them on every page, and the reader below only on those that read a mission.
export { MISSION_RELAYS, THE_RECORD } from '../mission-relays.js';

/**
 * One signing key of a publisher, as NavCom's release pins it [interchange spec §3, rev 7].
 *
 * **Every date here removes or grants trust on the reader's own clock, never on an event's.** The
 * date an event carries is whatever its signer wrote, so a stolen key can date anything: past
 * `notAfter`, nothing the key signed is trusted whatever date it carries. The clock it is judged on
 * has a floor — the moment this build was made — so a phone set back cannot revive an ended key
 * [trust.ts, `trustClock`].
 */
export interface PublisherKey {
  /** 64 lowercase hex. */
  pubkey: string;
  /**
   * Raised only by a release. For one publisher and one `d`, a higher generation outranks a lower
   * one whatever `created_at` says, so a stolen old key cannot override its successor by dating a
   * version later [trust.ts, `outranks`].
   */
  generation: number;
  /**
   * ISO 8601, UTC. From when NavCom trusts what this key signs. **Absent, it is not trusted to sign
   * at all**, and anything it signed is dropped; an event dated before it is dropped too, so a
   * forgery made in the gap does not become trusted when the date arrives. A start grants trust, so
   * it may wait for a later release: a late one only keeps its missions off the map longer.
   */
  notBefore?: string;
  /**
   * ISO 8601, UTC. When NavCom stops trusting this key, judged on the reader's clock with a floor.
   * At most a year out; renewing it is a person stating the key is still believed good, by release.
   * An end removes trust, so it ships in the next deploy and is never extended for an exposed key
   * [registry-rules.ts].
   */
  notAfter: string;
  /**
   * The day (`YYYY-MM-DD`) this key's secret was exposed. **Sealing to it hides nothing from
   * whoever holds that secret**, so nothing is sealed to it: on its missions the sealed choice is
   * off, with its reason [trust.ts, `sealTargetOf`]. None of its labels counts [`settlersOf`].
   */
  exposed?: string;
  /**
   * Its frozen set: only the package versions listed in `frozen.ts`, and versions that close one of
   * their missions, are kept from this key [trust.ts, `gate`]. `sha256` pins that list: a list
   * whose digest differs is refused, and then nothing under this key is kept. `confirmed` is
   * whether the publisher's own signed list of what it signed confirmed it; until then each such
   * mission shows at its jurisdiction only and cannot be taken [interchange spec §3].
   */
  frozen?: { sha256: string; confirmed: boolean };
}

/** One publisher NavCom reads, as its release pins it. Every rule keys on `id`, never on the name. */
export interface MissionPublisher {
  /** Stable, lowercase: what local history, ranking and replacement key on, across its keys. */
  id: string;
  name: string;
  agent: boolean;
  /**
   * Where sealed claims and reports to this publisher go: secure relay addresses, pinned here in
   * the release and never read off a relay [interchange spec §5.0]. Absent, nothing is sent sealed
   * to it, and the screen says so.
   *
   * **Not its kind-10050 list, since 2026-10-17.** The newest list by date won, and the date is
   * whatever the signer writes: whoever holds an exposed secret can sign a list dated next year
   * naming relays they run, and every sealed claim and report would go there. Asking for the list
   * also went out over the connection that carries the operator's card, a moment before the seal
   * (Q16). An inbox that moves now moves by a NavCom release, as the meeting relays do.
   */
  inbox?: readonly string[];
  keys: readonly PublisherKey[];
  /**
   * Reserved for the sha256 of a key committed in advance [interchange spec rev 7, decision 4].
   * Nothing reads it yet, so the build refuses anything but `null`: a field nothing honours would
   * claim a protection that is not there.
   */
  next: null;
}

export type MissionPublishers = readonly MissionPublisher[];

/**
 * Mecha Jono's inbox, as its old key's kind-10050 list named it with its letter (Q10).
 * `relay.damus.io` refuses every NIP-42 sign-in. Nothing is sealed to Mecha Jono while its only key
 * trusted to sign is exposed [trust.ts, `sealTargetOf`].
 */
const MECHA_JONO_INBOX: readonly string[] = ['wss://nos.lol', 'wss://relay.primal.net'];

/**
 * Who NavCom reads packages from, whether each is an agent, under which keys, and where each takes
 * sealed messages. Published as `/.well-known/navcom-publishers.json` with its digest, so a
 * publisher can check daily that what NavCom serves is what it agreed [interchange spec §3].
 *
 * A registry rather than trusting the `agent` tag alone: invariant 4 says agents are always
 * identified, and that cannot depend on an agent choosing to say so. The tag is honoured too — a
 * publisher that declares itself an agent is one.
 */
export const MISSION_PUBLISHERS: MissionPublishers = [
  {
    id: 'mecha-jono',
    name: 'Mecha Jono',
    agent: true,
    inbox: MECHA_JONO_INBOX,
    keys: [
      // Retiring. Its secret was exposed on 2026-09-28 (Mecha Jono's key-change letter of 7 Oct), so
      // it is frozen: nothing it signs is kept unless it is in the frozen set or closes one of its
      // missions, none of its labels counts, and nothing is sealed to it. It ends on 13 November
      // (decided 2026-10-18), on the reader's clock with a floor.
      {
        pubkey: '6301c4d09a014909e5a48b7d0c9aa859eec18804c2fc87eab4e414aa5a319692',
        generation: 1,
        notBefore: '2025-01-01T00:00:00Z',
        notAfter: '2026-11-13T00:00:00Z',
        exposed: '2026-09-28',
        frozen: { sha256: 'f225840937640ab8dd7e4e331e104c2a67a63fe9f885f38b85a096dd523e9a76', confirmed: false }
      },
      // Mecha Jono's next key, confirmed by Jono. **Not trusted to sign until the cut-over**
      // (decided 2026-10-18): Mecha Jono signs nothing with it before then, so anything under it
      // before its start is a thief's, and is dropped. A later release gives it its start once
      // Mecha Jono names the day.
      {
        pubkey: '86f824c3f1e67c60b1dc15ce110648c4de5c3fb879022fbbcc5e8deb720e402c',
        generation: 2,
        notAfter: '2027-10-18T00:00:00Z'
      }
    ],
    next: null
  }
];

/** A key, and the publisher it belongs to. */
export interface RegisteredKey {
  entry: MissionPublisher;
  key: PublisherKey;
}

/** Which publisher a key is, or null: a key NavCom does not read. */
export function keyOf(registry: MissionPublishers, pubkey: string): RegisteredKey | null {
  for (const entry of registry) {
    const key = entry.keys.find((k) => k.pubkey === pubkey);
    if (key) return { entry, key };
  }
  return null;
}

/** Unix seconds from an ISO date the registry holds, or NaN. */
export const registryTime = (iso: string | undefined): number => (iso === undefined ? NaN : Date.parse(iso) / 1000);

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

/**
 * How precisely a package placed its point, as kept: `address` is five decimals (~1 m), for a
 * subject on public record at a geocoded address; `1km` two; `city` one.
 */
export type GeoPrecision = 'address' | '1km' | 'city';

export interface MissionPlacement {
  /** `us-ca`, as the package files it. Drawn as that province. */
  jurisdiction: string | null;
  /**
   * Where the package puts it, at the precision its source earned and never finer than it declared
   * [interchange spec §4.2]. `kind` says what the point is: a `subject_location`, an entity on public
   * record, which the map draws as a ring; or a point that stands for a `jurisdiction`, which is
   * never finer than a city and is not drawn as a place [docs/design/map.md §5].
   */
  point: { lat: number; lon: number; precision: GeoPrecision; kind: 'subject_location' | 'jurisdiction'; coarsened: boolean } | null;
  /**
   * The Zone and the Sector the package names, by Starcom's ZSP 2.0 ids, each with the name it gives
   * [interchange spec §4.2, rev 9]: what its publisher says, whether or not it has a point. Null where
   * it names none, or two, or a Sector outside the Zone it names; a Sector alone names its Zone. Absent
   * on a mission kept by a build before 2026-10-27.
   */
  zone?: NamedArea | null;
  sector?: NamedArea | null;
  /** A city or town it names, as written, with the country or province it says it is in. */
  city?: { name: string; in: string | null } | null;
  /** A place of interest on public record it names, as written: a park, a library, a courthouse. */
  poi?: string | null;
}

/** An area a package names: its id, and the name the package gives it, if any. */
export interface NamedArea {
  id: string;
  name: string | null;
}

export interface Mission {
  /** The package's addressable coordinate, `30079:<pubkey>:<d>` — what a claim's `a` tag names. */
  address: string;
  d: string;
  /**
   * Who posted it: the key that signed it, and the registry entry that key belongs to. `entry` and
   * `generation` are absent on a mission kept by a build before 2026-10-18, so a reader of kept
   * missions asks the registry by key instead [trust.ts].
   */
  publisher:
    | { pubkey: string; name: string; agent: true; entry?: string; generation?: number }
    | { pubkey: string; name: string; agent: false; entry?: string; generation?: number };
  /**
   * Posted under a key that is being retired [interchange spec §3]: `unconfirmed` until the
   * publisher's own signed list of what it signed includes it — then it shows at its jurisdiction
   * only, cannot be taken, and says it may have been replaced — and `confirmed` after. Null for any
   * other key, and absent on a mission kept by an earlier build.
   */
  retiring?: 'unconfirmed' | 'confirmed' | null;
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
/**
 * The most content a package may carry, in bytes of UTF-8, and the most entries in any of its lists,
 * as Starcom's reader refuses them before reading a manifest (interchange rev 19, 23 Oct): The Record's
 * own message limit, and far above the one entry any published package has held. Some public relays
 * take 1 MB events, and anyone may post one. Read the same way here so both apps show the same set.
 */
export const PACKAGE_CONTENT_MAX = 131_072;
export const PACKAGE_LIST_MAX = 1_000;

const tag = (e: Event, name: string) => e.tags.find((t) => t[0] === name)?.[1];
const tags = (e: Event, name: string) => e.tags.filter((t) => t[0] === name).map((t) => t[1] ?? '');
const flag = (e: Event, value: string) => e.tags.some((t) => t[0] === 't' && t[1] === value);
const prefixed = (e: Event, prefix: string) =>
  tags(e, 't').filter((v) => v.startsWith(prefix)).map((v) => v.slice(prefix.length));

const STATES: readonly MissionState[] = ['open', 'claimed', 'closed'];
const DISTRESS_KINDS = /^2091[0-4]$/;
const JURISDICTION = /^[a-z]{2}(-[a-z0-9]{1,3})?$/;
/**
 * Words that make a line of `effect` a count of people. Deliberately plain, and wide on purpose
 * (decided 2026-10-07, after the audit found counts of people phrased in words the list lacked):
 * a materiel line that happens to use one of them is dropped too, which is the cheaper mistake
 * [invariant 1].
 */
const PEOPLE =
  /\b(people|persons?|individuals?|residents|clients|guests|households|families|children|kids|men|women|youths?|seniors|neighbou?rs|folks|unhoused)\b/i;
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

/** The most a package's name for a place may be. A longer one names nothing rather than being cut. */
const NAME_MAX = 80;

/** A place's name as a package writes it: one line, without control or format characters, or null. */
function nameOf(v: string | undefined): string | null {
  const s = v?.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return s && s.length <= NAME_MAX ? s : null;
}

/**
 * The one value a package gives under `name`, as `read` reads each tag, or null. Two that disagree
 * give none, as two jurisdictions do: a place is never guessed between two.
 */
function oneOf<T>(e: Event, name: string, read: (t: string[]) => T | null, same: (t: T) => string): T | null {
  const found = e.tags.filter((t) => t[0] === name).map(read).filter((x): x is T => x !== null);
  return new Set(found.map(same)).size === 1 ? found[0]! : null;
}

/**
 * The Zone and Sector a package names [interchange spec §4.2, rev 9]: Starcom's `["zone", id, name]`
 * and `["zone_sector", id, name]`, never `sector`, which another feed uses for something else.
 */
function zspOf(e: Event): { zone: NamedArea | null; sector: NamedArea | null } {
  const named = (level: 'zone' | 'sector') => (t: string[]) => (isZspId(t[1], level) ? { id: t[1]!, name: nameOf(t[2]) } : null);
  const sector = oneOf(e, 'zone_sector', named('sector'), (x) => x.id);
  const zone = oneOf(e, 'zone', named('zone'), (x) => x.id);
  const of = sector ? zoneOfSector(sector.id)! : null;
  if (zone && of && zone.id !== of) return { zone: null, sector: null };
  return { zone: zone ?? (of ? { id: of, name: null } : null), sector };
}

/** Decimal places kept for each precision. */
const PLACES: Record<GeoPrecision, number> = { address: 5, '1km': 2, city: 1 };

function placementOf(e: Event): MissionPlacement {
  const jurisdiction = jurisdictionOf(e);
  const named = {
    ...zspOf(e),
    city: oneOf(e, 'city', (t) => {
      const name = nameOf(t[1]);
      const at = t[2]?.toLowerCase();
      return name ? { name, in: at && JURISDICTION.test(at) ? at : null } : null;
    }, (x) => `${x.name.toLowerCase()} ${x.in}`),
    poi: oneOf(e, 'poi', (t) => nameOf(t[1]), (x) => x.toLowerCase())
  };

  const geo = tag(e, 'geo');
  const kind = tag(e, 'geo_kind');
  const m = geo ? /^lat:(-?\d+(?:\.\d+)?),lon:(-?\d+(?:\.\d+)?)$/.exec(geo) : null;
  if (!m || (kind !== 'subject_location' && kind !== 'jurisdiction')) return { jurisdiction, point: null, ...named };

  const declared = tag(e, 'geo_precision');
  const known = declared === 'address' || declared === '1km' || declared === 'city';
  // A point standing for a jurisdiction is a city at most; an undeclared one is ~1 km.
  const precision: GeoPrecision = kind === 'jurisdiction' ? 'city' : known ? declared : '1km';
  const round = (v: string) => Number(Number(v).toFixed(PLACES[precision]));
  const lat = round(m[1]!);
  const lon = round(m[2]!);
  const coarsened = declared !== precision || lat !== Number(m[1]) || lon !== Number(m[2]);
  return { jurisdiction, point: { lat, lon, precision, kind, coarsened }, ...named };
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
export function readMissionPackage(input: unknown, publishers: MissionPublishers = MISSION_PUBLISHERS): MissionReading {
  const raw = input as Event;
  if (
    !raw || typeof raw !== 'object' || raw.kind !== MISSION_PACKAGE_KIND || typeof raw.pubkey !== 'string' ||
    typeof raw.id !== 'string' || typeof raw.created_at !== 'number' ||
    !Array.isArray(raw.tags) || typeof raw.content !== 'string' || typeof raw.sig !== 'string'
  ) {
    return { ok: false, kind: 'not-a-package', because: 'Not a kind-30079 event.' };
  }
  // Before the signature is hashed: a string's length never exceeds its UTF-8 bytes, so only a near one is encoded.
  if (raw.content.length > PACKAGE_CONTENT_MAX || (raw.content.length * 3 > PACKAGE_CONTENT_MAX && new TextEncoder().encode(raw.content).length > PACKAGE_CONTENT_MAX)) {
    return { ok: false, kind: 'refused', because: 'Its content is larger than any reader takes.' };
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
  const registered = keyOf(publishers, e.pubkey);
  /*
   * A key not trusted to sign, or an event dated before its key's start, proves nothing about whose
   * it is: it carries no `from`, so it can hide nothing, and the feed drops it [decided 2026-10-18].
   * Both are read from the release and the event alone; whether the key's window is open now is the
   * reader's clock, asked in the registry gate before anything is kept [trust.ts, `gate`].
   */
  const start = registryTime(registered?.key.notBefore);
  const signs = !!registered && Number.isFinite(start) && e.created_at >= start;
  const known = signs ? registered : null;
  const from = signed && known ? { address: `${MISSION_PACKAGE_KIND}:${e.pubkey}:${tag(e, 'd') ?? ''}`, at: e.created_at, id: e.id } : null;
  const no = (kind: 'not-a-package' | 'desk' | 'refused', because: string): MissionReading =>
    from ? { ok: false, kind, because, from } : { ok: false, kind, because };

  if (!flag(e, 'starcom_mission_package') || !flag(e, 'navcom_handoff')) return no('not-a-package', 'Not handed off to NavCom.');
  if (!signed) return no('refused', 'The signature does not verify.');
  if (!registered) return no('refused', 'Not a publisher NavCom reads.');
  if (!known) {
    return no('refused', Number.isFinite(start) ? 'Dated before NavCom trusted the key that signed it.' : 'Signed by a key NavCom does not trust to sign yet.');
  }

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
  if (['objectives', 'reports', 'intel', 'assets'].some((k) => Array.isArray(manifest[k]) && (manifest[k] as unknown[]).length > PACKAGE_LIST_MAX)) {
    return no('refused', 'One of its lists is longer than any reader takes.');
  }

  /*
   * What a report will be held to, checked now rather than after the work [11.X]. A package an
   * operator could take part in but never report — no objectives, or ids a report cannot name, or
   * a line too long to count — was accepted, and the operator found out at the end.
   */
  const objectives = objectivesOf(manifest);
  if (objectives.length === 0) return no('refused', 'A field mission needs at least one objective.');
  if (!objectives.every((o) => OBJECTIVE_ID.test(o.id))) return no('refused', 'An objective id is not one a report could name.');
  if (new Set(objectives.map((o) => o.id)).size !== objectives.length) return no('refused', 'Two of its objectives share an id.');

  /*
   * What to count: Mecha Jono's packages ask at `metadata.mechaJono.format.effect`, and one made in
   * Starcom at `metadata.format.effect` (interchange rev 18), read after it. The same line twice is one
   * line, and a blank one says nothing to count.
   */
  const metadata = (manifest['metadata'] ?? {}) as Record<string, unknown>;
  const formats = [(metadata['mechaJono'] as Record<string, unknown> | undefined)?.['format'], metadata['format']]
    .map((f) => (f ?? {}) as Record<string, unknown>);
  const asked = formats.flatMap((f) => strings(f['effect']));
  const effectAll = [...new Set(asked.map((l) => l.trim()).filter(Boolean))];
  if (effectAll.some((l) => l.length > EFFECT_LINE_MAX)) return no('refused', 'An effect line is longer than a count could answer.');
  const effect = effectAll.filter((line) => !PEOPLE.test(line));
  const priority = Number(tag(e, 'priority'));
  const agent = known.entry.agent || tag(e, 'agent') !== undefined;
  const who = { pubkey: e.pubkey, name: known.entry.name, entry: known.entry.id, generation: known.key.generation };
  const retiring = known.key.frozen ? (known.key.frozen.confirmed ? 'confirmed' : 'unconfirmed') : null;
  const placement = placementOf(e);

  return {
    ok: true,
    mission: {
      address: `${MISSION_PACKAGE_KIND}:${e.pubkey}:${d}`,
      d,
      publisher: agent ? { ...who, agent: true } : { ...who, agent: false },
      retiring,
      title: typeof manifest['name'] === 'string' && manifest['name'] ? manifest['name'] : d,
      summary: typeof manifest['description'] === 'string' ? manifest['description'] : null,
      state,
      claims,
      validUntil: until,
      /*
       * Unconfirmed under a retiring key, it shows where it is filed and no finer [interchange spec
       * §3]: every package NavCom has read from the exposed key is dated after the exposure, so
       * nothing but the publisher's own list tells a planted one from a real one, and a planted
       * point is where a lure would send somebody.
       */
      placement: retiring === 'unconfirmed' ? { jurisdiction: placement.jurisdiction, point: null } : placement,
      family: tag(e, 'mission_family') ?? null,
      categories: prefixed(e, 'category:'),
      variant: prefixed(e, 'variant:')[0] ?? null,
      checks: tags(e, 'check'),
      citizenSafe: flag(e, 'citizen_safe'),
      priority: Number.isFinite(priority) ? priority : null,
      objectives,
      clock: [...new Set(formats.flatMap((f) => strings(f['clock'])))],
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
