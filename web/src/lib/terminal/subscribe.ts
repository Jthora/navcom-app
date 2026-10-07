/**
 * A subscription that stays open while the screen that asked for it does.
 *
 * **The pool does not reconnect, and turning that on is not the fix** [audit: relay paths, F19].
 * A subscription on the shared pool ended for good the first time its socket dropped — a network
 * handoff, a lock screen, a tunnel — while its screen went on showing the last thing it heard as
 * if it were current. Status and Watch stay open for hours, so that was the ordinary case.
 * nostr-tools' own reconnect is no answer on its own: on an iPhone the socket reports an error
 * before it closes and the library then skips reconnecting, and where it does reconnect it asks
 * only for events newer than the newest it has seen — a number a single future-dated event moves.
 *
 * So the app does it, the way the escalation executor does on the box: one subscription per
 * relay, each reopened with a fresh filter after a short wait that doubles to thirty seconds, and
 * every closed one reopened at once when the phone comes back online or back to the screen. The
 * same event from two relays, or from a reopened one, reaches the caller once.
 *
 * `oneose` is called when every relay has first answered or failed, with how many answered — and,
 * if that was none, once more when one first does: nobody answering is not nothing there [audit:
 * relay paths, F20]. Nothing is said after `close()`: a screen that moved on to another area must
 * not be told about the one it left [review: relay paths].
 *
 * ## What counts as a relay answering [review: relay paths]
 *
 * **A real end-of-stored-events, or an event. Nothing else.** nostr-tools fires its own stand-in
 * for an EOSE 4.4 seconds after a request nobody answered, and this counted it: a hung relay, or a
 * socket the phone had lost signal on and not yet noticed, read as a relay that had answered with
 * nothing, so Find said *None here* and Status *Nothing from this watch* when the truth was that
 * this phone could not ask. The stand-in is switched off. A relay that takes the subscription and
 * says nothing for {@link SILENT_MS} counts as not answering, and the subscription is left open in
 * case it does.
 *
 * **The subscription is the relay's own, not the pool's.** The pool's wrapper reads every close
 * reason with `reason.startsWith(...)`, so a relay that closed a subscription with a reason that is
 * not a string — `null`, or the `{}` a JavaScript relay makes of an Error — threw there, and the
 * subscription was gone with nothing told: never reopened, for as long as the screen was open. The
 * box's listener was moved for the same reason (`relay-listener.ts`). A pool that cannot hand over
 * its relays, as the test stand-ins cannot, is still subscribed through `subscribeMany`.
 *
 * **The wait starts over only after a relay has really answered** and stayed answering for a
 * minute — or, for a relay that could not be reached at all, when the phone comes back online or
 * to the screen, since the network that failed it may be back. nostr-tools reports every failure
 * as an end-of-answer and a close in the same moment, and the wait used to be reset by the first
 * half: a relay that was down, or that refused, was asked again every second for as long as the
 * screen was open. A wake asks a relay that refused again at once as well, but keeps its wait: it
 * is no more willing because somebody looked at the phone, and a holder glances at one often.
 *
 * **A burn ends it for good** — nothing reopens through a pool a burn has finished (`pool.ts`).
 */
import type { Event } from 'nostr-tools/core';
import type { Filter } from 'nostr-tools/filter';
import { pool } from './pool';
import { usable } from './relay-url';

export interface LiveParams {
  /** Each event once, with the relay it first arrived from. */
  onevent: (event: Event, url: string) => void;
  /** An event already delivered, arriving from a relay again: where else it was heard. */
  onrepeat?: (event: Event, url: string) => void;
  /**
   * After every relay has first answered or failed: how many of them answered. Called a second
   * time, with one, only if that was none and a relay answers later.
   */
  oneose?: (answered: number) => void;
  /** The relays it is listening on, as `listening()` gives them, each time that changes. */
  onlisten?: (listening: string[]) => void;
}

export interface LiveSubscription {
  close(): void;
  /**
   * The relays whose current subscription has answered — a real EOSE, or an event — and has not
   * closed since. A relay that refused it, dropped it, or holds it without a word is not here.
   *
   * With `heldFor`, only those whose subscription answered at least that many milliseconds ago and
   * has stayed open since: a relay that answers and drops again a moment later is never one.
   */
  listening(heldFor?: number): string[];
  /** The relays not yet heard from at all: neither answered nor failed since this was opened. */
  pending(): string[];
  /**
   * Moves to another list of relays. Relays on both lists keep their subscription as it is; new
   * ones are asked as soon as their connection is up, and dropped ones are let go at once — so
   * for a new relay's handshake, a whole-list change has nothing listening on either.
   */
  follow(urls: readonly string[]): void;
}

const FIRST_WAIT = 1_000;
const LONGEST_WAIT = 30_000;
/**
 * How long a subscription has to have stayed answered for its next failure to start the wait from
 * the beginning again. Without it, a relay that answers and drops straight away would be asked
 * again every second, for ever. The box uses the same minute.
 */
const STABLE_MS = 60_000;
/** How long a relay may hold a subscription without answering before it counts as not answering. */
export const SILENT_MS = 10_000;
/** nostr-tools' own connection timeout, for the connections asked for here. */
const CONNECT_MS = 3_000;
/** nostr-tools' longest timer, as the EOSE timeout: its stand-in for an EOSE never fires. */
const NEVER_MS = 2_147_483_647;
/** Ids remembered for dropping repeats: enough for any screen, bounded for a flood. */
const SEEN_MAX = 5_000;

/**
 * Whether a burn has finished the pool this subscribes through. Read off the pool, not imported:
 * see `AppPool` in `pool.ts`.
 */
const burned = (): boolean => (pool() as { burned?: unknown }).burned === true;

/**
 * A connection asked for and then not used is closed after the pool's idle time, as it would have
 * been had a subscription been opened on it and closed [review: relay paths].
 *
 * nostr-tools arms that close only when an operation on a connection ends, and a connection that
 * came up after its screen had moved on had no operation to end: nothing was subscribed on it, so
 * it stayed open, pinged every 29 seconds, until the page was reloaded. Leaving Find before a slow
 * relay finished its handshake was enough, and so was dropping that relay from the list. The
 * library's own timer looks again before it closes anything, so a connection another screen has
 * started using in the meantime stays up. Both members are public at runtime and private in the
 * types; a pool that has neither, as the test stand-ins have not, is left as it is.
 */
function release(relay: unknown): void {
  const r = relay as { connected?: boolean; ongoingOperations?: number; idleSince?: number; scheduleIdleClose?: () => void };
  if (!r.connected || r.ongoingOperations !== 0 || typeof r.scheduleIdleClose !== 'function') return;
  r.idleSince ||= Date.now();
  r.scheduleIdleClose();
}

interface Attempt {
  sub: { close(): void } | null;
  /** Its own close has been heard, its connection failed, or this closed it. Never closed twice. */
  closed: boolean;
  /** The relay answered it: a real EOSE, or an event on it. */
  answered: boolean;
  answeredAt: number;
  silence: ReturnType<typeof setTimeout> | null;
}

interface Slot {
  url: string;
  current: Attempt | null;
  wait: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** Its last attempt was ended by the relay itself, over a connection that stayed up. */
  refused: boolean;
}

export function subscribeLive(urls: readonly string[], filters: Filter | Filter[], params: LiveParams): LiveSubscription {
  const list = Array.isArray(filters) ? filters : [filters];
  const relays = list.length > 0 ? usable(urls) : [];

  if (burned()) {
    // Nobody will be asked, and the screen is told so rather than left waiting.
    params.oneose?.(0);
    return { close() {}, listening: () => [], pending: () => [], follow() {} };
  }

  let stopped = false;

  const seen = new Set<string>();
  const deliver = (event: Event, url: string) => {
    if (stopped) return;
    if (seen.has(event.id)) {
      params.onrepeat?.(event, url);
      return;
    }
    seen.add(event.id);
    if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value!);
    params.onevent(event, url);
  };

  /*
   * Once every relay has answered or failed, the caller is told how many have answered — counting
   * one that failed, reopened and answered while a slower one was still trying. If none had, the
   * caller is told again the first time one does: "nobody answered" must not stay on a screen
   * after somebody has, saying the opposite of "nothing there" for as long as it is open.
   */
  const pending = new Set(relays);
  const answered = new Set<string>();
  let told: number | null = null;
  const verdict = () => {
    if (stopped) return;
    if (told === null ? pending.size === 0 : told === 0 && answered.size > 0) {
      told = answered.size;
      params.oneose?.(told);
    }
  };
  const settled = (url: string, ok: boolean) => {
    if (stopped) return;
    if (ok) answered.add(url);
    pending.delete(url);
    verdict();
  };

  const live = new Map<string, Slot>();

  const listening = (heldFor = 0) => {
    const now = Date.now();
    return [...live.values()]
      .filter((s) => s.current && !s.current.closed && s.current.answered && now - s.current.answeredAt >= heldFor)
      .map((s) => s.url);
  };
  let said: string[] = [];
  const changed = () => {
    if (stopped) return;
    const now = listening();
    if (now.length === said.length && now.every((u, i) => u === said[i])) return;
    said = now;
    params.onlisten?.(now);
  };

  const open = (slot: Slot) => {
    slot.timer = null;
    if (stopped || live.get(slot.url) !== slot) return;
    if (burned()) return end();

    const attempt: Attempt = { sub: null, closed: false, answered: false, answeredAt: 0, silence: null };
    const previous = slot.current;
    slot.current = attempt;
    const current = () => !stopped && slot.current === attempt && !attempt.closed;
    const quiet = () => {
      if (attempt.silence) clearTimeout(attempt.silence);
      attempt.silence = null;
    };

    const answer = () => {
      if (!current() || attempt.answered) return;
      attempt.answered = true;
      attempt.answeredAt = Date.now();
      quiet();
      // Listening is said before the verdict, so a caller never reads "everyone answered, and
      // nobody is listening" in between.
      changed();
      settled(slot.url, true);
    };
    /**
     * Closed by the relay or the socket, or a connection that never came up. `byRelay` when the
     * relay ended it over a connection that is still up: a refusal, which no wake can mend.
     */
    const lost = (byRelay = false) => {
      if (attempt.closed) return;
      attempt.closed = true;
      quiet();
      if (stopped || slot.current !== attempt) return;
      if (attempt.answered && Date.now() - attempt.answeredAt >= STABLE_MS) slot.wait = FIRST_WAIT;
      slot.refused = byRelay;
      settled(slot.url, false);
      if (attempt.answered) changed();
      later(slot);
    };
    /** The connection the subscription went out on, once there is one. */
    let connection: { connected?: boolean } | null = null;
    const handlers = {
      onevent: (event: Event) => {
        if (stopped) return;
        // An event on the subscription is the relay answering it, whether or not EOSE follows.
        if (!attempt.answered) answer();
        deliver(event, slot.url);
      },
      // The pool reports a failed connection as an end-of-answer and a close in the same moment,
      // and a relay that answered with only the first. So this waits a microtask to see which.
      oneose: () => queueMicrotask(answer),
      // Any reason at all, including none: what a relay puts in a CLOSED is not checked here.
      // Whether the connection was still up is: nostr-tools marks one that went down as gone
      // before it closes what was on it, so a close over a live connection is the relay's own.
      onclose: () => lost(connection?.connected === true)
    };
    /** Said once if the relay holds the subscription without a word; it stays open in case. */
    const listen = () => {
      if (!current() || attempt.answered) return;
      attempt.silence = setTimeout(() => {
        attempt.silence = null;
        if (current() && !attempt.answered) settled(slot.url, false);
      }, SILENT_MS);
    };

    /** An address the pool cannot open fails the same way every time: said once, not retried. */
    const refused = () => {
      attempt.closed = true;
      settled(slot.url, false);
    };

    const p = pool();
    if (typeof p.ensureRelay === 'function') {
      let connecting: ReturnType<typeof p.ensureRelay>;
      try {
        connecting = p.ensureRelay(slot.url, { connectionTimeout: CONNECT_MS });
      } catch {
        return refused();
      }
      connecting.then((relay) => {
        // Closed, moved on or stopped while it was connecting: nothing is subscribed, and the
        // connection is let go of rather than left open for nobody.
        if (!current()) return release(relay);
        // Connected a moment ago and gone again: a subscription now would never be told it ended.
        if (!relay.connected) return lost();
        connection = relay;
        try {
          // Each attempt its own filters, which nothing a relay sends can rewrite.
          const sub = relay.subscribe(list.map((f) => ({ ...f })), { ...handlers, eoseTimeout: NEVER_MS });
          // nostr-tools never clears this on close, and a 24-day timer left behind holds nothing
          // useful. Private in its types and public at runtime; NEVER_MS holds the rule either way.
          clearTimeout((sub as unknown as { eoseTimeoutHandle?: ReturnType<typeof setTimeout> }).eoseTimeoutHandle);
          attempt.sub = sub;
        } catch {
          return lost();
        }
        listen();
      }, () => lost());
    } else {
      try {
        attempt.sub =
          list.length === 1
            ? p.subscribeMany([slot.url], list[0]!, handlers)
            : p.subscribeMap(list.map((filter) => ({ url: slot.url, filter })), handlers);
      } catch {
        return refused();
      }
      listen();
    }

    // Anything still open from before is let go. Only closed if its own close has not been heard:
    // closing it again counts the close twice in nostr-tools, and the connection under every other
    // screen goes with it.
    if (previous && !previous.closed) {
      previous.closed = true;
      if (previous.silence) clearTimeout(previous.silence);
      try {
        previous.sub?.close();
      } catch {
        /* already gone */
      }
    }
  };

  const later = (slot: Slot) => {
    if (stopped || slot.timer || live.get(slot.url) !== slot) return;
    if (burned()) return end();
    const wait = slot.wait;
    slot.wait = Math.min(wait * 2, LONGEST_WAIT);
    slot.timer = setTimeout(() => open(slot), wait);
  };

  /**
   * Back online, or back to the screen: anything closed is reopened now, not after its wait.
   *
   * A relay that could not be reached starts from the shortest wait again, because the network
   * that failed it may be back and a listener for a `Distress` should not sit out thirty seconds
   * for one attempt made a moment too early. A relay that refused keeps its wait: it is asked once
   * more for each wake, not every second again from the start [review: relay paths].
   */
  const wake = () => {
    if (stopped || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
    if (burned()) return end();
    for (const slot of live.values()) {
      // Listening, or still connecting.
      if (slot.current && !slot.current.closed) continue;
      if (slot.timer) clearTimeout(slot.timer);
      slot.timer = null;
      if (!slot.refused) slot.wait = FIRST_WAIT;
      open(slot);
    }
  };
  const win = typeof window !== 'undefined' ? window : null;
  const doc = typeof document !== 'undefined' ? document : null;
  win?.addEventListener('online', wake);
  doc?.addEventListener('visibilitychange', wake);

  /** Lets go of one relay: its timer, and its subscription unless that has already closed. */
  const shut = (slot: Slot) => {
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    const attempt = slot.current;
    slot.current = null;
    if (!attempt) return;
    if (attempt.silence) clearTimeout(attempt.silence);
    attempt.silence = null;
    if (attempt.closed) return;
    attempt.closed = true;
    try {
      attempt.sub?.close();
    } catch {
      /* already gone */
    }
  };

  function end() {
    if (stopped) return;
    stopped = true;
    win?.removeEventListener('online', wake);
    doc?.removeEventListener('visibilitychange', wake);
    for (const slot of live.values()) shut(slot);
  }

  const slot = (url: string): Slot => ({ url, current: null, wait: FIRST_WAIT, timer: null, refused: false });
  for (const url of relays) live.set(url, slot(url));
  for (const s of [...live.values()]) open(s);
  if (relays.length === 0) {
    told = 0;
    params.oneose?.(0);
  }

  return {
    close: end,
    listening,
    pending: () => (stopped ? [] : [...pending]),
    follow(next) {
      if (stopped) return;
      const want = list.length > 0 ? usable(next) : [];
      const added = want.filter((url) => !live.has(url));
      const gone = [...live.keys()].filter((url) => !want.includes(url));
      for (const url of added) {
        const s = slot(url);
        live.set(url, s);
        if (told === null) pending.add(url);
        open(s);
      }
      for (const url of gone) {
        const s = live.get(url)!;
        live.delete(url);
        shut(s);
        pending.delete(url);
      }
      verdict();
      changed();
    }
  };
}
