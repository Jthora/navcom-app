/**
 * Watch state — kind 10910.
 *
 * Published by the node, unencrypted, replaceable. A cold client must be able to read it
 * before signing on [C23, invariant 4], because an operator must never believe a human is
 * watching when none is.
 *
 * Normative source: docs/spec/watch-state.spec.md
 */

import type { Author } from '../attestation.js';
import { CALLSIGN_MAX, withinLimit } from '../limits.js';
import type { LogRoot } from '../merkle.js';
import { KIND_WATCH_STATE } from './kinds.js';

export type WatchState = 'station' | 'automated-oncall' | 'automated' | 'dark';
export type HolderKind = 'human' | 'agent';
export type AgentHealth = 'ok' | 'degraded' | 'down';

export interface DrillResult {
  /** Unix seconds. */
  at: number;
  result: 'pass' | 'fail';
  /** Who ran it. Today the node; the shape does not assume that. */
  author: Author;
  /**
   * Who actually woke up, each signing for themselves.
   *
   * Empty today, because nothing counter-signs yet — and an empty array is the honest
   * reading of that. A drill the node reports about itself is a claim; a drill carrying
   * acknowledgements from other keys is evidence.
   */
  acknowledged: Author[];
}

/**
 * One on-call operator's own statement that they are reachable.
 *
 * **The node must not assert this on anyone's behalf.** Today it synthesises these entries
 * with itself as author, which is a self-report and is marked as such. When operators sign
 * their own, only the author changes — the shape, the wire format and every consumer stay
 * put. That is the whole reason this is an array of authored statements rather than a
 * number the node picks.
 */
export interface OnCall {
  author: Author;
  /** How they can be woken. `console-open` is never sufficient alone. */
  channel: 'sms' | 'voice' | 'push' | 'console-open';
  /** Unix seconds. A stale declaration is not a reachable person. */
  expires: number;
  /** Hex signature by `author`. Absent means the node is speaking for them. */
  sig?: string;
}

export interface WatchStatePayload {
  /** Bumped when the shape changes in a way a consumer must notice. */
  v: number;
  state: WatchState;
  holder: string | null;
  holder_kind: HolderKind | null;
  /**
   * Who is on-call, each as their own statement rather than a number the node chose.
   *
   * A count can be inflated by whoever publishes it. A list of authored, signed statements
   * can only be inflated by forging keys — so a consumer counts the evidence instead of
   * trusting the total.
   */
  oncall: OnCall[];
  since: number;
  agent_health: AgentHealth;
  /** Null when no drill has ever run — itself a fact worth publishing. */
  last_drill: DrillResult | null;
  /**
   * A commitment to the accountability log as it stands right now.
   *
   * Published here rather than as a new kind: `10910` is already node-published, already
   * signed by the Watchtower key, and already read by a cold client, so the root arrives
   * signed with no new protocol surface. Null when the node keeps no log — which is itself
   * the fact worth publishing.
   *
   * What it buys: the root **pins history at a point in time**. A watch cannot retroactively
   * change an entry that a published root already covered without every operator holding an
   * old root being able to notice.
   *
   * What it does not buy: honesty about entries never written. A root over a tree that
   * omits an entry verifies perfectly. That is `countersig`, and it is gated.
   *
   * `10910` is replaceable, so a relay serves only the latest. A client that wants the
   * pinning property must **keep the roots it has seen** — the node cannot be the sole
   * custodian of the evidence against it.
   *
   * It is a **checkpoint**, republished on the heartbeat rather than on every entry, so an
   * entry written seconds ago is genuinely not covered yet. `size` is what makes that
   * legible: an operator verifies entries up to the size their root covers, and knows the
   * rest are pending rather than unverifiable.
   */
  log_root: LogRoot | null;
}

// v4 removes `overdue_count`. Subtractive rather than additive, so it is a real bump: a v3
// reader defaulted the missing field to 0 and would render "nobody overdue" for a watch that
// simply stopped saying — which is a claim nobody made.
//
// Why it went: `10910` is unencrypted, so publishing a count announced *that* somebody was
// overdue to anyone subscribed. It never said who, but a watcher correlating timing learns
// something, and that is the Doxxer's method. It existed only because there was no way to
// tell whoever held watch, and the watch is now a mode of the app that reads the board
// directly. The note on this field said to drop it once that existed. It does.
export const WATCH_STATE_VERSION = 4;

/** Reachable now: not expired, and not console-open standing alone [C40]. */
export function pageableNow(oncall: OnCall[], nowSeconds: number): OnCall[] {
  const live = oncall.filter((o) => o.expires > nowSeconds);
  const realChannels = live.filter((o) => o.channel !== 'console-open');
  // If the only declarations are console-open, treat the roster as empty and say so.
  return realChannels.length > 0 ? live : [];
}

/** What the node knows before it decides what to publish. */
export interface WatchStateInput {
  state: WatchState;
  holder: string | null;
  holder_kind: HolderKind | null;
  /** Every on-call declaration the node holds, expired or not. */
  oncall: OnCall[];
  since: number;
  agent_health: AgentHealth;
  last_drill: DrillResult | null;
  /** Absent when the node keeps no accountability log, which is published as null. */
  log_root?: LogRoot | null;
  /** Unix seconds, supplied rather than read from a clock this module does not own. */
  now: number;
}

/**
 * Decides what may honestly be published, and it is deliberately not a straight copy.
 *
 * Two demotions, both because publishing a capability that does not exist is the same class
 * of failure as publishing an agent as a human:
 *
 * 1. **No pageable on-call means `automated`, never `automated-oncall`.** An operator whose
 *    only channel is a console they have closed is not reachable [C40].
 * 2. **A failed or absent drill demotes `automated-oncall` to `automated`.** The on-call
 *    claim is exactly what a drill tests, so an untested ladder cannot be advertised [C29].
 *    `station` is unaffected — a human is genuinely present regardless.
 */
/**
 * How long a passing drill is worth anything.
 *
 * Drills run weekly, so a result older than two of those windows does not mean the ladder is
 * fine — it means **the thing that tests the ladder has stopped running**. An executor that
 * died in June leaves a passing June drill in the file forever, and until this existed the
 * daemon went on advertising `automated-oncall` on the strength of it. A dead safety check
 * read exactly like a healthy one.
 *
 * Invariant 9 says volatile data shows its age. A drill result is the most volatile thing
 * this system publishes, and it was the one piece that did not.
 */
export const DRILL_FRESH_SECONDS = 14 * 24 * 60 * 60;

/** Whether a drill result is recent enough to stand for anything. */
export function drillIsCurrent(drill: DrillResult | null, now: number): boolean {
  if (!drill) return false;
  return now - drill.at <= DRILL_FRESH_SECONDS;
}

export function publishableWatchState(input: WatchStateInput): WatchStatePayload {
  const reachable = pageableNow(input.oncall, input.now);
  let state = input.state;

  if (state === 'automated-oncall') {
    // A stale pass is not a pass. See DRILL_FRESH_SECONDS: it means the executor stopped,
    // and the last thing it managed to write outlives it.
    const unproven =
      input.last_drill === null ||
      input.last_drill.result === 'fail' ||
      !drillIsCurrent(input.last_drill, input.now);
    if (reachable.length === 0 || unproven) state = 'automated';
  }

  return {
    v: WATCH_STATE_VERSION,
    state,
    holder: input.holder,
    holder_kind: input.holder_kind,
    // Only the reachable are published. An expired declaration is not a person who will wake.
    oncall: reachable,
    since: input.since,
    agent_health: input.agent_health,
    last_drill: input.last_drill,
    log_root: input.log_root ?? null
  };
}

export function buildWatchStateEvent(input: WatchStateInput, createdAt: number) {
  return {
    kind: KIND_WATCH_STATE,
    created_at: createdAt,
    tags: [] as string[][],
    content: JSON.stringify(publishableWatchState(input))
  };
}

export type DarkReason =
  | 'absent'
  | 'stale'
  | 'corrupt'
  /** This device's clock and the node's disagree, so the age means nothing. */
  | 'clock';

export interface WatchStateRead {
  state: WatchStatePayload;
  /** True when the client must render Dark, whatever the payload said. */
  dark: boolean;
  reason: DarkReason | null;
  /** Age of the event in seconds, where one was found. */
  ageSeconds: number | null;
}

/**
 * How long a watch state may go unrefreshed before it is treated as Dark.
 *
 * Meant to be a small multiple of the daemon's publish interval. *Configurable.*
 */
export const STALE_AFTER_SECONDS = 300;

/**
 * How far the node's clock may lead this device's before the age becomes unusable.
 *
 * A watch state carries a `created_at` the node wrote. If that sits meaningfully in this
 * device's future, the two clocks disagree — and every staleness judgement made from the
 * difference is then arithmetic on a number that means nothing.
 *
 * Generous, because normal skew is seconds: relay delivery, a phone that has not synced
 * since it woke, an NTP nudge. Two minutes catches the failures that matter — a phone
 * hours or days out, which is ordinary on a cheap handset that has been off — while
 * ignoring the noise.
 */
export const CLOCK_TOLERANCE_SECONDS = 120;

/**
 * Reads a watch state event, and decides whether the client must render Dark.
 *
 * **Absence is Dark — and so is staleness, which is the part that is easy to miss.**
 *
 * `10910` is a *replaceable* kind, so a relay keeps serving the daemon's last published
 * copy long after the daemon has died. A client checking only for absence would fetch that
 * corpse, read `automated`, and tell an operator a watch exists when nothing is running.
 * That is invariant 4 failing in the exact way it was written to prevent.
 *
 * Found by running the loop against a real relay rather than by reading the spec, which is
 * why this function takes an age it cannot infer for itself.
 *
 * **A disagreeing clock is Dark too**, and that one is asymmetric in a way worth naming.
 * A device clock running *fast* makes a live watch look old, so it reads Dark — wrong, and
 * wrong in the safe direction. A device clock running *slow* makes a dead watch look fresh,
 * and tells an operator somebody is watching when nobody is. That is the direction invariant
 * 4 exists to prevent, and it is detectable: an event stamped in this device's future can
 * only mean the clocks disagree.
 *
 * The other direction is not reliably detectable and does not need to be. `10910` is
 * replaceable, so a genuinely old event legitimately arrives now — "stale" and "our clock is
 * fast" look identical from one event, and both already render Dark.
 */
export function readWatchStateAt(
  content: string | null | undefined,
  opts: {
    createdAt?: number | null;
    now?: number;
    staleAfterSeconds?: number;
    clockToleranceSeconds?: number;
  } = {}
): WatchStateRead {
  const parsed = readWatchState(content);

  if (!content) return { state: darkState(), dark: true, reason: 'absent', ageSeconds: null };
  if (parsed.state === 'dark' && content) {
    // Parsed to dark from malformed content.
    try {
      const raw = JSON.parse(content) as { v?: unknown; state?: unknown };
      // A watch newer than this build is unreadable rather than absent or stale, and that is
      // a different thing to tell an operator: it is fixable by updating, and the watch is
      // probably alive. `state` present but unreadable means the same.
      if (!readableVersion(raw?.v) || (raw?.state !== undefined && raw?.state !== 'dark')) {
        return { state: darkState(), dark: true, reason: 'corrupt', ageSeconds: null };
      }
    } catch {
      return { state: darkState(), dark: true, reason: 'corrupt', ageSeconds: null };
    }
  }

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const staleAfter = opts.staleAfterSeconds ?? STALE_AFTER_SECONDS;

  if (opts.createdAt == null) {
    // No age available means no way to tell a live watch from a preserved corpse. The
    // honest answer is Dark rather than an optimistic reading.
    return { state: darkState(), dark: true, reason: 'stale', ageSeconds: null };
  }

  const ageSeconds = now - opts.createdAt;

  // Stamped in our future by more than delivery could explain. We cannot tell whose clock
  // is wrong, and it does not matter: an age computed from disagreeing clocks is a number
  // with no meaning, so no claim about a live watch can rest on it.
  if (ageSeconds < -(opts.clockToleranceSeconds ?? CLOCK_TOLERANCE_SECONDS)) {
    return { state: darkState(), dark: true, reason: 'clock', ageSeconds };
  }

  if (ageSeconds > staleAfter) {
    return { state: darkState(), dark: true, reason: 'stale', ageSeconds };
  }

  return { state: parsed, dark: parsed.state === 'dark', reason: null, ageSeconds };
}

/**
 * Parses the payload only. **Prefer `readWatchStateAt`** — this cannot tell a live watch
 * from a stale one, and a replaceable event outlives the daemon that published it.
 */
const WATCH_STATES: readonly WatchState[] = ['station', 'automated-oncall', 'automated', 'dark'];
const CHANNELS: readonly OnCall['channel'][] = ['sms', 'voice', 'push', 'console-open'];
const HEALTH: readonly AgentHealth[] = ['ok', 'degraded', 'down'];

/**
 * Whether this client can read a payload claiming that version.
 *
 * Older is fine and deliberately so — *"a v2 node publishes no root"*, and every field this
 * client wants is either present or has an honest default. **Newer is not**: a payload
 * written to a spec this build has never seen may mean something different by the same
 * words, and guessing is how a client tells an operator a watch is staffed because a field
 * it did not understand happened to be truthy.
 */
const readableVersion = (v: unknown): boolean =>
  typeof v !== 'number' || (Number.isFinite(v) && v <= WATCH_STATE_VERSION);

/** One on-call declaration, or nothing. Elements were never checked, only the array. */
function readOnCall(raw: unknown): OnCall | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<OnCall>;
  const author = o.author as Author | undefined;
  if (!author || typeof author !== 'object') return null;
  if (author.kind !== 'human' && author.kind !== 'node' && author.kind !== 'agent') return null;
  if (author.callsign !== undefined && !withinLimit(author.callsign, CALLSIGN_MAX)) return null;
  if (!CHANNELS.includes(o.channel as OnCall['channel'])) return null;
  if (typeof o.expires !== 'number' || !Number.isFinite(o.expires)) return null;
  return o as OnCall;
}

/**
 * Reads a published watch state, or Dark.
 *
 * **Everything here arrived from a relay**, so nothing is taken on trust. Found by audit,
 * and the earlier version checked only that `state` was truthy: an unknown state word
 * rendered *"An agent holds the board"* — a false claim about who is watching, on the one
 * screen invariant 4 governs. A `holder` was never type-checked or bounded, so an object
 * rendered as `[object Object]` and a sixty-thousand-character name filled the screen.
 * Junk inside `oncall` threw out of `capabilitySentence` and took the screen down with it.
 *
 * Anything that does not parse cleanly reads as Dark, which is always the safe direction:
 * an operator who believes nobody is watching acts for themselves.
 */
/** A published commitment, or null. Shape-checked: a root nobody can verify is worse than none. */
function readLogRoot(v: unknown): LogRoot | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Partial<LogRoot>;
  if (typeof r.root !== 'string' || !/^[0-9a-f]{64}$/.test(r.root)) return null;
  if (typeof r.size !== 'number' || !Number.isInteger(r.size) || r.size < 0) return null;
  if (typeof r.at !== 'number' || !Number.isFinite(r.at)) return null;
  return { root: r.root, size: r.size, at: r.at };
}

export function readWatchState(content: string | null | undefined): WatchStatePayload {
  if (!content) return darkState();
  try {
    const p = JSON.parse(content) as Partial<WatchStatePayload>;
    if (!p || typeof p !== 'object') return darkState();
    if (!readableVersion(p.v)) return darkState();
    if (!WATCH_STATES.includes(p.state as WatchState)) return darkState();

    return {
      v: typeof p.v === 'number' ? p.v : 1,
      state: p.state as WatchState,
      // The name an operator reads to know who is watching. Bounded for the same reason
      // every callsign on somebody else's screen is bounded.
      holder: withinLimit(p.holder, CALLSIGN_MAX) ? p.holder : null,
      holder_kind: p.holder_kind === 'human' || p.holder_kind === 'agent' ? p.holder_kind : null,
      oncall: Array.isArray(p.oncall)
        ? p.oncall.map(readOnCall).filter((o): o is OnCall => o !== null)
        : [],
      since: typeof p.since === 'number' && Number.isFinite(p.since) ? p.since : 0,
      // Anything unrecognised reads as `down`, never as healthy.
      agent_health: HEALTH.includes(p.agent_health as AgentHealth) ? (p.agent_health as AgentHealth) : 'down',
      last_drill: p.last_drill ?? null,
      // A v2 node publishes no root. Null reads as "this watch commits to no log", which is
      // the honest reading of its absence rather than a shape to paper over.
      /*
       * Validated as the object it is published as.
       *
       * This tested `typeof p.log_root === 'string'`, and `log_root` is a `LogRoot` — so every
       * well-formed `10910` read back as committing to no log. TypeScript could not catch it:
       * narrowing `LogRoot | null` by `typeof === 'string'` yields `never`, and `never` is
       * assignable to the null it fell through to. The cost was the whole mechanism: a client
       * never accumulated a published root, so `observeRoot` had nothing to compare and the
       * `diverged` alarm — the finding it exists to produce — could not fire, while
       * `checkReview` told every operator their own entries could not be checked.
       */
      log_root: readLogRoot(p.log_root)
    };
  } catch {
    return darkState();
  }
}

export const darkState = (): WatchStatePayload => ({
  v: WATCH_STATE_VERSION,
  state: 'dark',
  holder: null,
  holder_kind: null,
  oncall: [],
  since: 0,
  agent_health: 'down',
  last_drill: null,
  // Dark commits to nothing. There is no watch to hold accountable right now.
  log_root: null
});

/**
 * What an operator is actually told before going out — the consequence, not the label.
 * A word like "Automated" is not enough on its own.
 */
/**
 * Who can actually be raised, by name.
 *
 * **Never a count.** A number invites gaming and tells a reader nothing they can act on;
 * *"Wren and Raven"* tells somebody whether they recognise anybody. The names are already
 * public — `10910` is unencrypted and carries the roster — so this reveals nothing new, it
 * just stops the sentence hiding behind a total.
 */
function namesOf(oncall: OnCall[]): string {
  const names = oncall.map((o) => o.author.callsign).filter((n): n is string => !!n);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function drillClause(drill: DrillResult | null, now: number): string {
  if (!drill) return ' No drill has ever run.';
  if (drill.result === 'fail') return ' The last drill failed.';
  if (drillIsCurrent(drill, now)) return '';

  const days = Math.floor((now - drill.at) / 86_400);
  return ` The last drill passed ${days} days ago, so nothing has tested this since.`;
}

export function capabilitySentence(s: WatchStatePayload, now: number): string {
  const reachable = namesOf(s.oncall);
  /*
   * What is thin, said to the operator relying on it.
   *
   * Not published anywhere new — this rides on the sentence that already goes to somebody at
   * sign-on. Naming the on-call roster *to the world* would hand an adversary the one name
   * worth targeting; naming it to the person about to walk out the door is the entire point
   * of a capability receipt.
   */
  const thin =
    s.oncall.length === 1
      ? ' One person, so if they miss it the ladder ends there.'
      : '';
  /*
   * What the drill actually says, rather than one sentence for three different situations.
   *
   * It read "No drill has ever passed." for all of them, which is an assertion the payload
   * cannot support — `last_drill` is the last one, so a failure today says nothing about
   * whether one passed last month. And a *stale* pass produced no caveat at all: an operator
   * signed on reading a clean sentence while the process that runs drills had been dead for
   * three months.
   */
  const drill = drillClause(s.last_drill, now);

  if (s.state === 'dark') {
    return 'No watch. Distress will page nobody — the terminal will tell you so, and it still works offline.';
  }

  if (s.state === 'station') {
    const who = s.holder ? `${s.holder} is` : 'A human is';
    /*
     * The state that looks strongest is the one that used to say least.
     *
     * "Wren is at the console right now" is true and is not a ladder. Wren can be asleep by
     * 3am, and if the roster is empty a Distress still pages nobody — which an operator was
     * never told, because this branch returned before it got to escalation. The strongest
     * word on the screen was hiding the weakest fact behind it.
     */
    if (!reachable) {
      return `${who} at the console. Nobody is on call, so if they cannot be raised, Distress pages nobody and tells you so.`;
    }
    return `${who} at the console, and ${reachable} on call.${thin}${drill}`;
  }

  if (!reachable) {
    return 'An agent holds the board. Distress will page nobody and tell you so.';
  }
  // "Reachable now" was the node's statement about its own configuration, which nothing here
  // can check. What the node can say is who it lists.
  return `An agent holds the board. ${reachable} listed as on call.${thin}${drill}`;
}

