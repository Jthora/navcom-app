import { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, verifyEvent } from "nostr-tools/pure";
import type { Event, EventTemplate } from "nostr-tools/core";
import { randomBytes } from "node:crypto";
import {
  acknowledge,
  drillSentence,
  LadderRegistry,
  ladderReport,
  type Author,
  type DistressAckPayload,
  type Ladder,
  type ResponsePayload,
} from "@navcom/core";
import { installNodeWebSocket } from "../shared/nostr-node.js";
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
  private subCloser: { close: (reason?: string) => void } | undefined;
  /**
   * The executor's own accountability log -- separate from the daemon's, and the only
   * place a Distress's real outcome (paged, acknowledged by whom, or exhausted) is
   * durably recorded. See `EscalationConfig.log`'s doc comment for why it is a second
   * file rather than the daemon's.
   */
  private accountability: AccountabilityLog | null = null;

  constructor(opts: ExecutorOptions) {
    installNodeWebSocket();
    this.config = opts.config;
    this.secretKey = opts.secretKey;
    this.pubkey = opts.pubkey;
    this.page = opts.page ?? pageAll;
    this.drillStatePath = opts.drillStatePath;
    this.pool = opts.pool ?? new SimplePool({ enableReconnect: true });
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
  private async report(ladder: Ladder, distressId: string, note?: string): Promise<void> {
    const responder: Author =
      ladder.state === "acknowledged" && ladder.acknowledgedBy
        ? ladder.acknowledgedBy
        : { kind: "node", callsign: "escalation" };

    const payload: ResponsePayload = {
      type: ladder.state === "acknowledged" ? "ack" : "escalation-status",
      responder,
      // `note` is what only this process knows: whether a page actually went out. The
      // ladder's own sentence describes the state machine, and the state machine cannot see
      // a command that exited non-zero.
      text: note ? `${ladderReport(ladder)} ${note}` : ladderReport(ladder),
      provenance: null,
    };

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

    console.log(`[ladder] ${distressId.slice(0, 8)} ${ladder.state}: ${payload.text}`);
    const results = await Promise.allSettled(this.pool.publish(this.config.relays.urls, event));
    if (results.every((r) => r.status === "rejected")) {
      // The operator cannot be told. Loud, because invariant 2 is failing right here and
      // there is nothing further this process can do about it.
      console.error(`[ladder] COULD NOT REPORT ${ladder.state} TO OPERATOR -- no relay accepted`);
    }
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
      console.log(`[ladder] ${event.id.slice(0, 8)} already running -- not starting a second`);
      return;
    }

    await this.report(ladder, event.id);

    if (ladder.state === "paging") {
      /*
       * The budget is spent before the roster is touched.
       *
       * Anybody holding this watch's address -- which is meant to be handed out -- can
       * publish a signed 20911 from a key made a second ago. Unbounded, three hundred of
       * them woke a real person three hundred times, which is how escalation dies: not by
       * being wrong, but by being ignored on the night it is right.
       */
      if (!this.budget.take(now())) {
        console.error(
          `[page] BUDGET SPENT -- refusing to page for ${event.id.slice(0, 8)}. ` +
            `More than ${this.config.escalation.maxPagesPerWindow} pages in ` +
            `${this.config.escalation.pageBudgetWindowSeconds}s. This watch is being flooded.`,
        );
        await this.report(
          ladder,
          event.id,
          "The watch could not page anyone -- too many alerts at once. Nobody has been woken.",
        );
        return;
      }

      const results = await this.page(
        this.config.escalation.oncall,
        `NavCom DISTRESS from ${event.pubkey.slice(0, 8)} -- ack in the console`,
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
       */
      if (results.length > 0 && results.every((r) => !r.dispatched)) {
        console.error(`[page] EVERY CHANNEL FAILED for ${event.id.slice(0, 8)}`);
        await this.report(
          ladder,
          event.id,
          "No page could be sent -- every channel failed. Nobody has been woken.",
        );
      }
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
    if (next) await this.report(next, payload.distress_id);
  }

  private listen(): void {
    this.subCloser = this.pool.subscribeMany(
      this.config.relays.urls,
      { kinds: [KIND_DISTRESS, KIND_SIGNAL], "#p": [this.pubkey], since: this.since },
      {
        onevent: (event: Event) => {
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

          const task =
            event.kind === KIND_DISTRESS
              ? this.handleDistress(event)
              : this.maybeAck(event);

          task.catch((err: unknown) => {
            console.error(`[executor] handling ${event.id.slice(0, 8)} failed: ${String(err)}`);
          });
        },
      },
    );
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

      for (const ladder of this.ladders.tickAll(now(), this.windows)) {
        this.report(ladder, ladder.distressId).catch((err: unknown) => {
          console.error(`[ladder] report failed: ${String(err)}`);
        });
      }
    }, 1000);
  }

  async stop(): Promise<void> {
    if (this.sweepHandle) clearInterval(this.sweepHandle);
    this.subCloser?.close("shutdown");
    this.pool.destroy();
  }
}

/** Exported for the acknowledgement test: an agent may never stop a ladder [invariant 5]. */
export { acknowledge };
