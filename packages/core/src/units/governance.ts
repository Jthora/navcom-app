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
 * to hold back statements dated in this phone's future, which are never dropped. A `now` that is
 * not a finite number could hold nothing back, so the unit is refused as `clock` rather than read.
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
 *    everyone's. Once a second key has built on one, the unit reads *needs an update*: the roster
 *    shown is as far as this release can read, and is never passed off as current.
 * 3. **Hold back.** A statement dated more than {@link GOVERNANCE_CLOCK_TOLERANCE_SECONDS} into this
 *    phone's future is held, and so is everything built on it. An act that needs a second signer is
 *    held while it has none dated in this phone's present: as future-dated if one is from the
 *    future, otherwise as incomplete. Of several second signatures, the first by key that makes the
 *    act valid is used, so a signature from a key that is not a member never displaces one that is.
 * 4. **Root.** Two founding statements by two keys, each naming the other, with the same unit and
 *    code. A founder who signed any other founding statement for the unit refuses it, named.
 * 5. **Ancestry.** Each act is checked against the state its own ancestors produce (the rule table
 *    in `checkWith`).
 * 6. **Crossing.** Among acts valid by ancestry, in this fixed order, once each:
 *    - **R0 split.** Two concurrent removals each removing a signer of the other: the unit has
 *      split. `follow` keeps one; without it, neither stands, nor anything built only on either.
 *    - **R1 one vote per opener.** One key's concurrent opens for one office, or concurrent
 *      petitions against one holder, are all void and the key is named.
 *    - **R2 crossed results.** Concurrent results for one office naming different winners are both
 *      void: nobody wins, the incumbent holds over, the run closes contested, and the electors in
 *      both are named.
 *    - **R3 a removal never defeats a result.** A removal concurrent with a result that removes its
 *      winner is void.
 *    - **R4 a change of command ends the authority it took.** An admission, invitation or removal
 *      that needed a position holder's signature is void if every position holder who signed it
 *      lost that position by a concurrent result, recall or vacate.
 *    - **R5 removal wins.** An act signed by a key that a concurrent removal or leave removes is
 *      void, except a vote (below).
 *    - **R6 crossed admissions.** Concurrent admissions that together pass the room are all void,
 *      as are concurrent admissions of one key under two callsigns, and concurrent readmissions of
 *      one removed leader by members using the open election to let them back in.
 *
 *    After ancestry and after each rule, an act that stood on something just voided is judged again
 *    against what still stands among its ancestors, and is void (`built-on-void`) only if it no
 *    longer holds there. So a room overflow after a split costs only the admissions, never an
 *    unrelated removal one half made in the same week.
 * 7. **Effects** of the acts left apply in one linear order: parents first, then by class (removals,
 *    results, recalls, vacates, opens and petitions, admissions), then by id. The id only orders acts
 *    of one class, whose effects commute, so **a ground id never decides who is in**.
 * 8. **This phone's own reading** of the loose statements it holds: tallies, who could post a
 *    result now, who endorsed two candidates in one run, and any result carrying the signature of
 *    an elector this phone holds endorsing someone else in that run (a disagreement, never a void,
 *    since a phone without that endorsement cannot know). None of these moves an office or a
 *    member: phones holding different loose statements show different tallies and the same unit.
 *
 * ## A vote and a removal never undo each other
 *
 * units.md §7 makes a removal that crosses an open vote void. Crossing means concurrent, and either
 * side can make two acts concurrent by naming an old `prev`: a removed member's petition on a
 * pre-removal state is concurrent with their own removal, and is, act for act, the same chain as an
 * incumbent racing a petition with a removal. No rule can tell the two apart without trusting a
 * claimed time, which both sides write. So neither side voids the other, and the vote is made
 * proof against removal instead:
 *
 * - the electorate is frozen at the state the vote names, removed electors still count, and their
 *   signatures still count;
 * - a vote (open, petition, result, recall) is never void because a key that signed it was removed
 *   beside it (R5's exception);
 * - a result or recall may be posted by any member or by any elector of that vote, so removing
 *   everyone who holds the signatures cannot stop it;
 * - a removal concurrent with a result cannot remove its winner (R3), and a result may name the
 *   vote's own state as its parent, so a winner removed after the vote opened still takes office.
 *
 * What is lost is the letter of the rule: a removal by the person a vote is about now stands, and is
 * shown with its receipt. It cannot change the vote.
 *
 * ## Choices a reviewer should check
 *
 * These go beyond units.md and governance §2.4, and the owner and a reviewer should sign them off:
 * the section above, which replaces units.md §7's crossing rule; concurrency rather than "siblings
 * of one prev"; the fixed class order; the void-parent re-judgement; R0 to R6 applied once with no
 * fixpoint; two concurrent opens for one office by two keys both standing until a result supersedes
 * both; a CO who holds the office (not acting) never winning the XO; after a CO recall the XO serves
 * as CO, not acting; the CO cap counting every CO term a key served any part of (not acting),
 * including a vacancy filled and the rest of a recalled CO's term, so swapping posts through a
 * vacancy does not reset it; a leaver counting as removed, so their key is never admitted again; a
 * re-founded unit's first election opening only once somebody invited has accepted; a phone that
 * holds the old unit's roster refusing an invitation to a key not on it, while a phone that does
 * not hold it cannot; and a checkpoint naming a head this phone cannot place never replacing
 * history this phone already holds.
 *
 * ## What it cannot settle
 *
 * Order comes only from parent links, so any act may name an old state, and every rule that lets one
 * act void a concurrent one can be aimed backwards by whoever writes the stale act. The rules above
 * remove the cases a vote or a minority could exploit, but two remain and need a decision, not a
 * patch: **removal wins (R5) reaches back** (two members who may remove a key can name a state from
 * weeks ago and void what that key signed since, and what stood only on it), and **an electorate is
 * frozen at whatever state the opener names**, so a vote opened on an early, small roster counts
 * against that roster. A co-signed checkpoint that this phone's history now contradicts is reported
 * as a disagreement, so the first is at least never silent. Both need an ordering anchor the design
 * does not yet have.
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
  /** What a key in {@link cappedKeys} needs instead. */
  kCapped: number | null;
  /**
   * Who the CO cap applies to in this run: anyone who served the CO office in each of the two terms
   * before the one this run fills. Usually one key; never more than the people who held the office.
   */
  cappedKeys: string[];
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
  | 'crossed-results' | 'crossed-admissions' | 'crossed-opens' | 'office-conflict' | 'office-ended'
  // The rule table
  | 'no-offices' | 'not-a-member' | 'not-allowed' | 'already-member' | 'was-removed' | 'room-full'
  | 'recalled-signer' | 'not-invited' | 'already-invited' | 'already-accepted' | 'bad-former-signature'
  | 'not-on-old-roster'
  | 'not-electable' | 'run-open' | 'run-not-open' | 'petition-not-open' | 'already-petitioned'
  | 'too-early' | 'moot' | 'unknown-rule' | 'digest-mismatch' | 'wrong-count' | 'not-an-elector'
  | 'no-stand' | 'bad-signature-carried';

export type HeldReason = 'future-dated' | 'waiting-for-earlier' | 'incomplete';

export type UnitRefusal =
  | 'needs-update' | 'malformed-charter' | 'off-menu' | 'named-higher' | 'founding'
  | 'founding-equivocation' | 'future-dated'
  /** This phone's clock could not be read: nothing can be held back against it. */
  | 'clock'
  /** A fault in this evaluator, never a verdict on the unit: shown as *needs an update*. */
  | 'internal';

export interface UnitView {
  status: 'ok' | 'split' | 'needs-update' | 'refused';
  reason?: UnitRefusal;
  /**
   * The charter field a newer release could read, or that is off the menu; `act` where the chain
   * builds on an act of a type this release does not know.
   */
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
  /** Null where this state cannot be written as a checkpoint at all. */
  snapshot: Snapshot | null;
}

export interface UnitInput {
  code: string;
  /** The unit's id, 32 hex. */
  unit: string;
  found: readonly [Event, Event];
  /**
   * A co-signed checkpoint to start from, for a phone that holds no history before it. Where `chain`
   * also carries history the checkpoint's head cannot be placed against, that history wins and the
   * checkpoint waits: to start from a checkpoint, pass only what came after it. Otherwise any two
   * members could sign a checkpoint naming a head nobody holds and replace every phone's history.
   */
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
/** The last CO term a key served in (not acting), and how many consecutive CO terms end there. */
interface Served { last: number; count: number }

interface State {
  members: Map<string, RosterRow>;
  removed: Set<string>;
  co: OfficeState | null;
  xo: OfficeState | null;
  /** CO service, for the cap: only keys whose last term is this one or the one before. */
  served: Map<string, Served>;
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
    served: new Map([...s.served].map(([k, r]) => [k, { ...r }])),
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

/** Consecutive CO terms `key` has served, ending with the current term. */
function termsNow(s: State, key: string): number {
  const e = s.served.get(key);
  return e && s.co && e.last === s.co.n ? e.count : 0;
}

/**
 * Consecutive CO terms `key` served, ending with the term before the one a run of this kind fills:
 * the next term for a term-end or first election, this term for a vacancy.
 */
function termsBefore(s: State, key: string, kind: RunSnap['kind']): number {
  const e = s.served.get(key);
  if (!e || !s.co) return 0;
  const n = s.co.n;
  if (kind === 'fill') return e.last === n ? e.count - 1 : e.last === n - 1 ? e.count : 0;
  return e.last === n ? e.count : 0;
}

function snapshotOfState(s: State): Snapshot {
  return canonicalSnapshot(rawSnapshot(s));
}

/** The snapshot of a state, or null where it cannot be written: a view never throws for it. */
function safeSnapshot(s: State): Snapshot | null {
  try {
    return snapshotOfState(s);
  } catch {
    return null;
  }
}

function rawSnapshot(s: State): Snapshot {
  const off = (o: OfficeState | null) => (o ? { holder: o.holder, acting: o.acting, n: o.n, start: o.start, end: o.end } : null);
  return {
    rule: 'g1',
    roster: rosterDigest([...s.members.values()]),
    co: off(s.co),
    xo: off(s.xo),
    cap: s.co ? { holder: s.co.holder, count: s.co.holder === null ? 0 : termsNow(s, s.co.holder) } : null,
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
    prevCommand: s.prevCommand,
    served: [...s.served].map(([k, r]) => [k, r.last, r.count] as const).sort((a, b) => (a[0] < b[0] ? -1 : 1))
  };
}

function stateOfSnapshot(snap: Snapshot, rows: readonly RosterRow[]): State {
  return {
    members: new Map(rows.map((r) => [r.key, { ...r, by: [...r.by] }])),
    removed: new Set(snap.removed),
    co: snap.co ? { ...snap.co } : null,
    xo: snap.xo ? { ...snap.xo } : null,
    served: new Map(snap.served.map(([k, last, count]) => [k, { last, count }])),
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
  /** Every second signature this phone holds for the act, one per key (the earliest), by key. */
  cosigns: { key: string; at: number }[];
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
  /** Void because they lie on a side of a split: what is built only on them inherits that. */
  branch: Set<string>;
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

/** Acts whose authority is the signatures they carry: removing whoever posted one never voids it. */
const VOTES: ReadonlySet<Act['t']> = new Set(['open', 'petition', 'result', 'recall']);

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
  // A clock this phone cannot read would hold nothing back, so nothing is read against it.
  if (typeof now !== 'number' || !Number.isFinite(now)) return emptyView({ status: 'refused', reason: 'clock' });
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
  const coCapOn = gov.shape === 'led' && gov.coCap === 'twoThenOut';
  const unit = input.unit;

  // (2) Normalise.
  const voids = new Map<string, { reason: VoidReason; names?: string[] }>();
  const setAside = (e: unknown, reason: VoidReason) => {
    const id = typeof (e as { id?: unknown })?.id === 'string' ? (e as { id: string }).id : '?';
    if (!voids.has(id)) voids.set(id, { reason });
  };
  /** Chain acts of a type this release does not know, and who signed each. */
  const unknownActs = new Map<string, string>();
  const readOne = (e: unknown, inChain = false): Read | null => {
    const r = readStatement(e);
    if (!r.ok) {
      setAside(e, r.reason);
      // Read only once its signature has verified, so the id and key are the signer's own.
      if (inChain && r.reason === 'unknown-act') {
        const o = e as { id: string; pubkey: string };
        unknownActs.set(o.id, o.pubkey);
      }
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
  /** The re-formers' own former keys: already in the unit, so never invited into a second seat. */
  const founderFormers = charter.lineage === null ? [] : [A.former![0], B.former![0]];

  // Everything else, read once.
  const chainReads: { act: Read; sign: Read | null }[] = [];
  for (const entry of input.chain) {
    if (typeof entry !== 'object' || entry === null) {
      setAside(entry, 'malformed');
      continue;
    }
    const act = readOne(entry.act, true);
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
    served: new Map(),
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
    if (!reformed) state0.served.set(coKey, { last: 1, count: 1 });
  }

  // Chain acts, deduplicated by id, with every second signature any copy carried. Which one counts
  // is decided against the act's own ancestry (`checkAct`), never by arrival order or by key alone.
  const acts = new Map<string, ActRec>();
  const held = new Map<string, HeldReason>();
  const addCosign = (a: ActRec, key: string, at: number) => {
    if (key === a.pubkey) return;
    const prior = a.cosigns.find((c) => c.key === key);
    if (prior) {
      prior.at = Math.min(prior.at, at);
      return;
    }
    a.cosigns.push({ key, at });
    a.cosigns.sort((p, q) => (p.key < q.key ? -1 : p.key > q.key ? 1 : 0));
  };
  for (const { act, sign } of chainReads) {
    if (!isAct(act.statement)) {
      if (!voids.has(act.id)) voids.set(act.id, { reason: 'not-in-place' });
      continue;
    }
    let rec = acts.get(act.id);
    if (!rec) {
      rec = { id: act.id, pubkey: act.pubkey, at: act.createdAt, s: act.statement, cosigns: [] };
      acts.set(act.id, rec);
    }
    if (sign) {
      const s = sign.statement;
      if (s.t === 'sign' && s.act === act.id && sign.pubkey !== act.pubkey) addCosign(rec, sign.pubkey, sign.createdAt);
      else if (!voids.has(sign.id)) voids.set(sign.id, { reason: 'not-in-place' });
    }
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

  // A second signature may also travel on its own, loose.
  for (const sg of loose.sign) {
    if (sg.statement.t !== 'sign') continue;
    const a = acts.get(sg.statement.act);
    if (a) addCosign(a, sg.pubkey, sg.createdAt);
  }

  // Phone-local findings, collected once however often an act is checked. A re-judgement against
  // what still stands (`recheck`) records nothing: it only asks whether an act still holds.
  let recording = true;
  const disagreements = new Map<string, 'result' | 'checkpoint'>();
  const disagree = (id: string, what: 'result' | 'checkpoint') => {
    if (recording) disagreements.set(id, what);
  };
  const equivocation = new Map<string, { key: string; run: string; evidence: Set<string> }>();
  const equivocate = (key: string, run: string, evidence: string[]) => {
    if (!recording) return;
    const k = `${run} ${key}`;
    const e = equivocation.get(k) ?? { key, run, evidence: new Set<string>() };
    for (const id of evidence) e.evidence.add(id);
    equivocation.set(k, e);
  };

  /** Per run of the fold: the second signer each act counts, and every one that would have done. */
  let chosen = new Map<string, string>();
  let validCos = new Map<string, string[]>();
  const signersOf = (a: ActRec): string[] => {
    const c = chosen.get(a.id);
    return c ? [a.pubkey, c] : [a.pubkey];
  };
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
  // The rule table: is act `x`, with these signers, allowed by the state its own ancestors produce?
  // ---------------------------------------------------------------------------------------------

  const electable = (st: State, o: Office, at: number): boolean => {
    const off = st[o];
    if (!off) return false;
    return off.holder === null || (o === 'co' && off.acting) || off.n === 0 || at >= off.end;
  };
  const isOfficer = (st: State, key: string) => holds(st, key).length > 0;
  /** A leader removed while holding an office whose election is open: any two may let them back in. */
  const readmitOpen = (st: State, key: string): boolean => {
    const offices = st.holding.get(key);
    return !!offices && [...st.runs.values()].some((run) => run.kind !== 'petition' && offices.has(run.office));
  };
  const cappedFor = (st: State, key: string, kind: RunSnap['kind']) => coCapOn && termsBefore(st, key, kind) >= 2;

  function checkWith(x: ActRec, signers: readonly string[], va: State): VoidReason | null {
    const s = x.s;
    const member = (k: string) => va.members.has(k);
    switch (s.t) {
      case 'admit':
      case 'invite': {
        if (signers.length < 2) return 'not-allowed';
        if (!signers.every(member)) return 'not-a-member';
        if (s.t === 'invite') {
          if (charter.lineage === null) return 'not-allowed';
          // A re-former's own former key: inviting it would give one person a second seat.
          if (founderFormers.includes(s.former)) return 'not-allowed';
          for (const i of va.invited.values()) if (i.former === s.former) return 'already-invited';
          // Only keys on the old roster may be invited. A phone that held it checks every invitation.
          if (input.formerRoster && !input.formerRoster.has(s.former)) return 'not-on-old-roster';
        } else {
          if (member(s.key)) return 'already-member';
          if (va.removed.has(s.key)) return 'was-removed';
          if (s.readmits !== null && (!va.removed.has(s.readmits) || s.readmits === s.key)) return 'not-allowed';
        }
        if (led && !signers.some((k) => isOfficer(va, k))) {
          // Command keeps the door, except for a leader whose key was removed, while that office's
          // election is open: then any two members may let them back in to stand.
          if (!(s.t === 'admit' && s.readmits !== null && readmitOpen(va, s.readmits))) return 'not-allowed';
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
        // One signer alone only in a unit of two, removing the other: never against a larger unit.
        const unitOfTwo = va.members.size === 2 && s.keys.length === 1;
        if (signers.length < 2 && !unitOfTwo) return 'not-allowed';
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
        // A re-founded unit's first election waits for somebody the re-formers invited: two
        // re-formers alone would turn acting posts into a full term before any member could vote.
        if (va[s.office]!.n === 0 && [...va.members.values()].every((r) => r.how === 'founding')) return 'not-electable';
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
          disagree(x.id, 'result');
          return 'unknown-rule';
        }
        const found = va.runs.get(s.run);
        const run = found && found.kind !== 'petition' ? found : null;
        // Any phone holding the signatures posts: a member, or an elector of this run however they
        // were removed since, so removing whoever holds them cannot stop a result.
        if (!member(x.pubkey) && !run?.electorate.includes(x.pubkey)) return 'not-a-member';
        if (!run) {
          const closed = va.closed.get(s.run);
          if (closed && closed.winner !== null && closed.winner !== s.candidate) {
            for (const key of s.sigs.map((c) => c[0])) {
              if (closed.signers.includes(key)) equivocate(key, s.run, [closed.by, x.id]);
            }
          }
          return 'run-not-open';
        }
        const m = run.electorate.length;
        const k = run.office === 'co' && cappedFor(va, s.candidate, run.kind) ? threeQuartersOf(m) : thresholdOf(m, gov.threshold);
        const keys = s.sigs.map((c) => c[0]);
        if (resultDigest('g1', run.id, run.office, s.candidate, m, k, electorateDigest(run.electorate), keys) !== s.digest) {
          disagree(x.id, 'result');
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
          disagree(x.id, 'result');
          return 'unknown-rule';
        }
        const found = va.runs.get(s.petition);
        const pet = found && found.kind === 'petition' ? found : null;
        // As for a result: any member, or any elector of the petition, posts it.
        if (!member(x.pubkey) && !pet?.electorate.includes(x.pubkey)) return 'not-a-member';
        if (!pet) return 'petition-not-open';
        const m = pet.electorate.length;
        const k = thresholdOf(m, gov.threshold);
        const keys = [pet.opener, ...s.sigs.map((c) => c[0])];
        if (resultDigest('g1', pet.id, pet.office, pet.subject!, m, k, electorateDigest(pet.electorate), keys) !== s.digest) {
          disagree(x.id, 'result');
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

  /**
   * The rule table for `x` as it stands: an act that needs a second signer is checked with each
   * second signature this phone holds dated in its present, smallest key first, and the first that
   * makes it valid is the one it counts. A key that is not a member therefore never displaces one
   * that is. `valid` is every second signer that would have done.
   */
  function checkAct(x: ActRec, va: State): { reason: VoidReason | null; cosigner: string | null; valid: string[] } {
    if (!needsCosign(x.s.t)) return { reason: checkWith(x, [x.pubkey], va), cosigner: null, valid: [] };
    const present = x.cosigns.filter((c) => !future(c.at)).map((c) => c.key);
    const valid: string[] = [];
    let first: VoidReason | null = null;
    for (const c of present) {
      const r = checkWith(x, [x.pubkey, c], va);
      if (r === null) valid.push(c);
      else first ??= r;
    }
    if (valid.length > 0) return { reason: null, cosigner: valid[0]!, valid };
    const alone = checkWith(x, [x.pubkey], va);
    if (alone === null) return { reason: null, cosigner: null, valid };
    return { reason: first ?? alone, cosigner: null, valid };
  }

  /** Whether `y` was valid only because a position holder signed it. */
  const needsAuthority = (y: ActRec, va: State): boolean => {
    const s = y.s;
    if (!led) return false;
    if (s.t === 'admit') return !(s.readmits !== null && readmitOpen(va, s.readmits));
    if (s.t === 'invite') return true;
    if (s.t === 'remove') return s.keys.some((k) => !isOfficer(va, k));
    return false;
  };

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

  /** `key` serves the current CO term, not acting: counted once per term, for the cap. */
  const serve = (st: State, key: string | null) => {
    if (key === null || !st.co) return;
    const n = st.co.n;
    const e = st.served.get(key);
    if (e && e.last === n) return;
    st.served.set(key, { last: n, count: e && e.last === n - 1 ? e.count + 1 : 1 });
    for (const [k, r] of st.served) if (r.last < n - 1) st.served.delete(k);
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
        if (gov.shape !== 'led' || !st.co || !st.xo) return 'no-offices';
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
        if (run.office === 'co') serve(st, s.candidate);
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
          // The XO serves out the term as CO, and that term counts towards the cap.
          serve(st, st.co.holder);
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
    chosen = new Map();
    validCos = new Map();
    const active = new Set<string>();
    const heldHere = new Map<string, HeldReason>();
    const foldMemo = new Map<string, Fold>();
    const statusMemo = new Map<string, VoidReason | null>();
    const afterMemo = new Map<string, State>();
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
      let r: VoidReason | null;
      if (allVoid(x.s.prev, f.void) && x.s.prev.some((p) => f.branch.has(p))) {
        r = inherit(x.s.prev, f.void);
      } else {
        // Judged against what stands among its ancestors: a void parent is ignored, and an act whose
        // parents are all void stands if it holds on what is left.
        const c = checkAct(x, f.state);
        if (c.cosigner !== null) chosen.set(id, c.cosigner);
        validCos.set(id, c.valid);
        r = c.reason !== null && allVoid(x.s.prev, f.void) ? 'built-on-void' : c.reason;
      }
      statusMemo.set(id, r);
      return r;
    }

    /** What `c` leaves behind, applied to its own ancestry. */
    const afterOf = (c: ActRec): State => {
      let s = afterMemo.get(c.id);
      if (!s) {
        const before = foldBefore(c.id).state;
        const next = cloneState(before);
        s = applyAct(next, c, before, concurrent) ? before : next;
        afterMemo.set(c.id, s);
      }
      return s;
    };
    const endsTenure = (c: ActRec, key: string) => isOfficer(foldBefore(c.id).state, key) && !isOfficer(afterOf(c), key);

    function foldSet(ids: readonly string[]): Fold {
      const set = new Set(ids);
      const order = linearize(set, parents, classOf);
      const v = new Map<string, VoidReason>();
      const names = new Map<string, string[]>();
      const branch = new Set<string>();
      const valid = () => order.filter((id) => !v.has(id)).map((id) => acts.get(id)!);

      const standingMemo = new Map<string, State>();
      /** The state this fold's standing ancestors of `id` produce. */
      const standing = (id: string): State => {
        const key = `${id} ${v.size}`;
        let s = standingMemo.get(key);
        if (!s) {
          s = foldSet([...ancOf(id)].filter((a) => set.has(a) && !v.has(a))).state;
          standingMemo.set(key, s);
        }
        return s;
      };
      /** Whether `x` still holds on what stands among its ancestors. Records nothing. */
      const holdsOn = (x: ActRec): boolean => {
        const s = standing(x.id);
        recording = false;
        try {
          return checkAct(x, s).reason === null;
        } finally {
          recording = true;
        }
      };
      /** An ancestor of `id` that stood in its own ancestry and is void in this fold. */
      const undermined = (id: string, among: ReadonlyMap<string, unknown> | ReadonlySet<string>): boolean => {
        const own = foldBefore(id).void;
        for (const a of ancOf(id)) if (set.has(a) && among.has(a) && !own.has(a)) return true;
        return false;
      };
      const onBranch = (ps: readonly string[]) => allVoid(ps, v) && ps.some((p) => branch.has(p));
      const markBranch = () => {
        for (const id of order) {
          if (v.has(id) && !branch.has(id) && onBranch(acts.get(id)!.s.prev)) branch.add(id);
        }
      };
      // What stood on an act just voided: a side of a split inherits it; anything else is judged
      // again against what still stands, and is void only if it no longer holds there.
      const cascade = () => {
        if (v.size === 0) return;
        markBranch();
        for (const id of order) {
          if (v.has(id)) continue;
          const x = acts.get(id)!;
          if (onBranch(x.s.prev)) {
            v.set(id, inherit(x.s.prev, v));
            branch.add(id);
            continue;
          }
          if (undermined(id, v) && !holdsOn(x)) v.set(id, 'built-on-void');
        }
      };

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
        for (const [id, r] of out) {
          if (!v.has(id) && !(r === 'split' && input.follow === id)) {
            v.set(id, r);
            branch.add(id);
          }
        }
        cascade();
      }

      // R1. One vote per opener: one key's concurrent opens for one office, or petitions against
      // one holder, are all void, so one member cannot fill every phone's state with runs.
      {
        const groups = new Map<string, ActRec[]>();
        for (const a of valid()) {
          if (a.s.t !== 'open' && a.s.t !== 'petition') continue;
          const k = `${a.pubkey} ${a.s.t} ${a.s.office} ${a.s.t === 'petition' ? a.s.subject : ''}`;
          const g = groups.get(k);
          if (g) g.push(a);
          else groups.set(k, [a]);
        }
        const out = new Set<string>();
        for (const g of groups.values()) {
          for (let i = 0; i < g.length; i++) {
            for (let j = i + 1; j < g.length; j++) {
              if (concurrent(g[i]!.id, g[j]!.id)) {
                out.add(g[i]!.id);
                out.add(g[j]!.id);
              }
            }
          }
        }
        for (const id of out) {
          v.set(id, 'crossed-opens');
          names.set(id, [acts.get(id)!.pubkey]);
        }
        cascade();
      }

      // R2. Crossed results, and a CO elected to the XO at once.
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

      // R3. A removal never defeats a result: one concurrent with a result that removes its winner.
      {
        const results = valid().filter((a) => a.s.t === 'result');
        if (results.length > 0) {
          for (const x of valid()) {
            if (x.s.t !== 'remove') continue;
            const keys = x.s.keys;
            if (results.some((r) => r.s.t === 'result' && keys.includes(r.s.candidate) && concurrent(x.id, r.id))) {
              v.set(x.id, 'vote-protection');
            }
          }
          cascade();
        }
      }

      // R4. A change of command ends the authority it took: an admission, invitation or removal that
      // needed a position holder is void if every holder who signed it lost that position by a
      // concurrent result, recall or vacate. An old CO cannot act as CO on a state from before.
      if (led) {
        const changes = valid().filter((a) => a.s.t === 'result' || a.s.t === 'recall' || a.s.t === 'vacate');
        if (changes.length > 0) {
          for (const y of valid()) {
            if (y.s.t !== 'admit' && y.s.t !== 'invite' && y.s.t !== 'remove') continue;
            const va = foldBefore(y.id).state;
            if (!needsAuthority(y, va)) continue;
            const holders = [y.pubkey, ...(validCos.get(y.id) ?? [])].filter((k) => isOfficer(va, k));
            if (holders.length > 0 && holders.every((k) => changes.some((c) => concurrent(c.id, y.id) && endsTenure(c, k)))) {
              v.set(y.id, 'office-ended');
            }
          }
          cascade();
        }
      }

      // R5. Removal wins, judged against the removals valid when it starts. A vote is the exception:
      // its electorate is frozen and every signature it counts still counts.
      {
        const live = valid();
        const removals = live.filter((a) => a.s.t === 'remove' || a.s.t === 'leave');
        if (removals.length > 0) {
          for (const y of live) {
            if (VOTES.has(y.s.t)) continue;
            const out = (k: string) =>
              removals.some((x) => x.id !== y.id && concurrent(x.id, y.id) && removedBy(x).includes(k));
            const cos = validCos.get(y.id) ?? [];
            // Its signer, or every second signer that would have made it valid.
            if (out(y.pubkey) || (cos.length > 0 && cos.every(out))) v.set(y.id, 'removal-wins');
          }
          cascade();
        }
      }

      // R6. Crossed admissions.
      {
        const live = valid();
        const joins = live.filter((a) => newKeyOf(a) !== null);
        const invites = live.filter((a) => a.s.t === 'invite');
        /** Admitted by members using a removed leader's open election, with no position holder. */
        const privileged = (a: ActRec): string | null => {
          if (!led || a.s.t !== 'admit' || a.s.readmits === null) return null;
          const va = foldBefore(a.id).state;
          return [a.pubkey, ...(validCos.get(a.id) ?? [])].some((k) => isOfficer(va, k)) ? null : a.s.readmits;
        };
        const out = new Set<string>();
        for (const a of joins) {
          const with_ = joins.filter((b) => b.id === a.id || concurrent(a.id, b.id));
          const key = newKeyOf(a)!;
          if (with_.some((b) => newKeyOf(b) === key && callsignOf(b) !== callsignOf(a))) out.add(a.id);
          if (a.s.t === 'accept') {
            const inv = a.s.invite;
            if (with_.some((b) => b.s.t === 'accept' && b.s.invite === inv && b.pubkey !== a.pubkey)) out.add(a.id);
          }
          // One removed leader comes back once: concurrent readmissions naming them all fall.
          const leader = privileged(a);
          if (leader !== null && with_.some((b) => b.id !== a.id && privileged(b) === leader)) out.add(a.id);
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
      const voidedHere = new Set<string>();
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
        if (onBranch(x.s.prev)) {
          v.set(id, inherit(x.s.prev, v));
          branch.add(id);
          continue;
        }
        if (voidedHere.size > 0 && undermined(id, voidedHere) && !holdsOn(x)) {
          v.set(id, 'built-on-void');
          voidedHere.add(id);
          continue;
        }
        const r = applyAct(st, x, foldBefore(id).state, concurrent);
        if (r) {
          v.set(id, r);
          voidedHere.add(id);
        }
      }
      return { state: st, void: v, names, splits, unresolved, branch };
    }

    // One pass in parent order decides what is held and fills the memos bottom-up.
    const all = linearize([...acts.keys()].filter((id) => !skip.has(id)), parents, (id) => actClass(acts.get(id)!.s.t));
    const known = (p: string) => base.ids.has(p) || active.has(p);
    for (const id of all) {
      const x = acts.get(id)!;
      if (future(x.at) || compactsOf(x.s).some(future)) {
        heldHere.set(id, 'future-dated');
        continue;
      }
      if (!x.s.prev.every(known)) {
        heldHere.set(id, 'waiting-for-earlier');
        continue;
      }
      if (needsCosign(x.s.t) && !x.cosigns.some((c) => !future(c.at))) {
        // Alone only in a unit of two, removing the other.
        const before = foldBefore(id).state;
        const unitOfTwo = x.s.t === 'remove' && before.members.size === 2 && x.s.keys.length === 1;
        if (!unitOfTwo) {
          heldHere.set(id, x.cosigns.length > 0 ? 'future-dated' : 'incomplete');
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

  type CheckpointRead = { read: Read; signers: string[]; head: readonly string[]; snapshot: Snapshot };
  /** A checkpoint and every key other than its author that signed it. */
  const checkpointOf = (event: Read, signs: readonly Read[]): CheckpointRead | null => {
    if (event.statement.t !== 'checkpoint') return null;
    const cp = event.statement;
    const signers = sortedKeys(signs
      .filter((s) => s.statement.t === 'sign' && s.statement.act === event.id && s.pubkey !== event.pubkey)
      .map((s) => s.pubkey));
    if (signers.length === 0) return null;
    return { read: event, signers, head: cp.head, snapshot: cp.snapshot };
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
    let anchorState: State | null = null;
    if (cp !== null && ev !== null && sg !== null && !future(ev.createdAt) && !future(sg.createdAt) &&
      rowKeys.size === rows.length && rowKeys.has(ev.pubkey) && cp.signers.every((k) => rowKeys.has(k)) &&
      rosterDigest(rows) === cp.snapshot.roster && (cp.snapshot.co !== null) === led) {
      // The snapshot must be the one spelling of the state it describes, its cap count included.
      const s = stateOfSnapshot(cp.snapshot, rows);
      const again = safeSnapshot(s);
      if (again && JSON.stringify(snapshotWire(again)) === JSON.stringify(snapshotWire(cp.snapshot))) anchorState = s;
    }
    if (anchorState === null || cp === null || ev === null || sg === null) {
      const id = ev?.id ?? (typeof input.checkpoint.event?.id === 'string' ? input.checkpoint.event.id : '?');
      if (!voids.has(id)) voids.set(id, { reason: 'not-an-anchor' });
    } else {
      // Where this phone holds the history up to the checkpoint, history wins and the checkpoint is
      // compared like any other. Where it holds none, the view starts from it. Where it holds history
      // the checkpoint does not account for, it keeps that history: a head it cannot place is a
      // checkpoint it cannot check, never a reason to drop what it has.
      loose.checkpoint.push(ev);
      loose.sign.push(sg);
      const historyHolds = cp.head.every((h) => h === root || run.active.has(h));
      if (!historyHolds) {
        const subsumed = new Set<string>();
        const stack = cp.head.filter((h) => acts.has(h));
        while (stack.length > 0) {
          const id = stack.pop()!;
          if (subsumed.has(id)) continue;
          subsumed.add(id);
          for (const p of acts.get(id)!.s.prev) if (acts.has(p)) stack.push(p);
        }
        if ([...run.active].every((id) => subsumed.has(id))) {
          mode = 'anchor';
          anchorHead = [...cp.head];
          run = runFrom({ ids: new Set(cp.head), state: anchorState }, subsumed);
        } else {
          held.set(ev.id, 'waiting-for-earlier');
        }
      }
    }
  }

  const fin = run.final;
  const st = fin.state;
  for (const [id, r] of run.held) held.set(id, r);
  for (const [id, r] of fin.void) voids.set(id, { reason: r, ...(fin.names.has(id) ? { names: fin.names.get(id)! } : {}) });

  // An act this release cannot read that a second key has since built on: governance on this phone
  // stops where it can read, and says so, rather than showing what it has as current.
  let needsUpdate = false;
  if (unknownActs.size > 0) {
    const blocked = new Map<string, Set<string>>([...unknownActs].map(([id, k]) => [id, new Set([k])]));
    let grew = true;
    while (grew && !needsUpdate) {
      grew = false;
      for (const [id, why] of run.held) {
        if (why !== 'waiting-for-earlier' || blocked.has(id)) continue;
        const x = acts.get(id);
        if (!x) continue;
        const via = x.s.prev.filter((p) => blocked.has(p));
        if (via.length === 0) continue;
        const keys = new Set<string>([x.pubkey, ...x.cosigns.map((c) => c.key)]);
        for (const p of via) for (const k of blocked.get(p)!) keys.add(k);
        blocked.set(id, keys);
        grew = true;
        if (keys.size >= 2) needsUpdate = true;
      }
    }
  }

  // (8) This phone's own reading of the loose statements it holds.
  const memberNow = (k: string) => st.members.has(k);
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
    const cappedKeys = r.office === 'co'
      ? sortedKeys([...st.members.keys(), ...electorate].filter((key) => cappedFor(st, key, r.kind)))
      : [];
    const kCapped = cappedKeys.length > 0 ? threeQuartersOf(m) : null;
    const candidates = sortedKeys([...counts.keys(), ...stood]);
    const tallies = candidates.map((c) => ({ candidate: c, count: counts.get(c) ?? 0, stood: stood.has(c) }));
    const postable = tallies.find((t) =>
      t.stood && memberNow(t.candidate) && t.count >= (cappedKeys.includes(t.candidate) ? kCapped! : k) &&
      !(r.office === 'xo' && st.co?.holder === t.candidate && !st.co.acting)
    )?.candidate ?? null;
    runs.push({
      id: r.id, office: r.office, kind: r.kind as RunView['kind'], openedAt: r.at, electorate,
      electorateDigest: electorateDigest(electorate), m, k, kCapped, cappedKeys, tallies, postable
    });
  }

  const applied = [...run.active].filter((id) => !fin.void.has(id));

  // A result that carries the signature of an elector this phone holds endorsing someone else in
  // the same run: the closer chose which of the two to count. Named, and shown as phones
  // disagreeing about the result, since a phone without that endorsement cannot see it.
  for (const id of applied) {
    const x = acts.get(id)!;
    if (x.s.t !== 'result') continue;
    const opened = run.foldBefore(id).state.runs.get(x.s.run);
    if (!opened) continue;
    const carried = new Set(x.s.sigs.map((c) => c[0]));
    for (const e of loose.endorse) {
      if (e.statement.t !== 'endorse' || e.statement.run !== x.s.run || e.statement.candidate === x.s.candidate) continue;
      if (!carried.has(e.pubkey) || e.createdAt < opened.at) continue;
      equivocate(e.pubkey, x.s.run, [e.id, id]);
      disagreements.set(id, 'result');
    }
  }

  // Checkpoints: compared against the history where this phone holds it, and whether the last
  // change of command has one after it. A checkpoint whose head this phone holds but now reads as
  // void certified something this phone has since undone: that is a disagreement, never a skip.
  let covered = st.prevCommand === null || (mode === 'anchor' && !run.active.has(st.prevCommand));
  for (const c of loose.checkpoint) {
    const cp = checkpointOf(c, loose.sign);
    if (!cp) continue;
    const base = (h: string) => (mode === 'history' && h === root) || (mode === 'anchor' && anchorHead.includes(h));
    if (!cp.head.every((h) => run.active.has(h) || base(h))) continue;
    const closure = new Set<string>();
    for (const h of cp.head) {
      if (!run.active.has(h)) continue;
      closure.add(h);
      for (const a of ancOf(h)) if (run.active.has(a)) closure.add(a);
    }
    const certified = run.foldSet([...closure]);
    const atHead = certified.state;
    if (!atHead.members.has(c.pubkey) || !cp.signers.some((k) => atHead.members.has(k))) continue;
    const snap = safeSnapshot(atHead);
    const undone = [...closure].some((id) => fin.void.has(id) && !certified.void.has(id));
    if (undone || snap === null || JSON.stringify(snapshotWire(snap)) !== JSON.stringify(snapshotWire(cp.snapshot))) {
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

  // Lineage: whether the former keys this unit names were on the old roster this phone held,
  // counting invitations this phone refused for naming a key off it.
  let lineage: UnitView['lineage'] = null;
  if (charter.lineage !== null) {
    const offRoster = [...fin.void]
      .filter(([, r]) => r === 'not-on-old-roster')
      .map(([id]) => acts.get(id)!.s)
      .flatMap((s) => (s.t === 'invite' ? [s.former] : []));
    const formers = [...founderFormers, ...[...st.invited.values()].map((i) => i.former), ...offRoster];
    lineage = {
      from: charter.lineage,
      former: !input.formerRoster ? 'not-held' : formers.every((k) => input.formerRoster!.has(k)) ? 'checked' : 'mismatch'
    };
  }

  const officeView = (o: OfficeState, isCo: boolean): OfficeView => ({
    holder: o.holder,
    acting: o.holder !== null && o.acting,
    term: { n: o.n, start: o.start, end: o.end },
    capped: isCo && coCapOn && o.holder !== null && !o.acting && termsNow(st, o.holder) >= 2
  });

  return {
    status: needsUpdate ? 'needs-update' : fin.unresolved ? 'split' : 'ok',
    ...(needsUpdate ? { reason: 'needs-update' as const, field: 'act' } : {}),
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
    snapshot: safeSnapshot(st)
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
  const k = rv.cappedKeys.includes(o.candidate) && rv.kCapped !== null ? rv.kCapped : rv.k;
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
