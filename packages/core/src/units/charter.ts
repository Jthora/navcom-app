/**
 * A unit's charter: the closed menu its founders chose from, as one short code.
 *
 * **Needs outside review before any screen uses it.** Nothing outside `units/` imports this, and
 * `test/units-unreached.test.ts` fails if anything in the Field Terminal or the watch does. It is
 * pure: no relay, no storage, no clock.
 *
 * ## What the code is
 *
 * Twelve fields separated by dots, read before anybody shows anything back (invariant 9), and the
 * exact string both founders sign inside their founding statements:
 *
 * ```
 * nu1.g1.<tpl>.<shape>.<room>.<thr>.<term>.<cap>.<auth>.<serve>.<higher>.<lineage>
 * ```
 *
 * - `nu1` is the format and `g1` the governance rule. **A rule code never changes meaning once
 *   shipped**: a later release that changes how results evaluate ships `g2`, and a phone that does
 *   not know it says *needs an update* and evaluates nothing.
 * - `tpl`: `m` Military or `p` Plain. Templates are data, so another letter reads *needs an update*.
 * - `shape`: `l` Led (a CO and an XO) or `a` Any two.
 * - `room`: 4, 8, 12 or 15, fixed for the unit's life.
 * - `thr`, `term`, `cap`: majority `m` or two-thirds `t`; 12 or 24 months; `n` no CO cap or `2` two
 *   consecutive terms then one out. Each is `-` for Any two, which has no office.
 * - `auth`: `w` word and offers, `o` orders that may be declined freely, `n` orders that may name a
 *   member. Any two is always `w`.
 * - `serve`: `y` or `n`, whether the unit may serve under a higher unit. Any two is always `n`.
 * - `higher`: zero to five strictly ascending echelon markers (`p` platoon, `c` company, `b`
 *   battalion, `x` brigade, `d` division), then `i` for Independent or `e` and the Earth Alliance
 *   Articles' sha256 in 64 lower-case hex. A unit is founded with no markers: it is seated only by a
 *   higher unit's own acts, which are not built.
 * - `lineage`: `-`, or the 32-hex {@link lineageOf} the unit this one was re-founded from.
 *
 * ## The menu is closed, and what it leaves out has nowhere to go
 *
 * The rules a phone cannot enforce without a server (a secret ballot, counting ballots cast, a
 * voting window, a deadline, ranked rounds, a lot, a teller) are not on the menu, and the grammar has
 * no field for them: a code carrying one more field is malformed. **The floor is the menu** (decided
 * 2026-10-09): every Led unit has a term of 12 or 24 months and a standing recall, so a Led code
 * with no term cannot be written.
 *
 * Three ways to be refused, because they mean three different things to the person holding the
 * phone:
 *
 * - `needs-update`: something a later release could add without changing what `g1` means, such as a
 *   new template letter, a new echelon marker, a new format or a new rule code.
 * - `off-menu`: a value that breaks the menu or a fixed rule, such as a room of 16, a term of 36
 *   months, a quorum, Military with Any two, or orders in an Any two unit.
 * - `malformed`: anything else, including a second spelling of a valid charter (upper-case hex, a
 *   leading zero, a space). One charter has one code, so the code is its identity.
 *
 * Normative sources: docs/design/units.md §4, §7 and §8; the owner's decisions of 2026-10-09.
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { CREW_ROOM_MAX } from '../limits.js';

export const CHARTER_FORMAT = 'nu1';
export const RULE_G1 = 'g1';
/** Every governance rule this release can evaluate. A code never changes meaning once shipped. */
export const KNOWN_RULES = ['g1'] as const;

/** The rooms a unit may choose, smallest first. The last is {@link CREW_ROOM_MAX}. */
export const ROOMS = [4, 8, 12, CREW_ROOM_MAX] as const;
export type Room = (typeof ROOMS)[number];

export type Template = 'military' | 'plain';
export type Threshold = 'majority' | 'twoThirds';
export type TermMonths = 12 | 24;
export type CoCap = 'none' | 'twoThenOut';
export type Authority = 'word' | 'orders' | 'ordersNamed';

/**
 * How a unit's offices are filled, or that it has none.
 *
 * A discriminated union so an Any two unit cannot carry a threshold, a term or a cap even at the type
 * level, and a Led unit cannot leave one out.
 */
export type Governance =
  | { shape: 'led'; threshold: Threshold; term: TermMonths; coCap: CoCap }
  | { shape: 'anyTwo' };

export type Echelon = 'platoon' | 'company' | 'battalion' | 'brigade' | 'division';
export type Top = { kind: 'independent' } | { kind: 'alliance'; articles: string };

export interface Higher {
  /** Whether the unit may serve under a higher unit at all. */
  mayServe: boolean;
  /** The echelons above, nearest first. Empty at founding. */
  under: readonly Echelon[];
  /** Where the chain ends: Independent, or the Earth Alliance under one text of its Articles. */
  top: Top;
}

export interface Charter {
  rule: 'g1';
  template: Template;
  room: Room;
  governance: Governance;
  authority: Authority;
  higher: Higher;
  /** {@link lineageOf} the unit this was re-founded from, or null. */
  lineage: string | null;
}

export type CharterRead =
  | { ok: true; charter: Charter; code: string }
  | { ok: false; reason: 'needs-update' | 'off-menu' | 'malformed'; field?: string };

export class CharterError extends Error {}

/**
 * **A placeholder, not the Articles.** Sixty-four zeros: unmistakable, and no text hashes to it.
 *
 * The owner writes the Earth Alliance Articles. A draft exists and is not adopted, and the proposal
 * rule's number (three commands, decided 2026-10-09) belongs to a later phase. Until the owner
 * adopts a text, a unit choosing the Earth Alliance carries this. The real value will be the sha256
 * of the adopted text's exact UTF-8 bytes, and replacing it is a gate before any unit ships.
 */
export const ARTICLES_HASH_PLACEHOLDER = '0'.repeat(64);

/**
 * The longest a g1 code can be is 128 characters. Anything past this is refused once the format and
 * rule have been read, so a later release's longer code still reads *needs an update*.
 */
const CODE_MAX = 160;

const TEMPLATE_LETTER: Record<Template, string> = { military: 'm', plain: 'p' };
const THRESHOLD_LETTER: Record<Threshold, string> = { majority: 'm', twoThirds: 't' };
const CAP_LETTER: Record<CoCap, string> = { none: 'n', twoThenOut: '2' };
const AUTHORITY_LETTER: Record<Authority, string> = { word: 'w', orders: 'o', ordersNamed: 'n' };
/** Nearest first, and the order a code must list them in. */
const ECHELONS: readonly Echelon[] = ['platoon', 'company', 'battalion', 'brigade', 'division'];
const ECHELON_LETTER: Record<Echelon, string> = {
  platoon: 'p', company: 'c', battalion: 'b', brigade: 'x', division: 'd'
};
const MARKERS_MAX = 5;

const invert = <K extends string>(r: Record<K, string>): Map<string, K> =>
  new Map(Object.entries(r).map(([k, v]) => [v as string, k as K]));
const TEMPLATE_OF = invert(TEMPLATE_LETTER);
const THRESHOLD_OF = invert(THRESHOLD_LETTER);
const CAP_OF = invert(CAP_LETTER);
const AUTHORITY_OF = invert(AUTHORITY_LETTER);
const ECHELON_OF = invert(ECHELON_LETTER);

/*
 * The lexical class of each field: what a canonical spelling looks like, before what it means.
 * Marker letters never include `e` or `i`, the two letters that start the top, so a code splits one
 * way only, and any later marker a release adds will avoid them too.
 */
const LEX = {
  format: /^nu[1-9][0-9]{0,3}$/,
  rule: /^g[1-9][0-9]{0,3}$/,
  letter: /^[a-z]$/,
  number: /^(0|[1-9][0-9]{0,5})$/,
  letterOrDash: /^([a-z]|-)$/,
  numberOrDash: /^((0|[1-9][0-9]{0,5})|-)$/,
  capOrDash: /^([a-z0-9]|-)$/,
  higher: /^([a-df-hj-z]*)(?:i|e([0-9a-f]{64}))$/,
  lineage: /^(-|[0-9a-f]{32})$/
} as const;

const refuse = (reason: 'needs-update' | 'off-menu' | 'malformed', field?: string): CharterRead =>
  field === undefined ? { ok: false, reason } : { ok: false, reason, field };

/**
 * Reads a charter code, or says exactly why not. Total: it never throws, whatever it is given.
 *
 * A code reads only if it is the one canonical spelling of its charter, so
 * `charterCode(readCharter(x).charter) === x` for every `x` that reads.
 */
export function readCharter(code: unknown): CharterRead {
  if (typeof code !== 'string' || code.length === 0) return refuse('malformed');

  // Format and rule first, read from the first two fields alone and before the length cap: a later
  // release may give its code any shape and any length at all.
  const d1 = code.indexOf('.');
  const format = d1 < 0 ? code : code.slice(0, d1);
  if (format !== CHARTER_FORMAT) return LEX.format.test(format) ? refuse('needs-update', 'format') : refuse('malformed');
  if (d1 < 0) return refuse('malformed');
  const d2 = code.indexOf('.', d1 + 1);
  const rule = d2 < 0 ? code.slice(d1 + 1) : code.slice(d1 + 1, d2);
  if (rule !== RULE_G1) return LEX.rule.test(rule) ? refuse('needs-update', 'rule') : refuse('malformed');

  // A g1 code this release can read is never longer than this.
  if (code.length > CODE_MAX) return refuse('malformed');
  const f = code.split('.');
  if (f.length !== 12) return refuse('malformed');

  const [, , tpl, shape, room, thr, term, cap, auth, serve, higher, lineage] = f as [
    string, string, string, string, string, string, string, string, string, string, string, string
  ];

  // Pass 1: every field is spelled the one way it may be.
  const higherLex = LEX.higher.exec(higher);
  if (
    !LEX.letter.test(tpl) || !LEX.letter.test(shape) || !LEX.number.test(room) ||
    !LEX.letterOrDash.test(thr) || !LEX.numberOrDash.test(term) || !LEX.capOrDash.test(cap) ||
    !LEX.letter.test(auth) || !LEX.letter.test(serve) || !higherLex || !LEX.lineage.test(lineage)
  ) {
    return refuse('malformed');
  }
  const markers = higherLex[1]!;
  const articles = higherLex[2];

  // Pass 2: something a newer release could have written. A marker letter this release does not
  // know is looked up before the markers are counted, since a later release that adds an echelon
  // also allows one more marker.
  const template = TEMPLATE_OF.get(tpl);
  if (!template) return refuse('needs-update', 'template');
  const under: Echelon[] = [];
  for (const m of markers) {
    const echelon = ECHELON_OF.get(m);
    if (!echelon) return refuse('needs-update', 'higher');
    under.push(echelon);
  }
  if (under.length > MARKERS_MAX) return refuse('off-menu', 'higher');

  // Pass 3: the menu, and the pairings it allows.
  if (shape !== 'l' && shape !== 'a') return refuse('off-menu', 'shape');
  const roomN = Number(room);
  if (!(ROOMS as readonly number[]).includes(roomN)) return refuse('off-menu', 'room');
  for (let i = 1; i < under.length; i++) {
    if (ECHELONS.indexOf(under[i]!) <= ECHELONS.indexOf(under[i - 1]!)) return refuse('off-menu', 'higher');
  }
  if (serve !== 'y' && serve !== 'n') return refuse('off-menu', 'serve');
  const authority = AUTHORITY_OF.get(auth);
  if (!authority) return refuse('off-menu', 'authority');
  if (serve === 'n' && under.length > 0) return refuse('off-menu', 'higher');

  let governance: Governance;
  if (shape === 'l') {
    const threshold = THRESHOLD_OF.get(thr);
    if (!threshold) return refuse('off-menu', 'threshold');
    if (term !== '12' && term !== '24') return refuse('off-menu', 'term');
    const coCap = CAP_OF.get(cap);
    if (!coCap) return refuse('off-menu', 'cap');
    governance = { shape: 'led', threshold, term: Number(term) as TermMonths, coCap };
  } else {
    if (template === 'military') return refuse('off-menu', 'shape');
    if (thr !== '-') return refuse('off-menu', 'threshold');
    if (term !== '-') return refuse('off-menu', 'term');
    if (cap !== '-') return refuse('off-menu', 'cap');
    if (authority !== 'word') return refuse('off-menu', 'authority');
    if (serve !== 'n') return refuse('off-menu', 'serve');
    governance = { shape: 'anyTwo' };
  }

  const charter: Charter = {
    rule: 'g1',
    template,
    room: roomN as Room,
    governance,
    authority,
    higher: {
      mayServe: serve === 'y',
      under,
      top: articles === undefined ? { kind: 'independent' } : { kind: 'alliance', articles }
    },
    lineage: lineage === '-' ? null : lineage
  };
  return { ok: true, charter, code };
}

const CHARTER_KEYS = ['rule', 'template', 'room', 'governance', 'authority', 'higher', 'lineage'];
const LED_KEYS = ['shape', 'threshold', 'term', 'coCap'];
const HIGHER_KEYS = ['mayServe', 'under', 'top'];

const exactKeys = (o: unknown, keys: readonly string[]): boolean =>
  typeof o === 'object' && o !== null && !Array.isArray(o) &&
  Object.keys(o).every((k) => keys.includes(k)) && keys.every((k) => k in (o as object));

/**
 * The one code for this charter. Throws {@link CharterError} on anything off the menu, including
 * a field the menu does not have.
 */
export function charterCode(c: Charter): string {
  const fail = (): never => {
    throw new CharterError('That charter is not on the menu, so it has no code.');
  };
  if (!exactKeys(c, CHARTER_KEYS) || !exactKeys(c.higher, HIGHER_KEYS)) return fail();
  const g = c.governance as Record<string, unknown>;
  const led = g?.shape === 'led';
  if (!exactKeys(g, led ? LED_KEYS : ['shape'])) return fail();
  const top = c.higher.top as Record<string, unknown>;
  if (!exactKeys(top, top?.kind === 'alliance' ? ['kind', 'articles'] : ['kind'])) return fail();
  if (!Array.isArray(c.higher.under)) return fail();

  const letter = <K extends string>(map: Record<K, string>, value: unknown): string =>
    typeof value === 'string' && Object.hasOwn(map, value) ? map[value as K] : '?';
  const markers = c.higher.under.map((e) => letter(ECHELON_LETTER, e)).join('');
  const higher =
    top.kind === 'independent' ? `${markers}i`
      : top.kind === 'alliance' && typeof top.articles === 'string' ? `${markers}e${top.articles}`
        : '?';
  const fields = [
    CHARTER_FORMAT,
    typeof c.rule === 'string' ? c.rule : '?',
    letter(TEMPLATE_LETTER, c.template),
    led ? 'l' : g?.shape === 'anyTwo' ? 'a' : '?',
    typeof c.room === 'number' ? String(c.room) : '?',
    led ? letter(THRESHOLD_LETTER, g.threshold) : '-',
    led ? (typeof g.term === 'number' ? String(g.term) : '?') : '-',
    led ? letter(CAP_LETTER, g.coCap) : '-',
    letter(AUTHORITY_LETTER, c.authority),
    c.higher.mayServe === true ? 'y' : c.higher.mayServe === false ? 'n' : '?',
    higher,
    c.lineage === null ? '-' : typeof c.lineage === 'string' ? c.lineage : '?'
  ];
  const code = fields.join('.');
  const read = readCharter(code);
  if (!read.ok || JSON.stringify(read.charter) !== JSON.stringify(normalise(c))) return fail();
  return code;
}

/** The charter with its keys in one order, so two equal charters stringify alike. */
function normalise(c: Charter): Charter {
  const g = c.governance;
  const top = c.higher.top;
  return {
    rule: c.rule,
    template: c.template,
    room: c.room,
    governance: g.shape === 'led'
      ? { shape: 'led', threshold: g.threshold, term: g.term, coCap: g.coCap }
      : { shape: 'anyTwo' },
    authority: c.authority,
    higher: {
      mayServe: c.higher.mayServe,
      under: [...c.higher.under],
      top: top.kind === 'alliance' ? { kind: 'alliance', articles: top.articles } : { kind: 'independent' }
    },
    lineage: c.lineage
  };
}

/** A charter's identity: the sha256 of its code. The code is canonical, so this is too. */
export const charterId = (code: string): string => bytesToHex(sha256(utf8ToBytes(code)));

/**
 * Whether two codes are the same charter. A summary code shown before joining and the code the
 * founders signed must be: anything else is a different unit, whatever the screen says.
 */
export function sameCharter(a: string, b: string): boolean {
  return readCharter(a).ok && a === b;
}

/** Which Articles an Earth Alliance unit signed: the placeholder, or another text. Null if Independent. */
export function articlesStatus(c: Charter): 'placeholder' | 'other' | null {
  if (c.higher.top.kind !== 'alliance') return null;
  return c.higher.top.articles === ARTICLES_HASH_PLACEHOLDER ? 'placeholder' : 'other';
}

const LINEAGE_INFO = 'navcom-unit-lineage-v1';

/**
 * The *re-founded from* mark for a unit re-formed out of the unit `oldUnitId`.
 *
 * The first 32 hex of sha256 over a domain separator and the old unit's 16-byte id. Former members
 * hold the old id and can check it; a photographed code learns nothing, because the id itself is
 * never published.
 */
export function lineageOf(oldUnitId: string): string {
  if (typeof oldUnitId !== 'string' || !/^[0-9a-f]{32}$/.test(oldUnitId)) {
    throw new CharterError('A unit id is 32 lower-case hex characters.');
  }
  return bytesToHex(sha256(concatBytes(utf8ToBytes(LINEAGE_INFO), hexToBytes(oldUnitId)))).slice(0, 32);
}

/**
 * How many signatures carry an election or a recall, out of an electorate of `m`.
 *
 * Counted against the whole frozen electorate, never against ballots cast, so silence counts as no.
 * Majority is ⌊m/2⌋+1; two-thirds is ⌈2m/3⌉. Never fewer than one.
 */
export function thresholdOf(m: number, t: Threshold): number {
  const k = t === 'majority' ? Math.floor(m / 2) + 1 : Math.floor((2 * m + 2) / 3);
  return Math.max(1, k);
}

/** ⌈3m/4⌉: what a CO who has served two consecutive terms needs, where the cap applies. */
export const threeQuartersOf = (m: number): number => Math.max(1, Math.floor((3 * m + 3) / 4));

/**
 * `months` calendar months after `unixSeconds`, in UTC, clamped to the last day of a shorter month.
 * Terms end on a date a person can read, not after a count of seconds.
 */
export function addMonthsUTC(unixSeconds: number, months: number): number {
  const d = new Date(unixSeconds * 1000);
  const target = d.getUTCMonth() + months;
  const year = d.getUTCFullYear() + Math.floor(target / 12);
  const month = ((target % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const ms = Date.UTC(
    year, month, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()
  );
  return Math.floor(ms / 1000);
}

/** A leaf unit's echelon in the Military template comes from its room, never a headcount. */
export const leafEchelon = (room: Room): 'team' | 'squad' => (room === 4 ? 'team' : 'squad');
