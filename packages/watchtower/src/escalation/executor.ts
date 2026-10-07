import type { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, verifyEvent } from "nostr-tools/pure";
import type { Event, EventTemplate } from "nostr-tools/core";
import { randomBytes } from "node:crypto";
import {
  acknowledge,
  drillSentence,
  LadderRegistry,
  ladderReport,
  STALE_AFTER_SECONDS,
  type Author,
  type DistressAckPayload,
  type Ladder,
  type LadderState,
  type ResponsePayload,
} from "@navcom/core";
import { nodePool } from "../shared/nostr-node.js";
import { RelayListener } from "../shared/relay-listener.js";
import { sealResponse, openSignal } from "../shared/crypto.js";
import { KIND_SIGNAL, KIND_DISTRESS, KIND_RESPONSE } from "../shared/kinds.js";
import { pageAll } from "./pager.js";
import { due, readDrillState, runDrill, schedule, writeDrillState, type DrillState } from "./drills.js";
import type { EscalationConfig } from "./config.js";
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
 */

function now(): number {
  return Math.floor(Date.now() / 1000);
}

export interface ExecutorOptions {
  config: EscalationConfig;
  secretKey: Uint8Array;
  pubkey: string;
  /** Injected for tests, so the seven failure modes never need a real relay. */
  pool?: SimplePool;
  /** Injected for tests. Real paging shells out; a test must not. */
  page?: typeof pageAll;
  /** Where drill results are kept, and where the daemon reads them from. */
  drillStatePath?: string;
}

/** The longest wait before a relay whose subscription closed is tried again. */
export { RELISTEN_SECONDS } from "../shared/relay-listener.js";

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

/** What the watch says when the page budget is spent. It states the outcome; "Paging Wren." would not be true. */
const BUDGET_SPENT = "The watch could not page anyone -- too many alerts at once. Nobody has been woken.";
/** What the watch says when every paging command failed. */
const EVERY_CHANNEL_FAILED = "No page could be sent -- every channel failed. Nobody has been woken.";

/** A human acknowledgement this executor is still holding for an operator. */
interface HeldAck {
  /** The acknowledged ladder, as it stood when the human answered. */
  ladder: Ladder;
  /** Unix seconds the acknowledgement arrived. The window runs from here. */
  at: number;
  /**
   * How many of its sends a relay has taken, all attempts together. An attempt whose two sends
   * both reached nothing ends the hold only if no other attempt's got through meanwhile: then the
   * operator has been told, and the hold is doing its job.
   */
  taken: number;
}

export class EscalationExecutor {
  readonly ladders = new LadderRegistry();
  private readonly pool: SimplePool;
  private readonly config: EscalationConfig;
  private readonly secretKey: Uint8Array;
  private readonly pubkey: string;
  private readonly page: typeof pageAll;
  private readonly drillStatePath: string | undefined;
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
   * own retention, and the hold must not end early because a ladder was tidied away.
   */
  private readonly heldAcks = new Map<string, HeldAck>();
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
    this.page = opts.page ?? pageAll;
    this.drillStatePath = opts.drillStatePath;
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

  private sign(template: EventTemplate): Event {
    return finalizeEvent(template, this.secretKey);
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

    const event = this.sign({
      kind: KIND_RESPONSE,
      created_at: now(),
      tags: [["p", ladder.operator], ["e", distressId]],
      content: sealResponse(this.secretKey, ladder.operator, payload),
    });

    // The one durable record of what actually happened, written before the publish
    // attempt rather than after: telling the operator and recording the outcome are
    // independent, and a relay that rejects the publish must not also cost the durable
    // record. report() runs exactly once per real transition [C42] -- including the
    // transition into a terminal state -- so this cannot be forgotten by a future branch
    // the way the daemon's own unconditional claim was.
    if (ladder.state === "acknowledged" || ladder.state === "exhausted") {
      this.recordOutcome(ladder);
    }

    return this.send(ladder, distressId, event, payload);
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
    const event = this.sign({
      kind: KIND_RESPONSE,
      created_at: now(),
      tags: [["p", ladder.operator], ["e", retryId], ["e", ladder.distressId]],
      content: sealResponse(this.secretKey, ladder.operator, payload),
    });
    return this.send(ladder, retryId, event, payload);
  }

  /** Returns how many relays took it. 0 is invariant 2 failing, and is said so. */
  private async send(ladder: Ladder, distressId: string, event: Event, payload: ResponsePayload): Promise<number> {
    console.log(`[ladder] ${distressId.slice(0, 8)} ${ladder.state}: ${payload.text}`);
    const results = await Promise.allSettled(this.pool.publish(this.config.relays.urls, event));
    const accepted = results.filter((r) => r.status === "fulfilled").length;
    if (accepted === 0) {
      // The operator cannot be told. Loud, because invariant 2 is failing right here and
      // there is nothing further this process can do about it.
      console.error(`[ladder] COULD NOT REPORT ${ladder.state} TO OPERATOR -- no relay accepted`);
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
   * answered with the same acknowledgement, authored by the same human, and nobody is woken.
   *
   * **The cost, stated in the spec:** a genuinely new emergency from the same operator inside
   * the window is read as the old one until it closes. Nothing is sent to the human who
   * acknowledged, or to anyone else: the operator's phone is told who acknowledged and when, and
   * a current phone tells that apart from an answer to the Distress it is sending [#0].
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
   * `escalated` and drills -- so a re-sent acknowledgement cannot be read as a second
   * escalation, or as none. Published first and recorded after, as the daemon does for its
   * acknowledgements: the record says whether anything left this machine. **Once per attempt, when
   * that is settled** [#25]: `acknowledged` as soon as a relay takes either send, `ack-not-sent`
   * once neither did -- including a second send that never went because the hold had ended, or
   * the executor stopped first.
   */
  private async resendAck(held: HeldAck, distressId: string): Promise<void> {
    const before = held.taken;
    const first = await this.sendHeld(held, distressId);
    if (first > 0) this.recordResent(held, distressId, true);
    else {
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
        actor: { kind: "node", callsign: "escalation", pubkey: this.pubkey },
        action: "acked",
        subject: { kind: "human", pubkey: held.ladder.operator },
        outcome: sent ? "acknowledged" : "ack-not-sent",
      });
    } catch (err: unknown) {
      console.error(`[escalation-log] FAILED TO RECORD re-sent ack for ${distressId.slice(0, 8)}: ${String(err)}`);
    }
  }

  /** One send of a held acknowledgement, freshly signed. Returns how many relays took it. */
  private async sendHeld(held: HeldAck, distressId: string): Promise<number> {
    const ladder = held.ladder;
    const age = Math.max(0, now() - held.at);
    const minutes = Math.round(age / 60);
    const left = Math.max(0, this.config.escalation.ackHoldsSeconds - age);
    const payload: ResponsePayload = {
      type: "ack",
      // The human who answered, because that is who did. A current phone ends its Distress on it
      // only when it names nothing but that phone's own attempts, or a ladder it joined [#0].
      responder: ladder.acknowledgedBy ?? { kind: "node", callsign: "escalation" },
      /*
       * Only what this process knows [review: D2, #0, relay paths R2]: when the answer was given,
       * that this executor has not escalated the attempt it reached, and when that changes. Not
       * "nobody has been told" or "the watch has paged nobody": a keyless pager beside this box
       * cannot know a Distress was answered and pages for it all the same, and somebody holding the
       * board sees it. "Your phone sent another" called a new emergency a duplicate.
       */
      text:
        `Acknowledged ${minutes === 0 ? "less than a minute" : `${minutes} min`} ago. The watch has not ` +
        `escalated this one. If your phone is still sending in ${
          left < 60 ? "less than a minute" : `${Math.ceil(left / 60)} min`
        }, the watch treats it as new.`,
      provenance: null,
      ladder: "acknowledged",
    };
    const event = this.sign({
      kind: KIND_RESPONSE,
      created_at: now(),
      tags: [["p", ladder.operator], ["e", distressId], ["e", ladder.distressId]],
      content: sealResponse(this.secretKey, ladder.operator, payload),
    });
    const accepted = await this.send(ladder, distressId, event, payload);
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
        actor: { kind: "node", callsign: "escalation", pubkey: this.pubkey },
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

  private async handleDistress(event: Event): Promise<void> {
    // The same event again -- relay redelivery, or a retry already joined -- is the registry's
    // to recognise, below, and is answered once.
    const known = this.ladders.get(event.id) !== undefined;

    // A new attempt from somebody a human has already answered: the acknowledgement again, not a
    // new ladder. A hold that has reached nobody, twice, ends itself, and the next attempt pages.
    if (!known) {
      const held = this.heldAcks.get(event.pubkey);
      if (held && !this.holding(held, now())) this.heldAcks.delete(event.pubkey);
      else if (held) {
        console.log(
          `[ladder] ${event.id.slice(0, 8)} from ${event.pubkey.slice(0, 8)}: already acknowledged by ` +
            `${held.ladder.acknowledgedBy?.callsign ?? "a human"} -- re-sending that, not paging`,
        );
        await this.resendAck(held, event.id);
        return;
      }
    }

    // Idempotent by event id. A client is REQUIRED to retry an unacknowledged Distress
    // indefinitely, so duplicates are the normal case, not an edge one.
    const { ladder, started } = this.ladders.open({
      distressId: event.id,
      operator: event.pubkey,
      oncall: this.config.escalation.oncall.map((e) => e.declaration),
      // Node-side emergency contacts are not built. The spec prefers device-initiated
      // anyway, and a ladder that claimed a contact it does not have would reach EXHAUSTED
      // five minutes late with nothing tried in between.
      hasEmergencyContact: false,
      now: now(),
    });

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

    if (ladder.state !== "paging") {
      await this.report(ladder, event.id);
      return;
    }

    /*
     * The budget is spent before the roster is touched -- and before anything is said, so a
     * ladder that will page nobody never opens with "Paging Wren." [#31].
     *
     * Anybody holding this watch's address -- which is meant to be handed out -- can publish a
     * signed 20911 from a key made a second ago. Unbounded, three hundred of them woke a real
     * person three hundred times, which is how escalation dies: not by being wrong, but by being
     * ignored on the night it is right.
     */
    if (!this.budget.take(now())) {
      console.error(
        `[page] BUDGET SPENT -- refusing to page for ${event.id.slice(0, 8)}. ` +
          `More than ${this.config.escalation.maxPagesPerWindow} pages in ` +
          `${this.config.escalation.pageBudgetWindowSeconds}s. This watch is being flooded.`,
      );
      await this.report(ladder, event.id, BUDGET_SPENT);
      return;
    }

    // Said before the roster is touched, and not held until the commands finish: a command may
    // take thirty seconds, and the operator is owed the ladder's first word before then.
    await this.report(ladder, event.id);

    /*
     * The id goes with the page, because it cannot be fetched afterwards.
     *
     * `20911` is ephemeral, so a phone that was asleep when this fired and wakes on the
     * notification finds nothing on the relay to acknowledge. Carrying it here is what makes
     * a one-tap ack possible at all [2.5]; a channel that cannot carry it ignores the
     * placeholder and that operator uses the console.
     */
    const results = await this.page(
      this.config.escalation.oncall,
      `NavCom DISTRESS from ${event.pubkey.slice(0, 8)} -- ack in the console`,
      undefined,
      event.id,
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
    if (current?.state !== "paging") return;
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
  }

  private async handleAck(event: Event, payload: DistressAckPayload): Promise<void> {
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
      if (next.state === "acknowledged") this.heldAcks.set(next.operator, { ladder: next, at: now(), taken: 0 });
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
        : this.maybeAck(event);

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
      filter: { kinds: [KIND_DISTRESS, KIND_SIGNAL], "#p": [this.pubkey] },
      since: this.since,
      label: "executor",
      missing: "a Distress sent only there is not heard until it answers",
      // Longer than twice the age window, so a duplicate cannot outlive being remembered.
      seenRetentionSeconds: 2 * window + 60,
      onevent: (event) => this.onEvent(event),
    });
    this.listener.start();
  }

  private async maybeAck(event: Event): Promise<void> {
    // The executor subscribes to 20910 only for acknowledgements. Everything else on that
    // kind is the daemon's business, and reaching into it would be a dependency.
    if (event.tags.find((t) => t[0] === "t")?.[1] !== "distress-ack") return;
    const payload = openSignal<DistressAckPayload>(this.secretKey, event.pubkey, event.content);
    await this.handleAck(event, payload);
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

      for (const ladder of this.ladders.tickAll(now(), this.windows)) {
        this.report(ladder, ladder.distressId).catch((err: unknown) => {
          console.error(`[ladder] report failed: ${String(err)}`);
        });
      }
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
    this.listener?.stop();
    this.listener = undefined;
    this.pool.destroy();
  }
}

/** Exported for the acknowledgement test: an agent may never stop a ladder [invariant 5]. */
export { acknowledge };
