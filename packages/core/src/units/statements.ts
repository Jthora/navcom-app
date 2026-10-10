/**
 * The signed statements a unit is made of: founding, admission, removal, office, endorsement,
 * petition, result, checkpoint.
 *
 * **Needs outside review before any screen uses it.** Nothing outside `units/` imports this.
 *
 * ## One shape for every statement
 *
 * Each is a NIP-01 event that is **never published**, of kind {@link KIND_CREW_STATEMENT} (`20917`,
 * ephemeral, like `20915` and `20916`), with no tags, `created_at` the signer's own clock, and
 * `content` exactly `JSON.stringify` of a fixed-length array whose first element is
 * {@link STATEMENT_TAG}. The signed bytes are NIP-01's, so any nostr library checks them, and the
 * key is the signer's own per-unit key, never a contact or operational key. This is the shape the
 * watch code's signature (`events/watch-code.ts`) and a `Distress` answer (`events/response.ts`)
 * already use.
 *
 * - `U` is the unit's 16-byte id as 32 lower-case hex. It is never published.
 * - `K` is a per-unit key and `H` a sha256, each in 64 lower-case hex.
 * - `P` is `prev`: one to {@link MAX_PARENTS} act ids, sorted and distinct. The first act names the
 *   root id ({@link rootIdOf}). Order in a unit comes from these links, never from a clock.
 * - A compact signature `C` is `[K, created_at, sig]`: everything needed to check a loose statement
 *   whose content the reader rebuilds from context (the watch code's `s` pattern).
 *
 * ```
 * found     [T,'found',U,code,role,otherK,callsign,former]       role co | xo | member; former C | null
 * admit     [T,'admit',U,P,K,callsign,readmits]                 readmits K | null       (needs a sign)
 * invite    [T,'invite',U,P,formerK]                            re-founded units only    (needs a sign)
 * accept    [T,'accept',U,P,inviteId,callsign,C]                signed by the new key
 * remove    [T,'remove',U,P,[K...],reasonH]                                               (needs a sign)
 * leave     [T,'leave',U,P]
 * vacate    [T,'vacate',U,P,office]                             no successor field
 * open      [T,'open',U,P,office]                               an election; no window, no deadline
 * petition  [T,'petition',U,P,office,subjectK,reasonH]          a standing recall
 * result    [T,'result',U,P,runId,candidateK,rule,digestH,[at,sig],[C x k]]
 * recall    [T,'recall',U,P,petitionId,rule,digestH,[C x k-1]]
 * endorse   [T,'endorse',U,runId,candidateK]                    one candidate; no ranking
 * stand     [T,'stand',U,runId]                                 nobody wins an office they did not ask for
 * support   [T,'support',U,petitionId]
 * sign      [T,'sign',U,actId]                                  the second signer of an act or a checkpoint
 * checkpoint [T,'checkpoint',U,head,snapshot]
 * refound-by [T,'refound-by',U,lineage,newK]                    signed by a former key, carried as C
 * accept-by  [T,'accept-by',U,inviteId,newK]                    signed by a former key, carried as C
 * ```
 *
 * ## What cannot be said
 *
 * The only free text anywhere is a callsign. A reason travels as the sha256 of a line, never the
 * line. There is no field for an agent, an attendance, a deadline, a window, a ranking, a no vote, a
 * count of ballots cast, a quorum or a successor, and no statement type for closing a vote, tallying
 * it, drawing a lot or appointing anyone: a type this release does not know reads `unknown-act`, and
 * a statement with one field more reads `malformed`.
 *
 * ## Reading is total
 *
 * {@link readStatement} never throws. It verifies a fresh copy of the event, because nostr-tools
 * caches `verifyEvent`'s verdict on the object it was given, and a signed event changed in place
 * afterwards would otherwise still verify.
 *
 * A phone re-reads the same statements every time one more arrives, and a BIP-340 check is most of
 * the cost (about a millisecond each on a Mac). So a bounded set remembers which (id, key,
 * signature) triples have verified. **The id is recomputed from the content on every read and never
 * taken from the cache**, so a remembered triple vouches only for the exact bytes that hash to it.
 */

import { finalizeEvent, getEventHash, verifyEvent } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { KIND_CREW_STATEMENT } from '../events/kinds.js';
import { CALLSIGN_MAX, CREW_ROOM_MAX, withinLimit } from '../limits.js';
import type { SecretKey } from '../crypto/keys.js';

export const STATEMENT_TAG = 'navcom-unit-v1';
/** The most acts one act may name as its parents. */
export const MAX_PARENTS = 4;

export type Office = 'co' | 'xo';
export type Role = 'co' | 'xo' | 'member';
/** `[pubkey, created_at, sig]`: a signature whose statement the reader rebuilds from context. */
export type Compact = readonly [pubkey: string, createdAt: number, sig: string];
/** A candidate's stand, carried in a result: the candidate's key is the result's own `candidate`. */
export type StandSig = readonly [createdAt: number, sig: string];

export interface Found {
  t: 'found'; unit: string; code: string; role: Role; other: string; callsign: string; former: Compact | null;
}
export interface Admit {
  t: 'admit'; unit: string; prev: readonly string[]; key: string; callsign: string; readmits: string | null;
}
export interface Invite { t: 'invite'; unit: string; prev: readonly string[]; former: string }
export interface Accept {
  t: 'accept'; unit: string; prev: readonly string[]; invite: string; callsign: string; former: Compact;
}
export interface Remove { t: 'remove'; unit: string; prev: readonly string[]; keys: readonly string[]; reason: string }
export interface Leave { t: 'leave'; unit: string; prev: readonly string[] }
export interface Vacate { t: 'vacate'; unit: string; prev: readonly string[]; office: Office }
export interface Open { t: 'open'; unit: string; prev: readonly string[]; office: Office }
export interface Petition {
  t: 'petition'; unit: string; prev: readonly string[]; office: Office; subject: string; reason: string;
}
export interface Result {
  t: 'result'; unit: string; prev: readonly string[]; run: string; candidate: string; rule: string;
  digest: string; stand: StandSig; sigs: readonly Compact[];
}
export interface Recall {
  t: 'recall'; unit: string; prev: readonly string[]; petition: string; rule: string; digest: string;
  sigs: readonly Compact[];
}
export interface Endorse { t: 'endorse'; unit: string; run: string; candidate: string }
export interface Stand { t: 'stand'; unit: string; run: string }
export interface Support { t: 'support'; unit: string; petition: string }
export interface Sign { t: 'sign'; unit: string; act: string }
export interface RefoundBy { t: 'refound-by'; unit: string; lineage: string; key: string }
export interface AcceptBy { t: 'accept-by'; unit: string; invite: string; key: string }

/** One office as a checkpoint carries it. `n` is the term number; 0 is a re-formed unit's acting term. */
export interface OfficeSnap { holder: string | null; acting: boolean; n: number; start: number; end: number }
/** An open election run or petition, with its electorate frozen at the state it named. */
export interface RunSnap {
  id: string;
  /** `end` a term-end election, `fill` a vacancy, `first` a re-formed unit's first, `petition` a recall. */
  kind: 'end' | 'fill' | 'first' | 'petition';
  office: Office;
  subject: string | null;
  opener: string;
  at: number;
  electorate: readonly string[];
}
/** A recall that passed this term, and who carried it. */
export interface RecalledSnap { key: string; office: Office; n: number; signers: readonly string[] }
/**
 * `[key, last, count]`: the last CO term `key` served in (not acting), and how many consecutive CO
 * terms end there. Only keys whose `last` is the current term or the one before are kept.
 */
export type ServedSnap = readonly [key: string, last: number, count: number];

/**
 * Everything a phone needs to go on from a checkpoint without the history before it.
 *
 * Governance §2.4 asks for the term number, the count of consecutive terms, the petitions this term
 * and the previous change of command. The rest is what a phone anchored here needs to check the
 * next act: the electorates of open runs (a digest alone could not tell it whether a signer
 * counts), who was removed (who may never be admitted again), who was removed while holding an
 * office (who may be re-admitted by any two while that office's election is open), the
 * invitations of a re-founded unit, and who served the CO office in the last two terms.
 *
 * `cap` is the count governance §2.4 names: the CO holder and the consecutive CO terms they have
 * served. It is read from `served`, which is what the cap is applied from, because a CO cap that
 * followed only the current holder could be stepped around by swapping posts through a vacancy.
 */
export interface Snapshot {
  rule: 'g1';
  roster: string;
  co: OfficeSnap | null;
  xo: OfficeSnap | null;
  cap: { holder: string | null; count: number } | null;
  petitioned: readonly (readonly [Office, string, number])[];
  runs: readonly RunSnap[];
  recalled: readonly RecalledSnap[];
  removed: readonly string[];
  holding: readonly (readonly [string, readonly Office[]])[];
  invited: readonly (readonly [string, string, boolean])[];
  prevCommand: string | null;
  served: readonly ServedSnap[];
}
export interface Checkpoint { t: 'checkpoint'; unit: string; head: readonly string[]; snapshot: Snapshot }

export type Act = Admit | Invite | Accept | Remove | Leave | Vacate | Open | Petition | Result | Recall;
export type Loose = Endorse | Stand | Support | Sign;
export type Statement = Found | Act | Loose | Checkpoint | RefoundBy | AcceptBy;
export type StatementType = Statement['t'];

export type StatementRead =
  | { ok: true; id: string; pubkey: string; createdAt: number; statement: Statement }
  | { ok: false; reason: 'malformed' | 'bad-signature' | 'wrong-kind' | 'unknown-act' };

export class StatementError extends Error {}

/** Effects of concurrent acts apply in this order, so the order never depends on an id. */
const CLASS: Record<Act['t'], 0 | 1 | 2 | 3 | 4 | 5> = {
  remove: 0, leave: 0, result: 1, recall: 2, vacate: 3, open: 4, petition: 4, admit: 5, invite: 5, accept: 5
};
export const CHAIN_ACTS = Object.keys(CLASS) as readonly Act['t'][];
export const isAct = (s: Statement): s is Act => Object.hasOwn(CLASS, s.t);
export const actClass = (t: Act['t']): 0 | 1 | 2 | 3 | 4 | 5 => CLASS[t];
/** Acts that take effect only with a second member's `sign`. A removal in a unit of two is the exception. */
export const needsCosign = (t: StatementType): boolean => t === 'admit' || t === 'invite' || t === 'remove';

const KNOWN = new Set<string>([
  ...CHAIN_ACTS, 'found', 'endorse', 'stand', 'support', 'sign', 'checkpoint', 'refound-by', 'accept-by'
]);

// ---------------------------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------------------------

/** (id, pubkey, sig) triples that have verified. Cleared when full: a cache, never a source of truth. */
const verifiedTriples = new Set<string>();
const VERIFIED_MAX = 8192;

/** Whether `e` is signed by its `pubkey` over exactly its content. `e` must be a fresh plain object. */
function signedAsClaimed(e: Event): boolean {
  if (getEventHash(e) !== e.id) return false;
  const triple = e.id + e.pubkey + e.sig;
  if (verifiedTriples.has(triple)) return true;
  const ok = verifyEvent(e);
  if (ok) {
    if (verifiedTriples.size >= VERIFIED_MAX) verifiedTriples.clear();
    verifiedTriples.add(triple);
  }
  return ok;
}

// ---------------------------------------------------------------------------------------------
// Lexical checks
// ---------------------------------------------------------------------------------------------

const HEX32 = /^[0-9a-f]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
const RULE = /^g[1-9][0-9]{0,3}$/;
/**
 * C0, DEL and C1 controls, line and paragraph separators, every format character (the bidirectional
 * marks and overrides, zero-width spaces and joiners, the word joiner, the byte-order mark) and every
 * other code point Unicode says to draw as nothing. A callsign is somebody's name on somebody else's
 * screen, and two members compared by string must not both read "Raven".
 */
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;
/** The longest content any statement can need: a result with fifteen signatures is about 3.5 kB. */
const CONTENT_MAX = 32_768;
/** Seconds. Anything beyond is not a time a person's phone wrote. */
const TIME_MAX = 2 ** 40;

const isUnit = (v: unknown): v is string => typeof v === 'string' && HEX32.test(v);
const isKey = (v: unknown): v is string => typeof v === 'string' && HEX64.test(v);
const isHash = isKey;
const isTime = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= TIME_MAX;
const isSig = (v: unknown): v is string => typeof v === 'string' && HEX128.test(v);
const isOffice = (v: unknown): v is Office => v === 'co' || v === 'xo';
/** One spelling per name: no invisible characters, no padding, and composed (NFC) form only. */
export const isCallsign = (v: unknown): v is string =>
  withinLimit(v, CALLSIGN_MAX) && !CONTROL.test(v) && v.trim() === v && v.normalize('NFC') === v;

/** Sorted, distinct, and each passing `each`; `min` to `max` long. */
function sortedSet(v: unknown, min: number, max: number, each: (x: unknown) => boolean): v is string[] {
  if (!Array.isArray(v) || v.length < min || v.length > max) return false;
  for (let i = 0; i < v.length; i++) {
    if (!each(v[i])) return false;
    if (i > 0 && !((v[i - 1] as string) < (v[i] as string))) return false;
  }
  return true;
}
const isPrev = (v: unknown): v is string[] => sortedSet(v, 1, MAX_PARENTS, isHash);
const isCompact = (v: unknown): v is Compact =>
  Array.isArray(v) && v.length === 3 && isKey(v[0]) && isTime(v[1]) && isSig(v[2]);
const isStandSig = (v: unknown): v is StandSig =>
  Array.isArray(v) && v.length === 2 && isTime(v[0]) && isSig(v[1]);

const isOfficeSnap = (v: unknown): boolean =>
  v === null ||
  (Array.isArray(v) && v.length === 5 && (v[0] === null || isKey(v[0])) && (v[1] === 0 || v[1] === 1) &&
    Number.isSafeInteger(v[2]) && (v[2] as number) >= 0 && (v[2] as number) < 10_000 &&
    isTime(v[3]) && isTime(v[4]) && (v[3] as number) <= (v[4] as number));

const RUN_KINDS = ['end', 'fill', 'first', 'petition'] as const;

/** The snapshot's wire form: a fixed array. Returns null if any part is not its one spelling. */
function snapshotFrom(v: unknown): Snapshot | null {
  if (!Array.isArray(v) || v.length !== 13) return null;
  const [rule, roster, co, xo, cap, petitioned, runs, recalled, removed, holding, invited, prevCommand, served] = v;
  if (rule !== 'g1' || !isHash(roster) || !isOfficeSnap(co) || !isOfficeSnap(xo)) return null;
  if ((co === null) !== (xo === null) || (co === null) !== (cap === null)) return null;
  if (cap !== null && !(Array.isArray(cap) && cap.length === 2 && (cap[0] === null || isKey(cap[0])) &&
    Number.isSafeInteger(cap[1]) && cap[1] >= 0 && cap[1] < 10_000)) return null;
  const many = 512;
  if (!Array.isArray(petitioned) || petitioned.length > many || !petitioned.every((p) =>
    Array.isArray(p) && p.length === 3 && isOffice(p[0]) && isKey(p[1]) && Number.isSafeInteger(p[2]) && p[2] >= 0
  )) return null;
  if (!Array.isArray(runs) || runs.length > many || !runs.every((r) =>
    Array.isArray(r) && r.length === 7 && isHash(r[0]) && (RUN_KINDS as readonly unknown[]).includes(r[1]) &&
    isOffice(r[2]) && (r[3] === null || isKey(r[3])) && isKey(r[4]) && isTime(r[5]) &&
    sortedSet(r[6], 1, CREW_ROOM_MAX, isKey)
  )) return null;
  if (!Array.isArray(recalled) || recalled.length > many || !recalled.every((r) =>
    Array.isArray(r) && r.length === 4 && isKey(r[0]) && isOffice(r[1]) && Number.isSafeInteger(r[2]) &&
    r[2] >= 0 && sortedSet(r[3], 1, CREW_ROOM_MAX, isKey)
  )) return null;
  if (!sortedSet(removed, 0, 4096, isKey)) return null;
  if (!Array.isArray(holding) || holding.length > 4096 || !holding.every((h) =>
    Array.isArray(h) && h.length === 2 && isKey(h[0]) && sortedSet(h[1], 1, 2, isOffice)
  )) return null;
  if (!Array.isArray(invited) || invited.length > 4096 || !invited.every((i) =>
    Array.isArray(i) && i.length === 3 && isHash(i[0]) && isKey(i[1]) && (i[2] === 0 || i[2] === 1)
  )) return null;
  if (!(prevCommand === null || isHash(prevCommand))) return null;
  if (!Array.isArray(served) || served.length > 4096 || !served.every((s, i) =>
    Array.isArray(s) && s.length === 3 && isKey(s[0]) && Number.isSafeInteger(s[1]) && s[1] >= 0 && s[1] < 10_000 &&
    Number.isSafeInteger(s[2]) && s[2] >= 1 && s[2] < 10_000 &&
    (i === 0 || (served[i - 1] as string[])[0]! < (s[0] as string))
  )) return null;
  if (co === null && served.length > 0) return null;

  const office = (o: unknown): OfficeSnap | null => {
    if (o === null) return null;
    const a = o as [string | null, 0 | 1, number, number, number];
    return { holder: a[0], acting: a[1] === 1, n: a[2], start: a[3], end: a[4] };
  };
  return {
    rule: 'g1',
    roster: roster as string,
    co: office(co),
    xo: office(xo),
    cap: cap === null ? null : { holder: (cap as [string | null, number])[0], count: (cap as [string | null, number])[1] },
    petitioned: (petitioned as [Office, string, number][]).map((p) => [p[0], p[1], p[2]] as const),
    runs: (runs as [string, RunSnap['kind'], Office, string | null, string, number, string[]][]).map((r) => ({
      id: r[0], kind: r[1], office: r[2], subject: r[3], opener: r[4], at: r[5], electorate: r[6]
    })),
    recalled: (recalled as [string, Office, number, string[]][]).map((r) => ({
      key: r[0], office: r[1], n: r[2], signers: r[3]
    })),
    removed: removed as string[],
    holding: (holding as [string, Office[]][]).map((h) => [h[0], h[1]] as const),
    invited: (invited as [string, string, 0 | 1][]).map((i) => [i[0], i[1], i[2] === 1] as const),
    prevCommand: prevCommand as string | null,
    served: (served as [string, number, number][]).map((s) => [s[0], s[1], s[2]] as const)
  };
}

/** Reads a snapshot from its wire form, or null. */
export const readSnapshot = (wire: unknown): Snapshot | null => snapshotFrom(wire);

/** The one form of a snapshot: written to the wire and read back, so two equal ones compare equal. */
export function canonicalSnapshot(s: Snapshot): Snapshot {
  const c = snapshotFrom(JSON.parse(JSON.stringify(snapshotWire(s))));
  if (!c) throw new StatementError('That snapshot cannot be written.');
  return c;
}

/** The snapshot as it travels: a fixed array, with every list in one order. */
export function snapshotWire(s: Snapshot): unknown[] {
  const office = (o: OfficeSnap | null) => (o === null ? null : [o.holder, o.acting ? 1 : 0, o.n, o.start, o.end]);
  const byJson = <T>(xs: readonly T[]): T[] =>
    [...xs].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0));
  return [
    'g1',
    s.roster,
    office(s.co),
    office(s.xo),
    s.cap === null ? null : [s.cap.holder, s.cap.count],
    byJson(s.petitioned.map((p) => [p[0], p[1], p[2]])),
    byJson(s.runs.map((r) => [r.id, r.kind, r.office, r.subject, r.opener, r.at, [...r.electorate].sort()])),
    byJson(s.recalled.map((r) => [r.key, r.office, r.n, [...r.signers].sort()])),
    [...s.removed].sort(),
    byJson(s.holding.map((h) => [h[0], [...h[1]].sort()])),
    byJson(s.invited.map((i) => [i[0], i[1], i[2] ? 1 : 0])),
    s.prevCommand,
    [...s.served]
      .map((r): [string, number, number] => [r[0], r[1], r[2]])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  ];
}

// ---------------------------------------------------------------------------------------------
// Content: one fixed array per type, and back
// ---------------------------------------------------------------------------------------------

/** The content array a statement is signed as. */
export function contentOf(s: Statement): unknown[] {
  const T = STATEMENT_TAG;
  switch (s.t) {
    case 'found': return [T, s.t, s.unit, s.code, s.role, s.other, s.callsign, s.former];
    case 'admit': return [T, s.t, s.unit, s.prev, s.key, s.callsign, s.readmits];
    case 'invite': return [T, s.t, s.unit, s.prev, s.former];
    case 'accept': return [T, s.t, s.unit, s.prev, s.invite, s.callsign, s.former];
    case 'remove': return [T, s.t, s.unit, s.prev, s.keys, s.reason];
    case 'leave': return [T, s.t, s.unit, s.prev];
    case 'vacate': return [T, s.t, s.unit, s.prev, s.office];
    case 'open': return [T, s.t, s.unit, s.prev, s.office];
    case 'petition': return [T, s.t, s.unit, s.prev, s.office, s.subject, s.reason];
    case 'result': return [T, s.t, s.unit, s.prev, s.run, s.candidate, s.rule, s.digest, s.stand, s.sigs];
    case 'recall': return [T, s.t, s.unit, s.prev, s.petition, s.rule, s.digest, s.sigs];
    case 'endorse': return [T, s.t, s.unit, s.run, s.candidate];
    case 'stand': return [T, s.t, s.unit, s.run];
    case 'support': return [T, s.t, s.unit, s.petition];
    case 'sign': return [T, s.t, s.unit, s.act];
    case 'checkpoint': return [T, s.t, s.unit, s.head, snapshotWire(s.snapshot)];
    case 'refound-by': return [T, s.t, s.unit, s.lineage, s.key];
    case 'accept-by': return [T, s.t, s.unit, s.invite, s.key];
  }
}

/** Parses content already known to be an array led by the tag and a known type. */
function statementFrom(a: unknown[]): Statement | null {
  const t = a[1] as StatementType;
  const unit = a[2];
  if (!isUnit(unit)) return null;
  const arity = (n: number) => a.length === n;
  switch (t) {
    case 'found': {
      const [, , , code, role, other, callsign, former] = a;
      if (!arity(8) || typeof code !== 'string' || code.length === 0 || code.length > 160) return null;
      if (role !== 'co' && role !== 'xo' && role !== 'member') return null;
      if (!isKey(other) || !isCallsign(callsign) || !(former === null || isCompact(former))) return null;
      return { t, unit, code, role, other, callsign, former: former as Compact | null };
    }
    case 'admit': {
      const [, , , prev, key, callsign, readmits] = a;
      if (!arity(7) || !isPrev(prev) || !isKey(key) || !isCallsign(callsign)) return null;
      if (!(readmits === null || isKey(readmits))) return null;
      return { t, unit, prev, key, callsign, readmits };
    }
    case 'invite': {
      const [, , , prev, former] = a;
      if (!arity(5) || !isPrev(prev) || !isKey(former)) return null;
      return { t, unit, prev, former };
    }
    case 'accept': {
      const [, , , prev, invite, callsign, former] = a;
      if (!arity(7) || !isPrev(prev) || !isHash(invite) || !isCallsign(callsign) || !isCompact(former)) return null;
      return { t, unit, prev, invite, callsign, former };
    }
    case 'remove': {
      const [, , , prev, keys, reason] = a;
      if (!arity(6) || !isPrev(prev) || !sortedSet(keys, 1, CREW_ROOM_MAX, isKey) || !isHash(reason)) return null;
      return { t, unit, prev, keys, reason };
    }
    case 'leave': {
      const [, , , prev] = a;
      if (!arity(4) || !isPrev(prev)) return null;
      return { t, unit, prev };
    }
    case 'vacate':
    case 'open': {
      const [, , , prev, office] = a;
      if (!arity(5) || !isPrev(prev) || !isOffice(office)) return null;
      return { t, unit, prev, office };
    }
    case 'petition': {
      const [, , , prev, office, subject, reason] = a;
      if (!arity(7) || !isPrev(prev) || !isOffice(office) || !isKey(subject) || !isHash(reason)) return null;
      return { t, unit, prev, office, subject, reason };
    }
    case 'result': {
      const [, , , prev, run, candidate, rule, digest, stand, sigs] = a;
      if (!arity(10) || !isPrev(prev) || !isHash(run) || !isKey(candidate)) return null;
      if (typeof rule !== 'string' || !RULE.test(rule) || !isHash(digest) || !isStandSig(stand)) return null;
      if (!Array.isArray(sigs) || sigs.length < 1 || sigs.length > CREW_ROOM_MAX || !sigs.every(isCompact)) return null;
      return { t, unit, prev, run, candidate, rule, digest, stand, sigs };
    }
    case 'recall': {
      const [, , , prev, petition, rule, digest, sigs] = a;
      if (!arity(8) || !isPrev(prev) || !isHash(petition)) return null;
      if (typeof rule !== 'string' || !RULE.test(rule) || !isHash(digest)) return null;
      // k - 1 supports: none at all where one signature carries a petition (an electorate of one).
      if (!Array.isArray(sigs) || sigs.length > CREW_ROOM_MAX || !sigs.every(isCompact)) return null;
      return { t, unit, prev, petition, rule, digest, sigs };
    }
    case 'endorse': {
      const [, , , run, candidate] = a;
      if (!arity(5) || !isHash(run) || !isKey(candidate)) return null;
      return { t, unit, run, candidate };
    }
    case 'stand': {
      const [, , , run] = a;
      if (!arity(4) || !isHash(run)) return null;
      return { t, unit, run };
    }
    case 'support': {
      const [, , , petition] = a;
      if (!arity(4) || !isHash(petition)) return null;
      return { t, unit, petition };
    }
    case 'sign': {
      const [, , , act] = a;
      if (!arity(4) || !isHash(act)) return null;
      return { t, unit, act };
    }
    case 'checkpoint': {
      const [, , , head, snap] = a;
      if (!arity(5) || !sortedSet(head, 1, MAX_PARENTS, isHash)) return null;
      const snapshot = snapshotFrom(snap);
      if (!snapshot) return null;
      return { t, unit, head, snapshot };
    }
    case 'refound-by': {
      const [, , , lineage, key] = a;
      if (!arity(5) || typeof lineage !== 'string' || !HEX32.test(lineage) || !isKey(key)) return null;
      return { t, unit, lineage, key };
    }
    case 'accept-by': {
      const [, , , invite, key] = a;
      if (!arity(5) || !isHash(invite) || !isKey(key)) return null;
      return { t, unit, invite, key };
    }
    default:
      return null;
  }
}

/** The never-published event a statement is signed as, before its id and signature. */
export function statementTemplate(s: Statement, pubkey: string, createdAt: number) {
  return { kind: KIND_CREW_STATEMENT, pubkey, created_at: createdAt, tags: [] as string[][], content: JSON.stringify(contentOf(s)) };
}

/**
 * Signs a statement with a per-unit key. Throws {@link StatementError} on anything a reader would
 * refuse, so a builder can never emit what {@link readStatement} would call malformed.
 */
export function signStatement(secret: SecretKey, s: Statement, createdAt: number): Event {
  if (!isTime(createdAt)) throw new StatementError('A statement’s time is whole seconds.');
  const content = JSON.stringify(contentOf(s));
  if (content.length > CONTENT_MAX) throw new StatementError('That statement is too long to be one.');
  const parsed = statementFrom(JSON.parse(content) as unknown[]);
  if (!parsed || JSON.stringify(contentOf(parsed)) !== content) {
    throw new StatementError('That is not a statement this release can read, so it was not signed.');
  }
  return finalizeEvent({ kind: KIND_CREW_STATEMENT, created_at: createdAt, tags: [], content }, secret);
}

/** A fresh, plain copy of the fields an event's id and signature cover. */
function plainCopy(e: unknown): Event | null {
  if (typeof e !== 'object' || e === null) return null;
  const o = e as Record<string, unknown>;
  if (!isHash(o.id) || !isKey(o.pubkey) || !isTime(o.created_at) || typeof o.kind !== 'number' ||
    !Array.isArray(o.tags) || typeof o.content !== 'string' || !isSig(o.sig)) {
    return null;
  }
  return {
    id: o.id, pubkey: o.pubkey, created_at: o.created_at, kind: o.kind,
    tags: (o.tags as unknown[]).map((t) => (Array.isArray(t) ? [...t] : t)) as string[][],
    content: o.content, sig: o.sig
  };
}

/**
 * Reads one statement. Total: never throws.
 *
 * Checks, in order: the event's shape, its kind, its signature (on a fresh copy), no tags, content
 * that is canonical JSON of an array led by the tag, a known type, and then that type's exact arity
 * and every field's one spelling.
 */
export function readStatement(e: unknown): StatementRead {
  const copy = plainCopy(e);
  if (!copy) return { ok: false, reason: 'malformed' };
  if (copy.kind !== KIND_CREW_STATEMENT) return { ok: false, reason: 'wrong-kind' };
  let verified = false;
  try {
    verified = signedAsClaimed(copy);
  } catch {
    verified = false;
  }
  if (!verified) return { ok: false, reason: 'bad-signature' };
  if (copy.tags.length !== 0 || copy.content.length > CONTENT_MAX) return { ok: false, reason: 'malformed' };
  let a: unknown;
  try {
    a = JSON.parse(copy.content);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!Array.isArray(a) || a[0] !== STATEMENT_TAG || typeof a[1] !== 'string') return { ok: false, reason: 'malformed' };
  if (!KNOWN.has(a[1])) return /^[a-z][a-z-]{0,23}$/.test(a[1]) ? { ok: false, reason: 'unknown-act' } : { ok: false, reason: 'malformed' };
  const statement = statementFrom(a);
  if (!statement || JSON.stringify(contentOf(statement)) !== copy.content) return { ok: false, reason: 'malformed' };
  return { ok: true, id: copy.id, pubkey: copy.pubkey, createdAt: copy.created_at, statement };
}

/** The compact form of a signed statement: `[pubkey, created_at, sig]`. */
export const compactOf = (e: Event): Compact => [e.pubkey, e.created_at, e.sig];

/**
 * Whether `c` is a signature on `expected`, by the key it names, at the time it names. Never throws.
 *
 * The reader rebuilds the statement from context (the run and candidate it should be about), so a
 * signature reused for another run, candidate or unit fails here.
 */
export function checkCompact(c: Compact, expected: Statement): boolean {
  try {
    if (!isCompact(c)) return false;
    const template = statementTemplate(expected, c[0], c[1]);
    return signedAsClaimed({ ...template, id: getEventHash(template), sig: c[2] });
  } catch {
    return false;
  }
}

/**
 * The id the first acts name: sha256 over the tag, the unit, and both founding statements' ids,
 * sorted, so it is the same whichever founder's phone computes it.
 */
export function rootIdOf(foundA: Event, foundB: Event): string {
  const a = readStatement(foundA);
  const b = readStatement(foundB);
  if (!a.ok || !b.ok || a.statement.t !== 'found' || b.statement.t !== 'found' ||
    a.statement.unit !== b.statement.unit || a.id === b.id) {
    throw new StatementError('A unit’s root is two founding statements for the same unit.');
  }
  return rootId(a.statement.unit, a.id, b.id);
}

/** {@link rootIdOf} from the unit and the two ids alone. */
export function rootId(unit: string, idA: string, idB: string): string {
  return sha256Json([STATEMENT_TAG, 'root', unit, [idA, idB].sort()]);
}

/** sha256 hex of `JSON.stringify(value)`, as `log.ts` hashes its entries. */
export const sha256Json = (value: unknown): string => bytesToHex(sha256(utf8ToBytes(JSON.stringify(value))));

/** The sha256 of a reason line's text: what travels in place of the text. */
export const reasonHash = (line: string): string => bytesToHex(sha256(utf8ToBytes(line)));
