import type { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, verifyEvent } from "nostr-tools/pure";
import type { Event, EventTemplate } from "nostr-tools/core";
import { nodePool } from "../shared/nostr-node.js";
import { RelayListener } from "../shared/relay-listener.js";
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

/**
 * A response as the daemon may send it: from the agent, by the agent's name, and saying nothing only
 * the escalation executor may say.
 *
 * **The daemon can no longer close a `Distress`** (decided 2026-10-07, G3). On a box whose watch names
 * the executor's own key, a phone ends a `Distress` only on an answer that key signed, and the daemon
 * never holds it. On a box that names none, a phone still ends on a person's answer the watch key
 * signed -- and this process holds the watch key, beside the agent. So nothing it publishes says a
 * person answered, whatever the agent seam (`answerQuery`, and whatever replaces it) hands back:
 *
 * - `responder` is the agent, by this daemon's agent name: never `human`, never a person's callsign
 *   [invariant 4]
 * - no `ladder`: only the executor speaks for the ladder, and a phone acts on `exhausted` at once
 * - no `sig`: a holder's own answer signature is a person's, and the daemon is not one
 * - no `copy_of`: the daemon copies nothing the executor sent
 */
export function asAgent(payload: ResponsePayload, agentName: string): ResponsePayload {
  const { ladder: _ladder, sig: _sig, copy_of: _copy, ...rest } = payload;
  return { ...rest, responder: { kind: "agent", callsign: agentName } };
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
  private listener: RelayListener | undefined;
  private readonly accountability: AccountabilityLog | undefined;
  /**
   * Whether each relay refused the last watch state, so a change is said once [F13].
   * Absent until the first heartbeat reaches it.
   */
  private readonly refusing = new Map<string, boolean>();
  /** The relays that have taken a watch state at least once, so the first time is said. */
  private readonly carried = new Set<string>();
  /** The relays it was listening on when that last changed, so a relay coming back is announced at once. */
  private announcedOn = new Set<string>();
  /**
   * The publish in flight, and whether another was asked for meanwhile [review: relay paths].
   *
   * Overlapping publishes in the same second sign the same event, and nostr-tools keeps one
   * pending OK per event id: the earlier call never settled, so what each relay said to it was
   * never logged. A relay that starts listening mid-publish is covered by the one that follows.
   */
  private publishing: Promise<number> | null = null;
  private publishAgain = false;
  private stopped = false;

  constructor(opts: WatchtowerDaemonOptions) {
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
    // enablePing so a connection that died without a word is noticed and closed. Reconnection
    // is the listener's job, not the pool's: nostr-tools' own reconnect rewrote `since` to one
    // past the newest `created_at` anybody sent, so a single future-dated event made this daemon
    // deaf after the next drop [F04]. See `shared/relay-listener.ts`.
    //
    // The pool's connection callbacks are no longer logged here. They fired on every heartbeat
    // to a relay that was down -- once a minute, for ever -- and the listener and the heartbeat
    // now each say once when a relay goes and once when it comes back.
    this.pool = nodePool({ enablePing: true });
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
    let state: { last?: Drill | null };
    try {
      state = JSON.parse(readFileSync(path, "utf8")) as { last?: Drill | null };
    } catch (err: unknown) {
      /*
       * Said, once until it reads again [review: box safety]. A file that exists and cannot be read is
       * not the same as no drill: once the executor runs as a user of its own, a drill file that user
       * made `0600` demoted this watch from automated-oncall to automated with nothing said anywhere.
       */
      if (!this.drillUnreadable) {
        this.drillUnreadable = true;
        console.error(
          `[drill] the drill file at ${path} exists and cannot be read: ${String(err)}. The watch publishes no drill, ` +
            "and reads as automated rather than automated-oncall, until it can -- see ops/systemd/README.md, 4b",
        );
      }
      return null;
    }
    this.drillUnreadable = false;
    const drill = state?.last;
    if (!drill) return null;
    return {
      at: drill.at,
      result: drill.result,
      author: { kind: "node", callsign: this.agentName },
      // Who actually woke up, each named. Empty on a failed drill, which is the point.
      acknowledged: drill.acknowledged,
    };
  }
  /** Whether the drill file's being unreadable has been said, so it is said once until it reads again. */
  private drillUnreadable = false;

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

  /**
   * The relays this daemon can hear on right now: the only ones it announces itself on [#38].
   *
   * A relay that takes writes and author-only reads but refuses the box's `#p` subscription -- an
   * inbox that wants AUTH, or one that holds such a REQ and never answers -- carried a fresh
   * "automated" watch for as long as the box ran, while nothing on the box could hear a Distress
   * sent there. Withheld instead, the state there ages to Dark within `stale_after_seconds`: the
   * rule a phone holding the watch already keeps [F09].
   */
  private hearing(): string[] {
    return this.listener?.relays().filter((r) => r.listening).map((r) => r.url) ?? [];
  }

  /** Announces at once on a relay that has just started listening, rather than at the next beat. */
  private listeningChanged(): void {
    const now = new Set(this.hearing());
    const fresh = [...now].some((url) => !this.announcedOn.has(url));
    this.announcedOn = now;
    if (!fresh) return;
    this.publishWatchState().catch((err: unknown) => {
      console.error(`[heartbeat] publish failed: ${String(err)}`);
    });
  }

  /**
   * Publishes `10910` on every relay this daemon is listening on, and returns how many took it --
   * 0 means operators read Dark. One at a time: asked for while one is going out, it publishes once
   * more after that one has settled, rather than beside it.
   */
  private publishWatchState(): Promise<number> {
    if (this.publishing) {
      this.publishAgain = true;
      return this.publishing;
    }
    const run = (async () => {
      try {
        let accepted = 0;
        do {
          this.publishAgain = false;
          try {
            accepted = await this.publishWatchStateOnce();
          } catch (err: unknown) {
            // Said here, so one that fails does not take the one asked for meanwhile with it.
            console.error(`[heartbeat] publish failed: ${String(err)}`);
            accepted = 0;
          }
        } while (this.publishAgain && !this.stopped);
        return accepted;
      } finally {
        this.publishing = null;
      }
    })();
    this.publishing = run;
    return run;
  }

  /**
   * One publish of `10910`.
   *
   * The results were thrown away [F13]. A relay that refused every heartbeat (a write allowlist,
   * a rate limit, a policy against this kind) left the daemon logging nothing at all while
   * operators reading that relay were told nobody was on watch.
   */
  private async publishWatchStateOnce(): Promise<number> {
    if (this.stopped) return 0;
    const urls = this.hearing();
    const total = new Set(this.relayUrls).size;
    if (urls.length === 0) {
      // Every time, as below: the watch is invisible, and stays so until a relay answers.
      console.error(
        `[heartbeat] LISTENING ON NO RELAY (0/${total}) -- the watch state goes nowhere, and operators read Dark ` +
          "until a relay answers this box's subscription",
      );
      return 0;
    }
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
    const results = await Promise.allSettled(this.pool.publish(urls, event));
    let accepted = 0;
    const first: string[] = [];
    results.forEach((result, i) => {
      const url = urls[i] ?? "?";
      const was = this.refusing.get(url);
      if (result.status === "fulfilled") {
        accepted++;
        this.refusing.set(url, false);
        if (!this.carried.has(url)) {
          this.carried.add(url);
          first.push(url);
        } else if (was === true) console.log(`[heartbeat] ${url} accepting watch state again`);
        return;
      }
      this.refusing.set(url, true);
      // Once per change. A relay that refuses every minute would otherwise bury everything else.
      if (was !== true) {
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        // By cause [#26]: a publish that never connected is not a write policy.
        console.error(
          reason.startsWith("connection failure:")
            ? `[heartbeat] could not reach ${url} to publish the watch state: ${sanitizeForLog(reason, 160)}`
            : `[heartbeat] ${url} refused watch state: ${sanitizeForLog(reason, 160)}`,
        );
      }
    });
    if (accepted === 0) {
      // Every time, not once. This is the watch being invisible, and it stays true until it stops.
      console.error(
        `[heartbeat] NO RELAY ACCEPTED the watch state (0/${urls.length} listening, ${total} configured) -- ` +
          "operators read Dark until one does",
      );
    }
    /*
     * Each relay the first time it takes the watch state, with how many carry it now. One line for
     * the whole first publish said "2/3" on a healthy box whose third relay answered a moment
     * later, and nothing after -- while the systemd README told the Stationkeeper to look for N/N.
     */
    for (const url of first) {
      console.log(`[heartbeat] watch state (automated) published on ${url} -- ${accepted}/${total} relay(s) carry it now`);
    }
    return accepted;
  }

  /** Returns how many relays accepted it — 0 means nothing left this machine. */
  private async publishResponse(
    toPubkey: string,
    inReplyToEventId: string,
    said: ResponsePayload,
  ): Promise<number> {
    // Whatever the agent seam returned, it goes out as the agent: the one place that holds that rule.
    const payload = asAgent(said, this.agentName);
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
    // asAgent() is applied on the way out as well; this is what the daemon means to say.
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
        case "distress-ack":
        case "wake-others": {
          /*
           * The escalation executor's, and only its. It reads them from the relays itself and answers
           * them with its own key; an answer from here would be the agent's process speaking for the
           * ladder, and an acknowledgement is the one thing that may never come from an agent
           * [invariant 4]. Not "unknown": this daemon knows exactly whose they are.
           */
          console.log(`[signal] ${type} from ${shortId(event.pubkey)} is the escalation executor's -- not answered here`);
          return;
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

    // Published first, recorded second. The record says what happened, not what was attempted.
    const accepted = await this.publishResponse(event.pubkey, event.id, response);
    this.noteResponse(event.pubkey, response, accepted);
  }

  /**
   * Records what the watch actually answered, derived from the response itself.
   *
   * Single site on purpose: a note() call inside each case of the dispatch is one branch
   * away from an action that silently never gets recorded, and the log's whole value is
   * that it is complete.
   */
  private noteResponse(operator: string, response: ResponsePayload, accepted: number): void {
    const callsign = this.board.get(operator)?.callsign;
    /*
     * `accepted` is how many relays took it, and it decides the outcome.
     *
     * This recorded `acknowledged` before the publish and regardless of its result, so a
     * response every relay refused still left a durable claim that this watch answered — a
     * confident wrong answer in the one artifact that exists to be trusted about what happened.
     */
    if (response.type === "log-review" || response.type === "answer") {
      // An answer nobody could receive is not an answer. Said as plainly as the ack below.
      if (accepted === 0) {
        this.note("answered", operator, "ack-not-sent", callsign);
        return;
      }
      // An answer with no provenance renders unverified to the operator; the log says the
      // same thing, so the two accounts cannot drift apart.
      this.note("answered", operator, response.provenance ? "answered" : "answered-unverified", callsign);
      return;
    }
    const failed = response.text?.startsWith("error:") ?? false;
    this.note(
      "acked",
      operator,
      failed ? "error" : accepted > 0 ? "acknowledged" : "ack-not-sent",
      callsign,
    );
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
    /*
     * Published first, recorded second, and the record follows the result.
     *
     * This wrote `acknowledged` and fsynced it before publishing, so a response that every
     * relay refused still left a durable claim that this watch answered. `contactOverdue` in
     * this same file already does it the right way round for the *less* important action.
     */
    const accepted = await this.publishResponse(event.pubkey, event.id, response);
    this.note("acked", event.pubkey, accepted > 0 ? "acknowledged" : "ack-not-sent", callsign);
  }

  /**
   * Everything a relay hands over, before any of it is acted on.
   *
   * **An age window, because a signed event is valid for ever** [F12]. The executor has always
   * refused a `20911` stamped outside its own window; this daemon had only `since`, which a
   * relay can ignore. A relay rewriting frames -- or serving a captured one -- made it mark an
   * operator in distress again and acknowledge them again. The same event arriving twice is
   * answered once: the listener remembers verified ids for longer than twice this window, so an
   * event cannot outlive its own memory and come back inside it. Never under five minutes, the age
   * at which a phone reads this watch as Dark; the config refuses less [#4].
   */
  private onEvent(event: Event): void {
    if (!verifyEvent(event)) {
      console.log(`[signal] dropped: bad signature (${event.id.slice(0, 8)})`);
      return;
    }
    const age = now() - event.created_at;
    const window = this.config.watch.maxEventAgeSeconds;
    if (age > window || age < -window) {
      console.log(
        `[signal] dropped: ${event.id.slice(0, 8)} stamped ${age}s away -- outside max_event_age_seconds (${window}s)`,
      );
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
  }

  /**
   * One subscription per relay, each reopened by itself when it closes [F05].
   *
   * This was one subscription across every relay, opened once. A relay unreachable at boot was
   * never subscribed at all, while the heartbeat went on reconnecting to it and publishing
   * `10910` there -- so operators on that relay saw a watch that could not hear them. Reopening
   * fixed only the reconnect: the heartbeat still published to every configured relay, and a relay
   * that refused the box's subscription for good carried a fresh watch for as long as the box ran.
   * The watch state now goes only where this listens, and goes there the moment it starts [#38].
   */
  private startListening(): void {
    const window = this.config.watch.maxEventAgeSeconds;
    this.listener = new RelayListener({
      pool: this.pool,
      urls: this.relayUrls,
      filter: { kinds: [KIND_SIGNAL, KIND_DISTRESS], "#p": [this.pubkey] },
      since: this.since,
      label: "relay",
      missing: "signals sent only there are not heard, and the watch state is not published there",
      seenRetentionSeconds: 2 * window + 60,
      onevent: (event) => this.onEvent(event),
      onchange: () => this.listeningChanged(),
    });
    this.listener.start();
  }

  /** How many relays this daemon is actually subscribed on right now. */
  listening(): number {
    return this.listener?.listening() ?? 0;
  }

  /**
   * Takes the watch: listens first, and announces the watch on each relay as it starts listening.
   *
   * It used to publish the first state before subscribing anywhere, so a relay the box would never
   * hear on was told a watch was up before anything had checked [#38]. Each relay now says when it
   * is listening (`[relay] <url> listening`), and the first watch state follows at once.
   */
  async start(): Promise<void> {
    this.note("took-watch", null, "held");
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
    this.stopped = true;
    if (this.heartbeatHandle) clearInterval(this.heartbeatHandle);
    if (this.sweepHandle) clearInterval(this.sweepHandle);
    this.listener?.stop();
    this.pool.destroy();
    this.accountability?.close();
  }
}
