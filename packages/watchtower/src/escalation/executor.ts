import type { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, verifyEvent } from "nostr-tools/pure";
import type { Event } from "nostr-tools/core";
import { randomBytes } from "node:crypto";
import {
  acknowledge,
  DEFAULT_WINDOWS,
  drillSentence,
  LadderRegistry,
  ladderReport,
  pageableNow,
  STALE_AFTER_SECONDS,
  watchCopy,
  type Author,
  type DistressAckPayload,
  type Ladder,
  type LadderState,
  type OnCall,
  type ResponsePayload,
} from "@navcom/core";
import { nodePool } from "../shared/nostr-node.js";
import { RelayListener } from "../shared/relay-listener.js";
import {
  HEARING_MAX_AGE_SECONDS,
  HEARING_VERSION,
  HEARING_WRITE_SECONDS,
  writeHearing,
  type HearingRelay,
} from "../shared/hearing.js";
import { sealResponse, openSignal } from "../shared/crypto.js";
import { KIND_SIGNAL, KIND_DISTRESS, KIND_RESPONSE } from "../shared/kinds.js";
import { pageAll, type PageResult } from "./pager.js";
import { due, readDrillState, runDrill, schedule, writeDrillState, type DrillState } from "./drills.js";
import type { EscalationConfig, OnCallEntry } from "./config.js";
import { pageBudget, type PageBudget } from "./budget.js";
// A source import, not a runtime dependency: `AccountabilityLog` is a self-contained class
// with no reference to the daemon process. The executor still opens and writes its own
// instance, on its own schedule, from its own config -- nothing here waits on the daemon
// or reads its health, which is the actual rule this file exists to hold.
import { AccountabilityLog } from "../shared/accountability.js";

/**
 * The escalation executor.
 *
 * A separate process from the daemon, and separate in the way that matters: **it gets its
 * trigger from the relays, not from the daemon.** A design where the daemon receives the
 * `20911` and hands it over would satisfy "separate process" on paper while leaving a hung
 * daemon able to take escalation down with it -- which is the requirement failing in
 * exactly the way it was written to prevent.
 *
 * Nothing here calls the agent, waits on it, or reads its health. There is no seam.
 *
 * Two processes therefore hold the Watchtower key, and that cost is real: it doubles where
 * the key lives. It is accepted because the alternative is an escalation path that depends
 * on the availability of the component most likely to hang.
 *
 * **And the executor has a key of its own** (decided 2026-10-07, G3), where `escalation.toml` names
 * one. Every response it sends is signed with that key and then copied under the watch key, and a
 * phone handed it ends a `Distress` only on an answer that key signed -- so the daemon, which the
 * agent runs beside and which holds the watch key, can tell an operator anything but that a person
 * has it. Without one, every response is signed with the watch key, as before.
 */

function now(): number {
  return Math.floor(Date.now() / 1000);
}

export interface ExecutorOptions {
  config: EscalationConfig;
  /** The watch key: what operators address, and what signs the copies older phones hear. */
  secretKey: Uint8Array;
  pubkey: string;
  /**
   * The executor's own key, which only this process holds. Every response is signed and sealed with
   * it, then sent again as the watch key's copy (`copy_of`); the acknowledgements and wake-others it
   * acts on are opened with it first. Absent: every response is signed with the watch key alone, as
   * it was before the key existed, and the operator's phone keeps the old rule.
   */
  executorKey?: { secretKey: Uint8Array; pubkey: string };
  /** Injected for tests, so the seven failure modes never need a real relay. */
  pool?: SimplePool;
  /** Injected for tests. Real paging shells out; a test must not. */
  page?: typeof pageAll;
  /** Where drill results are kept, and where the daemon reads them from. */
  drillStatePath?: string;
  /**
   * Where this executor writes where it hears, for the daemon (`shared/hearing.ts`). Only the
   * long-running start passes it: `--drill` runs beside the live executor and must not overwrite
   * what the live one hears.
   */
  hearingStatePath?: string;
  /**
   * The long-running start only: what the key file check found at this start, recorded once by
   * `start()` as `took-watch` -- `held`, or `key-not-its-own` while it found anything -- where the
   * executor signs with a key of its own. `--drill` passes none: run beside the live executor, it would
   * append to the live one's chain from a copy that is behind.
   */
  tookWatch?: { keyProblems: readonly string[] };
}

/** The longest wait before a relay whose subscription closed is tried again. */
export { RELISTEN_SECONDS } from "../shared/relay-listener.js";

/**
 * How long a starting executor waits for a first relay before saying it hears on none: the keyless
 * pager's figure, after every relay has had its first try.
 */
export const BOOT_GRACE_SECONDS = 15;

/**
 * How long after re-sending a held acknowledgement it is sent once more.
 *
 * For a client from before 2026-10-07, which stays cached on phones: its loop listens only for
 * answers to ids it has recorded, and records an attempt only once the publish has settled on
 * every relay -- three seconds to connect and 4.4 to give up on an OK. Such a phone, having
 * started its Distress again, knows none of the ids the watch acknowledged, so the first re-send
 * names only an id it has not recorded yet whenever one of its relays is slow [review: D2]. The
 * second lands after. A current client records an attempt before sending it and listens for the
 * whole Distress, so it hears the first -- when a relay took the first. One no relay took is
 * reached by the second, which is why the hold stands until it has gone [review: relay paths, R2].
 */
export const RESEND_AGAIN_SECONDS = 10;

/**
 * How far from this machine's clock a `20911` may be stamped and still be acted on, either way.
 *
 * **Never less than {@link STALE_AFTER_SECONDS}**, the age at which a phone reads this watch as
 * Dark [review: relay paths, #4]. It was the paging window, so a Stationkeeper who shortened that
 * to reach "nobody is coming" sooner also narrowed which clocks the watch could hear: at 120, a
 * phone 200s fast read the watch as up -- its state was 200s old, short of 300 -- while every
 * Distress it sent was ignored, with no page and no "nobody is coming" from the watch. At 300 or
 * more, a phone whose clock is off by enough to be ignored already reads the watch as Dark.
 */
export function ageWindowSeconds(config: EscalationConfig): number {
  return Math.max(config.escalation.pagingWindowSeconds, STALE_AFTER_SECONDS);
}

/**
 * How long after the person who acknowledged is paged about an operator they may be paged about
 * that operator again: the paging window, and **never less than the spec's default of 300**. Since
 * option E (decided 2026-10-07) it is also how long after any page to that person, about anybody they
 * hold, the next one may go -- except the first page about an operator, which goes at once.
 *
 * A phone resends every 20 to 80 seconds, so a paging window shorter than that -- which the example
 * config's note on shortening it invites -- paged the person who answered on every attempt for the
 * whole hold, which is what the window was there to stop, and one operator's repeats spent the
 * watch's page budget [review: hold decisions]. Shortening the window reaches "nobody is coming"
 * sooner on a ladder; it does not page the person who acknowledged more often.
 */
export function repageWindowSeconds(config: EscalationConfig): number {
  return Math.max(config.escalation.pagingWindowSeconds, DEFAULT_WINDOWS.pagingSeconds);
}

/**
 * The most times one person may be paged again in an hour, about operators they acknowledged (decided
 * 2026-10-07, option E). Far above what the re-page interval allows -- the first page about each
 * operator they hold, and after that one page per person per five minutes only where the hold cannot
 * widen (*Silence widens*) -- so it is there only to catch a loop:
 * this project has paged in a loop twice with no attacker involved. A person at it is not paged again:
 * the hold ends and the attempt is escalated as new, failing toward paging -- a ladder that pages the
 * whole roster, that person included, with a first page they can acknowledge.
 */
export const REPAGE_CEILING = 24;
/** The window {@link REPAGE_CEILING} counts over. */
export const REPAGE_CEILING_SECONDS = 3_600;

/**
 * How long a push service may hold a repeat page before delivering it: `navcom-push`'s default for a
 * repeat. An attempt answered from a hold is remembered for this long past the hold's window, or the
 * ladder retention if longer, so a `wake-others` sent from a page that arrived late -- or was read late
 * -- is told the hold had ended, rather than that the watch never answered that attempt from a hold
 * [review: box safety].
 */
export const REPEAT_PAGE_TTL_SECONDS = 1_800;

/** What the watch says when the page budget is spent. It states the outcome; "Paging Wren." would not be true. */
const BUDGET_SPENT = "The watch could not page anyone -- too many alerts at once. Nobody has been woken.";
/** What the watch says when every paging command failed. */
const EVERY_CHANNEL_FAILED = "No page could be sent -- every channel failed. Nobody has been woken.";

/** How long ago, as the operator reads it: under a minute, or whole minutes. */
function ago(seconds: number): string {
  const minutes = Math.round(Math.max(0, seconds) / 60);
  return minutes === 0 ? "less than a minute" : `${minutes} min`;
}

/** How long from now, as the operator reads it: rounded up, so it is never sooner than said. */
function within(seconds: number): string {
  return seconds < 60 ? "less than a minute" : `${Math.ceil(seconds / 60)} min`;
}

/**
 * Why the person who acknowledged is not paged again about this attempt, as the executor's log says it.
 * Each one fails toward paging: the hold ends and the attempt is escalated as new.
 */
const UNPAGED = {
  "off-roster": "no longer on call",
  // The only on-call entry with no command the config accepts: nothing can wake them [C40].
  "console-only": "only reachable at a console",
  // A loop, not a person: far above anything the re-page interval allows (`REPAGE_CEILING`).
  ceiling: "at the re-page ceiling",
  failed: "every channel failed",
  // Not "cannot be paged": what it stops is a second page to one person (decided 2026-10-07).
  silence: "paged about them once already, and they are still sending after the re-page interval (silence widens)",
} as const;
type Unpaged = keyof typeof UNPAGED;

/**
 * Why, in the words the operator is told -- each true at the moment it is said.
 *
 * The ceiling is not "could not be paged" [review: box safety]: the ladder it opens pages the whole
 * roster, that person included, with a first page. What the ceiling stops is the re-pages, so that is
 * what is said, and the ladder's own sentence says who is being paged. Silence widens is the same: the
 * ladder pages that person too, and what it replaces is paging them alone a second time.
 */
function unpagedSentence(name: string, why: Unpaged): string {
  return why === "ceiling"
    ? `${name} has been paged again as often as the watch allows in an hour, so the watch is treating this one as new.`
    : why === "silence"
      ? `${name} was paged again about you and your phone is still sending, so the watch is treating this one as new.`
      : `${name} could not be paged again -- ${UNPAGED[why]}.`;
}

/**
 * A ladder's first report, decided before anything is sent: what it says, whether the roster is
 * paged, and who it says is being paged.
 */
interface Opening {
  said: string | undefined;
  pages: boolean;
  paging: string[];
  /** Who the page goes to, where it is not everybody on the roster the ladder names. */
  roster?: OnCallEntry[];
  /** Refused by the first-page budget: the one reason a paging ladder pages nobody that a flood causes. */
  budgetSpent?: true;
}

/** The name a ladder gives an on-call entry -- core's rule (`startLadder`), for entries this process filters itself. */
function nameOf(entry: OnCall): string {
  return entry.author.callsign ?? entry.author.pubkey?.slice(0, 8) ?? "unnamed";
}

/**
 * The person who acknowledged, paged again about a later attempt (decided 2026-10-07): when, about
 * which attempt, and whether a channel has taken it yet -- shared by every operator one page named.
 */
interface Repage {
  at: number;
  attempt: string;
  sent: { dispatched: boolean };
}

/** What this executor knows about the pages to one person who acknowledged (option E). */
interface PersonPages {
  /** Their last page, about any operator they hold. The re-page interval runs from here. */
  last: Repage | undefined;
  /** When each page to them started, for {@link REPAGE_CEILING}. */
  started: number[];
}

/** An attempt answered from a hold: what `wake-others` may name, while that hold stands. */
interface HeldAttempt {
  event: Event;
  held: HeldAck;
}

/** One hold a `wake-others` named: what the person who asked is told, and what is sent after. */
interface WakeDecision {
  text: string;
  /** The ladder for that attempt, where there is one, for the answer's `ladder` field. */
  ladder?: Ladder;
  /** What goes out once the answer has; resolves with anything the person who asked must hear after. */
  go?: () => Promise<string | undefined>;
}

/** A human acknowledgement this executor is still holding for an operator. */
interface HeldAck {
  /** The acknowledged ladder, as it stood when the human answered. */
  ladder: Ladder;
  /**
   * Who answered, from their roster entry when they did. Always both: an acknowledgement is matched
   * by key and refused without a callsign, so nobody else is ever held.
   */
  by: { callsign: string; pubkey: string };
  /** Unix seconds the acknowledgement arrived. The window runs from here. */
  at: number;
  /**
   * How many of its sends a relay has taken, all attempts together. An attempt whose two sends
   * both reached nothing ends the hold only if no other attempt's got through meanwhile: then the
   * operator has been told, and the hold is doing its job.
   */
  taken: number;
}

/**
 * The subscription this executor makes on every relay, without the `since` its listener adds: every
 * `Distress` and every signal addressed to the watch. `navcom-escalation --check` asks each relay for
 * exactly this, so the question it asks cannot drift from the one the running executor depends on: a
 * check that asked for less -- no `#p`, or one kind -- passed a relay that refuses this one.
 */
export function executorSubscription(watch: string): { kinds: number[]; "#p": string[] } {
  return { kinds: [KIND_DISTRESS, KIND_SIGNAL], "#p": [watch] };
}

export class EscalationExecutor {
  readonly ladders = new LadderRegistry();
  private readonly pool: SimplePool;
  private readonly config: EscalationConfig;
  private readonly secretKey: Uint8Array;
  private readonly pubkey: string;
  /** The executor's own key, or null on a box that has not named one. */
  private readonly own: { secretKey: Uint8Array; pubkey: string } | null;
  private readonly page: typeof pageAll;
  private readonly drillStatePath: string | undefined;
  /** Where it writes where it hears; undefined writes nothing. See {@link writeHearingNow}. */
  private readonly hearingPath: string | undefined;
  /** Set by `drillOnce`: a drill beside the live executor never writes where it hears. */
  private hearingOff = false;
  /** When the hearing file was last written (or, with none, the last thirty-second beat), unix seconds. */
  private hearingAt: number | null = null;
  /** A write asked for on a change and not yet made: changes in one tick are one write. */
  private hearingQueued = false;
  /** Whether a failed write has been said, so it is said once until one succeeds. */
  private hearingFailed = false;
  /** Whether {@link BOOT_GRACE_SECONDS} have passed since start, after which hearing nowhere is said. */
  private graceOver = false;
  private graceHandle: ReturnType<typeof setTimeout> | undefined;
  /** Whether "HEARS ON NO RELAY" is the last thing said about where it hears. */
  private saidNowhere = false;
  private started = false;
  private drills: DrillState | null = null;
  /** Acknowledgements arriving for a drill rather than a real Distress. */
  private drillAcks = new Map<string, { by: Author; atMs: number }[]>();
  private readonly since = now();
  private readonly budget: PageBudget;
  /**
   * Whether a drill is already running.
   *
   * A drill waits out its acknowledgement window -- ten minutes by default -- before it can
   * record a result, and the sweep that decides whether one is due runs every second. With
   * nothing marking it in flight, one weekly drill fired roughly six hundred times, paging
   * every on-call person once a second for the whole window.
   *
   * The mechanism built to prove the pager works without wearing it out was the thing most
   * likely to destroy it, and no attacker was required.
   */
  private drilling = false;
  private sweepHandle: ReturnType<typeof setInterval> | undefined;
  /** One subscription per relay, each reopened by itself. See `shared/relay-listener.ts`. */
  private listener: RelayListener | undefined;
  /**
   * Operators a human answered recently, by pubkey -- the decision of 2026-10-07.
   *
   * Kept here rather than read from the ladder registry: terminal ladders are reaped on their
   * own retention, and the hold must not end early because a ladder was tidied away. It applies
   * only while that operator has no ladder running: a live ladder comes first.
   */
  private readonly heldAcks = new Map<string, HeldAck>();
  /**
   * The last page to a person who acknowledged, about one operator -- keyed by both
   * ({@link repageKey}). At most one per {@link repageWindowSeconds}, however often the phone sends,
   * and a later attempt inside it is told when they were paged instead.
   *
   * **Kept apart from the hold, and outliving it** [review: hold decisions]. On the hold, a newer
   * acknowledgement for the same operator started it over: a hold that ended, a ladder that paged the
   * roster, the same person answering that, and the next attempt seconds later paged them a third
   * time inside one window. A page that failed is dropped, because it woke nobody.
   */
  private readonly repaged = new Map<string, Repage>();
  /**
   * The pages to each person who acknowledged, by their key -- option E (decided 2026-10-07). The
   * re-page interval is theirs as well as each operator's: one page per interval, naming every operator
   * they hold who has sent since, and never more than {@link REPAGE_CEILING} an hour.
   */
  private readonly persons = new Map<string, PersonPages>();
  /**
   * When a hold about each operator last widened (*Silence widens*), by the operator's key: at most once
   * per `ack_holds_seconds` [review: silence widens]. Kept apart from the hold and the person, because
   * the loop it stops runs through both: a phone that cannot end its Distress on what the box sends, the
   * person acknowledging every ladder a hold widened to -- a new hold each time -- and the next attempt
   * past their interval widening again at once. Each widening is a first page, so that spent the whole
   * first-page budget in under twenty minutes, and a stranger's new Distress after it paged nobody.
   */
  private readonly widened = new Map<string, number>();
  /** Operators each person holds who have sent since that person's last page, for the next page to name. */
  private readonly pending = new Map<string, Map<string, HeldAttempt>>();
  /**
   * Attempts answered from a hold, by id: what `wake-others` may name while their hold stands. Kept past
   * the hold's end, however it ended -- expired included -- for {@link REPEAT_PAGE_TTL_SECONDS} or the
   * ladder retention, so a late one is told the hold ended rather than that it was never held.
   */
  private readonly heldAttempts = new Map<string, HeldAttempt>();
  /**
   * Every attempt one repeat page named, by the attempt it carried [review: box safety]. A page names
   * every operator the person holds who has sent since their last page, but a page command carries one
   * attempt id, so a `wake-others` from that page widens every hold it named, not only the one it carried.
   */
  private readonly pageNamed = new Map<string, string[]>();
  /**
   * The watch key and the executor's own. Neither is a person's, so neither acknowledges or asks the
   * watch to wake anybody, whatever the roster says [review: box safety]: the daemon and the agent beside
   * it hold the watch key, and an acknowledgement accepted from it would have the executor sign "a person
   * has it" with the one key a phone handed it trusts.
   */
  private readonly boxKeys: ReadonlySet<string>;
  /**
   * Second sends of held acknowledgements still waiting, so `stop()` can cancel them -- each with
   * the record it still owes, where its first send reached no relay and nothing is written yet.
   */
  private readonly resends = new Map<ReturnType<typeof setTimeout>, (() => void) | null>();
  /**
   * What only this process knows about each live ladder -- that a page did not go out -- and the
   * state it was said in, so a retry joining the ladder is told it too [#31]. Dropped with the
   * ladder.
   */
  private readonly notes = new Map<string, { state: LadderState; text: string }>();
  /**
   * Responses one of the box's two keys placed on no relay while the other's was taken, already in the
   * accountability log -- keyed by what they were about (a ladder or hold's acknowledged Distress, or a
   * wake) and which key, with when. Once per thread and direction: a review of a log hands an operator
   * only the newest page of entries about them, and a relay refusing one key on every retry through a
   * half-hour hold would push their ladder's own entry off it.
   */
  private readonly oneKey = new Map<string, number>();
  /** What the key file check found at this start, for the one `took-watch` record; none for `--drill`. */
  private readonly tookWatch: { keyProblems: readonly string[] } | undefined;
  private stopped = false;
  /**
   * The executor's own accountability log -- separate from the daemon's, and the only
   * place a Distress's real outcome (paged, acknowledged by whom, or exhausted) is
   * durably recorded. See `EscalationConfig.log`'s doc comment for why it is a second
   * file rather than the daemon's.
   */
  private accountability: AccountabilityLog | null = null;

  constructor(opts: ExecutorOptions) {
    this.config = opts.config;
    this.secretKey = opts.secretKey;
    this.pubkey = opts.pubkey;
    // The watch key is no executor key: a phone handed it reads it as none (`executorOf` in core).
    this.own = opts.executorKey && opts.executorKey.pubkey !== opts.pubkey ? opts.executorKey : null;
    this.boxKeys = new Set([opts.pubkey, ...(opts.executorKey ? [opts.executorKey.pubkey] : [])]);
    this.page = opts.page ?? pageAll;
    this.drillStatePath = opts.drillStatePath;
    this.hearingPath = opts.hearingStatePath;
    this.tookWatch = opts.tookWatch;
    // Ping so a dead connection is noticed; no pool-level reconnect, because nostr-tools' rewrote
    // `since` past anything a relay sent [F04]. The listener reopens what closes.
    this.pool = opts.pool ?? nodePool({ enablePing: true });
    this.budget = pageBudget(
      this.config.escalation.maxPagesPerWindow,
      this.config.escalation.pageBudgetWindowSeconds,
    );
    if (this.drillStatePath) {
      this.drills =
        readDrillState(this.drillStatePath) ??
        schedule(null, now(), this.config.escalation.drillWindowDays);
    }
    // An accountability problem must never become an availability one -- same rule the
    // daemon holds for its own log. A ladder still runs and still pages correctly even if
    // its own record of having done so cannot be opened.
    try {
      const opened = AccountabilityLog.open(this.config.log.path, this.config.log.retentionDays);
      this.accountability = opened.log;
      if (!opened.check.intact) {
        console.error(
          `[escalation-log] CHAIN BROKEN at entry ${opened.check.brokenAt}: ${opened.check.reason}`,
        );
      }
    } catch (err: unknown) {
      console.error(`[escalation-log] could not open -- outcomes will not be recorded: ${String(err)}`);
    }
  }

  /** The key this executor speaks with: its own where it has one, which the accountability log names. */
  private get speaker(): string {
    return this.own?.pubkey ?? this.pubkey;
  }

  /**
   * Signs and sends one response to `to`, and returns how many relays took what every phone can read.
   *
   * **With its own key, twice** (`escalation.spec.md`, *Phones handed the watch before it named the
   * executor*): signed and sealed by its own key, which is the only answer a phone handed that key
   * ends a `Distress` on, and then the same words signed and sealed by the watch key, carrying
   * `copy_of`, for phones handed the watch before it named one. Its own goes first on every socket,
   * so a phone that knows it has usually heard it by the time the copy arrives, and passes over the
   * copy; one that has not reads the copy as the watch key's, shown and never closure.
   *
   * **What it returns counts the copy** [review: box safety]. Every phone handed the watch before it
   * named this key reads the copy and nothing else, and this box cannot know that no such phone is
   * left. A relay that took only the executor's own told those phones nothing, so it does not count as
   * having told the operator: where no relay took a copy, the caller says it could not report, and a
   * hold that reached nobody twice ends and fails toward paging. Counting either send, a relay with a
   * rate limit that refused the second event of the pair left every current phone hearing nothing while
   * the box logged an acknowledgement as delivered.
   *
   * Either asymmetry is said at once, and recorded in the accountability log once per `about` -- the
   * ladder or hold a response belongs to, or the wake it answers ({@link recordOneKey}). A relay that
   * takes the copy and refuses the executor's own leaves a phone given the executor key unable to end a
   * `Distress` there; one that takes the executor's own and refuses the copy leaves a phone not given it
   * hearing nothing.
   */
  private async respond(to: string, tags: string[][], payload: ResponsePayload, label: string, about: string): Promise<number> {
    const urls = this.config.relays.urls;
    const sealed = (secretKey: Uint8Array, body: ResponsePayload): Event =>
      finalizeEvent({ kind: KIND_RESPONSE, created_at: now(), tags, content: sealResponse(secretKey, to, body) }, secretKey);
    const took = (results: PromiseSettledResult<string>[]) => results.filter((r) => r.status === "fulfilled").length;

    if (!this.own) return took(await Promise.allSettled(this.pool.publish(urls, sealed(this.secretKey, payload))));

    const mine = sealed(this.own.secretKey, payload);
    const copy = sealed(this.secretKey, watchCopy(payload, mine.id));
    // Both handed to the pool before either is awaited, in this order, so each socket carries its own first.
    const sentMine = this.pool.publish(urls, mine);
    const sentCopy = this.pool.publish(urls, copy);
    const [ownResults, copyResults] = await Promise.all([Promise.allSettled(sentMine), Promise.allSettled(sentCopy)]);
    const ownTook = took(ownResults);
    const copyTook = took(copyResults);
    if (ownTook === 0 && copyTook > 0) {
      console.error(
        `[ladder] ${label}: NO RELAY TOOK THE EXECUTOR'S OWN KEY -- only the watch key's copy went out. A phone ` +
          `given the executor key shows it and does not end a Distress on it. navcom-escalation --check names ` +
          `the relays that refuse that key.`,
      );
      this.recordOneKey(to, about, "executor-key-refused", label);
    }
    if (copyTook === 0 && ownTook > 0) {
      console.error(
        `[ladder] ${label}: NO RELAY TOOK THE WATCH KEY'S COPY -- only the executor's own went out. A phone not ` +
          `given the executor key -- every phone handed this watch before it named one -- heard nothing. ` +
          `navcom-escalation --check names the relays that refuse the watch key.`,
      );
      this.recordOneKey(to, about, "watch-key-refused", label);
    }
    return copyTook;
  }

  /**
   * A response one key placed on no relay while the other's was taken, in the accountability log
   * (`escalation.spec.md`, *Every relay the box uses must take both keys*): `answered`, about whoever it
   * was for -- the operator, or the person who asked the watch to wake the others -- never `escalated`,
   * `acked` or `contacted`, which `--review` counts as escalations, held answers and re-pages.
   *
   * **Once per thread and direction.** Every report, retry answer and held send of one ladder or hold
   * shares `about`, so a relay refusing one key for a whole hold is one entry, not one per attempt: a
   * review of a log hands an operator only the newest page of entries about them, and fifty of these
   * would push their ladder's own entry off it. Marked only once written, so a write that failed is
   * tried again.
   */
  private recordOneKey(to: string, about: string, outcome: "executor-key-refused" | "watch-key-refused", label: string): void {
    const key = `${about}:${outcome}`;
    if (!this.accountability || this.oneKey.has(key)) return;
    try {
      this.accountability.record({
        at: now(),
        actor: { kind: "node", callsign: "escalation", pubkey: this.speaker },
        action: "answered",
        subject: { kind: "human", pubkey: to },
        outcome,
      });
      this.oneKey.set(key, now());
    } catch (err: unknown) {
      console.error(
        `[escalation-log] FAILED TO RECORD that ${outcome === "executor-key-refused" ? "no relay took the executor's own key" : "no relay took the watch key's copy"} ` +
          `for ${label}: ${String(err)}`,
      );
    }
  }

  /**
   * This start, in the accountability log, where the executor signs with a key of its own: `took-watch`,
   * `held` or -- while its file check finds anything -- `key-not-its-own` (`escalation.spec.md`, *The
   * executor has a key of its own*), so `--review` can say it, and so a key that never ran a ladder is
   * still named in the log a replacement is checked against. Never stops anything.
   */
  private recordTookWatch(): void {
    if (!this.accountability || !this.own || !this.tookWatch) return;
    try {
      this.accountability.record({
        at: now(),
        actor: { kind: "node", callsign: "escalation", pubkey: this.own.pubkey },
        action: "took-watch",
        subject: null,
        outcome: this.tookWatch.keyProblems.length > 0 ? "key-not-its-own" : "held",
      });
    } catch (err: unknown) {
      console.error(`[escalation-log] FAILED TO RECORD this start: ${String(err)}`);
    }
  }

  private get windows() {
    return {
      pagingSeconds: this.config.escalation.pagingWindowSeconds,
      contactSeconds: this.config.escalation.contactWindowSeconds,
    };
  }

  /**
   * Tells the operator where the ladder is. Sent on **every** transition [C42].
   *
   * `responder` is the load-bearing field. A transition is the node speaking about its own
   * progress, so it is authored by the node -- and the operator's client keeps retrying
   * through all of them. Only the acknowledgement carries a `human` author, because only a
   * human acknowledgement means somebody has it. Get this wrong and a phone stops retrying
   * because a machine said "paging".
   */
  private async report(ladder: Ladder, distressId: string, said?: string): Promise<number> {
    const responder: Author =
      ladder.state === "acknowledged" && ladder.acknowledgedBy
        ? ladder.acknowledgedBy
        : { kind: "node", callsign: "escalation" };

    const payload: ResponsePayload = {
      type: ladder.state === "acknowledged" ? "ack" : "escalation-status",
      responder,
      /*
       * `said` is what only this process knows: whether a page actually went out. The ladder's
       * own sentence describes the state machine, and the state machine cannot see a command that
       * exited non-zero -- so where nobody was woken, `said` replaces it rather than following
       * "Paging Wren." with a sentence that takes it back [#31].
       */
      text: said ?? ladderReport(ladder),
      provenance: null,
      // The state itself, so a phone can act on `exhausted` without parsing the sentence.
      ladder: ladder.state,
    };
    if (said !== undefined) this.notes.set(ladder.distressId, { state: ladder.state, text: said });

    // The one durable record of what actually happened, written before the publish
    // attempt rather than after: telling the operator and recording the outcome are
    // independent, and a relay that rejects the publish must not also cost the durable
    // record. report() runs exactly once per real transition [C42] -- including the
    // transition into a terminal state -- so this cannot be forgotten by a future branch
    // the way the daemon's own unconditional claim was.
    if (ladder.state === "acknowledged" || ladder.state === "exhausted") {
      this.recordOutcome(ladder);
    }

    return this.send(ladder, distressId, [["p", ladder.operator], ["e", distressId]], payload);
  }

  /**
   * Tells a retry that joined a live ladder where that ladder is [#31].
   *
   * A retry used to be answered with nothing: the ladder had said where it was once, to the
   * attempt that opened it, and a phone that missed that -- a connection that dropped, a
   * Distress started again -- never heard "Paging Wren.", or that nobody could be woken. Now each
   * attempt is told the ladder's state and whatever this process has added to it, naming the
   * retry and the ladder's own Distress. Not a transition, so nothing is recorded.
   */
  private async reportAgain(ladder: Ladder, retryId: string): Promise<number> {
    const note = this.notes.get(ladder.distressId);
    const payload: ResponsePayload = {
      type: "escalation-status",
      responder: { kind: "node", callsign: "escalation" },
      text: note && note.state === ladder.state ? note.text : ladderReport(ladder),
      provenance: null,
      ladder: ladder.state,
    };
    return this.send(ladder, retryId, [["p", ladder.operator], ["e", retryId], ["e", ladder.distressId]], payload);
  }

  /** Returns how many relays took it ({@link respond}). 0 is invariant 2 failing, and is said so. */
  private async send(ladder: Ladder, distressId: string, tags: string[][], payload: ResponsePayload): Promise<number> {
    console.log(`[ladder] ${distressId.slice(0, 8)} ${ladder.state}: ${payload.text}`);
    // About the ladder, or the hold, it belongs to: one thread for the one-key record however many attempts.
    const accepted = await this.respond(ladder.operator, tags, payload, distressId.slice(0, 8), ladder.distressId);
    if (accepted === 0) {
      // The operator cannot be told. Loud, because invariant 2 is failing right here and
      // there is nothing further this process can do about it.
      console.error(
        `[ladder] COULD NOT REPORT ${ladder.state} TO OPERATOR -- no relay accepted ${this.own ? "the watch key's copy" : "it"}`,
      );
    }
    return accepted;
  }

  /**
   * Answers a new `20911` with the acknowledgement this operator already has.
   *
   * **Decided 2026-10-07, reversing "terminal ladders do not adopt".** A phone that missed the
   * acknowledgement -- its connection dropped at that moment -- keeps sending, because only a
   * human answer ends a Distress on the phone. Each new attempt opened a fresh ladder and paged
   * the roster again for an emergency somebody was already responding to. For
   * `ack_holds_seconds` after a human acknowledged, a new attempt from that operator is
   * answered with the same acknowledgement, authored by the same human, and nobody on the roster
   * is woken -- except that human, who is paged about it ({@link answerHeld}).
   *
   * **The cost, stated in the spec:** a genuinely new emergency from the same operator inside
   * the window is read as the old one until it closes, by everybody but the person who
   * acknowledged: they are paged, and nobody else is. The operator's phone is told who
   * acknowledged and when, and a current phone tells that apart from an answer to the Distress it
   * is sending [#0].
   *
   * `said`, when given, is this attempt's text whatever happens next -- the hold ending as it is
   * sent, because the person who acknowledged cannot be paged. Otherwise each send says what is
   * true as it goes ({@link heldText}).
   *
   * **It names the acknowledged Distress as well as the new one** [review: D2], for clients from
   * before 2026-10-07, still cached on phones. Their loop drops an answer to an id it has not
   * recorded, and records an attempt only once its publish has settled on every relay -- so an
   * answer naming only the new attempt, sent the moment it lands, was thrown away whenever one of
   * the phone's relays was slow to say OK, on every attempt for the whole hold. The acknowledged
   * id is one such a loop has held since it sent it. One that started again holds neither, so
   * the answer goes once more {@link RESEND_AGAIN_SECONDS} later. A current client records an
   * attempt before sending it, and reads the two ids to know which Distress was answered.
   *
   * **A held answer stands through its second send** [#14, review: relay paths, R2]. One that no
   * relay took is sent again {@link RESEND_AGAIN_SECONDS} later all the same: a refusal is often
   * a moment's -- the daemon's agent acknowledgement on the same key a millisecond earlier, under a
   * relay's rate limit, or a blip on a box with one relay -- and the second send lands outside it.
   * Ending the hold at the first refusal opened a ladder in the same breath and paged a person who
   * had already answered. Only when the second send reaches no relay either, and nothing has
   * reached the operator from this hold meanwhile, does the hold end: they were told nothing, so
   * nothing is being held for them, and their next attempt opens a ladder and pages -- the same
   * direction a restart or a clock step fails in. It is the next attempt rather than this one so
   * that a phone that did hear, through a relay that never said OK, and stopped, is not paged for.
   *
   * Recorded as `acked`, which this log otherwise never writes -- its own entries are
   * `escalated`, `contacted` for the person who acknowledged being paged again, `answered` for a
   * response one of its two keys could place on no relay, and `took-watch` at a start -- so a
   * re-sent acknowledgement cannot be read as a second escalation, or as none. Published first and
   * recorded after, as the daemon does for its acknowledgements: the record says whether anything
   * left this machine. **Once per attempt, when that is settled** [#25]: `acknowledged` as soon as
   * a relay takes either send, `ack-not-sent` once neither did -- including a second send that
   * never went because the hold had ended, or the executor stopped first.
   */
  private async resendAck(held: HeldAck, distressId: string, said?: string): Promise<void> {
    const before = held.taken;
    const first = await this.sendHeld(held, distressId, said);
    if (first > 0) this.recordResent(held, distressId, true);
    else if (this.heldAcks.get(held.ladder.operator) !== held) {
      console.error(`[ladder] ${distressId.slice(0, 8)}: no relay took the held acknowledgement, and the hold has ended`);
    } else {
      console.error(
        `[ladder] ${distressId.slice(0, 8)}: no relay took the held acknowledgement -- still holding it, ` +
          `and sending it again in ${RESEND_AGAIN_SECONDS}s`,
      );
    }

    const again = setTimeout(() => {
      this.resends.delete(again);
      this.sendAgain(held, distressId, first > 0, before).catch((err: unknown) => {
        console.error(`[ladder] re-sending the held ack for ${distressId.slice(0, 8)} failed: ${String(err)}`);
      });
    }, RESEND_AGAIN_SECONDS * 1000);
    // What `stop()` writes if it cancels this: neither send reached a relay.
    this.resends.set(again, first > 0 ? null : () => this.recordResent(held, distressId, false));
  }

  /** The second send, and -- where the first reached nobody -- the record, and the end of the hold. */
  private async sendAgain(held: HeldAck, distressId: string, firstTaken: boolean, before: number): Promise<void> {
    const operator = held.ladder.operator;
    // Only while this same hold stands: one that has ended, or a newer answer, is not re-sent.
    const standing = () => !this.stopped && this.heldAcks.get(operator) === held;
    const second = standing() ? await this.sendHeld(held, distressId) : 0;
    if (firstTaken) return;
    this.recordResent(held, distressId, second > 0);
    if (second > 0 || !standing() || held.taken !== before) return;
    // Told nothing, twice, and nothing since: held for nobody. Fails toward paging.
    this.heldAcks.delete(operator);
    console.error(
      `[ladder] ${distressId.slice(0, 8)}: no relay took the held acknowledgement, twice -- no longer holding ` +
        `it for ${operator.slice(0, 8)}; their next attempt is escalated as new`,
    );
  }

  private recordResent(held: HeldAck, distressId: string, sent: boolean): void {
    if (!this.accountability) return;
    try {
      this.accountability.record({
        at: now(),
        actor: { kind: "node", callsign: "escalation", pubkey: this.speaker },
        action: "acked",
        subject: { kind: "human", pubkey: held.ladder.operator },
        outcome: sent ? "acknowledged" : "ack-not-sent",
      });
    } catch (err: unknown) {
      console.error(`[escalation-log] FAILED TO RECORD re-sent ack for ${distressId.slice(0, 8)}: ${String(err)}`);
    }
  }

  /**
   * What a held acknowledgement says to one attempt, as it is sent: when the answer was given, what
   * this executor has done about the person who gave it, and when the watch treats an attempt as new.
   *
   * Only what this process knows [review: D2, #0, relay paths R2]. Not "nobody else has been
   * paged" or "the watch has paged nobody": a keyless pager beside this box cannot know a Distress
   * was answered and pages for it all the same, and somebody holding the board sees it. "Your phone
   * sent another" called a new emergency a duplicate.
   *
   * The page is said while it goes out, as the ladder's "Paging Wren." is: a command may take
   * thirty seconds to fail, and the operator is owed an answer before then. If it does fail, the
   * ladder that opens says so at once.
   *
   * **And what happens next if they keep sending** (option E): the later of this operator's interval and
   * the person's own, since the person's last page may have been about somebody else they hold. Said
   * about this operator only -- when that person was last paged about them, never who else. Once they
   * have been paged about this operator, the next attempt past both intervals is treated as new
   * (*Silence widens*, {@link answerHeld}), so that is when the watch treats it as new -- unless the
   * hold could not widen now, when that person is paged again then instead, as before. Where a hold
   * about this operator widened inside `ack_holds_seconds`, that is the only thing in the way, and it
   * says when that ends.
   */
  private heldText(held: HeldAck, distressId: string): string {
    const at = now();
    const age = Math.max(0, at - held.at);
    const left = Math.max(0, this.config.escalation.ackHoldsSeconds - age);
    const name = held.by.callsign;
    const asNew = (seconds: number) => ` If your phone is still sending in ${within(seconds)}, the watch treats it as new.`;
    const paged = this.lastRepage(held, at);
    if (!paged) return `Acknowledged ${ago(age)} ago.${asNew(left)}`;
    const about = paged.attempt === distressId ? " about this one" : "";
    const theirs = this.lastPersonPage(held.by.pubkey, at);
    const next = Math.max(paged.at, theirs?.at ?? paged.at) + repageWindowSeconds(this.config) - at;
    const widensIn = this.widensIn(held.ladder.operator, at);
    const otherwise = this.canWiden(held.by.pubkey, at);
    if (otherwise && widensIn === 0) {
      const page = paged.sent.dispatched
        ? ` ${name} was paged again${about} ${ago(at - paged.at)} ago.`
        : ` The watch is paging ${name} again${about}.`;
      return `Acknowledged ${ago(age)} ago.${page}${asNew(Math.max(0, Math.min(left, next)))}`;
    }
    const page = !paged.sent.dispatched
      ? ` The watch is paging ${name} again${about}.`
      : ` ${name} was paged again${about} ${ago(at - paged.at)} ago` +
        (next > 0 ? `, and is paged again if your phone is still sending in ${within(next)}.` : ".");
    // Where only the once-per-window rule stands in the way, it widens at the first attempt past both the
    // window and the interval -- never sooner than that, so never sooner than said.
    return `Acknowledged ${ago(age)} ago.${page}${asNew(otherwise ? Math.min(left, Math.max(widensIn, next)) : left)}`;
  }

  /**
   * Who else a ladder for this person's hold would page: everybody on call now but them, by core's rule
   * -- nobody, where the rest of the roster is only at a console.
   */
  private othersPageable(person: string, at: number): boolean {
    const others = this.rosterAt(at).filter((e) => e.declaration.author.pubkey !== person);
    return pageableNow(others.map((e) => e.declaration), at).length > 0;
  }

  /**
   * Whether a hold of this person's could widen now, but for how recently one about the same operator
   * did (*Silence widens*): somebody else on call can be paged, and the first-page budget has a unit
   * for the ladder. Wake-others' rule, for the same reason.
   */
  private canWiden(person: string, at: number): boolean {
    return this.othersPageable(person, at) && this.budget.remaining(at) > 0;
  }

  /**
   * Seconds until a hold about this operator may widen again -- 0 where none has inside
   * `ack_holds_seconds`. One stamped after `at` (the clock stepped back past it) stands for nothing,
   * failing toward paging the roster, as the interval does.
   */
  private widensIn(operator: string, at: number): number {
    const last = this.widened.get(operator);
    if (last === undefined || last > at) return 0;
    return Math.max(0, last + this.config.escalation.ackHoldsSeconds - at);
  }

  /** Where the pages to the person who gave this acknowledgement, about its operator, are kept. */
  private repageKey(held: HeldAck): string {
    return `${held.ladder.operator}:${held.by.pubkey}`;
  }

  /**
   * The last page to the person who gave this acknowledgement about its operator, as it stands at
   * `at`. One stamped after `at` -- a clock stepped back past it -- stands for nothing: the next
   * attempt pages again, failing toward paging as the hold does.
   */
  private lastRepage(held: HeldAck, at: number): Repage | undefined {
    const last = this.repaged.get(this.repageKey(held));
    return last && at >= last.at ? last : undefined;
  }

  /** This person's last page about anybody they hold, as it stands at `at`; one stamped after `at` stands for nothing. */
  private lastPersonPage(person: string, at: number): Repage | undefined {
    const last = this.persons.get(person)?.last;
    return last && at >= last.at ? last : undefined;
  }

  private personPages(person: string): PersonPages {
    let record = this.persons.get(person);
    if (!record) this.persons.set(person, (record = { last: undefined, started: [] }));
    return record;
  }

  /** Whether this person has had {@link REPAGE_CEILING} pages started in the last hour. */
  private atCeiling(person: string, at: number): boolean {
    const record = this.persons.get(person);
    if (!record) return false;
    // A page stamped after `at` -- the clock stepped back past it -- counts for nothing, as in the interval.
    record.started = record.started.filter((t) => t <= at && at - t < REPAGE_CEILING_SECONDS);
    return record.started.length >= REPAGE_CEILING;
  }

  /** Whether this attempt's hold is the one that still stands for its operator. */
  private standing(entry: HeldAttempt, at: number): boolean {
    return this.heldAcks.get(entry.held.ladder.operator) === entry.held && this.holding(entry.held, at);
  }

  /** The operators this person holds who have sent since their last page, whose holds still stand; cleared. */
  private takePending(person: string, at: number): HeldAttempt[] {
    const waiting = [...(this.pending.get(person)?.values() ?? [])];
    this.pending.delete(person);
    return waiting.filter((p) => this.standing(p, at));
  }

  /** One send of a held acknowledgement, freshly signed. Returns how many relays took it. */
  private async sendHeld(held: HeldAck, distressId: string, said?: string): Promise<number> {
    const ladder = held.ladder;
    const payload: ResponsePayload = {
      type: "ack",
      // The human who answered, because that is who did. A current phone ends its Distress on it
      // only when it names nothing but that phone's own attempts, or a ladder it joined [#0].
      responder: ladder.acknowledgedBy ?? { kind: "node", callsign: "escalation" },
      text: said ?? this.heldText(held, distressId),
      provenance: null,
      ladder: "acknowledged",
    };
    const accepted = await this.send(ladder, distressId, [["p", ladder.operator], ["e", distressId], ["e", ladder.distressId]], payload);
    if (accepted > 0) held.taken++;
    return accepted;
  }

  /**
   * Whether a held acknowledgement still answers for its operator at `at`.
   *
   * A clock that stepped back past the moment it was given ends it [review: D2]. Measured from a
   * moment now in the future, the hold lasted the window plus the step -- an hour, for a box
   * whose clock was kept in local time and then corrected -- and a genuinely new emergency was
   * answered with an old acknowledgement. Ending it fails toward paging, which is the direction
   * to be wrong in; core's ladder re-anchors on the same step for the same reason.
   */
  private holding(held: HeldAck, at: number): boolean {
    const age = at - held.at;
    return age >= 0 && age < this.config.escalation.ackHoldsSeconds;
  }

  private recordOutcome(ladder: Ladder): void {
    if (!this.accountability) return;
    try {
      this.accountability.record({
        at: now(),
        actor: { kind: "node", callsign: "escalation", pubkey: this.speaker },
        action: "escalated",
        subject: { kind: "human", pubkey: ladder.operator },
        outcome: ladder.state === "acknowledged" ? "escalation-reached-human" : "escalation-reached-nobody",
      });
    } catch (err: unknown) {
      console.error(
        `[escalation-log] FAILED TO RECORD outcome for ${ladder.distressId.slice(0, 8)}: ${String(err)}`,
      );
    }
  }

  /**
   * This operator's ladder that is still running -- paging, or trying their contact -- if there is one.
   * The registry joins a new attempt to it; the hold must not stand in front of it.
   */
  private liveFor(operator: string): Ladder | undefined {
    return this.ladders.all().find((l) => l.operator === operator && (l.state === "paging" || l.state === "contact"));
  }

  /**
   * The roster entries a ladder that opened at `at` names, in roster order: those whose declaration
   * had not expired. Its page goes to these and no others, so the names the operator is told are the
   * people a command runs for -- an expired entry was left out of "Paging Raven." and paged all the
   * same [review: hold decisions].
   */
  private rosterAt(at: number) {
    return this.config.escalation.oncall.filter((e) => e.declaration.expires > at);
  }

  /** Opens a ladder for this attempt, or joins the one this operator already has running. */
  private openLadder(event: Event): { ladder: Ladder; started: boolean } {
    // Idempotent by event id. A client is REQUIRED to retry an unacknowledged Distress
    // indefinitely, so duplicates are the normal case, not an edge one.
    return this.ladders.open({
      distressId: event.id,
      operator: event.pubkey,
      oncall: this.config.escalation.oncall.map((e) => e.declaration),
      // Node-side emergency contacts are not built. The spec prefers device-initiated
      // anyway, and a ladder that claimed a contact it does not have would reach EXHAUSTED
      // five minutes late with nothing tried in between.
      hasEmergencyContact: false,
      now: now(),
    });
  }

  private async handleDistress(event: Event): Promise<void> {
    // The same event again -- relay redelivery, or a retry already joined -- is the registry's
    // to recognise, below, and is answered once.
    const known = this.ladders.get(event.id) !== undefined;

    // A new attempt from somebody a human has already answered: the acknowledgement again, and that
    // human paged about it, not a new ladder. A hold that has reached nobody, twice, ends itself,
    // and the next attempt pages.
    if (!known) {
      const held = this.heldAcks.get(event.pubkey);
      if (held && !this.holding(held, now())) this.heldAcks.delete(event.pubkey);
      else if (held && this.liveFor(event.pubkey)) {
        /*
         * A live ladder comes before the hold (decided 2026-10-07). The registry joins this attempt
         * to the ladder still paging for them, as it joins any retry, and the attempt is told where
         * that ladder is. Answered from the hold instead, it was told a person had it while the
         * roster was still being paged -- and an acknowledgement naming its id found no ladder.
         */
        console.log(
          `[ladder] ${event.id.slice(0, 8)} from ${event.pubkey.slice(0, 8)}: acknowledged earlier by ` +
            `${held.by.callsign}, but a ladder for them is still running -- joining it`,
        );
      } else if (held) {
        // Whether they are paged about it, or were already, or cannot be, `answerHeld` says.
        console.log(
          `[ladder] ${event.id.slice(0, 8)} from ${event.pubkey.slice(0, 8)}: already acknowledged by ` +
            `${held.by.callsign} -- re-sending that`,
        );
        await this.answerHeld(held, event);
        return;
      }
    }

    const { ladder, started } = this.openLadder(event);

    if (!started) {
      if (known) {
        console.log(`[ladder] ${event.id.slice(0, 8)} already running -- not starting a second`);
        return;
      }
      // A retry that joined the live ladder: it pages nobody again, and is told where the ladder is.
      console.log(
        `[ladder] ${event.id.slice(0, 8)} joins ${ladder.distressId.slice(0, 8)}, already ${ladder.state} -- not paging again`,
      );
      await this.reportAgain(ladder, event.id);
      return;
    }

    await this.run(ladder, event, this.opening(ladder, event));
  }

  /**
   * What a ladder that has just opened says first, and whether it pages -- decided before anything is
   * sent, so whatever is said about it beforehand can be true.
   *
   * `preface` is what the operator is owed ahead of the ladder's own sentence: that the person who
   * acknowledged could not be paged again, when that is why this ladder opened. `paging` is who that
   * sentence names as being paged, where it is not everybody the ladder names.
   */
  private opening(
    ladder: Ladder,
    event: Event,
    preface = "",
    paging: string[] = ladder.paged,
    roster?: OnCallEntry[],
    /** The first-page budget was taken before the ladder opened -- by a `wake-others`, which must know first. */
    charged = false,
  ): Opening {
    const lead = preface ? `${preface} ` : "";
    const sentence = ladderReport({ ...ladder, paged: paging });
    if (ladder.state !== "paging") return { said: preface ? lead + sentence : undefined, pages: false, paging: [] };
    // Somebody on the roster is pageable -- the ladder is paging -- but not anybody this page is for.
    if (paging.length === 0) return { said: lead + "Nobody else on call can be paged.", pages: false, paging: [] };

    /*
     * The budget is spent before the roster is touched -- and before anything is said, so a
     * ladder that will page nobody never opens with "Paging Wren." [#31].
     *
     * Anybody holding this watch's address -- which is meant to be handed out -- can publish a
     * signed 20911 from a key made a second ago. Unbounded, three hundred of them woke a real
     * person three hundred times, which is how escalation dies: not by being wrong, but by being
     * ignored on the night it is right.
     */
    if (!charged && !this.takeFirstPage(event.id)) {
      return { said: lead + BUDGET_SPENT, pages: false, paging: [], budgetSpent: true };
    }
    return { said: preface ? lead + sentence : undefined, pages: true, paging, ...(roster ? { roster } : {}) };
  }

  /** One unit of the first-page budget, or false -- said, with which limit -- when it is spent. */
  private takeFirstPage(id: string): boolean {
    if (this.budget.take(now())) return true;
    console.error(
      `[page] BUDGET SPENT -- refused by the first-page budget, not paging for ${id.slice(0, 8)}. ` +
        `More than ${this.config.escalation.maxPagesPerWindow} ladders paged in ` +
        `${this.config.escalation.pageBudgetWindowSeconds}s. This watch is being flooded.`,
    );
    return false;
  }

  /**
   * A ladder's first report, and -- where it pages -- the page, and what came of it. Returns what each
   * page command did, or nothing where it paged nobody.
   */
  private async run(ladder: Ladder, event: Event, opening: Opening): Promise<PageResult[] | undefined> {
    // Said before the roster is touched, and not held until the commands finish: a command may
    // take thirty seconds, and the operator is owed the ladder's first word before then.
    await this.report(ladder, event.id, opening.said);
    if (!opening.pages) return undefined;

    /*
     * The id goes with the page, because it cannot be fetched afterwards.
     *
     * `20911` is ephemeral, so a phone that was asleep when this fired and wakes on the
     * notification finds nothing on the relay to acknowledge. Carrying it here is what makes
     * a one-tap ack possible at all [2.5]; a channel that cannot carry it ignores the
     * placeholder and that operator uses the console.
     */
    const results = await this.page(
      opening.roster ?? this.rosterAt(ladder.startedAt),
      `NavCom DISTRESS from ${event.pubkey.slice(0, 8)} -- ack in the console`,
      undefined,
      event.id,
      "first",
    );
    for (const r of results) {
      console.log(
        `[page] ${r.callsign} via ${r.channel}: ${r.dispatched ? "dispatched" : `FAILED ${r.error}`}`,
      );
    }

    /*
     * Whether the page went out is something only this process knows, and until now it
     * went into the log and nowhere else. Every command could exit non-zero -- a dead SMS
     * gateway, a missing binary -- and the operator was still told "Paging Wren." That is
     * a silent failure of invariant 2 dressed as a success.
     *
     * An empty result is not a failure: a roster of console-open entries dispatches
     * nothing because those people are already watching a console.
     *
     * Said only if the ladder is still paging: an answer that arrived while the commands ran has
     * moved it on, and its own report has said so.
     */
    const current = this.ladders.get(ladder.distressId);
    if (current?.state !== "paging") return results;
    const failed = results.filter((r) => !r.dispatched);
    if (results.length > 0 && failed.length === results.length) {
      console.error(`[page] EVERY CHANNEL FAILED for ${event.id.slice(0, 8)}`);
      await this.report(current, event.id, EVERY_CHANNEL_FAILED);
    } else if (failed.length > 0) {
      /*
       * A partial failure was reported to the operator as a success.
       *
       * `ladder.paged` is built from the roster when the ladder opens, never from what was
       * dispatched, so the status said "Paging Wren, Raven, Kestrel." when Kestrel's channel
       * had exited non-zero -- and the operator spent the paging window believing three
       * people were being woken. `runDrill` already names only those that dispatched; the two
       * paths disagreed about what "paged" means. Now it names both, each for what happened.
       */
      const names = failed.map((r) => r.callsign).join(", ");
      const paged = results.filter((r) => r.dispatched).map((r) => r.callsign).join(", ");
      console.error(`[page] PARTIAL FAILURE for ${event.id.slice(0, 8)}: ${names}`);
      await this.report(
        current,
        event.id,
        `Paging ${paged}. ${names} could not be reached -- their channel failed.`,
      );
    }
    return results;
  }

  /**
   * A new attempt from somebody a human answered: the answer again, and that human paged about it --
   * decided 2026-10-07.
   *
   * The hold's cost was that a genuinely new emergency from the same operator inside the window was
   * read as the old one and nobody was told. Now the person who acknowledged is: paged through their
   * own roster entries, and nobody else is woken.
   *
   * **How often, option E** (decided 2026-10-07). A phone retries every 20 to 80 seconds, so:
   *
   * - The first page about each operator they hold goes at once, so news is never held back
   * - Inside {@link repageWindowSeconds} of that page -- never less than five minutes -- and of the
   *   person's own last page, whoever it was about, the hold stands and the attempt is told when they
   *   were paged and when the watch treats it as new; the next page names every operator they hold who
   *   has sent since their last
   * - **Silence widens** (decided 2026-10-07): the first attempt past both intervals does not page them
   *   again. The hold ends and the attempt is escalated as new, a ladder paging the roster, them
   *   included, with a first page they can acknowledge -- **it widens, or it changes nothing**, as a
   *   `wake-others` does. Who else would be paged and the first-page budget are settled before the hold
   *   is touched; where nobody else on call can be paged or the budget is spent, they are paged again
   *   as before, and the hold stands. Widened regardless, a flood would leave a ladder that paged nobody:
   *   the operator's later attempts joined it, the person who had answered was never paged again, and it
   *   ran out -- "Nobody is coming", minutes after a person had acknowledged them. **Once per operator
   *   per `ack_holds_seconds`**: inside that, whoever acknowledged is paged again alone in the same way,
   *   so a phone that never hears the box costs the budget one unit a hold window, as an expired hold
   *   always did, and not one every interval
   * - **None of it comes from the page budget**, and a spent budget never refuses one. The budget
   *   bounds what a stranger with the watch's address can do, and a re-page needs an acknowledgement
   *   from a roster key: charged to one pool, a few operators sending through a hold spent what a new
   *   Distress needed. A per-person ceiling, {@link REPAGE_CEILING} an hour, catches a loop instead
   *
   * **Somebody who cannot be paged again is not holding anything** -- off the roster, reachable only at
   * a console, every channel failing, or at their ceiling, where it is a loop rather than a night. Then
   * the hold ends and this attempt is escalated as new ({@link unpaged}): failing toward paging, the
   * direction the hold already fails in for a restart or a clock step. At the ceiling, that ladder pages
   * them too, with a first page: what the ceiling stops is the re-pages.
   *
   * The operator hears the acknowledgement first, as before, and the page goes out after it. Said
   * while it goes out, as the ladder's "Paging Wren." is; a page that fails is corrected by the
   * ladder that opens.
   */
  private async answerHeld(held: HeldAck, event: Event): Promise<void> {
    const at = now();
    const person = held.by.pubkey;
    const operator = held.ladder.operator;
    const name = held.by.callsign;
    // What `wake-others` may name, for as long as this hold stands.
    this.heldAttempts.set(event.id, { event, held });

    const window = repageWindowSeconds(this.config);
    const aboutThem = this.lastRepage(held, at);
    const theirs = this.lastPersonPage(person, at);
    // The first page about an operator goes at once, whoever else this person was paged about.
    const waitOperator = aboutThem ? aboutThem.at + window - at : 0;
    const waitPerson = aboutThem && theirs ? theirs.at + window - at : 0;
    if (waitOperator > 0 || waitPerson > 0) {
      let waiting = this.pending.get(person);
      if (!waiting) this.pending.set(person, (waiting = new Map()));
      waiting.set(operator, { event, held });
      console.log(
        waitOperator > 0
          ? `[page] ${name} was paged about ${operator.slice(0, 8)} ${at - aboutThem!.at}s ago -- not again until ` +
              `${window}s after that (the re-page interval)`
          : `[page] ${name} was paged ${at - theirs!.at}s ago about somebody else they acknowledged -- their next page ` +
              `names ${operator.slice(0, 8)} too, ${window}s after that (the re-page interval, per person)`,
      );
      await this.resendAck(held, event.id);
      return;
    }

    // Their own entries and nobody else's, by the key they acknowledged with.
    const entries = this.config.escalation.oncall.filter(
      (e) => e.declaration.author.pubkey === person && e.declaration.expires > at,
    );
    const wakeable = entries.filter((e) => e.declaration.channel !== "console-open");
    const cannot: Unpaged | null =
      entries.length === 0 ? "off-roster" : wakeable.length === 0 ? "console-only" : this.atCeiling(person, at) ? "ceiling" : null;
    // After the ceiling, never before it: a person at it is not paged again whatever silence widening
    // would have said, and its warning that the hold stands would be false [review: silence widens].
    if (cannot === null && aboutThem) {
      /*
       * Silence widens: paged about this operator once already, and the operator still sending past both
       * intervals. Decided -- and the budget taken -- before anything is awaited, so two attempts in one
       * tick open one ladder and spend one unit; the second joins it.
       *
       * At most once per operator per `ack_holds_seconds`, checked before the budget is touched. Without
       * it, a phone that cannot end its Distress on what the box sends -- a relay refusing one key, or
       * withholding answers -- and a person acknowledging each ladder it widened to, widened again at the
       * first attempt past their interval every time: twenty first pages to the whole roster in under
       * twenty minutes, the budget spent, and a stranger's new Distress after it paging nobody. Inside
       * that, whoever acknowledged is paged again alone, as where nobody else could be paged.
       */
      const widensIn = this.widensIn(operator, at);
      const refused =
        widensIn > 0
          ? `the roster was paged about them ${this.config.escalation.ackHoldsSeconds - widensIn}s ago, and a hold ` +
            `widens about one operator once in ${this.config.escalation.ackHoldsSeconds}s`
          : !this.othersPageable(person, at)
            ? "nobody else on call can be paged"
            : !this.budget.take(at)
              ? "the first-page budget is spent"
              : null;
      if (refused === null) {
        this.widened.set(operator, at);
        return this.unpaged(held, event, "silence", false, true);
      }
      console.warn(
        `[page] silence widens refused -- ${refused}: paging ${name} again about ${operator.slice(0, 8)} instead, ` +
          "and the hold stands",
      );
    }
    if (cannot === "ceiling") {
      console.error(
        `[page] REFUSED by the re-page ceiling: ${name} has been paged again ${REPAGE_CEILING} times in the last ` +
          `${REPAGE_CEILING_SECONDS}s. That is a loop, not a night -- treating them as unreachable`,
      );
    }
    if (cannot) return this.unpaged(held, event, cannot);

    // This operator, and every other one this person holds who has sent since their last page.
    const named = [{ event, held }, ...this.takePending(person, at).filter((p) => p.held.ladder.operator !== operator)];
    // The page carries this attempt's id alone; a wake from it widens every hold it names.
    this.pageNamed.set(event.id, named.map((n) => n.event.id));
    const sent = { dispatched: false };
    for (const n of named) this.repaged.set(this.repageKey(n.held), { at, attempt: n.event.id, sent });
    const page: Repage = { at, attempt: event.id, sent };
    const record = this.personPages(person);
    record.last = page;
    record.started.push(at);
    console.log(
      `[page] paging ${name} again, and nobody else, about ${event.id.slice(0, 8)} from ${operator.slice(0, 8)}` +
        (named.length > 1 ? `, and about ${named.length - 1} more operator(s) they acknowledged who sent since their last page` : ""),
    );
    // An acknowledgement that could not be sent must not cost the page.
    await this.resendAck(held, event.id).catch((err: unknown) => {
      console.error(`[ladder] re-sending the held ack for ${event.id.slice(0, 8)} failed: ${String(err)}`);
    });

    /*
     * A `repeat` page, never a first one. No Distress id goes with it, deliberately: an acknowledgement
     * names a ladder, and this attempt has none. One naming it would be ignored, so a channel offering
     * a one-tap acknowledgement for it would tell the person tapping that the operator heard them, when
     * nothing had. The attempt goes under its own placeholder, `{{attempt}}`, for the one thing that
     * page can do: ask the watch to wake the others (`wake-others`).
     */
    const results = await this.page(wakeable, this.repeatText(named, at), undefined, "", "repeat", event.id);
    for (const r of results) {
      console.log(`[page] again: ${r.callsign} via ${r.channel}: ${r.dispatched ? "dispatched" : `FAILED ${r.error}`}`);
    }
    // A command exiting zero, which is all "dispatched" means -- not that anybody woke.
    if (results.some((r) => r.dispatched)) {
      sent.dispatched = true;
      this.recordPaged(held, "contact-attempted");
      return;
    }
    // It woke nobody, so it holds back no page after it -- about any operator it named, or to this person.
    for (const n of named) {
      const key = this.repageKey(n.held);
      if (this.repaged.get(key)?.sent === sent) this.repaged.delete(key);
    }
    if (record.last === page) record.last = undefined;
    this.recordPaged(held, "contact-failed");
    if (!this.stopped) await this.unpaged(held, event, "failed", true);
  }

  /**
   * The words a re-page carries, for channels that show them. Never opens with "Distress": the first
   * word is what is read at 3am, and this is not a new one. Says why only this person is being woken,
   * and never that nobody else was -- a keyless pager beside this box may have paged others.
   */
  private repeatText(named: HeldAttempt[], at: number): string {
    const who = named
      .map((n) => `${n.event.pubkey.slice(0, 8)} (${ago(at - n.held.at)} after you acknowledged)`)
      .join(", ");
    return (
      `NavCom REPEAT -- ${named.length === 1 ? "an operator" : `${named.length} operators`} you acknowledged sent ` +
      `Distress again: ${who}. You are paged because you answered; if you are not with them, reach them another way.`
    );
  }

  /**
   * The person who acknowledged cannot be paged about this attempt, so it is escalated as new: the
   * hold ends, a ladder opens for this attempt and pages the roster as for any new Distress, and
   * the operator is told why.
   *
   * `tried` when the page went out and every channel failed: the acknowledgement has already gone,
   * saying it was going out, and the ladder's first report corrects it. Otherwise the
   * acknowledgement goes now, saying what the ladder does -- decided first, so that it is true --
   * and the ladder straight after, not held behind a slow relay's OK.
   *
   * `charged` when the first-page budget was taken before this was called -- by silence widening, which
   * must know it has a unit before it touches the hold. A widened attempt records no `contacted`: nobody
   * failed to be paged, and `contact-not-attempted` would have `--review` say the person was off the
   * roster, only at a console or at their ceiling. The ladder's own `escalated` entry records how it ended.
   */
  private async unpaged(held: HeldAck, event: Event, why: Unpaged, tried = false, charged = false): Promise<void> {
    const name = held.by.callsign;
    const said =
      `[page] ${name} is not paged again about ${event.id.slice(0, 8)} -- ${UNPAGED[why]}. ` +
      `Not holding their acknowledgement for ${event.pubkey.slice(0, 8)} any longer; escalating this attempt as new`;
    // Widening is the rule working, not a failure: said on the ordinary stream.
    if (why === "silence") console.log(said);
    else console.error(said);
    if (!tried && why !== "silence") this.recordPaged(held, "contact-not-attempted");
    if (this.heldAcks.get(held.ladder.operator) === held) this.heldAcks.delete(held.ladder.operator);
    this.pending.get(held.by.pubkey)?.delete(held.ladder.operator);

    const { ladder, started } = this.openLadder(event);
    if (!started) {
      // Another attempt's ladder opened while the page was out: this one joins it, and is told where it is.
      await this.reportAgain(ladder, event.id);
      return;
    }
    /*
     * Not named as being paged in the sentence that says they cannot be [review: hold decisions]. A
     * ladder names a console-open entry among those it pages, and runs no command for it: said beside
     * "only reachable at a console", "Paging Wren, Raven." told the operator both.
     */
    const paging =
      why === "console-only"
        ? pageableNow(this.config.escalation.oncall.map((e) => e.declaration), ladder.startedAt)
            .filter((d) => d.author.pubkey !== held.by.pubkey)
            .map(nameOf)
        : ladder.paged;
    const opening = this.opening(ladder, event, unpagedSentence(name, why), paging, undefined, charged);
    if (tried) {
      await this.run(ladder, event, opening);
      return;
    }
    // Caught at once: this process exits on a rejection nobody is listening for yet.
    const acked = this.resendAck(held, event.id, this.unpagedText(held, why, ladder, opening)).catch((err: unknown) => {
      console.error(`[ladder] re-sending the held ack for ${event.id.slice(0, 8)} failed: ${String(err)}`);
    });
    await this.run(ladder, event, opening);
    await acked;
  }

  /** The held acknowledgement's text for an attempt escalated as new: who could not be paged, and what the ladder does. */
  private unpagedText(held: HeldAck, why: Unpaged, ladder: Ladder, opening: Opening): string {
    const lead = `Acknowledged ${ago(now() - held.at)} ago.`;
    const next = opening.pages
      ? `The watch is paging ${opening.paging.join(", ")} about this one.`
      : opening.budgetSpent
        ? "The watch could not page anyone else -- too many alerts at once."
        : ladder.state === "paging"
          ? "Nobody else on call can be paged about this one."
          : "Nobody on call can be paged about this one.";
    return `${lead} ${unpagedSentence(held.by.callsign, why)} ${next}`;
  }

  /**
   * The page to the person who acknowledged, in the log's existing vocabulary: `contacted`, about
   * the person contacted, as the daemon's own contact entries are. Attempted is a command exiting
   * zero and claims nobody woke; failed is nothing leaving this machine; not attempted is a person
   * who could not be paged at all.
   */
  private recordPaged(held: HeldAck, outcome: "contact-attempted" | "contact-failed" | "contact-not-attempted"): void {
    if (!this.accountability) return;
    try {
      this.accountability.record({
        at: now(),
        actor: { kind: "node", callsign: "escalation", pubkey: this.speaker },
        action: "contacted",
        subject: { kind: "human", callsign: held.by.callsign, pubkey: held.by.pubkey },
        outcome,
      });
    } catch (err: unknown) {
      console.error(`[escalation-log] FAILED TO RECORD the page to ${held.by.callsign}: ${String(err)}`);
    }
  }

  private async handleAck(event: Event, payload: DistressAckPayload): Promise<void> {
    if (typeof payload?.distress_id !== "string") {
      console.warn(`[ack] REFUSED ${event.id.slice(0, 8)} from ${event.pubkey.slice(0, 8)} -- it names no Distress`);
      return;
    }
    // Before the drill and the roster: listed on the roster or not, the watch key is the daemon's and the
    // agent's, and an acknowledgement from it would have this process sign "a person has it".
    if (this.boxKeys.has(event.pubkey)) {
      console.warn(`[ack] REFUSED ${event.id.slice(0, 8)} -- ${this.boxKeyRefusal(event.pubkey)}`);
      return;
    }
    // A drill uses the same acknowledgement a real Distress does, deliberately: an ack path
    // that only gets exercised by drills is an ack path that has never been tested.
    const forDrill = this.drillAcks.get(payload.distress_id);
    if (forDrill) {
      const entry = this.config.escalation.oncall.find(
        (e) => e.declaration.author.pubkey === event.pubkey,
      );
      if (entry?.declaration.author.callsign) {
        forDrill.push({
          by: { kind: "human", callsign: entry.declaration.author.callsign, pubkey: event.pubkey },
          atMs: Date.now(),
        });
      }
      return;
    }

    const ladder = this.ladders.get(payload.distress_id);
    if (!ladder) {
      console.log(`[ack] ${event.pubkey.slice(0, 8)} acked an unknown distress -- ignored`);
      return;
    }

    // Strict on purpose. A ladder that keeps paging is survivable; one stopped by somebody
    // who is not coming is not. An ack from outside the roster is logged and refused rather
    // than quietly accepted.
    const entry = this.config.escalation.oncall.find(
      (e) => e.declaration.author.pubkey === event.pubkey,
    );
    const callsign = entry?.declaration.author.callsign;
    if (!callsign) {
      console.warn(`[ack] REFUSED from ${event.pubkey.slice(0, 8)} -- not on the on-call roster`);
      return;
    }

    const next = this.ladders.acknowledge(
      payload.distress_id,
      { kind: "human", callsign, pubkey: event.pubkey },
      now(),
    );
    if (next) {
      // Only a human gets here -- `acknowledge` refuses anything else -- and only a human's
      // answer is held for the operator's later attempts.
      if (next.state === "acknowledged") {
        this.heldAcks.set(next.operator, { ladder: next, by: { callsign, pubkey: event.pubkey }, at: now(), taken: 0 });
      }
      await this.report(next, payload.distress_id);
    }
  }

  private onEvent(event: Event): void {
    if (!verifyEvent(event)) return;
    // The relay's own `#p` filter is not re-checked by anything downstream --
    // signature validity says who sent it, not who it was sent to. A relay that
    // mis-honors its own filter, or forwards from one that does, could otherwise
    // deliver a validly-signed Distress addressed to a *different* Watchtower and
    // have it open a ladder and page this roster.
    if (!event.tags.some((t) => t[0] === "p" && t[1] === this.pubkey)) {
      console.warn(`[executor] ${event.id.slice(0, 8)} not addressed to this watch -- ignored`);
      return;
    }

    /*
     * A signed `20911` is valid forever, and any relay can re-serve one.
     *
     * The `#p` re-check above exists because a relay may mis-honour its own filter, which
     * is the same reason the `since` in the subscription cannot be trusted as a defence.
     * Without an age check a captured Distress from months ago opens a ladder and wakes
     * the whole roster -- and, because terminal ladders are reaped hourly, wakes them
     * again every hour. The keyless pager has guarded exactly this from the start:
     * "something stamped well in the past is not news, and paging for it would wake
     * somebody about an emergency that is over".
     */
    const age = Math.floor(Date.now() / 1000) - event.created_at;
    const window = ageWindowSeconds(this.config);
    if (age > window || age < -window) {
      console.warn(
        `[executor] ${event.id.slice(0, 8)} stamped ${age}s away -- outside the age window (${window}s), ignored`,
      );
      return;
    }

    const task =
      event.kind === KIND_DISTRESS
        ? this.handleDistress(event)
        : this.handleSignal(event);

    task.catch((err: unknown) => {
      console.error(`[executor] handling ${event.id.slice(0, 8)} failed: ${String(err)}`);
    });
  }

  /**
   * One subscription per relay, each of which reopens itself when it closes.
   *
   * **The executor went deaf if a relay was unreachable when it started**, and the fix for that
   * asked the wrong question [F08]. It re-subscribed when the pool said a relay was not
   * connected -- but a relay can stay connected and send `CLOSED` (`auth-required`, a rate
   * limit, `restricted`), and a heartbeat publish makes a relay read connected for twenty
   * seconds with no subscription on it. Such a relay was re-subscribed only when the pool's
   * idle reaper happened to close the socket, the log blamed an outage, and in some sequences
   * closing a subscription the relay had already closed made nostr-tools count it twice, so the
   * socket was never reaped and the relay never heard from again.
   *
   * Liveness is now each relay's own subscription. What changes is said once.
   */
  private listen(): void {
    // Once. `drillOnce` calls `start()`, and a second listener would orphan the first.
    if (this.listener) return;
    const window = ageWindowSeconds(this.config);
    this.listener = new RelayListener({
      pool: this.pool,
      urls: this.config.relays.urls,
      filter: executorSubscription(this.pubkey),
      since: this.since,
      label: "executor",
      missing: "a Distress sent only there is not heard until it answers",
      // Longer than twice the age window, so a duplicate cannot outlive being remembered.
      seenRetentionSeconds: 2 * window + 60,
      onevent: (event) => this.onEvent(event),
      // Written down at once, for the daemon, and said when it falls to none or comes back.
      onchange: () => this.hearingChanged(),
    });
    this.listener.start();
  }

  /**
   * A relay started or stopped listening: where this executor hears is written again, once per tick
   * however many changed in it, and hearing nowhere -- or somewhere again -- is said.
   */
  private hearingChanged(): void {
    if (this.hearingQueued) return;
    this.hearingQueued = true;
    queueMicrotask(() => {
      this.hearingQueued = false;
      if (this.stopped || !this.listener) return;
      this.writeHearingNow();
      const listening = this.listener.listening();
      if (listening === 0 && this.graceOver && !this.saidNowhere) this.sayNowhere();
      else if (listening > 0 && this.saidNowhere) {
        this.saidNowhere = false;
        console.log(`[executor] hears on ${listening}/${this.listener.relays().length} relay(s) again`);
      }
    });
  }

  /**
   * Every relay unreachable or refusing this executor's subscription. Each relay's own line has said
   * why, once; this says what it adds up to, after the boot grace, on falling to none, and with every
   * thirty-second write while it lasts [failure mode 30] -- the executor had no line for it, while the
   * daemon said `LISTENING ON NO RELAY` and the pager `NOT WATCHING`.
   *
   * Never "unreachable", and never names AUTH: those are each relay's own words, and are said once.
   */
  private sayNowhere(): void {
    if (this.hearingOff || !this.listener) return;
    this.saidNowhere = true;
    console.error(
      `[executor] HEARS ON NO RELAY (0/${this.listener.relays().length}) -- a Distress sent now pages nobody from ` +
        "this executor, and a daemon reading its hearing file publishes the watch state nowhere. Each relay's own " +
        "line above says why; retrying",
    );
  }

  /**
   * Writes where this executor hears, for the daemon: every relay in its config, whether its
   * subscription there is answered, and why not (`shared/hearing.ts`). `stopping` writes every relay
   * as not heard, with that reason.
   *
   * **Never throws, and never stops anything.** The ladder runs whether or not this can be written;
   * a failure is said once until a write succeeds, and the daemon reading an old file reads this
   * executor as hearing nowhere -- Dark, the safe direction.
   */
  private writeHearingNow(stopping?: string): void {
    const path = this.hearingPath;
    if (!path || this.hearingOff || !this.listener) return;
    const at = now();
    this.hearingAt = at;
    const relays: HearingRelay[] = this.listener.relays().map((r) =>
      stopping !== undefined
        ? { url: r.url, hears: false, why: stopping }
        : r.listening
          ? { url: r.url, hears: true }
          : { url: r.url, hears: false, why: r.why ?? "has not answered yet" },
    );
    try {
      writeHearing(path, { v: HEARING_VERSION, at, watch: this.pubkey, relays });
      if (this.hearingFailed) {
        this.hearingFailed = false;
        console.log(`[executor] writing where it hears to ${path} again`);
      }
    } catch (err: unknown) {
      if (this.hearingFailed) return;
      this.hearingFailed = true;
      console.error(
        `[executor] COULD NOT WRITE WHERE IT HEARS to ${path}: ${err instanceof Error ? err.message : String(err)}. ` +
          "The ladder runs regardless. A daemon reading this file treats this executor as hearing nowhere once it " +
          `is ${HEARING_MAX_AGE_SECONDS}s old, and operators then read Dark`,
      );
    }
  }

  /**
   * The thirty-second beat: the file written again with nothing changed, so its age says this
   * executor is alive, and hearing nowhere said again while it lasts. A clock that stepped back past
   * the last write counts as due, rather than leaving the file to age out.
   */
  private hearingBeat(): void {
    const since = this.hearingAt === null ? Infinity : now() - this.hearingAt;
    if (since < HEARING_WRITE_SECONDS && since >= 0) return;
    this.hearingAt = now();
    this.writeHearingNow();
    if (this.graceOver && this.listener?.listening() === 0) this.sayNowhere();
  }

  /**
   * The two signals this process acts on: `distress-ack` and `wake-others`.
   *
   * The executor subscribes to `20910` only for these. Everything else on that kind is the daemon's
   * business, and reaching into it would be a dependency.
   */
  private async handleSignal(event: Event): Promise<void> {
    const type = event.tags.find((t) => t[0] === "t")?.[1];
    if (type !== "distress-ack" && type !== "wake-others") return;
    const payload = this.openSignalFrom(event);
    if (payload === null) {
      /*
       * Logged as refused, never dropped without a word (`escalation.spec.md`, failure mode 19). With
       * its own key, the usual cause is a phone that sealed it to a watch key this box does not hold
       * -- a watch handed over again -- and the person who sent it is still waiting.
       */
      console.warn(
        `[${type === "distress-ack" ? "ack" : "wake"}] REFUSED ${event.id.slice(0, 8)} from ${event.pubkey.slice(0, 8)} -- ` +
          `it could not be opened with ${this.own ? "the executor's own key or the watch key" : "the watch key"}`,
      );
      if (type === "wake-others") await this.answerWake(event, "Not done -- the watch could not read it.");
      return;
    }
    if (type === "distress-ack") return this.handleAck(event, payload as DistressAckPayload);
    return this.handleWake(event, payload);
  }

  /**
   * A signal's payload, opened with the executor's own key where the phone sealed one to it, and the
   * watch key otherwise -- a phone handed the watch before it named the executor seals to the watch key
   * alone. Null when neither opens it.
   */
  private openSignalFrom(event: Event): unknown {
    const keys = this.own ? [this.own.secretKey, this.secretKey] : [this.secretKey];
    for (const key of keys) {
      try {
        return openSignal<unknown>(key, event.pubkey, event.content);
      } catch {
        /* the next key */
      }
    }
    return null;
  }

  /**
   * *"Page everyone about this one"* -- decided 2026-10-07, option (d).
   *
   * The person paged again about an operator they acknowledged has one move on that page: ask the
   * watch to wake the rest of the roster about the attempt it carried. **It can only widen, and never
   * closes anything** [invariant 2]: it ends the hold and opens a ladder for that attempt, as when the
   * person who acknowledged cannot be paged, and nothing in it tells the operator a person has it --
   * that comes only from somebody acknowledging the ladder it opens, the person who asked included.
   *
   * **It widens, or it changes nothing** [review: box safety]. Who would be paged, and the first-page
   * budget, are settled before the hold is touched. Where nobody else on call can be paged, or the
   * budget is spent, the hold stands, the person who acknowledged is still the one paged about that
   * operator, and the operator is told nothing new. Ending the hold first opened a ladder that paged
   * nobody; the operator's later attempts joined it, the person who had answered them stopped being
   * paged, and when the ladder ran out the operator was told "Nobody is coming", minutes after a person
   * had acknowledged them.
   *
   * **A page can name several operators** and carries one attempt id, so a wake from it widens every
   * hold that page named ({@link pageNamed}), and the answer names each operator by key.
   *
   * Accepted only from a key on the on-call roster, never the watch's own, and only about an attempt
   * this executor answered from a hold. Anything else is refused and logged, as an acknowledgement from
   * outside the roster is. Either way the person who asked is answered: it is the only way they learn
   * whether anybody else is being woken -- and answered again if the page then fails.
   */
  private async handleWake(event: Event, payload: unknown): Promise<void> {
    const asker = event.pubkey;
    const raw = (payload as { distress_id?: unknown } | null)?.distress_id;
    const attempt = typeof raw === "string" && /^[0-9a-f]{64}$/.test(raw) ? raw : null;
    const at = now();
    const entry = this.config.escalation.oncall.find(
      (e) => e.declaration.author.pubkey === asker && e.declaration.expires > at,
    );
    const callsign = entry?.declaration.author.callsign;
    const refuse = async (why: string, text: string): Promise<void> => {
      console.warn(`[wake] REFUSED from ${asker.slice(0, 8)} about ${attempt?.slice(0, 8) ?? "nothing"} -- ${why}`);
      await this.answerWake(event, text);
    };

    if (this.boxKeys.has(asker)) {
      return refuse(this.boxKeyRefusal(asker), "Not done -- this is the watch's own key. Only a person on call can ask this.");
    }
    if (!callsign) return refuse("not on the on-call roster", "Not done -- this key is not on the watch's on-call roster.");
    if (!attempt) return refuse("it names no attempt", "Not done -- it named no attempt.");
    if (!this.heldAttempts.has(attempt)) {
      return refuse(
        "not an attempt the watch answered from a hold",
        "Not done -- the watch did not answer that attempt with an earlier acknowledgement.",
      );
    }

    // Every hold the page named, each decided -- and, where accepted, ended -- before anything is sent.
    const ids = this.pageNamed.get(attempt) ?? [attempt];
    const woken = ids.flatMap((id) => {
      const held = this.heldAttempts.get(id);
      return held ? [this.wake(held, callsign, asker, at)] : [];
    });
    const ladder = woken.length === 1 ? woken[0]!.ladder : undefined;
    // Caught at once: this process exits on a rejection nobody is listening for yet.
    const told = this.answerWake(event, woken.map((w) => w.text).join(" "), ladder).catch((err: unknown) => {
      console.error(`[wake] answering ${callsign} failed: ${String(err)}`);
    });
    const after = await Promise.all(woken.map((w) => (w.go ? w.go() : Promise.resolve(undefined))));
    await told;
    // A page that failed is said to the person who asked, who was told it was going out.
    const failed = after.filter((s): s is string => typeof s === "string");
    if (failed.length > 0) await this.answerWake(event, failed.join(" "), ladder);
  }

  /**
   * One hold a `wake-others` named: what the person who asked is told about it, and what is sent once
   * they have been. Decided, and an accepted hold ended, without awaiting anything, so two wakes in
   * one tick cannot both open a ladder for the same attempt.
   */
  private wake(entry: HeldAttempt, callsign: string, asker: string, at: number): WakeDecision {
    const { held, event } = entry;
    const operator = held.ladder.operator;
    const who = operator.slice(0, 8);
    const about = `${event.id.slice(0, 8)} from ${who}`;

    if (!this.standing(entry, at)) {
      const ladder = this.ladders.get(event.id);
      console.warn(`[wake] REFUSED from ${asker.slice(0, 8)} about ${about} -- the hold had already ended`);
      return {
        text: `Not done -- the hold on ${who} had already ended.${ladder ? ` Where the watch is now: ${this.where(ladder)}` : ""}`,
        ...(ladder ? { ladder } : {}),
      };
    }

    if (this.liveFor(operator)) {
      // The roster is already being paged for them: the attempt joins that ladder, and the hold stands
      // behind it, as it does for any attempt while a ladder of theirs runs.
      const { ladder } = this.openLadder(event);
      console.log(`[wake] ${callsign} asked about ${about} -- a ladder for them is already running; joining it`);
      return {
        text: `A ladder for ${who} was already running. ${this.where(ladder)}`,
        ladder,
        go: async () => {
          await this.reportAgain(ladder, event.id);
          return undefined;
        },
      };
    }

    // Everybody pageable but the person who asked, who knows: "Wren asked the watch to page everyone about this one. Paging Raven."
    const others = this.rosterAt(at).filter((e) => e.declaration.author.pubkey !== asker);
    const paging = pageableNow(others.map((e) => e.declaration), at).map(nameOf);
    const stands =
      held.by.pubkey === asker
        ? "The hold stands, and you are still the one paged about them if they keep sending."
        : `The hold stands, and ${held.by.callsign} is still the one paged about them if they keep sending.`;
    if (paging.length === 0) {
      console.warn(`[wake] ${callsign} asked about ${about} -- nobody else on call can be paged, so the hold stands`);
      return { text: `Not done -- nobody else on call can be paged about ${who}. ${stands}` };
    }
    if (!this.takeFirstPage(event.id)) {
      console.warn(`[wake] ${callsign} asked about ${about} -- refused by the first-page budget, so the hold stands`);
      return { text: `Not done -- too many alerts at once, so the watch could not page anyone else about ${who}. ${stands}` };
    }

    // Accepted, and only now is the hold touched: nothing answers this operator from it again.
    if (this.heldAcks.get(operator) === held) this.heldAcks.delete(operator);
    this.pending.get(held.by.pubkey)?.delete(operator);
    console.log(
      `[wake] ${callsign} asked the watch to page everyone about ${about} -- no longer holding ` +
        `${held.by.callsign}'s acknowledgement for them; escalating that attempt as new`,
    );
    const { ladder, started } = this.openLadder(event);
    if (!started) {
      // Not reachable while no ladder of theirs is live, which was checked above; said as it is if it ever is.
      return {
        text: `A ladder for ${who} was already running. ${this.where(ladder)}`,
        ladder,
        go: async () => {
          await this.reportAgain(ladder, event.id);
          return undefined;
        },
      };
    }
    const opening = this.opening(ladder, event, `${callsign} asked the watch to page everyone about this one.`, paging, others, true);
    return {
      text: `Done. The hold on ${who} has ended and the watch is paging ${opening.paging.join(", ")} about them.`,
      ladder,
      go: async () => {
        const results = (await this.run(ladder, event, opening)) ?? [];
        const failed = results.filter((r) => !r.dispatched);
        if (failed.length === 0) return undefined;
        const names = failed.map((r) => r.callsign).join(", ");
        return failed.length === results.length
          ? `Every channel failed paging ${names} about ${who}. Nobody else has been woken.`
          : `${names} could not be reached about ${who} -- their channel failed.`;
      },
    };
  }

  /** Why the watch key, or the executor's own, is refused as a person. */
  private boxKeyRefusal(pubkey: string): string {
    return pubkey === this.pubkey
      ? "signed by the watch key, which is no person's: the daemon and the agent beside it hold it. A person uses their own key"
      : "signed by the executor's own key, which is no person's";
  }

  /** Where a ladder is, as a retry joining it is told -- with whatever this process added to it. */
  private where(ladder: Ladder): string {
    const note = this.notes.get(ladder.distressId);
    return note && note.state === ladder.state ? note.text : ladderReport(ladder);
  }

  /**
   * The answer to the person who sent a `wake-others`: accepted with who is being paged, or refused and
   * why. Signed by the executor's own key, with the watch key's copy, as every response is. Spoken as
   * the node: it is the ladder's word, never a person's.
   */
  private async answerWake(event: Event, text: string, ladder?: Ladder): Promise<number> {
    const payload: ResponsePayload = {
      type: "escalation-status",
      responder: { kind: "node", callsign: "escalation" },
      text,
      provenance: null,
      ...(ladder ? { ladder: ladder.state } : {}),
    };
    console.log(`[wake] answering ${event.pubkey.slice(0, 8)}: ${text}`);
    const accepted = await this.respond(event.pubkey, [["p", event.pubkey], ["e", event.id]], payload, event.id.slice(0, 8), event.id);
    if (accepted === 0) console.error(`[wake] COULD NOT ANSWER ${event.pubkey.slice(0, 8)} -- no relay accepted`);
    return accepted;
  }

  /**
   * Fires a drill and records what happened.
   *
   * Exercises the same paging code a real `Distress` does. A drill that took a different
   * path would be testing something nobody depends on.
   */
  async fireDrill(id = randomBytes(16).toString("hex")): Promise<void> {
    if (!this.drillStatePath) return;
    if (this.drilling) {
      console.warn("[drill] one is already running -- not starting a second");
      return;
    }

    this.drilling = true;
    this.drillAcks.set(id, []);

    /*
     * Re-armed before the window is waited out, not after.
     *
     * The in-flight flag covers this process; this covers the case where the drill throws
     * or the process restarts mid-window. Without it, `nextAt` stays in the past and every
     * sweep from then on considers a drill due -- so a failure in the drill path becomes a
     * drill that pages the roster once a second forever.
     *
     * The result overwrites this a moment later. Losing one drill to a crash is the correct
     * trade against paging everybody until somebody notices.
     */
    this.drills = schedule(this.drills?.last ?? null, now(), this.config.escalation.drillWindowDays);
    try {
      writeDrillState(this.drillStatePath, this.drills);
    } catch (err: unknown) {
      console.error("[drill] could not re-arm the schedule: " + String(err));
    }

    try {
      const result = await runDrill(id, {
        page: this.page,
        roster: this.config.escalation.oncall,
        ackWindowMs: this.config.escalation.drillAckWindowSeconds * 1000,
        now,
        collectAcks: async (drillId, windowMs) => {
          await new Promise((r) => setTimeout(r, windowMs));
          return this.drillAcks.get(drillId) ?? [];
        },
      });

      /*
       * Said out loud before it is written down.
       *
       * The order used to be the other way round, so a filesystem that refused the write
       * threw past the log line and the drill's result -- the entire product of a safety
       * check -- was lost. A watch that cannot record a drill must still be able to tell
       * the person reading its logs what the drill found.
       */
      console.log("[drill] " + drillSentence(result));
      this.drills = schedule(result, now(), this.config.escalation.drillWindowDays);
      try {
        writeDrillState(this.drillStatePath, this.drills);
      } catch (err: unknown) {
        // Loud: the daemon reads this file to publish `10910`, so a failure here means the
        // watch will keep advertising an older drill than the one that just ran.
        console.error(
          "[drill] RESULT NOT RECORDED -- " + String(err) +
            ". The watch will publish the previous drill until this is fixed.",
        );
      }
    } finally {
      this.drillAcks.delete(id);
      this.drilling = false;
    }
  }

  start(): void {
    this.stopped = false;
    this.listen();
    if (!this.started) {
      this.started = true;
      // Once per long-running start: what this start's key check found, in the log `--review` reads.
      this.recordTookWatch();
      // Written at once -- every relay "has not answered yet" -- so a daemon never reads a file an
      // earlier run left behind as this one's.
      this.writeHearingNow();
      // A start into an outage never falls to none, so nothing else would say it.
      this.graceHandle = setTimeout(() => {
        this.graceOver = true;
        if (!this.stopped && this.listener?.listening() === 0) this.sayNowhere();
      }, BOOT_GRACE_SECONDS * 1000);
      this.graceHandle.unref?.();
    }
    // The ladder advances on a clock the executor owns. This is not a trigger -- no timer
    // in this process can START a ladder, only move one that a 20911 already began.
    this.sweepHandle = setInterval(() => {
      // Unannounced and randomised inside its window. A drill on a fixed cadence tests
      // whether the path works at that moment, and an operator who learned the schedule is
      // being reminded rather than tested.
      if (this.drillStatePath && due(this.drills, now(), this.config.escalation.drillWindowDays)) {
        this.fireDrill().catch((err: unknown) => {
          console.error("[drill] failed: " + String(err));
        });
      }

      // Finished ladders are dropped here rather than at the moment they finish, so a late
      // duplicate of the same 20911 still finds one and does not open a second.
      this.ladders.reap(now(), this.config.escalation.ladderRetentionSeconds);
      for (const id of this.notes.keys()) {
        if (!this.ladders.get(id)) this.notes.delete(id);
      }
      for (const [operator, held] of this.heldAcks) {
        if (!this.holding(held, now())) this.heldAcks.delete(operator);
      }
      // Kept while a hold could still say when it was; one stamped ahead of the clock stands for nothing.
      const kept = Math.max(repageWindowSeconds(this.config), this.config.escalation.ackHoldsSeconds);
      for (const [key, page] of this.repaged) {
        const age = now() - page.at;
        if (age < 0 || age >= kept) this.repaged.delete(key);
      }
      for (const [person, record] of this.persons) {
        const age = record.last ? now() - record.last.at : -1;
        if (record.last && (age < 0 || age >= kept)) record.last = undefined;
        this.atCeiling(person, now());
        if (!record.last && record.started.length === 0) this.persons.delete(person);
      }
      for (const [person, waiting] of this.pending) {
        for (const [operator, entry] of waiting) if (!this.standing(entry, now())) waiting.delete(operator);
        if (waiting.size === 0) this.pending.delete(person);
      }
      for (const operator of this.widened.keys()) if (this.widensIn(operator, now()) === 0) this.widened.delete(operator);
      // Kept past the hold's end, however it ended, so a late `wake-others` is told the hold ended. One
      // stamped ahead of the clock -- a step back -- is dropped, as the hold itself is.
      const keptAttempts =
        this.config.escalation.ackHoldsSeconds +
        Math.max(REPEAT_PAGE_TTL_SECONDS, this.config.escalation.ladderRetentionSeconds);
      for (const [id, entry] of this.heldAttempts) {
        const age = now() - entry.held.at;
        if (age < 0 || age >= keptAttempts) this.heldAttempts.delete(id);
      }
      for (const id of this.pageNamed.keys()) if (!this.heldAttempts.has(id)) this.pageNamed.delete(id);
      // As long as a ladder, its hold and a late wake from it can last; one stamped ahead of the clock is dropped.
      for (const [key, at] of this.oneKey) {
        const age = now() - at;
        if (age < 0 || age >= keptAttempts) this.oneKey.delete(key);
      }

      for (const ladder of this.ladders.tickAll(now(), this.windows)) {
        this.report(ladder, ladder.distressId).catch((err: unknown) => {
          console.error(`[ladder] report failed: ${String(err)}`);
        });
      }

      this.hearingBeat();
    }, 1000);
  }

  /**
   * One drill on demand, fired exactly the way the sweep fires one: with the subscription open.
   *
   * `--drill` built an executor and called `fireDrill()` without `start()`, so nothing was
   * listening when the on-call person answered. Every manual drill waited out its window,
   * recorded FAIL, and the daemon published that FAIL in `10910`, where it demotes the watch
   * -- and `docs/human-tasks.md` gives this command as the proof that paging works.
   *
   * Run beside a live executor, a real `Distress` inside the drill window is handled by both.
   * That pages twice rather than not at all, which is the direction to be wrong in.
   */
  async drillOnce(id?: string): Promise<void> {
    // Belt and braces with `--drill` passing no path: run beside the live executor, a drill that wrote
    // where it hears would overwrite what the live one hears, and stop by saying it hears nowhere.
    this.hearingOff = true;
    this.start();
    try {
      await this.fireDrill(id);
    } finally {
      await this.stop();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    // A second send that will not go now, after a first that reached no relay: recorded as that,
    // so a restart between the two cannot leave the attempt out of the log.
    for (const [handle, unsent] of this.resends) {
      clearTimeout(handle);
      unsent?.();
    }
    this.resends.clear();
    if (this.sweepHandle) clearInterval(this.sweepHandle);
    if (this.graceHandle) clearTimeout(this.graceHandle);
    // Said before the subscriptions close, so a daemon reading it withholds the watch state at its next
    // read rather than believing a stopped executor for ninety seconds.
    this.writeHearingNow("the executor stopped");
    this.listener?.stop();
    this.listener = undefined;
    this.pool.destroy();
  }
}

/** Exported for the acknowledgement test: an agent may never stop a ladder [invariant 5]. */
export { acknowledge };
