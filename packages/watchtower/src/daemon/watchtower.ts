import { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, verifyEvent } from "nostr-tools/pure";
import type { Event, EventTemplate } from "nostr-tools/core";
import { installNodeWebSocket } from "../shared/nostr-node.js";
import { sealResponse, openSignal } from "../shared/crypto.js";
import { existsSync, readFileSync } from "node:fs";
import { WATCH_STATE_VERSION, type Drill, type LogAction, type LogOutcome, type LogReviewPayload } from "@navcom/core";
import { KIND_WATCH_STATE, KIND_SIGNAL, KIND_DISTRESS, KIND_RESPONSE } from "../shared/kinds.js";
import type {
  DrillResult,
  AssistPayload,
  QueryPayload,
  ResponsePayload,
  SignalType,
  WatchStatePayload,
} from "../shared/payloads.js";
import { sanitizeForLog, validateOnStationPayload, ValidationError } from "../shared/validate.js";
import { isAuthorizedOperator } from "./authorization.js";
import { Board, type BoardEntry } from "./board.js";
import { AccountabilityLog } from "../shared/accountability.js";
import type { DaemonConfig } from "./config.js";
import { answerQuery } from "./query.js";

export interface WatchtowerDaemonOptions {
  config: DaemonConfig;
  secretKey: Uint8Array;
  pubkey: string;
  agentName?: string;
  /**
   * Inject a pre-built pool (a test fake, typically) instead of letting
   * the constructor build a real SimplePool. Added so WatchtowerDaemon
   * -- the one file tying every other piece together, and the one with
   * zero direct test coverage before this -- can be unit tested without
   * opening a real network connection.
   */
  pool?: SimplePool;
  /**
   * Where actions are recorded [C33].
   *
   * Optional so tests can run without touching a disk, and so a daemon whose log could not
   * be opened still holds the watch -- an accountability failure must not become an
   * availability one. When absent, `note()` is a no-op and the caller has already shouted.
   */
  log?: AccountabilityLog;
}

const AGENT_HEALTH_OK = "ok" as const;

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function shortId(pubkey: string): string {
  return pubkey.slice(0, 8);
}

/**
 * A timeout is safe to describe to the operator -- unlike a raw internal
 * exception, "query answer timed out" carries no implementation detail
 * worth hiding, so handleSignalEvent's catch block treats this the same
 * way it treats ValidationError (real message passed through) rather
 * than genericizing it to "internal error handling signal."
 */
export class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export class WatchtowerDaemon {
  readonly board = new Board();
  private readonly pool: SimplePool;
  private readonly config: DaemonConfig;
  private readonly secretKey: Uint8Array;
  private readonly pubkey: string;
  private readonly agentName: string;
  private readonly since: number;
  private heartbeatHandle: ReturnType<typeof setInterval> | undefined;
  private sweepHandle: ReturnType<typeof setInterval> | undefined;
  private subCloser: { close: (reason?: string) => void } | undefined;
  private readonly accountability: AccountabilityLog | undefined;

  constructor(opts: WatchtowerDaemonOptions) {
    installNodeWebSocket();
    this.config = opts.config;
    this.secretKey = opts.secretKey;
    this.pubkey = opts.pubkey;
    this.agentName = opts.agentName ?? "watchtower";
    this.accountability = opts.log;
    this.since = now();
    if (opts.pool) {
      this.pool = opts.pool;
      return;
    }
    // enableReconnect: true -- found in review: nostr-tools' SimplePool
    // defaults this to false. A daemon that silently stops receiving
    // signals after a transient network blip, with no auto-recovery and
    // no indication to anyone that it happened, is unacceptable for a
    // safety-coordination system.
    this.pool = new SimplePool({ enableReconnect: true });
    // Connection callbacks aren't part of SimplePool's typed constructor
    // (only enablePing/enableReconnect are) but ARE public, assignable
    // properties on the underlying AbstractSimplePool -- set them so a
    // relay drop/recovery is at least visible in the daemon's own logs,
    // even though there's no remote alerting in session one.
    this.pool.onRelayConnectionFailure = (url: string) => {
      console.warn(`[relay] connection failed: ${url}`);
    };
    this.pool.onRelayConnectionSuccess = (url: string) => {
      console.log(`[relay] connected: ${url}`);
    };
  }

  private get relayUrls(): string[] {
    return this.config.relays.urls;
  }

  /**
   * The last drill, as the executor recorded it.
   *
   * Null when no drill has ever run, when the file is unreadable, or when there is no
   * executor -- and all three mean the same thing to a client: **this watch has not
   * demonstrated that it can raise anyone.** `publishableWatchState` demotes
   * `automated-oncall` to `automated` on exactly that, so the honest answer arrives without
   * anything here having to decide it.
   */
  private lastDrill(): DrillResult | null {
    const path = this.config.log.drillStatePath;
    if (!path || !existsSync(path)) return null;
    try {
      const state = JSON.parse(readFileSync(path, "utf8")) as { last?: Drill | null };
      const drill = state.last;
      if (!drill) return null;
      return {
        at: drill.at,
        result: drill.result,
        author: { kind: "node", callsign: this.agentName },
        // Who actually woke up, each named. Empty on a failed drill, which is the point.
        acknowledged: drill.acknowledged,
      };
    } catch {
      return null;
    }
  }

  /**
   * Records a watch action.
   *
   * The actor is always this node, identified as an agent -- `agents.md` requires an agent
   * to be identified as one in the log, not only in the watch state and acknowledgements.
   *
   * A failure to write is logged and swallowed. It must never take down the watch, and it
   * must never be silent.
   */
  private note(action: LogAction, subject: string | null, outcome: LogOutcome, callsign?: string): void {
    if (!this.accountability) return;
    try {
      this.accountability.record({
        at: now(),
        actor: { kind: "agent", callsign: this.agentName, pubkey: this.pubkey },
        action,
        // Omitted rather than set to undefined: the subject is keyed on pubkey, and a
        // callsign is a reading convenience the board may not have yet.
        subject:
          subject === null
            ? null
            : { kind: "human", pubkey: subject, ...(callsign ? { callsign } : {}) },
        outcome,
      });
    } catch (err: unknown) {
      console.error(`[log] FAILED TO RECORD ${action}/${outcome}: ${String(err)}`);
    }
  }

  private sign(template: EventTemplate): Event {
    return finalizeEvent(template, this.secretKey);
  }

  private async publishWatchState(): Promise<void> {
    const payload: WatchStatePayload = {
      v: WATCH_STATE_VERSION,
      state: "automated",
      holder: null,
      holder_kind: "agent",
      // Empty, and that is the honest value: nobody has declared themselves on-call.
      //
      // This previously published `this.board.size` — the number of operators OUT in the
      // field — as the number reachable to help them. An operator reading "3 on-call"
      // would have believed three people could be raised, when those three were the ones
      // on the street. An authored list cannot be assigned a board count by accident,
      // which is why it is a list.
      oncall: [],
      since: this.since,
      agent_health: AGENT_HEALTH_OK,
      // Read from where the escalation executor wrote it, never asked for. One direction
      // only: an executor that is down leaves this null or stale, which DEMOTES the watch
      // state -- the correct failure, arrived at structurally rather than by anybody
      // remembering to handle it.
      last_drill: this.lastDrill(),
      // A commitment to the log, republished on every heartbeat so an operator holding an
      // older root can tell whether history moved under them. Null when no log is open --
      // "this watch commits to nothing" is a fact worth publishing, not a gap to hide.
      log_root: this.accountability?.root(now()) ?? null,
    };
    const event = this.sign({
      kind: KIND_WATCH_STATE,
      tags: [],
      content: JSON.stringify(payload),
      created_at: now(),
    });
    await Promise.allSettled(this.pool.publish(this.relayUrls, event));
  }

  /** Returns how many relays accepted it — 0 means nothing left this machine. */
  private async publishResponse(
    toPubkey: string,
    inReplyToEventId: string,
    payload: ResponsePayload,
  ): Promise<number> {
    const content = sealResponse(this.secretKey, toPubkey, payload);
    const event = this.sign({
      kind: KIND_RESPONSE,
      tags: [
        ["p", toPubkey],
        ["e", inReplyToEventId],
      ],
      content,
      created_at: now(),
    });
    const results = await Promise.allSettled(this.pool.publish(this.relayUrls, event));
    const okCount = results.filter((r) => r.status === "fulfilled").length;
    console.log(
      `[respond] -> ${shortId(toPubkey)} type=${payload.type} (${okCount}/${results.length} relays)`,
    );
    return okCount;
  }

  private ack(): ResponsePayload {
    return { type: "ack", responder: { kind: "agent", callsign: this.agentName }, text: null, provenance: null };
  }

  /**
   * The third thing `watch-state.spec.md` requires on overdue, and the one that was missing.
   *
   * The spec is explicit: mark the entry, make it visible to whoever holds watch, **and
   * attempt contact with the operator**. The first two shipped; this logged
   * `contact-not-attempted` for months behind a comment saying it should read badly until
   * it stopped being true.
   *
   * **It goes to the operator and to nobody else.** Not the watch holder, not on-call, not
   * a pager, not a ladder — the same paragraph that requires this forbids all of those
   * [C4, invariant 3], because raising somebody *else* on a missed window is inferring
   * duress from silence. Asking the person is the opposite of inferring: it consults the
   * only individual who knows, and accepts whatever they say or don't say.
   *
   * **Nothing about the overdue is published.** The payload is sealed to the operator and
   * the tags are the ordinary `p`/`e` every response carries. What an observer can still
   * see is *timing*: a `20912` to an operator with no signal of theirs just before it is
   * inferable as this. That is a weak correlation rather than an announcement — the
   * `overdue_count` this replaces told anyone subscribed, in the clear — and it is the
   * price of the node being able to reach the operator at all over a relay, which is the
   * only channel it has (`declined.md` refuses node-held contact details). Named here
   * rather than left for an audit.
   *
   * Failure is recorded, not swallowed. `contact-attempted` says a relay took it and
   * nothing more; `contact-failed` says nothing left this machine. Neither claims the
   * operator read it, because neither can know.
   */
  private async contactOverdue(entry: BoardEntry): Promise<void> {
    if (entry.signalId === null) {
      // An entry a Distress created, with no sign-on behind it. `sweep` only marks `active`
      // entries overdue so this should be unreachable — logged rather than silently skipped,
      // because if it ever fires the assumption above has stopped being true.
      console.error(`[overdue] no signal to reference for ${shortId(entry.operator)}; not contacting`);
      this.note("contacted", entry.operator, "contact-not-attempted", entry.callsign);
      return;
    }
    const payload: ResponsePayload = {
      type: "contact",
      responder: { kind: "agent", callsign: this.agentName },
      // Deliberately flat. "Are you okay?" invites the reading invariant 3 refuses, and an
      // operator who is simply late should not be met with alarm for being late.
      text: "You are past the time you gave. Send a routine check-in if you are still out, or stand down if you are home.",
      provenance: null,
    };
    try {
      const accepted = await this.publishResponse(entry.operator, entry.signalId, payload);
      this.note(
        "contacted",
        entry.operator,
        accepted > 0 ? "contact-attempted" : "contact-failed",
        entry.callsign,
      );
    } catch (err: unknown) {
      console.error(`[overdue] contact failed: ${String(err)}`);
      this.note("contacted", entry.operator, "contact-failed", entry.callsign);
    }
  }

  /**
   * What the escalation executor's own log says about this operator, if this daemon has
   * been told where to find it. `undefined` when not configured -- most deployments today
   * don't set this, and log-review degrades to answering from this watch's own log alone,
   * same as before this existed.
   *
   * Opened fresh on every call rather than held, matching `root()`'s own "recomputed on
   * demand" reasoning: a cached view of tamper-evidence that drifted from the file would be
   * the single most misleading value here. Read-only and never fatal -- an accountability
   * problem must not become an availability one, same rule this daemon holds for its own
   * log, and the executor being down or the file not existing yet must not break
   * `log-review` for the part this daemon can still answer.
   *
   * The review returned here carries no root this device can independently verify yet --
   * nothing publishes the escalation log's commitment anywhere. Surfacing it unverified is
   * still real progress over not surfacing it at all, and the terminal says so plainly
   * rather than implying a check that hasn't happened.
   */
  private reviewEscalationLog(
    pubkey: string,
    opts: { since?: number; limit?: number },
  ): ReturnType<AccountabilityLog["reviewFor"]> | undefined {
    const path = this.config.log.escalationLogPath;
    if (!path) return undefined;
    try {
      const { log } = AccountabilityLog.open(path, this.config.log.retentionDays);
      return log.reviewFor(pubkey, opts);
    } catch (err: unknown) {
      console.error(`[log-review] could not read the escalation log at ${path}: ${String(err)}`);
      return undefined;
    }
  }

  private handleOnStation(operatorPubkey: string, rawPayload: unknown, signalId: string): void {
    // Found in review: this used to trust `payload as OnStationPayload`
    // with zero runtime checking -- a malformed expected_duration
    // (missing/NaN/non-numeric) reached
    // `new Date(NaN * 1000).toISOString()` inside Board.onStation() and
    // threw an uncaught RangeError, silently killing the response to
    // that operator. validateOnStationPayload() throws a clear
    // ValidationError instead, which handleSignalEvent's outer try/catch
    // now turns into an actual error-ack rather than silence.
    const payload = validateOnStationPayload(rawPayload);
    const callsign = payload.callsign?.trim() || `OP-${operatorPubkey.slice(0, 6)}`;
    // "?? default" would be wrong here: the wire contract says an
    // EXPLICIT null disables routine check-ins, and `??` treats null and
    // undefined identically, silently overriding a deliberate "disable"
    // with the config default. Only a genuinely missing key (malformed
    // payload, not a spec-following client) falls back to the default.
    const routineIntervalSeconds =
      "routine_interval" in payload
        ? payload.routine_interval
        : this.config.watch.routineIntervalDefault;
    this.board.onStation({
      operator: operatorPubkey,
      callsign,
      area: payload.area,
      expectedDurationSeconds: payload.expected_duration,
      routineIntervalSeconds,
      position: payload.share_position ? payload.position : null,
      now: now(),
      signalId,
    });
  }

  private async handleSignalEvent(event: Event): Promise<void> {
    const tTag = event.tags.find((t) => t[0] === "t")?.[1];
    const type = tTag as SignalType | undefined;
    if (!type) {
      console.log(`[signal] dropped: missing t tag (${event.id.slice(0, 8)})`);
      return;
    }

    let payload: unknown;
    try {
      payload = openSignal(this.secretKey, event.pubkey, event.content);
    } catch {
      console.log(`[signal] dropped: undecryptable content (${event.id.slice(0, 8)})`);
      return;
    }

    // Found in review: everything from here down used to run outside
    // any try/catch, so ANY exception (a validation failure, an
    // encryption error building the response, anything) propagated up
    // to startListening()'s bare `task.catch(log-and-drop)` -- meaning
    // the operator got total silence, violating "every signal receives
    // at least an ack." This now guarantees SOME response is attempted
    // for every signal we understood well enough to reach this point,
    // even when handling it failed.
    let response: ResponsePayload;
    try {
      switch (type) {
        case "on-station": {
          this.handleOnStation(event.pubkey, payload, event.id);
          response = this.ack();
          break;
        }
        case "routine": {
          this.board.routine(event.pubkey, now(), this.config.watch.overdueGrace);
          response = this.ack();
          break;
        }
        case "query": {
          this.board.touch(event.pubkey, now(), this.config.watch.overdueGrace);
          response = await withTimeout(
            answerQuery(payload as QueryPayload, this.agentName),
            this.config.watch.queryTimeoutSeconds * 1000,
            "query answer timed out",
          );
          break;
        }
        case "assist": {
          this.board.touch(event.pubkey, now(), this.config.watch.overdueGrace);
          // Urgency is the whole point of an assist and must reach whoever holds watch.
          // "soon" and "now" ask for different responses, and an ack that swallows the
          // difference makes them look identical on the board.
          const assist = payload as AssistPayload;
          const entry = this.board.get(event.pubkey);
          // An absent urgency reads as UNSTATED, never as the lower of the two. Guessing
          // "soon" from silence is the confident wrong answer [principle 9] applied to the
          // one field that says how long someone has.
          const urgency =
            assist.urgency === "now" ? "NOW" : assist.urgency === "soon" ? "soon" : "UNSTATED";
          // sanitizeForLog on both fields: found in robustness audit that this line was
          // the one console.log left interpolating operator-controlled text unsanitized --
          // an assist.text containing an embedded newline and a forged "[distress] ..."
          // line was indistinguishable from a real one, undermining the manual, human-read
          // console verification the whole no-persistence design leans on. Its own maxLen
          // (64, the same bound every other board log line uses) is what caps the length
          // here too -- a separate slice first would just be redundant with it.
          const callsignForLog = entry?.callsign
            ? sanitizeForLog(entry.callsign)
            : event.pubkey.slice(0, 8);
          console.log(
            `[assist] ${callsignForLog} ` +
              `urgency=${urgency}` +
              (assist.text ? ` — ${sanitizeForLog(assist.text)}` : ""),
          );
          response = this.ack();
          break;
        }
        case "log-review": {
          // C33 made operable. There is no subject field in the request: the answer is
          // about whoever signed it, so one operator asking for another's record is not a
          // thing the payload can express.
          const req = (payload ?? {}) as LogReviewPayload;
          if (!this.accountability) {
            response = {
              type: "ack",
              responder: { kind: "agent", callsign: this.agentName },
              text: "this watch keeps no accountability log",
              provenance: null,
            };
            break;
          }
          const reviewOpts = {
            ...(typeof req.since === "number" ? { since: req.since } : {}),
            ...(typeof req.limit === "number" ? { limit: req.limit } : {}),
          };
          const escalation = this.reviewEscalationLog(event.pubkey, reviewOpts);
          response = {
            type: "log-review",
            responder: { kind: "agent", callsign: this.agentName },
            text: null,
            provenance: null,
            review: {
              ...this.accountability.reviewFor(event.pubkey, reviewOpts),
              ...(escalation ? { escalation } : {}),
            },
          };
          break;
        }
        case "stood-down": {
          this.board.standDown(event.pubkey);
          response = this.ack();
          break;
        }
        default: {
          console.log(`[signal] dropped: unknown type "${type}" (${event.id.slice(0, 8)})`);
          return;
        }
      }
    } catch (err: unknown) {
      const message =
        err instanceof ValidationError || err instanceof TimeoutError
          ? err.message
          : "internal error handling signal";
      console.error(`[signal] handling "${type}" from ${shortId(event.pubkey)} failed: ${String(err)}`);
      response = { type: "ack", responder: { kind: "agent", callsign: this.agentName }, text: `error: ${message}`, provenance: null };
    }

    this.noteResponse(event.pubkey, response);
    await this.publishResponse(event.pubkey, event.id, response);
  }

  /**
   * Records what the watch actually answered, derived from the response itself.
   *
   * Single site on purpose: a note() call inside each case of the dispatch is one branch
   * away from an action that silently never gets recorded, and the log's whole value is
   * that it is complete.
   */
  private noteResponse(operator: string, response: ResponsePayload): void {
    const callsign = this.board.get(operator)?.callsign;
    if (response.type === "log-review" || response.type === "answer") {
      // An answer with no provenance renders unverified to the operator; the log says the
      // same thing, so the two accounts cannot drift apart.
      this.note("answered", operator, response.provenance ? "answered" : "answered-unverified", callsign);
      return;
    }
    const failed = response.text?.startsWith("error:") ?? false;
    this.note("acked", operator, failed ? "error" : "acknowledged", callsign);
  }

  private async handleDistressEvent(event: Event): Promise<void> {
    // Distress is always a deliberate act -- never inferred. This
    // handler only ever fires from an explicit kind-20911 event the
    // operator sent, never from a missed check-in (that's overdue,
    // which is a nudge, not distress).
    this.board.distress(event.pubkey, now());
    const callsign = this.board.get(event.pubkey)?.callsign;

    // The real escalation outcome is recorded by the executor -- a separate process that
    // actually runs the ladder, and the only party that knows whether it reached a human.
    // This daemon does not, so it does not claim one: writing "escalation-not-attempted"
    // here regardless of the true outcome (as this used to, from before the ladder
    // existed) is exactly the confident wrong answer the accountability log exists to
    // prevent. See `shared/accountability.ts`'s own doc comment and the executor's log.
    const response: ResponsePayload = {
      type: "ack",
      responder: { kind: "agent", callsign: this.agentName },
      text: null,
      provenance: null,
    };
    this.note("acked", event.pubkey, "acknowledged", callsign);
    await this.publishResponse(event.pubkey, event.id, response);
  }

  private startListening(): void {
    this.subCloser = this.pool.subscribeMany(
      this.relayUrls,
      { kinds: [KIND_SIGNAL, KIND_DISTRESS], "#p": [this.pubkey], since: this.since },
      {
        onevent: (event: Event) => {
          if (!verifyEvent(event)) {
            console.log(`[signal] dropped: bad signature (${event.id.slice(0, 8)})`);
            return;
          }
          if (!isAuthorizedOperator(event.pubkey, this.config.authorization.allowedPubkeys)) {
            // Silent drop, not an ack -- an unauthorized sender doesn't
            // get confirmation that anything was even received. With no
            // allowed_pubkeys configured this never fires (matches
            // Session One's "any pubkey" MVP policy); once a real
            // allowlist is set, telling a rejected party "yes, I'm here,
            // and no" is strictly worse than saying nothing.
            console.log(`[signal] dropped: unauthorized operator (${shortId(event.pubkey)})`);
            return;
          }
          const task =
            event.kind === KIND_DISTRESS
              ? this.handleDistressEvent(event)
              : this.handleSignalEvent(event);
          task.catch((err: unknown) => {
            console.error(`[signal] handler error: ${String(err)}`);
          });
        },
      },
    );
  }

  async start(): Promise<void> {
    this.note("took-watch", null, "held");
    await this.publishWatchState();
    this.startListening();
    this.heartbeatHandle = setInterval(() => {
      this.publishWatchState().catch((err: unknown) => {
        console.error(`[heartbeat] publish failed: ${String(err)}`);
      });
    }, this.config.watch.heartbeatIntervalSeconds * 1000);
    this.sweepHandle = setInterval(() => {
      // Overdue is written to the accountability log and published nowhere.
      //
      // This used to trigger an out-of-band watch-state publish, because the aggregate
      // count on 10910 was the only way to tell whoever held watch. It was also an
      // unencrypted announcement that *somebody* was overdue, to anyone subscribed. The
      // watch is now a mode of the app and reads the board directly, so the channel is
      // gone and so is the leak.
      this.board.sweep(now(), this.config.watch.overdueGrace, this.config.watch.hardExpiry, (entry) => {
        this.note("marked-overdue", entry.operator, "marked-overdue", entry.callsign);
        void this.contactOverdue(entry);
        this.publishWatchState().catch((err: unknown) => {
          console.error(`[overdue] notify publish failed: ${String(err)}`);
        });
      });
    }, this.config.watch.sweepIntervalSeconds * 1000);
  }

  async stop(): Promise<void> {
    if (this.heartbeatHandle) clearInterval(this.heartbeatHandle);
    if (this.sweepHandle) clearInterval(this.sweepHandle);
    this.subCloser?.close("shutdown");
    this.pool.destroy();
    this.accountability?.close();
  }
}
