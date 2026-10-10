/**
 * Who is in a unit and who holds its offices, decided from signed statements alone.
 *
 * **Needs outside review before any screen uses it.** This is a new composition on a boundary that
 * protects people, and the rules for acts that cross go beyond what the design documents spell out
 * (named below, under *Choices a reviewer should check*). Nothing outside `units/` imports it.
 *
 * ## What it is given, and what it promises
 *
 * {@link evaluate} takes a charter code, the two founding statements, the chain of acts with their
 * second signatures, the loose endorsements, stands, supports and signs this phone holds, and the
 * phone's own clock. It returns the roster, the offices and their terms, the open runs and
 * petitions, and everything it refused and why.
 *
 * It is **total and deterministic**: it never throws, and its output depends on the *set* of
 * statements it was given, never on their order. It reads no clock but `now`, and uses `now` only
 * to hold back statements dated in this phone's future, which are never dropped.
 *
 * ## The three things a phone can enforce (governance §2.1)
 *
 * 1. **A count of signatures against an electorate frozen when the vote opened.** A result carries
 *    exactly the threshold's number of endorsements from that electorate. A lost or withheld
 *    signature delays a result; it can never invent one. Silence counts as no.
 * 2. **A "not before" date on whoever wants to act early.** An election opens no earlier than the
 *    term's end; a petition no earlier than day 31; an endorsement or support counts only if it is
 *    not dated before the vote opened. Back-dating only makes an act earlier, so it fails.
 * 3. **The order of signed acts in the chain**, which comes from parent links (`chain.ts`).
 *
 * Every rule the menu leaves out has nowhere to be written (`statements.ts`): no secret ballot, no
 * count of ballots cast, no window, no deadline, no ranked round, no lot, no teller, no successor
 * and no appointment. Nothing lapses: an incumbent holds over until a successor takes office,
 * however late `now` is.
 *
 * ## How it decides
 *
 * 1. **Charter.** An unknown rule code freezes governance on this phone (*needs an update*). Off the
 *    menu, malformed, or naming a higher unit at founding: refused.
 * 2. **Normalise.** Every statement is read on a fresh copy; anything malformed, badly signed, of
 *    another unit, or of a type this release does not know is set aside with its reason. An unknown
 *    act in a `g1` chain is dropped rather than freezing governance, so one member cannot freeze
 *    everyone's.
 * 3. **Hold back.** A statement dated more than {@link GOVERNANCE_CLOCK_TOLERANCE_SECONDS} into this
 *    phone's future is held, and so is everything built on it. An act that needs a second signer
 *    and has none is held as incomplete.
 * 4. **Root.** Two founding statements by two keys, each naming the other, with the same unit and
 *    code. A founder who signed any other founding statement for the unit refuses it, named.
 * 5. **Ancestry.** Each act is checked against the state its own ancestors produce (the rule table
 *    in {@link checkAct}). An act whose parents are all void is void. A void parent is otherwise
 *    ignored, so a poisoned tip cannot void honest acts that also name a valid one.
 * 6. **Crossing.** Among acts valid by ancestry, in this fixed order, once each:
 *    - **R0 split.** Two concurrent removals each removing a signer of the other: the unit has
 *      split. `follow` keeps one; without it, neither stands.
 *    - **R1 vote protection.** A removal concurrent with an open election or petition is void if it
 *      removes one of that vote's electors, or if the vote's subject signed it.
 *    - **R2 removal wins.** Any act signed by a key that a concurrent removal or leave removes is
 *      void.
 *    - **R3 crossed results.** Concurrent results for one office naming different winners are both
 *      void: nobody wins, the incumbent holds over, the run closes contested, and the electors in
 *      both are named.
 *    - **R4 crossed admissions.** Concurrent admissions that together pass the room are all void,
 *      as are concurrent admissions of one key under two callsigns.
 * 7. **Effects** of the acts left apply in one linear order: parents first, then by class (removals,
 *    results, recalls, vacates, opens and petitions, admissions), then by id. The id only orders acts
 *    of one class, whose effects commute, so **a ground id never decides who is in**.
 * 8. **This phone's own reading** of the loose statements it holds: tallies, who could post a
 *    result now, and who endorsed two candidates in one run. These never move an office or a member:
 *    phones holding different loose statements show different tallies and the same unit.
 *
 * ## Choices a reviewer should check
 *
 * These go beyond units.md and governance §2.4, and the owner and a reviewer should sign them off:
 * concurrency rather than "siblings of one prev"; the fixed class order; the built-on-void cascade
 * and void-parent tolerance; R0 to R4 applied once with no fixpoint, so a cascade that voids an open
 * does not revive a removal it already protected, and R2 judges against the removals valid when it
 * starts; two concurrent opens for one office both standing until a result supersedes both; a CO who
 * holds the office (not acting) never winning the XO; after a CO recall the XO serves as CO, not
 * acting, and the cap count restarts at zero, as it does for a vacancy filled mid-term; a leaver
 * counting as removed, so their key is never admitted again; and a re-founded unit's first election
 * opening at once with an electorate of the re-formers alone.
 *
 * The evaluator costs roughly the cube of the number of acts since the last checkpoint. That is
 * nothing at tens of acts and unmeasured on the device floor.
 */

import type { Event } from 'nostr-tools/core';
import { CLOCK_TOLERANCE_SECONDS } from '../events/watch-state.js';
import type { SecretKey } from '../crypto/keys.js';
import {
  addMonthsUTC, readCharter, thresholdOf, threeQuartersOf, type Charter
} from './charter.js';
import { ancestorsOf, isConcurrent, linearize, tipsOf } from './chain.js';
import {
  MAX_PARENTS, actClass, canonicalSnapshot, checkCompact, isAct, needsCosign, readStatement, rootId,
  sha256Json, signStatement, snapshotWire, type Act, type Compact, type Office, type RecalledSnap, type RunSnap,
  type Snapshot, type Statement
} from './statements.js';

/** How far into this phone's future a statement may be dated before it is held back. The watch's. */
export const GOVERNANCE_CLOCK_TOLERANCE_SECONDS = CLOCK_TOLERANCE_SECONDS;

const DAY = 86_400;
/** A petition opens from day 31 of the term: at least thirty whole days after it began. */
const PETITION_AFTER_SECONDS = 30 * DAY;
const DIGEST_TAG = 'navcom-unit-digest-v1';

export class GovernanceError extends Error {}

export interface RosterRow {
  key: string;
  callsign: string;
  how: 'founding' | 'in-person' | 're-formed';
  at: number;
  /** Who admitted them: both signers of an admission, or the signers of a re-formed unit's invite. */
  by: string[];
}

export interface OfficeView {
  holder: string | null;
  /** Holding the office until the selection rule runs: an XO after a CO left, or a re-former. */
  acting: boolean;
  /** Always present in a Led unit. `n` 0 is a re-formed unit's acting term, ending at once. */
  term: { n: number; start: number; end: number } | null;
  /** This holder has served two consecutive CO terms under a two-then-out cap. */
  capped: boolean;
}

export interface RunView {
  id: string;
  office: Office;
  kind: 'end' | 'fill' | 'first';
  openedAt: number;
  electorate: string[];
  electorateDigest: string;
  m: number;
  /** Signatures a result needs. */
  k: number;
  /** What {@link cappedKey} needs instead, where the CO cap applies to them. */
  kCapped: number | null;
  cappedKey: string | null;
  /** This phone's count, from the loose endorsements it holds. */
  tallies: { candidate: string; count: number; stood: boolean }[];
  /** A candidate this phone could post a result for now, or null. */
  postable: string | null;
}

export interface PetitionView {
  id: string;
  office: Office;
  subject: string;
  opener: string;
  openedAt: number;
  electorate: string[];
  m: number;
  k: number;
  /** The opener, plus every distinct support this phone holds. */
  count: number;
  postable: boolean;
}

export type VoidReason =
  // Read before anything else
  | 'malformed' | 'bad-signature' | 'wrong-kind' | 'unknown-act' | 'other-unit' | 'not-in-place'
  | 'not-an-anchor'
  // The chain
  | 'built-on-void' | 'split' | 'split-not-followed' | 'vote-protection' | 'removal-wins'
  | 'crossed-results' | 'crossed-admissions' | 'office-conflict'
  // The rule table
  | 'no-offices' | 'not-a-member' | 'not-allowed' | 'already-member' | 'was-removed' | 'room-full'
  | 'recalled-signer' | 'not-invited' | 'already-invited' | 'already-accepted' | 'bad-former-signature'
  | 'not-electable' | 'run-open' | 'run-not-open' | 'petition-not-open' | 'already-petitioned'
  | 'too-early' | 'moot' | 'unknown-rule' | 'digest-mismatch' | 'wrong-count' | 'not-an-elector'
  | 'no-stand' | 'bad-signature-carried';

export type HeldReason = 'future-dated' | 'waiting-for-earlier' | 'incomplete';

export type UnitRefusal =
  | 'needs-update' | 'malformed-charter' | 'off-menu' | 'named-higher' | 'founding'
  | 'founding-equivocation' | 'future-dated'
  /** A fault in this evaluator, never a verdict on the unit: shown as *needs an update*. */
  | 'internal';

export interface UnitView {
  status: 'ok' | 'split' | 'needs-update' | 'refused';
  reason?: UnitRefusal;
  /** The charter field a newer release could read, or that is off the menu. */
  field?: string;
  /** Who a refusal names: the founders who signed two foundings. */
  names?: string[];
  charter?: Charter;
  root: string | null;
  /** What a new act names as its parents: the tips of the acts that stand. */
  head: string[];
  members: RosterRow[];
  offices: null | { co: OfficeView; xo: OfficeView };
  runs: RunView[];
  petitions: PetitionView[];
  void: { id: string; reason: VoidReason; names?: string[] }[];
  held: { id: string; reason: HeldReason }[];
  equivocators: { key: string; run: string; evidence: string[] }[];
  disagreements: { id: string; what: 'result' | 'checkpoint' }[];
  splits?: { via: string; head: string[] }[];
  /** A change of command has no co-signed checkpoint after it yet. */
  checkpointDue: boolean;
  lineage: null | { from: string; former: 'checked' | 'not-held' | 'mismatch' };
  /** Whether this view rests on a checkpoint rather than the whole history. */
  anchored: boolean;
  snapshot: Snapshot | null;
}

export interface UnitInput {
  code: string;
  /** The unit's id, 32 hex. */
  unit: string;
  found: readonly [Event, Event];
  /** A co-signed checkpoint to start from, for a phone that holds no history before it. */
  checkpoint?: { event: Event; sign: Event; roster: readonly RosterRow[] };
  chain: readonly { act: Event; sign?: Event }[];
  loose: readonly Event[];
  now: number;
  /** In a split, the removal this phone follows. */
  follow?: string;
  /** The keys of the unit this one was re-founded from, on a phone that held it. */
  formerRoster?: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------------------------
// Digests
// ---------------------------------------------------------------------------------------------

export const electorateDigest = (keys: readonly string[]): string => sha256Json([...keys].sort());

export const rosterDigest = (rows: readonly { key: string; callsign: string }[]): string =>
  sha256Json([...rows].map((r) => [r.key, r.callsign]).sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0)));

/**
 * What a result or recall says it computed, so a phone that computes something else can say
 * *phones disagree about this result*. `id` is the run or petition, `who` the candidate or subject.
 */
export function resultDigest(
  rule: string, id: string, office: Office, who: string, m: number, k: number, eDigest: string,
  signers: readonly string[]
): string {
  return sha256Json([DIGEST_TAG, rule, id, office, who, m, k, eDigest, [...signers].sort()]);
}

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------

interface OfficeState { holder: string | null; acting: boolean; n: number; start: number; end: number }
interface RunState extends RunSnap { electorate: string[] }

interface State {
  members: Map<string, RosterRow>;
  removed: Set<string>;
  co: OfficeState | null;
  xo: OfficeState | null;
  cap: { holder: string | null; count: number } | null;
  /** Open election runs and petitions. */
  runs: Map<string, RunState>;
  petitioned: Set<string>;
  recalled: RecalledSnap[];
  /** Keys removed while holding an office, and which. */
  holding: Map<string, Set<Office>>;
  invited: Map<string, { former: string; accepted: boolean }>;
  prevCommand: string | null;
  /** Phone-local: runs and petitions that closed, and by what. Not carried in a checkpoint. */
  closed: Map<string, { winner: string | null; signers: string[]; by: string }>;
}

const office = (o: OfficeState | null): OfficeState | null => (o ? { ...o } : null);

function cloneState(s: State): State {
  return {
    members: new Map([...s.members].map(([k, r]) => [k, { ...r, by: [...r.by] }])),
    removed: new Set(s.removed),
    co: office(s.co),
    xo: office(s.xo),
    cap: s.cap ? { ...s.cap } : null,
    runs: new Map([...s.runs].map(([k, r]) => [k, { ...r, electorate: [...r.electorate] }])),
    petitioned: new Set(s.petitioned),
    recalled: s.recalled.map((r) => ({ ...r, signers: [...r.signers] })),
    holding: new Map([...s.holding].map(([k, h]) => [k, new Set(h)])),
    invited: new Map([...s.invited].map(([k, i]) => [k, { ...i }])),
    prevCommand: s.prevCommand,
    closed: new Map([...s.closed].map(([k, c]) => [k, { ...c, signers: [...c.signers] }]))
  };
}

const petitionKey = (o: Office, key: string, n: number): string => `${o} ${key} ${n}`;
const holds = (s: State, key: string): Office[] =>
  (['co', 'xo'] as const).filter((o) => s[o]?.holder === key);
const sortedKeys = (xs: Iterable<string>): string[] => [...new Set(xs)].sort();

function snapshotOfState(s: State): Snapshot {
  return canonicalSnapshot(rawSnapshot(s));
}

function rawSnapshot(s: State): Snapshot {
  const off = (o: OfficeState | null) => (o ? { holder: o.holder, acting: o.acting, n: o.n, start: o.start, end: o.end } : null);
  return {
    rule: 'g1',
    roster: rosterDigest([...s.members.values()]),
    co: off(s.co),
    xo: off(s.xo),
    cap: s.cap ? { ...s.cap } : null,
    petitioned: [...s.petitioned].sort().map((p) => {
      const [o, key, n] = p.split(' ');
      return [o as Office, key!, Number(n)] as const;
    }),
    runs: [...s.runs.values()]
      .map((r) => ({ ...r, electorate: [...r.electorate].sort() }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    recalled: s.recalled.map((r) => ({ ...r, signers: [...r.signers].sort() })),
    removed: [...s.removed].sort(),
    holding: [...s.holding].map(([k, h]) => [k, [...h].sort()] as const).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    invited: [...s.invited].map(([id, i]) => [id, i.former, i.accepted] as const).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    prevCommand: s.prevCommand
  };
}

function stateOfSnapshot(snap: Snapshot, rows: readonly RosterRow[]): State {
  return {
    members: new Map(rows.map((r) => [r.key, { ...r, by: [...r.by] }])),
    removed: new Set(snap.removed),
    co: snap.co ? { ...snap.co } : null,
    xo: snap.xo ? { ...snap.xo } : null,
    cap: snap.cap ? { ...snap.cap } : null,
    runs: new Map(snap.runs.map((r) => [r.id, { ...r, electorate: [...r.electorate] }])),
    petitioned: new Set(snap.petitioned.map((p) => petitionKey(p[0], p[1], p[2]))),
    recalled: snap.recalled.map((r) => ({ ...r, signers: [...r.signers] })),
    holding: new Map(snap.holding.map(([k, h]) => [k, new Set(h)])),
    invited: new Map(snap.invited.map(([id, former, accepted]) => [id, { former, accepted }])),
    prevCommand: snap.prevCommand,
    closed: new Map()
  };
}

// ---------------------------------------------------------------------------------------------
// The evaluator
// ---------------------------------------------------------------------------------------------

interface ActRec {
  id: string;
  pubkey: string;
  at: number;
  s: Act;
  /** The second signer, from a valid `sign`. */
  cosigner: string | null;
  cosignAt: number | null;
}

interface Read {
  id: string;
  pubkey: string;
  createdAt: number;
  statement: Statement;
}

interface Fold {
  state: State;
  void: Map<string, VoidReason>;
  names: Map<string, string[]>;
  splits: [string, string][];
  unresolved: boolean;
}

const emptyView = (over: Partial<UnitView>): UnitView => ({
  status: 'refused',
  root: null,
  head: [],
  members: [],
  offices: null,
  runs: [],
  petitions: [],
  void: [],
  held: [],
  equivocators: [],
  disagreements: [],
  checkpointDue: false,
  lineage: null,
  anchored: false,
  snapshot: null,
  ...over
});

/** Never throws: anything unexpected refuses the unit on this phone rather than crashing it. */
export function evaluate(input: UnitInput): UnitView {
  try {
    return evaluateUnchecked(input);
  } catch {
    return emptyView({ status: 'refused', reason: 'internal' });
  }
}

function evaluateUnchecked(input: UnitInput): UnitView {
  const now = input.now;
  const tolerance = GOVERNANCE_CLOCK_TOLERANCE_SECONDS;
  const future = (t: number) => t > now + tolerance;

  // (1) The charter.
  const charterRead = readCharter(input.code);
  if (!charterRead.ok) {
    if (charterRead.reason === 'needs-update') {
      return emptyView({ status: 'needs-update', reason: 'needs-update', ...(charterRead.field ? { field: charterRead.field } : {}) });
    }
    return emptyView({
      status: 'refused',
      reason: charterRead.reason === 'off-menu' ? 'off-menu' : 'malformed-charter',
      ...(charterRead.field ? { field: charterRead.field } : {})
    });
  }
  const charter = charterRead.charter;
  if (charter.higher.under.length > 0) return emptyView({ status: 'refused', reason: 'named-higher', charter });
  const gov = charter.governance;
  const led = gov.shape === 'led';
  const unit = input.unit;

  // (2) Normalise.
  const voids = new Map<string, { reason: VoidReason; names?: string[] }>();
  const setAside = (e: unknown, reason: VoidReason) => {
    const id = typeof (e as { id?: unknown })?.id === 'string' ? (e as { id: string }).id : '?';
    if (!voids.has(id)) voids.set(id, { reason });
  };
  const readOne = (e: unknown): Read | null => {
    const r = readStatement(e);
    if (!r.ok) {
      setAside(e, r.reason);
      return null;
    }
    if (r.statement.unit !== unit) {
      setAside(e, 'other-unit');
      return null;
    }
    return { id: r.id, pubkey: r.pubkey, createdAt: r.createdAt, statement: r.statement };
  };

  // (4) The root, read first because everything names it.
  const fa = readOne(input.found[0]);
  const fb = readOne(input.found[1]);
  const founding = (): UnitView => emptyView({ status: 'refused', reason: 'founding', charter });
  if (!fa || !fb || fa.statement.t !== 'found' || fb.statement.t !== 'found') return founding();
  const A = fa.statement;
  const B = fb.statement;
  if (fa.pubkey === fb.pubkey || A.code !== input.code || B.code !== input.code) return founding();
  if (A.other !== fb.pubkey || B.other !== fa.pubkey) return founding();
  const roles = [A.role, B.role].sort().join(' ');
  if (led ? roles !== 'co xo' : roles !== 'member member') return founding();
  if (charter.lineage === null) {
    if (A.former !== null || B.former !== null) return founding();
  } else {
    const lineage = charter.lineage;
    const checkFormer = (f: Compact | null, newKey: string) =>
      f !== null && checkCompact(f, { t: 'refound-by', unit, lineage, key: newKey });
    if (!checkFormer(A.former, fa.pubkey) || !checkFormer(B.former, fb.pubkey)) return founding();
    if (A.former![0] === B.former![0]) return founding();
  }
  const root = rootId(unit, fa.id, fb.id);
  const foundIds = new Set([fa.id, fb.id]);
  const tf = Math.max(fa.createdAt, fb.createdAt);

  // Everything else, read once.
  const chainReads: { act: Read; sign: Read | null }[] = [];
  for (const entry of input.chain) {
    if (typeof entry !== 'object' || entry === null) {
      setAside(entry, 'malformed');
      continue;
    }
    const act = readOne(entry.act);
    if (!act) continue;
    if (foundIds.has(act.id)) continue;
    const sign = entry.sign === undefined ? null : readOne(entry.sign);
    chainReads.push({ act, sign });
  }
  const looseReads: Read[] = [];
  for (const e of input.loose) {
    const r = readOne(e);
    if (r && !foundIds.has(r.id)) looseReads.push(r);
  }

  // A founder who signed another founding statement for this unit has founded two units with one key.
  const twice = new Set<string>();
  for (const r of [...chainReads.map((c) => c.act), ...looseReads]) {
    if (r.statement.t === 'found' && (r.pubkey === fa.pubkey || r.pubkey === fb.pubkey)) twice.add(r.pubkey);
  }
  if (twice.size > 0) {
    return emptyView({ status: 'refused', reason: 'founding-equivocation', names: [...twice].sort(), charter, root });
  }
  if (future(tf)) {
    return emptyView({
      status: 'refused', reason: 'future-dated', charter, root,
      held: [...foundIds].sort().map((id) => ({ id, reason: 'future-dated' as const }))
    });
  }

  // View 0.
  const founders = [fa, fb];
  const state0: State = {
    members: new Map(founders.map((f) => [
      f.pubkey,
      { key: f.pubkey, callsign: (f.statement as { callsign: string }).callsign, how: 'founding' as const, at: f.createdAt, by: [] }
    ])),
    removed: new Set(),
    co: null,
    xo: null,
    cap: null,
    runs: new Map(),
    petitioned: new Set(),
    recalled: [],
    holding: new Map(),
    invited: new Map(),
    prevCommand: null,
    closed: new Map()
  };
  if (gov.shape === 'led') {
    const coKey = A.role === 'co' ? fa.pubkey : fb.pubkey;
    const xoKey = A.role === 'xo' ? fa.pubkey : fb.pubkey;
    const reformed = charter.lineage !== null;
    const term = reformed
      ? { n: 0, start: tf, end: tf }
      : { n: 1, start: tf, end: addMonthsUTC(tf, gov.term) };
    state0.co = { holder: coKey, acting: reformed, ...term };
    state0.xo = { holder: xoKey, acting: reformed, ...term };
    state0.cap = reformed ? { holder: null, count: 0 } : { holder: coKey, count: 1 };
  }

  // Chain acts, deduplicated by id. Where one act arrives with different second signatures, the
  // smallest valid signer is kept, so the choice does not depend on arrival order.
  const acts = new Map<string, ActRec>();
  const held = new Map<string, HeldReason>();
  for (const { act, sign } of chainReads) {
    if (!isAct(act.statement)) {
      if (!voids.has(act.id)) voids.set(act.id, { reason: 'not-in-place' });
      continue;
    }
    let cosigner: string | null = null;
    let cosignAt: number | null = null;
    if (sign) {
      const s = sign.statement;
      if (s.t === 'sign' && s.act === act.id && sign.pubkey !== act.pubkey) {
        cosigner = sign.pubkey;
        cosignAt = sign.createdAt;
      } else if (!voids.has(sign.id)) {
        voids.set(sign.id, { reason: 'not-in-place' });
      }
    }
    const rec: ActRec = { id: act.id, pubkey: act.pubkey, at: act.createdAt, s: act.statement, cosigner, cosignAt };
    const prior = acts.get(act.id);
    if (!prior || (cosigner !== null && (prior.cosigner === null || cosigner < prior.cosigner))) acts.set(act.id, rec);
  }
  // An id first set aside on one copy and then read whole on another is not void.
  for (const id of acts.keys()) voids.delete(id);

  const parents = new Map<string, readonly string[]>();
  for (const [id, a] of acts) parents.set(id, a.s.prev);
  const ancOf = (id: string) => ancestorsOf(id, parents);

  // Loose statements, and any checkpoints among them.
  const loose = { endorse: [] as Read[], stand: [] as Read[], support: [] as Read[], sign: [] as Read[], checkpoint: [] as Read[] };
  for (const r of looseReads) {
    const t = r.statement.t;
    if (t === 'endorse' || t === 'stand' || t === 'support' || t === 'sign' || t === 'checkpoint') {
      if (future(r.createdAt)) {
        held.set(r.id, 'future-dated');
        continue;
      }
      loose[t].push(r);
    } else if (!acts.has(r.id) && !voids.has(r.id)) {
      voids.set(r.id, { reason: 'not-in-place' });
    }
  }

  // A second signature may also travel on its own, loose. Of every valid one, the smallest key is
  // kept, as for copies of one act above, so which arrived first never matters.
  for (const sg of loose.sign) {
    if (sg.statement.t !== 'sign') continue;
    const a = acts.get(sg.statement.act);
    if (!a || sg.pubkey === a.pubkey) continue;
    if (a.cosigner === null || sg.pubkey < a.cosigner) {
      a.cosigner = sg.pubkey;
      a.cosignAt = sg.createdAt;
    }
  }

  // Phone-local findings, collected once however often an act is checked.
  const disagreements = new Map<string, 'result' | 'checkpoint'>();
  const equivocation = new Map<string, { key: string; run: string; evidence: Set<string> }>();
  const equivocate = (key: string, run: string, evidence: string[]) => {
    const k = `${run} ${key}`;
    const e = equivocation.get(k) ?? { key, run, evidence: new Set<string>() };
    for (const id of evidence) e.evidence.add(id);
    equivocation.set(k, e);
  };

  const signersOf = (a: ActRec): string[] => (a.cosigner ? [a.pubkey, a.cosigner] : [a.pubkey]);
  const removedBy = (a: ActRec): string[] =>
    a.s.t === 'remove' ? [...a.s.keys] : a.s.t === 'leave' ? [a.pubkey] : [];
  const newKeyOf = (a: ActRec): string | null =>
    a.s.t === 'admit' ? a.s.key : a.s.t === 'accept' ? a.pubkey : null;
  const callsignOf = (a: ActRec): string | null =>
    a.s.t === 'admit' || a.s.t === 'accept' ? a.s.callsign : null;
  const compactsOf = (s: Act): number[] =>
    s.t === 'result' ? [s.stand[0], ...s.sigs.map((c) => c[1])]
      : s.t === 'recall' ? s.sigs.map((c) => c[1])
        : s.t === 'accept' ? [s.former[1]] : [];
  const effectiveTime = (a: ActRec, run: RunState): number =>
    a.s.t === 'result' ? Math.max(run.at, a.s.stand[0], ...a.s.sigs.map((c) => c[1])) : a.at;

  // ---------------------------------------------------------------------------------------------
  // The rule table: is act `x` allowed by the state its own ancestors produce?
  // ---------------------------------------------------------------------------------------------

  const electable = (st: State, o: Office, at: number): boolean => {
    const off = st[o];
    if (!off) return false;
    return off.holder === null || (o === 'co' && off.acting) || off.n === 0 || at >= off.end;
  };
  const isOfficer = (st: State, key: string) => holds(st, key).length > 0;

  function checkAct(x: ActRec, va: State): VoidReason | null {
    const s = x.s;
    const member = (k: string) => va.members.has(k);
    const signers = signersOf(x);
    switch (s.t) {
      case 'admit':
      case 'invite': {
        if (!signers.every(member)) return 'not-a-member';
        if (s.t === 'invite') {
          if (charter.lineage === null) return 'not-allowed';
          for (const i of va.invited.values()) if (i.former === s.former) return 'already-invited';
        } else {
          if (member(s.key)) return 'already-member';
          if (va.removed.has(s.key)) return 'was-removed';
          if (s.readmits !== null && (!va.removed.has(s.readmits) || s.readmits === s.key)) return 'not-allowed';
        }
        if (led && !signers.some((k) => isOfficer(va, k))) {
          // Command keeps the door, except for a leader whose key was removed, while that office's
          // election is open: then any two members may let them back in to stand.
          const r = s.t === 'admit' ? s.readmits : null;
          const offices = r ? va.holding.get(r) : undefined;
          const open = offices && [...va.runs.values()].some((run) => run.kind !== 'petition' && offices.has(run.office));
          if (!open) return 'not-allowed';
        }
        if (s.t === 'admit' && va.members.size >= charter.room) return 'room-full';
        return null;
      }
      case 'accept': {
        if (charter.lineage === null) return 'not-allowed';
        const invite = va.invited.get(s.invite);
        if (!invite) return 'not-invited';
        if (invite.accepted) return 'already-accepted';
        if (member(x.pubkey)) return 'already-member';
        if (va.removed.has(x.pubkey)) return 'was-removed';
        if (s.former[0] !== invite.former ||
          !checkCompact(s.former, { t: 'accept-by', unit, invite: s.invite, key: x.pubkey })) {
          return 'bad-former-signature';
        }
        if (va.members.size >= charter.room) return 'room-full';
        return null;
      }
      case 'remove': {
        if (!s.keys.every(member)) return 'not-a-member';
        if (s.keys.length >= va.members.size) return 'not-allowed';
        if (!signers.every(member)) return 'not-a-member';
        if (signers.some((k) => s.keys.includes(k))) return 'not-allowed';
        const lastOne = va.members.size - s.keys.length === 1;
        if (signers.length < 2 && !lastOne) return 'not-allowed';
        if (led && s.keys.some((k) => !isOfficer(va, k)) && !signers.some((k) => isOfficer(va, k))) return 'not-allowed';
        for (const r of va.recalled) {
          if (!signers.includes(r.key)) continue;
          if (va[r.office]?.n === r.n && s.keys.some((k) => r.signers.includes(k))) return 'recalled-signer';
        }
        return null;
      }
      case 'leave':
        return member(x.pubkey) ? null : 'not-a-member';
      case 'vacate':
        if (!led) return 'no-offices';
        return va[s.office]?.holder === x.pubkey ? null : 'not-allowed';
      case 'open': {
        if (!led) return 'no-offices';
        if (!member(x.pubkey)) return 'not-a-member';
        if (!electable(va, s.office, x.at)) return 'not-electable';
        for (const r of va.runs.values()) if (r.kind !== 'petition' && r.office === s.office) return 'run-open';
        return null;
      }
      case 'petition': {
        if (!led) return 'no-offices';
        if (!member(x.pubkey)) return 'not-a-member';
        const off = va[s.office]!;
        if (x.pubkey === s.subject || off.holder !== s.subject || off.n < 1) return 'not-allowed';
        if (x.at < off.start + PETITION_AFTER_SECONDS) return 'too-early';
        if (va.petitioned.has(petitionKey(s.office, s.subject, off.n))) return 'already-petitioned';
        return null;
      }
      case 'result': {
        if (!led || gov.shape !== 'led') return 'no-offices';
        if (s.rule !== 'g1') {
          disagreements.set(x.id, 'result');
          return 'unknown-rule';
        }
        if (!member(x.pubkey)) return 'not-a-member';
        const run = va.runs.get(s.run);
        if (!run || run.kind === 'petition') {
          const closed = va.closed.get(s.run);
          if (closed && closed.winner !== null && closed.winner !== s.candidate) {
            for (const key of s.sigs.map((c) => c[0])) {
              if (closed.signers.includes(key)) equivocate(key, s.run, [closed.by, x.id]);
            }
          }
          return 'run-not-open';
        }
        const m = run.electorate.length;
        const capped = run.office === 'co' && gov.coCap === 'twoThenOut' &&
          va.cap?.holder === s.candidate && va.cap.count >= 2;
        const k = capped ? threeQuartersOf(m) : thresholdOf(m, gov.threshold);
        const keys = s.sigs.map((c) => c[0]);
        if (resultDigest('g1', run.id, run.office, s.candidate, m, k, electorateDigest(run.electorate), keys) !== s.digest) {
          disagreements.set(x.id, 'result');
          return 'digest-mismatch';
        }
        if (keys.length !== k || new Set(keys).size !== keys.length) return 'wrong-count';
        const electorate = new Set(run.electorate);
        if (!keys.every((key) => electorate.has(key))) return 'not-an-elector';
        if (!member(s.candidate)) return 'not-a-member';
        if (run.office === 'xo' && va.co?.holder === s.candidate && !va.co.acting) return 'office-conflict';
        if (s.stand[0] < run.at || !checkCompact([s.candidate, s.stand[0], s.stand[1]], { t: 'stand', unit, run: run.id })) {
          return 'no-stand';
        }
        for (const c of s.sigs) {
          if (c[1] < run.at) return 'too-early';
          if (!checkCompact(c, { t: 'endorse', unit, run: run.id, candidate: s.candidate })) return 'bad-signature-carried';
        }
        return null;
      }
      case 'recall': {
        if (!led || gov.shape !== 'led') return 'no-offices';
        if (s.rule !== 'g1') {
          disagreements.set(x.id, 'result');
          return 'unknown-rule';
        }
        if (!member(x.pubkey)) return 'not-a-member';
        const pet = va.runs.get(s.petition);
        if (!pet || pet.kind !== 'petition') return 'petition-not-open';
        const m = pet.electorate.length;
        const k = thresholdOf(m, gov.threshold);
        const keys = [pet.opener, ...s.sigs.map((c) => c[0])];
        if (resultDigest('g1', pet.id, pet.office, pet.subject!, m, k, electorateDigest(pet.electorate), keys) !== s.digest) {
          disagreements.set(x.id, 'result');
          return 'digest-mismatch';
        }
        if (s.sigs.length !== k - 1 || new Set(keys).size !== keys.length) return 'wrong-count';
        const electorate = new Set(pet.electorate);
        if (!keys.every((key) => electorate.has(key))) return 'not-an-elector';
        for (const c of s.sigs) {
          if (c[1] < pet.at) return 'too-early';
          if (!checkCompact(c, { t: 'support', unit, petition: pet.id })) return 'bad-signature-carried';
        }
        return null;
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Effects, applied in linear order to an accumulating state, each re-checked where a concurrent
  // act of an earlier class could have changed what it needs.
  // ---------------------------------------------------------------------------------------------

  /** Petitions whose subject no longer holds the office they were opened against close. */
  const settle = (st: State) => {
    for (const [id, r] of st.runs) {
      if (r.kind === 'petition' && st[r.office]?.holder !== r.subject) {
        st.runs.delete(id);
        if (!st.closed.has(id)) st.closed.set(id, { winner: null, signers: [], by: id });
      }
    }
  };

  /** Takes `key` out of the unit. A CO leaving passes the office to the XO, acting. */
  const drop = (st: State, key: string, by: string) => {
    if (!st.members.has(key)) return;
    st.members.delete(key);
    st.removed.add(key);
    if (st.co && st.xo) {
      if (st.co.holder === key) {
        st.co.holder = st.xo.holder;
        st.co.acting = st.co.holder !== null;
        st.xo.holder = null;
        st.xo.acting = false;
        st.prevCommand = by;
      } else if (st.xo.holder === key) {
        st.xo.holder = null;
        st.xo.acting = false;
        st.prevCommand = by;
      }
    }
    settle(st);
  };

  function applyAct(st: State, x: ActRec, va: State, concurrent: (a: string, b: string) => boolean): VoidReason | null {
    const s = x.s;
    switch (s.t) {
      case 'remove': {
        for (const key of s.keys) {
          if (!st.members.has(key)) continue;
          const was = holds(va, key);
          if (was.length > 0) {
            const h = st.holding.get(key) ?? new Set<Office>();
            for (const o of was) h.add(o);
            st.holding.set(key, h);
          }
          drop(st, key, x.id);
        }
        return null;
      }
      case 'leave':
        drop(st, x.pubkey, x.id);
        return null;
      case 'result': {
        if (gov.shape !== 'led' || !st.co || !st.xo || !st.cap) return 'no-offices';
        const keys = s.sigs.map((c) => c[0]).sort();
        const run = st.runs.get(s.run);
        if (!run) {
          // A concurrent result for the same office and winner already took effect: the same
          // outcome, with the term starting at the earlier of the two effective times.
          const closed = st.closed.get(s.run);
          const ran = va.runs.get(s.run)!;
          if (closed && closed.winner === s.candidate && concurrent(closed.by, x.id)) {
            const off = st[ran.office]!;
            const t = effectiveTime(x, ran);
            if ((ran.kind === 'end' || ran.kind === 'first') && t < off.start) {
              off.start = t;
              off.end = addMonthsUTC(t, gov.term);
            }
            return null;
          }
          return 'run-not-open';
        }
        if (!st.members.has(s.candidate)) return 'not-a-member';
        if (run.office === 'xo' && st.co.holder === s.candidate && !st.co.acting) return 'office-conflict';
        const t = effectiveTime(x, run);
        const off = st[run.office]!;
        const other = st[run.office === 'co' ? 'xo' : 'co']!;
        if (other.holder === s.candidate) {
          other.holder = null;
          other.acting = false;
        }
        off.holder = s.candidate;
        off.acting = false;
        if (run.kind === 'end' || run.kind === 'first') {
          off.n = run.kind === 'first' ? 1 : off.n + 1;
          off.start = t;
          off.end = addMonthsUTC(t, gov.term);
        }
        if (run.office === 'co') {
          st.cap = run.kind === 'fill'
            ? { holder: s.candidate, count: 0 }
            : st.cap.holder === s.candidate ? { holder: s.candidate, count: st.cap.count + 1 } : { holder: s.candidate, count: 1 };
        }
        for (const [id, r] of st.runs) {
          if (r.kind !== 'petition' && r.office === run.office) {
            st.runs.delete(id);
            st.closed.set(id, { winner: s.candidate, signers: keys, by: x.id });
          }
        }
        for (const [key, h] of st.holding) {
          h.delete(run.office);
          if (h.size === 0) st.holding.delete(key);
        }
        st.prevCommand = x.id;
        settle(st);
        return null;
      }
      case 'recall': {
        if (!st.co || !st.xo) return 'no-offices';
        const pet = st.runs.get(s.petition);
        if (!pet) {
          const closed = st.closed.get(s.petition);
          return closed && concurrent(closed.by, x.id) ? null : 'petition-not-open';
        }
        const subject = pet.subject!;
        const signers = [pet.opener, ...s.sigs.map((c) => c[0])].sort();
        const n = st[pet.office]!.n;
        if (st.co.holder === subject) {
          st.co.holder = st.xo.holder;
          st.co.acting = false;
          st.xo.holder = null;
          st.xo.acting = false;
          st.cap = { holder: st.co.holder, count: 0 };
        } else if (st.xo.holder === subject) {
          st.xo.holder = null;
          st.xo.acting = false;
        }
        st.recalled.push({ key: subject, office: pet.office, n, signers });
        st.runs.delete(pet.id);
        st.closed.set(pet.id, { winner: subject, signers, by: x.id });
        st.prevCommand = x.id;
        settle(st);
        return null;
      }
      case 'vacate': {
        if (!st.co || !st.xo) return 'no-offices';
        if (st.co.holder === x.pubkey) {
          st.co.holder = st.xo.holder;
          st.co.acting = st.co.holder !== null;
          st.xo.holder = null;
          st.xo.acting = false;
        } else if (st.xo.holder === x.pubkey) {
          st.xo.holder = null;
          st.xo.acting = false;
        } else {
          return null;
        }
        st.prevCommand = x.id;
        settle(st);
        return null;
      }
      case 'open': {
        if (!electable(st, s.office, x.at)) return 'not-electable';
        const off = va[s.office]!;
        const kind: RunState['kind'] = off.n === 0 ? 'first' : x.at >= off.end ? 'end' : 'fill';
        st.runs.set(x.id, {
          id: x.id, kind, office: s.office, subject: null, opener: x.pubkey, at: x.at,
          electorate: sortedKeys(va.members.keys())
        });
        return null;
      }
      case 'petition': {
        const cur = st[s.office];
        const then = va[s.office]!;
        if (!cur || cur.holder !== s.subject || cur.n !== then.n) return 'moot';
        st.runs.set(x.id, {
          id: x.id, kind: 'petition', office: s.office, subject: s.subject, opener: x.pubkey, at: x.at,
          electorate: sortedKeys([...va.members.keys()].filter((k) => k !== s.subject))
        });
        st.petitioned.add(petitionKey(s.office, s.subject, then.n));
        return null;
      }
      case 'admit': {
        const row = st.members.get(s.key);
        if (row) {
          // The same admission, made twice at once: one member, admitted by everyone who signed.
          row.by = sortedKeys([...row.by, ...signersOf(x)]);
          row.at = Math.min(row.at, x.at);
          return null;
        }
        if (st.removed.has(s.key)) return 'was-removed';
        if (st.members.size >= charter.room) return 'room-full';
        st.members.set(s.key, { key: s.key, callsign: s.callsign, how: 'in-person', at: x.at, by: sortedKeys(signersOf(x)) });
        if (s.readmits) st.holding.delete(s.readmits);
        return null;
      }
      case 'invite':
        if (!st.invited.has(x.id)) st.invited.set(x.id, { former: s.former, accepted: false });
        return null;
      case 'accept': {
        const invite = st.invited.get(s.invite);
        if (!invite) return 'not-invited';
        const row = st.members.get(x.pubkey);
        if (row) {
          row.at = Math.min(row.at, x.at);
          return null;
        }
        if (invite.accepted) return 'already-accepted';
        if (st.removed.has(x.pubkey)) return 'was-removed';
        if (st.members.size >= charter.room) return 'room-full';
        invite.accepted = true;
        const inviter = acts.get(s.invite);
        st.members.set(x.pubkey, {
          key: x.pubkey, callsign: s.callsign, how: 're-formed', at: x.at, by: inviter ? sortedKeys(signersOf(inviter)) : []
        });
        return null;
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Folding a set of acts: ancestry, crossing, effects.
  // ---------------------------------------------------------------------------------------------

  type Base = { ids: ReadonlySet<string>; state: State };

  function runFrom(base: Base, skip: ReadonlySet<string>) {
    const active = new Set<string>();
    const heldHere = new Map<string, HeldReason>();
    const foldMemo = new Map<string, Fold>();
    const statusMemo = new Map<string, VoidReason | null>();
    const classOf = (id: string) => actClass(acts.get(id)!.s.t);
    const concurrent = (a: string, b: string) => isConcurrent(a, b, ancOf);

    const ancActs = (id: string): string[] => [...ancOf(id)].filter((a) => active.has(a));
    const foldBefore = (id: string): Fold => {
      let f = foldMemo.get(id);
      if (!f) {
        f = foldSet(ancActs(id));
        foldMemo.set(id, f);
      }
      return f;
    };
    const inherit = (ps: readonly string[], v: Map<string, VoidReason>): VoidReason =>
      ps.some((p) => v.get(p) === 'split-not-followed') ? 'split-not-followed' : 'built-on-void';
    const allVoid = (ps: readonly string[], v: Map<string, VoidReason>) => ps.every((p) => v.has(p));

    function ancestryStatus(id: string): VoidReason | null {
      if (statusMemo.has(id)) return statusMemo.get(id)!;
      const x = acts.get(id)!;
      const f = foldBefore(id);
      const r = allVoid(x.s.prev, f.void) ? inherit(x.s.prev, f.void) : checkAct(x, f.state);
      statusMemo.set(id, r);
      return r;
    }

    function foldSet(ids: readonly string[]): Fold {
      const set = new Set(ids);
      const order = linearize(set, parents, classOf);
      const v = new Map<string, VoidReason>();
      const names = new Map<string, string[]>();
      const cascade = () => {
        for (const id of order) {
          if (v.has(id)) continue;
          const ps = acts.get(id)!.s.prev;
          if (allVoid(ps, v)) v.set(id, inherit(ps, v));
        }
      };
      const valid = () => order.filter((id) => !v.has(id)).map((id) => acts.get(id)!);

      // 6a. Ancestry.
      for (const id of order) {
        const r = ancestryStatus(id);
        if (r) v.set(id, r);
      }
      cascade();

      // R0. A split: two concurrent removals, each removing a signer of the other.
      const splits: [string, string][] = [];
      let unresolved = false;
      {
        const removals = valid().filter((a) => a.s.t === 'remove');
        const out = new Map<string, VoidReason>();
        for (let i = 0; i < removals.length; i++) {
          for (let j = i + 1; j < removals.length; j++) {
            const a = removals[i]!;
            const b = removals[j]!;
            if (!concurrent(a.id, b.id)) continue;
            const ab = removedBy(a).some((k) => signersOf(b).includes(k));
            const ba = removedBy(b).some((k) => signersOf(a).includes(k));
            if (!ab || !ba) continue;
            splits.push(a.id < b.id ? [a.id, b.id] : [b.id, a.id]);
            if (input.follow === a.id) out.set(b.id, 'split-not-followed');
            else if (input.follow === b.id) out.set(a.id, 'split-not-followed');
            else {
              unresolved = true;
              if (!out.has(a.id)) out.set(a.id, 'split');
              if (!out.has(b.id)) out.set(b.id, 'split');
            }
          }
        }
        for (const [id, r] of out) if (!v.has(id) && !(r === 'split' && input.follow === id)) v.set(id, r);
        cascade();
      }

      // R1. Vote protection.
      {
        const live = valid();
        const votes = live.filter((a) => a.s.t === 'open' || a.s.t === 'petition');
        for (const x of live) {
          if (x.s.t !== 'remove') continue;
          for (const o of votes) {
            if (!concurrent(x.id, o.id)) continue;
            const va = foldBefore(o.id).state;
            const subject = o.s.t === 'petition' ? o.s.subject : null;
            const electorate = [...va.members.keys()].filter((k) => k !== subject);
            if (x.s.keys.some((k) => electorate.includes(k)) || (subject !== null && signersOf(x).includes(subject))) {
              v.set(x.id, 'vote-protection');
              break;
            }
          }
        }
        cascade();
      }

      // R2. Removal wins, judged against the removals valid when it starts.
      {
        const live = valid();
        const removals = live.filter((a) => a.s.t === 'remove' || a.s.t === 'leave');
        for (const y of live) {
          for (const x of removals) {
            if (x.id === y.id || !concurrent(x.id, y.id)) continue;
            if (removedBy(x).some((k) => signersOf(y).includes(k))) {
              v.set(y.id, 'removal-wins');
              break;
            }
          }
        }
        cascade();
      }

      // R3. Crossed results, and a CO elected to the XO at once.
      {
        const results = valid().filter((a) => a.s.t === 'result');
        const officeOf = (a: ActRec) => foldBefore(a.id).state.runs.get((a.s as { run: string }).run)!.office;
        const out = new Map<string, VoidReason>();
        for (let i = 0; i < results.length; i++) {
          for (let j = i + 1; j < results.length; j++) {
            const a = results[i]!;
            const b = results[j]!;
            if (!concurrent(a.id, b.id) || a.s.t !== 'result' || b.s.t !== 'result') continue;
            const oa = officeOf(a);
            const ob = officeOf(b);
            if (oa === ob && a.s.candidate !== b.s.candidate) {
              out.set(a.id, 'crossed-results');
              out.set(b.id, 'crossed-results');
              const ka = a.s.sigs.map((c) => c[0]);
              const both = b.s.sigs.map((c) => c[0]).filter((k) => ka.includes(k)).sort();
              for (const id of [a.id, b.id]) names.set(id, sortedKeys([...(names.get(id) ?? []), ...both]));
              for (const key of both) {
                equivocate(key, a.s.run, [a.id, b.id]);
                if (b.s.run !== a.s.run) equivocate(key, b.s.run, [a.id, b.id]);
              }
            } else if (oa !== ob && a.s.candidate === b.s.candidate) {
              const xo = oa === 'xo' ? a : b;
              if (!out.has(xo.id)) out.set(xo.id, 'office-conflict');
            }
          }
        }
        for (const [id, r] of out) v.set(id, r);
        cascade();
      }

      // R4. Crossed admissions.
      {
        const live = valid();
        const joins = live.filter((a) => newKeyOf(a) !== null);
        const invites = live.filter((a) => a.s.t === 'invite');
        const out = new Set<string>();
        for (const a of joins) {
          const with_ = joins.filter((b) => b.id === a.id || concurrent(a.id, b.id));
          const key = newKeyOf(a)!;
          if (with_.some((b) => newKeyOf(b) === key && callsignOf(b) !== callsignOf(a))) out.add(a.id);
          if (a.s.t === 'accept') {
            const inv = a.s.invite;
            if (with_.some((b) => b.s.t === 'accept' && b.s.invite === inv && b.pubkey !== a.pubkey)) out.add(a.id);
          }
          const va = foldBefore(a.id).state;
          const fresh = new Set(with_.map((b) => newKeyOf(b)!).filter((k) => !va.members.has(k)));
          if (va.members.size + fresh.size > charter.room) out.add(a.id);
        }
        for (const a of invites) {
          if (invites.some((b) => b.id !== a.id && concurrent(a.id, b.id) &&
            (b.s as { former: string }).former === (a.s as { former: string }).former)) out.add(a.id);
        }
        for (const id of out) v.set(id, 'crossed-admissions');
        cascade();
      }

      // 6c. Effects.
      const st = cloneState(base.state);
      for (const id of order) {
        const x = acts.get(id)!;
        if (v.has(id)) {
          if (v.get(id) === 'crossed-results' && x.s.t === 'result') {
            // Nobody wins: the run closes contested, the incumbent holds over, the office stays electable.
            const run = x.s.run;
            if (st.runs.delete(run) || !st.closed.has(run)) st.closed.set(run, { winner: null, signers: [], by: id });
          }
          continue;
        }
        if (allVoid(x.s.prev, v)) {
          v.set(id, inherit(x.s.prev, v));
          continue;
        }
        const r = applyAct(st, x, foldBefore(id).state, concurrent);
        if (r) v.set(id, r);
      }
      return { state: st, void: v, names, splits, unresolved };
    }

    // One pass in parent order decides what is held and fills the memos bottom-up.
    const all = linearize([...acts.keys()].filter((id) => !skip.has(id)), parents, (id) => actClass(acts.get(id)!.s.t));
    const known = (p: string) => base.ids.has(p) || active.has(p);
    for (const id of all) {
      const x = acts.get(id)!;
      if (future(x.at) || (x.cosignAt !== null && future(x.cosignAt)) || compactsOf(x.s).some(future)) {
        heldHere.set(id, 'future-dated');
        continue;
      }
      if (!x.s.prev.every(known)) {
        heldHere.set(id, 'waiting-for-earlier');
        continue;
      }
      if (needsCosign(x.s.t) && x.cosigner === null) {
        const lastOne = x.s.t === 'remove' && foldBefore(id).state.members.size - x.s.keys.length === 1;
        if (!lastOne) {
          heldHere.set(id, 'incomplete');
          continue;
        }
      }
      active.add(id);
      ancestryStatus(id);
    }
    const final = foldSet([...active]);
    return { active, held: heldHere, final, foldSet, foldBefore };
  }

  // ---------------------------------------------------------------------------------------------
  // History, or a checkpoint to start from.
  // ---------------------------------------------------------------------------------------------

  type CheckpointRead = { read: Read; signer: string; head: readonly string[]; snapshot: Snapshot };
  const checkpointOf = (event: Read, signs: readonly Read[]): CheckpointRead | null => {
    if (event.statement.t !== 'checkpoint') return null;
    const cp = event.statement;
    const sign = signs
      .filter((s) => s.statement.t === 'sign' && s.statement.act === event.id && s.pubkey !== event.pubkey)
      .sort((a, b) => (a.pubkey < b.pubkey ? -1 : 1))[0];
    if (!sign) return null;
    return { read: event, signer: sign.pubkey, head: cp.head, snapshot: cp.snapshot };
  };

  let mode: 'history' | 'anchor' = 'history';
  let run = runFrom({ ids: new Set([root]), state: state0 }, new Set());
  let anchorHead: readonly string[] = [root];

  if (input.checkpoint) {
    const ev = readOne(input.checkpoint.event);
    const sg = readOne(input.checkpoint.sign);
    const cp = ev && sg ? checkpointOf(ev, [sg]) : null;
    const rows = input.checkpoint.roster;
    const rowKeys = new Set(rows.map((r) => r.key));
    const anchorOk = cp !== null && ev !== null &&
      !future(ev.createdAt) && !future(sg!.createdAt) &&
      rowKeys.size === rows.length && rowKeys.has(ev.pubkey) && rowKeys.has(cp.signer) &&
      rosterDigest(rows) === cp.snapshot.roster && (cp.snapshot.co !== null) === led;
    if (!anchorOk) {
      const id = ev?.id ?? (typeof input.checkpoint.event?.id === 'string' ? input.checkpoint.event.id : '?');
      if (!voids.has(id)) voids.set(id, { reason: 'not-an-anchor' });
    } else {
      // Where this phone holds the history up to the checkpoint, history wins and the checkpoint is
      // compared like any other. Otherwise the view starts from it.
      loose.checkpoint.push(ev!);
      loose.sign.push(sg!);
      const historyHolds = cp!.head.every((h) => h === root || run.active.has(h));
      if (!historyHolds) {
        mode = 'anchor';
        anchorHead = [...cp!.head];
        const subsumed = new Set<string>();
        const stack = cp!.head.filter((h) => acts.has(h));
        while (stack.length > 0) {
          const id = stack.pop()!;
          if (subsumed.has(id)) continue;
          subsumed.add(id);
          for (const p of acts.get(id)!.s.prev) if (acts.has(p)) stack.push(p);
        }
        run = runFrom({ ids: new Set(cp!.head), state: stateOfSnapshot(cp!.snapshot, rows) }, subsumed);
      }
    }
  }

  const fin = run.final;
  const st = fin.state;
  for (const [id, r] of run.held) held.set(id, r);
  for (const [id, r] of fin.void) voids.set(id, { reason: r, ...(fin.names.has(id) ? { names: fin.names.get(id)! } : {}) });

  // (8) This phone's own reading of the loose statements it holds.
  const memberNow = (k: string) => st.members.has(k);
  const capKey = gov.shape === 'led' && gov.coCap === 'twoThenOut' && st.cap?.holder && st.cap.count >= 2 ? st.cap.holder : null;
  const runs: RunView[] = [];
  const petitions: PetitionView[] = [];
  for (const r of [...st.runs.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const electorate = [...r.electorate].sort();
    const inE = new Set(electorate);
    const m = electorate.length;
    if (r.kind === 'petition') {
      const supporters = new Set<string>([r.opener]);
      for (const s of loose.support) {
        if (s.statement.t === 'support' && s.statement.petition === r.id && inE.has(s.pubkey) && s.createdAt >= r.at) {
          supporters.add(s.pubkey);
        }
      }
      const k = thresholdOf(m, gov.shape === 'led' ? gov.threshold : 'majority');
      petitions.push({
        id: r.id, office: r.office, subject: r.subject!, opener: r.opener, openedAt: r.at, electorate, m, k,
        count: supporters.size, postable: supporters.size >= k
      });
      continue;
    }
    const byKey = new Map<string, Map<string, string>>();
    for (const e of loose.endorse) {
      if (e.statement.t !== 'endorse' || e.statement.run !== r.id || !inE.has(e.pubkey) || e.createdAt < r.at) continue;
      const mine = byKey.get(e.pubkey) ?? new Map<string, string>();
      mine.set(e.statement.candidate, e.id);
      byKey.set(e.pubkey, mine);
    }
    for (const [key, choices] of byKey) if (choices.size > 1) equivocate(key, r.id, [...choices.values()]);
    const twoFaced = new Set([...equivocation.values()].filter((e) => e.run === r.id).map((e) => e.key));
    const counts = new Map<string, number>();
    for (const [key, choices] of byKey) {
      if (twoFaced.has(key)) continue;
      const c = [...choices.keys()][0]!;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const stood = new Set(
      loose.stand
        .filter((s) => s.statement.t === 'stand' && s.statement.run === r.id && s.createdAt >= r.at && memberNow(s.pubkey))
        .map((s) => s.pubkey)
    );
    const k = thresholdOf(m, gov.shape === 'led' ? gov.threshold : 'majority');
    const kCapped = r.office === 'co' && capKey ? threeQuartersOf(m) : null;
    const cappedKey = kCapped === null ? null : capKey;
    const candidates = sortedKeys([...counts.keys(), ...stood]);
    const tallies = candidates.map((c) => ({ candidate: c, count: counts.get(c) ?? 0, stood: stood.has(c) }));
    const postable = tallies.find((t) =>
      t.stood && memberNow(t.candidate) && t.count >= (t.candidate === cappedKey ? kCapped! : k) &&
      !(r.office === 'xo' && st.co?.holder === t.candidate && !st.co.acting)
    )?.candidate ?? null;
    runs.push({
      id: r.id, office: r.office, kind: r.kind as RunView['kind'], openedAt: r.at, electorate,
      electorateDigest: electorateDigest(electorate), m, k, kCapped, cappedKey, tallies, postable
    });
  }

  // Checkpoints: compared against the history where this phone holds it, and whether the last
  // change of command has one after it.
  const applied = [...run.active].filter((id) => !fin.void.has(id));
  const appliedSet = new Set(applied);
  let covered = st.prevCommand === null || (mode === 'anchor' && !run.active.has(st.prevCommand));
  for (const c of loose.checkpoint) {
    const cp = checkpointOf(c, loose.sign);
    if (!cp) continue;
    const headKnown = cp.head.every((h) => appliedSet.has(h) || (mode === 'history' && h === root) || (mode === 'anchor' && anchorHead.includes(h)));
    if (!headKnown) continue;
    const closure = new Set<string>();
    for (const h of cp.head) {
      if (appliedSet.has(h)) {
        closure.add(h);
        for (const a of ancOf(h)) if (run.active.has(a)) closure.add(a);
      }
    }
    const atHead = run.foldSet([...closure]).state;
    const signersAreMembers = atHead.members.has(c.pubkey) && atHead.members.has(cp.signer);
    if (!signersAreMembers) continue;
    if (JSON.stringify(snapshotWire(snapshotOfState(atHead))) !== JSON.stringify(snapshotWire(cp.snapshot))) {
      disagreements.set(c.id, 'checkpoint');
      continue;
    }
    if (st.prevCommand !== null && (cp.head.includes(st.prevCommand) || cp.head.some((h) => ancOf(h).has(st.prevCommand!)))) {
      covered = true;
    }
  }

  // The head: tips of what stands, with the base where nothing builds on it yet.
  const baseIds = mode === 'history' ? [root] : [...anchorHead];
  const named = new Set<string>();
  for (const id of applied) for (const p of acts.get(id)!.s.prev) named.add(p);
  const head = sortedKeys([...tipsOf(applied, parents), ...baseIds.filter((b) => !named.has(b))]);

  // Splits, with the tips of each side.
  const splitList = fin.splits.flatMap(([a, b]) => [a, b]).filter((id, i, xs) => xs.indexOf(id) === i).sort().map((via) => {
    const side = [...run.active].filter((id) => id === via || ancOf(id).has(via));
    return { via, head: tipsOf(side, parents) };
  });

  // Lineage: whether the former keys this unit names were on the old roster this phone held.
  let lineage: UnitView['lineage'] = null;
  if (charter.lineage !== null) {
    const formers = [A.former![0], B.former![0], ...[...st.invited.values()].map((i) => i.former)];
    lineage = {
      from: charter.lineage,
      former: !input.formerRoster ? 'not-held' : formers.every((k) => input.formerRoster!.has(k)) ? 'checked' : 'mismatch'
    };
  }

  const officeView = (o: OfficeState, isCo: boolean): OfficeView => ({
    holder: o.holder,
    acting: o.holder !== null && o.acting,
    term: { n: o.n, start: o.start, end: o.end },
    capped: isCo && o.holder !== null && capKey === o.holder
  });

  return {
    status: fin.unresolved ? 'split' : 'ok',
    charter,
    root,
    head,
    members: [...st.members.values()].sort((a, b) => (a.key < b.key ? -1 : 1)),
    offices: st.co && st.xo ? { co: officeView(st.co, true), xo: officeView(st.xo, false) } : null,
    runs,
    petitions,
    void: [...voids].map(([id, v]) => ({ id, ...v })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    held: [...held].map(([id, reason]) => ({ id, reason })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    equivocators: [...equivocation.values()]
      .map((e) => ({ key: e.key, run: e.run, evidence: [...e.evidence].sort() }))
      .sort((a, b) => (a.run + a.key < b.run + b.key ? -1 : 1)),
    disagreements: [...disagreements].map(([id, what]) => ({ id, what })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    ...(splitList.length > 0 ? { splits: splitList } : {}),
    checkpointDue: !covered,
    lineage,
    anchored: mode === 'anchor',
    snapshot: snapshotOfState(st)
  };
}

// ---------------------------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------------------------

/** The checkpoint a phone would co-sign for this view. Throws if the view has none. */
export function snapshotOf(v: UnitView): Snapshot {
  if (!v.snapshot) throw new GovernanceError('This unit has no state to checkpoint on this phone.');
  return v.snapshot;
}

const prevOf = (prev: readonly string[]): string[] => sortedKeys(prev).slice(0, MAX_PARENTS);

/** Earliest by (created_at, pubkey), one per key: the first set to reach the threshold. */
function earliest(events: readonly Event[], keep: (s: Statement, pubkey: string, at: number) => boolean): Event[] {
  const byKey = new Map<string, Event>();
  for (const e of events) {
    const r = readStatement(e);
    if (!r.ok || !keep(r.statement, r.pubkey, r.createdAt)) continue;
    const prior = byKey.get(r.pubkey);
    if (!prior || e.created_at < prior.created_at) byKey.set(r.pubkey, e);
  }
  return [...byKey.values()].sort((a, b) => a.created_at - b.created_at || (a.pubkey < b.pubkey ? -1 : 1));
}

/**
 * A result for `candidate` in `run`, carrying exactly the threshold's number of endorsements, the
 * earliest by (created_at, pubkey). Throws {@link GovernanceError} if this phone does not hold
 * enough, or the candidate's stand.
 */
export function buildResult(
  o: { unit: string; view: UnitView; run: string; candidate: string; stand: Event; endorsements: readonly Event[]; prev: readonly string[]; at: number },
  poster: SecretKey
): Event {
  const rv = o.view.runs.find((r) => r.id === o.run);
  if (!rv) throw new GovernanceError('That run is not open on this phone.');
  const k = o.candidate === rv.cappedKey && rv.kCapped !== null ? rv.kCapped : rv.k;
  const stand = readStatement(o.stand);
  if (!stand.ok || stand.statement.t !== 'stand' || stand.statement.run !== o.run || stand.pubkey !== o.candidate ||
    stand.statement.unit !== o.unit || stand.createdAt < rv.openedAt) {
    throw new GovernanceError('Nobody wins an office they did not stand for.');
  }
  const electorate = new Set(rv.electorate);
  const twoFaced = new Set(o.view.equivocators.filter((e) => e.run === o.run).map((e) => e.key));
  const chosen = earliest(o.endorsements, (s, pubkey, at) =>
    s.t === 'endorse' && s.unit === o.unit && s.run === o.run && s.candidate === o.candidate &&
    electorate.has(pubkey) && !twoFaced.has(pubkey) && at >= rv.openedAt
  ).slice(0, k);
  if (chosen.length < k) throw new GovernanceError(`That needs ${k} endorsements; this phone holds ${chosen.length}.`);
  const sigs: Compact[] = chosen.map((e) => [e.pubkey, e.created_at, e.sig]);
  const digest = resultDigest('g1', o.run, rv.office, o.candidate, rv.m, k, rv.electorateDigest, sigs.map((c) => c[0]));
  return signStatement(poster, {
    t: 'result', unit: o.unit, prev: prevOf(o.prev), run: o.run, candidate: o.candidate, rule: 'g1', digest,
    stand: [o.stand.created_at, o.stand.sig], sigs
  }, o.at);
}

/**
 * A recall carrying the opener's petition and exactly k − 1 supports, the earliest by
 * (created_at, pubkey). Throws {@link GovernanceError} if this phone does not hold enough.
 */
export function buildRecall(
  o: { unit: string; view: UnitView; petition: string; supports: readonly Event[]; prev: readonly string[]; at: number },
  poster: SecretKey
): Event {
  const pv = o.view.petitions.find((p) => p.id === o.petition);
  if (!pv) throw new GovernanceError('That petition is not open on this phone.');
  const electorate = new Set(pv.electorate);
  const chosen = earliest(o.supports, (s, pubkey, at) =>
    s.t === 'support' && s.unit === o.unit && s.petition === o.petition && electorate.has(pubkey) &&
    pubkey !== pv.opener && at >= pv.openedAt
  ).slice(0, pv.k - 1);
  if (chosen.length < pv.k - 1) {
    throw new GovernanceError(`That needs ${pv.k} signatures; this phone holds ${chosen.length + 1}.`);
  }
  const sigs: Compact[] = chosen.map((e) => [e.pubkey, e.created_at, e.sig]);
  const digest = resultDigest(
    'g1', o.petition, pv.office, pv.subject, pv.m, pv.k, electorateDigest(pv.electorate),
    [pv.opener, ...sigs.map((c) => c[0])]
  );
  return signStatement(poster, {
    t: 'recall', unit: o.unit, prev: prevOf(o.prev), petition: o.petition, rule: 'g1', digest, sigs
  }, o.at);
}

/** A checkpoint of this view at `head`, for a second member to co-sign with a `sign`. */
export function buildCheckpoint(o: { unit: string; view: UnitView; head: readonly string[]; at: number }, secret: SecretKey): Event {
  return signStatement(secret, { t: 'checkpoint', unit: o.unit, head: prevOf(o.head), snapshot: snapshotOf(o.view) }, o.at);
}
