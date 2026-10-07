import type { SimplePool } from "nostr-tools/pool";
import type { Filter } from "nostr-tools/filter";
import type { Event } from "nostr-tools/core";
import { verifyEvent } from "nostr-tools/pure";
import { sanitizeForLog } from "./validate.js";

/**
 * One subscription per relay, each of which notices when it has gone and comes back by itself.
 *
 * ## Why this is shared
 *
 * The daemon, the executor and the keyless pager each listened differently, and each was deaf
 * in its own way [audit: relay paths]:
 *
 * - **The daemon** never subscribed again to a relay that was down when it booted, while its
 *   heartbeat kept publishing there -- so the watch looked up on a relay that could not hear
 *   anybody [F05]
 * - **The pager** had no reconnect at all; one router reboot and it watched nothing while still
 *   saying it was watching [F06]
 * - **The executor** decided liveness from the pool's connection status, which a relay that
 *   stays connected and sends `CLOSED` reads as healthy, and which a heartbeat publish makes
 *   read as connected for twenty seconds with no subscription on it [F08]
 * - **All three** shared one filter object across relays and let nostr-tools rewrite its
 *   `since` on reconnect to one past the newest `created_at` anybody had sent -- so one
 *   future-dated event made them deaf after the next reconnect [F04]
 *
 * Three implementations of "keep listening" disagree right up until one of them is fixed. One
 * implementation is what stops them drifting apart again.
 *
 * ## The rules it holds
 *
 * - **Liveness is the relay's own subscription.** A relay is up when its subscription has been
 *   answered -- a real EOSE, or an event on it -- and has not closed. Connection status is not
 *   consulted: a socket can be open with nothing listening on it. Nor is nostr-tools' stand-in
 *   for an EOSE, which it fires by itself 4.4 seconds after a REQ nobody answered: a hung relay
 *   was logged `listening`, and the pager said it was watching there [review: relay paths]
 * - **A relay that takes the subscription and never answers is said once**, after
 *   {@link SILENT_SECONDS}, and the subscription is left open in case it does
 * - **The subscription is the relay's own, not the pool's.** nostr-tools' pool wraps every
 *   `onclose` in `reason.startsWith(...)`, and a relay that sends `CLOSED` with a reason that
 *   is not a string -- `null`, or the `{}` a JS relay makes of an Error -- threw there, so the
 *   listener never heard the close and counted that relay as listening until restart
 * - **A closed subscription is reopened**, after a wait that grows to {@link RELISTEN_SECONDS}
 * - **The new subscription opens before the old one closes**, and a subscription whose own
 *   `onclose` has fired is never closed again. nostr-tools counts the close twice, the socket is
 *   then never reaped, and the relay is never subscribed again [F08]
 * - **Every subscription gets its own filter, and its `since` never moves.** nostr-tools'
 *   reconnect rewrite is discarded, so nothing a relay sends can push it into the future [F04]
 * - **An event seen on two relays, or across a re-subscribe, is delivered once.** Keyed on
 *   verified ids only, so a forged frame cannot claim a real event's id first
 * - **A change is said once.** "Unreachable" when a relay goes, "reachable again" when it comes
 *   back, never once per retry
 */

/** The longest wait between attempts to reopen a relay's subscription. */
export const RELISTEN_SECONDS = 15;

/** Seconds before each successive attempt; the last repeats. */
export const RELISTEN_BACKOFF_SECONDS: readonly number[] = [1, 2, 5, 10, RELISTEN_SECONDS];

/**
 * How long a subscription has to have stayed open for its next failure to start the backoff
 * again from the beginning. Without it, a relay that answers and then refuses straight away
 * would be retried every second for ever.
 */
const STABLE_SECONDS = 60;

/**
 * How long a subscription may go unanswered before that is said. Longer than a slow relay takes to
 * send EOSE, short enough that a box whose relay has hung says so before anyone needs it.
 */
export const SILENT_SECONDS = 10;

/** The same connection timeout nostr-tools' pool uses, for the subscriptions opened here. */
const CONNECT_TIMEOUT_MS = 3_000;

/**
 * nostr-tools' longest timer, as the subscription's EOSE timeout: its stand-in for an EOSE never
 * fires, including on a reconnecting pool, which arms it again on every reconnect.
 */
const NEVER_MS = 2_147_483_647;

/** How often the seen-ids map is pruned, at most. */
const PRUNE_EVERY_SECONDS = 60;

/**
 * NIP-01's machine-readable prefixes. A close reason that starts with one of these came from the
 * relay refusing; anything else is the connection going.
 */
const REFUSALS = [
  "auth-required",
  "restricted",
  "rate-limited",
  "blocked",
  "invalid",
  "error",
  "unsupported",
  "pow",
  "duplicate",
] as const;

/**
 * A pool. One that can hand over its relay (`ensureRelay`, as `SimplePool` does) is subscribed on
 * directly, which is what every process here runs. The fakes in tests have only
 * `subscribeMany`, and that path is kept for them.
 */
type Pool = Pick<SimplePool, "subscribeMany"> & Partial<Pick<SimplePool, "ensureRelay">>;

export interface RelayListenerOptions {
  pool: Pool;
  urls: readonly string[];
  /** Everything but `since`, which this owns. */
  filter: Omit<Filter, "since">;
  /** Never moves, whatever a relay sends. Omitted for a listener that has no floor. */
  since?: number;
  /** Log prefix: `[relay]`, `[executor]`, `[pager]`. */
  label: string;
  /** What a relay being down costs, said with the line that says it went. */
  missing: string;
  onevent: (event: Event, url: string) => void;
  /** Called after a relay's state changes, with how many are listening now. */
  onchange?: (listening: number, total: number) => void;
  /**
   * How long a verified id is remembered. A consumer with an age window must set this to more
   * than twice that window, or an event could outlive its own memory and be acted on again.
   */
  seenRetentionSeconds?: number;
  /** Unix seconds. Injected for tests. */
  now?: () => number;
}

interface Attempt {
  closer: { close: (reason?: string) => void } | null;
  /** True once its `onclose` has fired, or once this closed it. Never closed twice. */
  closed: boolean;
  /** Whether the relay has answered this subscription: an EOSE, or an event on it. */
  answered: boolean;
  /** Says it once if the relay has not answered by then. */
  silence: ReturnType<typeof setTimeout> | undefined;
}

interface Slot {
  url: string;
  current: Attempt | null;
  /** Last state said out loud. Undefined until the first one. */
  up: boolean | undefined;
  /** What the last "down" line was about, so a different reason is still said. */
  downAs: string | undefined;
  upSince: number | null;
  failures: number;
  retry: ReturnType<typeof setTimeout> | undefined;
}

export interface RelayState {
  url: string;
  listening: boolean;
}

/**
 * The reason a pool or a relay gave for closing, from whichever shape it used. Whatever arrives
 * from a relay's `CLOSED` is wire data and may be anything at all.
 */
function reasonOf(reasons: unknown): string {
  if (Array.isArray(reasons)) {
    const first = reasons[0] as { reason?: unknown } | string | undefined;
    if (typeof first === "string") return first;
    if (first && typeof first.reason === "string") return first.reason;
  }
  if (typeof reasons === "string") return reasons;
  return "closed with no reason given";
}

function refusalOf(reason: string): string | null {
  const prefix = reason.split(":")[0]?.trim() ?? "";
  return (REFUSALS as readonly string[]).includes(prefix) ? prefix : null;
}

export class RelayListener {
  private readonly slots: Slot[];
  private readonly seen = new Map<string, number>();
  private readonly now: () => number;
  private readonly retention: number;
  private lastPrune = 0;
  private stopped = false;
  private started = false;

  constructor(private readonly opts: RelayListenerOptions) {
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
    this.retention = opts.seenRetentionSeconds ?? 3_600;
    // One slot per distinct relay. The pool normalises URLs, and two spellings of one relay
    // would be two subscriptions delivering everything twice -- the dedupe would hide it, but
    // the log would report the same relay going down twice.
    const unique = [...new Set(opts.urls)];
    this.slots = unique.map((url) => ({
      url,
      current: null,
      up: undefined,
      downAs: undefined,
      upSince: null,
      failures: 0,
      retry: undefined,
    }));
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const slot of this.slots) this.open(slot);
  }

  stop(): void {
    this.stopped = true;
    for (const slot of this.slots) {
      if (slot.retry) clearTimeout(slot.retry);
      slot.retry = undefined;
      const attempt = slot.current;
      slot.current = null;
      if (attempt) clearTimeout(attempt.silence);
      if (attempt && !attempt.closed) {
        attempt.closed = true;
        attempt.closer?.close("shutdown");
      }
    }
  }

  /** How many relays have an open subscription they have answered, right now. */
  listening(): number {
    return this.slots.filter((s) => s.up === true).length;
  }

  relays(): RelayState[] {
    return this.slots.map((s) => ({ url: s.url, listening: s.up === true }));
  }

  /**
   * A fresh filter whose `since` cannot be moved.
   *
   * nostr-tools assigns `since = lastEmitted + 1` to every filter of a subscription it
   * reconnects, where `lastEmitted` is the newest `created_at` of any EVENT frame on it, valid
   * or not. The pools here do not reconnect, but a pool handed in might, and a setter that
   * discards the write holds whichever pool it is. The getter also never reads past the present,
   * so a clock that stepped backwards cannot make the floor a future one.
   */
  private filter(): Filter {
    const floor = this.opts.since;
    const filter: Filter = { ...this.opts.filter };
    Object.defineProperty(filter, "since", {
      enumerable: true,
      configurable: true,
      get: () => (floor === undefined ? undefined : Math.min(floor, this.now())),
      set: () => {
        /* nostr-tools' reconnect rewrite, discarded on purpose -- see above. */
      },
    });
    return filter;
  }

  private open(slot: Slot): void {
    slot.retry = undefined;
    if (this.stopped) return;
    const attempt: Attempt = { closer: null, closed: false, answered: false, silence: undefined };
    const previous = slot.current;
    slot.current = attempt;
    const current = () => slot.current === attempt && !attempt.closed && !this.stopped;
    const answered = () => {
      if (!current()) return;
      attempt.answered = true;
      clearTimeout(attempt.silence);
      this.markUp(slot);
    };
    const handlers = {
      onevent: (event: Event) => {
        if (this.stopped) return;
        // An event on the subscription is the relay answering it, whether or not EOSE follows.
        if (!attempt.answered) answered();
        this.deliver(event, slot.url);
      },
      // nostr-tools calls `oneose` immediately before `onclose` when a subscription fails, in
      // the same tick. Deferred, so a refusal is never mistaken for a moment of listening.
      oneose: () => queueMicrotask(answered),
      onclose: (reasons: unknown) => {
        attempt.closed = true;
        clearTimeout(attempt.silence);
        // The previous subscription reporting the close this asked for, or the end of a stop.
        if (slot.current !== attempt || this.stopped) return;
        this.markDown(slot, reasonOf(reasons));
        this.scheduleRetry(slot);
      },
    };
    const failed = (err: unknown) => {
      if (attempt.closed) return;
      attempt.closed = true;
      if (slot.current !== attempt || this.stopped) return;
      this.markDown(slot, err instanceof Error ? err.message : String(err));
      this.scheduleRetry(slot);
    };

    if (this.opts.pool.ensureRelay) {
      this.openOwn(slot, attempt, handlers, failed);
    } else {
      try {
        attempt.closer = this.opts.pool.subscribeMany([slot.url], this.filter(), handlers);
      } catch (err: unknown) {
        failed(err);
      }
    }
    // New before old: a relay that was fine is never left without a subscription between the
    // two. Only closed if its own onclose has not fired -- closing it again is the double count.
    if (previous && !previous.closed) {
      previous.closed = true;
      clearTimeout(previous.silence);
      previous.closer?.close("relisten");
    }
  }

  /**
   * Subscribes on the relay itself rather than through the pool's `subscribeMany`.
   *
   * Two things the pool's wrapper does that cannot be undone from outside it [review: relay
   * paths]. It calls `reason.startsWith(...)` on every close, so a `CLOSED` whose reason is not a
   * string threw before the listener heard it -- the subscription was gone, nothing retried, and
   * the relay went on counting as listening. And it sets the subscription's EOSE timeout itself,
   * so nostr-tools' 4.4-second stand-in for an EOSE could not be told from a relay answering.
   */
  private openOwn(
    slot: Slot,
    attempt: Attempt,
    handlers: { onevent: (e: Event) => void; oneose: () => void; onclose: (reason: unknown) => void },
    failed: (err: unknown) => void,
  ): void {
    this.opts.pool.ensureRelay!(slot.url, { connectionTimeout: CONNECT_TIMEOUT_MS }).then(
      (relay) => {
        // Superseded or stopped while it was connecting: there is nothing to close yet, and
        // nothing should be opened.
        if (attempt.closed || slot.current !== attempt || this.stopped) return;
        try {
          // Only a real EOSE counts: the stand-in is put off as far as a timer goes, and then
          // cleared, because nostr-tools never clears it on close and a 24-day timer left behind
          // holds a process open. The field is private in nostr-tools' types and public at runtime;
          // if it is renamed, the clear does nothing and NEVER_MS still holds the rule.
          const sub = relay.subscribe([this.filter()], { ...handlers, eoseTimeout: NEVER_MS });
          clearTimeout((sub as unknown as { eoseTimeoutHandle?: ReturnType<typeof setTimeout> }).eoseTimeoutHandle);
          attempt.closer = sub;
        } catch (err: unknown) {
          failed(err);
          return;
        }
        if (attempt.closed || attempt.answered) return;
        attempt.silence = setTimeout(() => {
          if (slot.current === attempt && !attempt.closed && !attempt.answered && !this.stopped) {
            this.markSilent(slot);
          }
        }, SILENT_SECONDS * 1000);
      },
      failed,
    );
  }

  private deliver(event: Event, url: string): void {
    // Only a verified id is remembered. Unverified ones go through to the consumer, which
    // verifies and says why it dropped them, exactly as it did before this existed.
    if (verifyEvent(event)) {
      if (this.seen.has(event.id)) return;
      const at = this.now();
      this.seen.set(event.id, at);
      this.prune(at);
    }
    this.opts.onevent(event, url);
  }

  private prune(at: number): void {
    if (at - this.lastPrune < PRUNE_EVERY_SECONDS) return;
    this.lastPrune = at;
    for (const [id, seenAt] of this.seen) {
      if (at - seenAt > this.retention) this.seen.delete(id);
    }
  }

  private scheduleRetry(slot: Slot): void {
    if (this.stopped || slot.retry) return;
    const steps = RELISTEN_BACKOFF_SECONDS;
    const wait = steps[Math.min(slot.failures, steps.length - 1)] ?? RELISTEN_SECONDS;
    slot.failures++;
    slot.retry = setTimeout(() => this.open(slot), wait * 1000);
  }

  private markUp(slot: Slot): void {
    slot.upSince = this.now();
    const was = slot.up;
    slot.up = true;
    slot.downAs = undefined;
    if (was === true) return;
    console.log(`[${this.opts.label}] ${slot.url} ${was === false ? "reachable again" : "listening"}`);
    this.opts.onchange?.(this.listening(), this.slots.length);
  }

  /** Connected and subscribed, and nothing back. The subscription stays open in case it answers. */
  private markSilent(slot: Slot): void {
    const was = slot.up;
    slot.up = false;
    if (was === false && slot.downAs === "silent") return;
    slot.downAs = "silent";
    console.error(
      `[${this.opts.label}] ${slot.url} took the subscription and has not answered in ${SILENT_SECONDS}s -- ` +
        `waiting on it; ${this.opts.missing}`,
    );
    if (was !== false) this.opts.onchange?.(this.listening(), this.slots.length);
  }

  private markDown(slot: Slot, rawReason: string): void {
    if (slot.upSince !== null && this.now() - slot.upSince >= STABLE_SECONDS) slot.failures = 0;
    slot.upSince = null;
    const reason = sanitizeForLog(rawReason, 160);
    const refusal = refusalOf(rawReason);
    const as = refusal ?? "unreachable";
    const was = slot.up;
    slot.up = false;
    if (was === false && slot.downAs === as) return;
    slot.downAs = as;

    const { label, missing } = this.opts;
    if (refusal === "auth-required") {
      console.error(
        `[${label}] ${slot.url} refused the subscription: ${reason} -- this process does not do ` +
          `NIP-42 AUTH, so this relay will not deliver to it while it asks for that. Retrying; ${missing}`,
      );
    } else if (refusal) {
      console.error(`[${label}] ${slot.url} refused the subscription: ${reason} -- retrying; ${missing}`);
    } else {
      console.error(`[${label}] ${slot.url} unreachable (${reason}) -- retrying; ${missing}`);
    }
    if (was !== false) this.opts.onchange?.(this.listening(), this.slots.length);
  }
}
