/**
 * Where this phone has heard its watch, relay by relay [relay-lists §7].
 *
 * The watch-state read keeps only the newest copy across every relay, which is right for *what is
 * the watch doing* and says nothing about *where*. A watch heard on one relay of three is a watch a
 * `Distress` reaches only through that one; if it fails, nothing would hear one. This keeps, per
 * relay, what the reads this phone already makes showed, so the receipt can say *heard on 2 of 3
 * relays* before anybody relies on it [invariant 9], and the `Distress` loop can say which relays
 * that took an attempt the watch was heard on (core's `watchStateAgeMs`).
 *
 * **A relay counts as heard on** when it is one a `Distress` from this phone would go to
 * (`watchTargets()`), it answered this phone's watch-state request, its newest watch state reads
 * live — not absent, unreadable, dated more than two minutes ahead, older than
 * five minutes, or the watch's own Dark — no relay holds a published Dark newer than it, and it did
 * not refuse this phone's last signal. On a box given its hearing file (§6), that is where whoever
 * holds the watch hears a `Distress`; a box without one fails its own `--check` until it has it. It
 * counts relays, never people.
 *
 * **Memory only.** Nothing here reaches storage, IndexedDB or a backup, and nothing opens at
 * import: what each relay showed is a fact about tonight's network, and a searched phone should
 * not carry a map of where its watch is heard. A panic wipe clears it.
 *
 * It opens no read of its own except {@link heard.read}, which the session calls when a
 * `Distress` starts, on the relays the `Distress` goes to: it tells them nothing the `Distress`
 * does not. Status and sign-on feed it from the read they already make (`relay.ts`).
 */

import {
  KIND_WATCH_STATE,
  readWatchStateAt,
  type DistressPhase,
  type PublishResult,
  type RelayReason
} from '@navcom/core';
import { loadConfig } from './config';
import { relayLine, type HeardState } from './heard-copy';
import { reachableRelay } from './relay-url';
import { subscribeLive } from './subscribe';
import { watchTargets, watchWithheld } from './watch-targets';

/** What a relay reader hands over: each watch state with the relay it came from, and how it went. */
export interface RelaySink {
  /** A `10910` from this watch, arriving from `url`: first, or again from another relay. */
  arrived(url: string, event: { id: string; pubkey: string; kind: number; created_at: number; content: string }): void;
  /** The relays whose current subscription has answered, each time that changes. */
  listening(urls: readonly string[]): void;
  /** Every relay has first answered or failed: the read has a verdict. */
  settled(answered: number): void;
}

/** One relay the count is counted against, and what it showed. */
export interface HeardRelay {
  url: string;
  /** It counts. */
  heard: boolean;
  state: HeardState;
  /** Seconds since its newest watch state was signed, where it holds one. */
  ageSeconds: number | null;
  /** Its answer to this phone's last signal, where that was a refusal. */
  refused: string | null;
  /** Its line in the receipt's `Why`. */
  text: string;
}

/** The count, as of one moment. */
export interface Heard {
  /** How many relays a `Distress` from this phone would go to. */
  of: number;
  /** Which of them the watch is heard on. */
  on: string[];
  relays: HeardRelay[];
  /** The watch's relays nothing is sent to, with core's reason. */
  withheld: RelayReason[];
  /** Whether any read has had a verdict since this app opened. Until then there is no count. */
  asked: boolean;
  /**
   * Whether the count is known: a read has had its verdict and some relay counted against answered
   * this phone. A read where none did is this phone unable to ask -- offline, or every relay failing
   * -- and its count is unknown, never zero [invariant 7]. "Heard nowhere" with "if the watch moved"
   * would give somebody the wrong fix.
   */
  known: boolean;
}

/** The count this phone last held, and when it was read. */
export interface HeldCount {
  /** How many it was heard on; null when no relay answered this phone, so it could not ask. */
  on: number | null;
  of: number;
  atMs: number;
}

interface State {
  at: number;
  id: string;
  content: string;
  receivedMs: number;
}

interface Seen {
  /** The newest `10910` from the watch this relay has served, by `created_at` and then the lower id. */
  state: State | null;
  /** When this phone's watch-state request was first answered there. */
  answeredMs: number | null;
  /** Its answer to this phone's last signal, when that answer was no. */
  refused: { reason: string; atMs: number } | null;
}

const seen = new Map<string, Seen>();
/** Whose watch the record is about. Another watch's key starts it over. */
let watchKey: string | null = null;
let version = $state(0);
let asked = $state(false);
let last = $state<(HeldCount & { watch: string | null }) | null>(null);

/** One spelling per relay, as `usable()` gives it, so a reader and a publish land in one place. */
function key(url: string): string {
  try {
    return reachableRelay(url) ?? String(url).trim();
  } catch {
    return String(url);
  }
}

function entry(url: string): Seen {
  const k = key(url);
  let s = seen.get(k);
  if (!s) {
    s = { state: null, answeredMs: null, refused: null };
    seen.set(k, s);
  }
  return s;
}

/** Newer by `created_at`, then the lower id: NIP-01's tie-break, as the watch-state read keeps it. */
const newer = (a: { at: number; id: string }, b: { at: number; id: string }): boolean =>
  a.at > b.at || (a.at === b.at && a.id < b.id);

/** The watch's own word that nobody holds it, read at the moment it was signed. */
function saysDark(s: State): boolean {
  const r = readWatchStateAt(s.content, { createdAt: s.at, now: s.at });
  return r.reason === null && r.dark;
}

/** The newest Dark the watch has published on any relay this phone has read. */
function newestDark(): State | null {
  let out: State | null = null;
  for (const s of seen.values()) {
    if (s.state && saysDark(s.state) && (!out || newer(s.state, out))) out = s.state;
  }
  return out;
}

function classify(s: Seen | undefined, nowS: number, dark: State | null): { state: HeardState; ageSeconds: number | null } {
  if (!s || (s.answeredMs === null && !s.state)) return { state: 'unanswered', ageSeconds: null };
  const held = s.state;
  if (!held) return { state: 'none', ageSeconds: null };
  const ageSeconds = nowS - held.at;
  const r = readWatchStateAt(held.content, { createdAt: held.at, now: nowS });
  if (r.reason === 'clock') return { state: 'ahead', ageSeconds };
  if (r.reason === 'stale') return { state: 'stale', ageSeconds };
  if (r.reason !== null) return { state: 'corrupt', ageSeconds };
  if (r.dark) return { state: 'dark', ageSeconds };
  if (dark && newer(dark, held)) return { state: 'superseded', ageSeconds };
  return { state: 'heard', ageSeconds };
}

/** The watch this phone was given, or null. Never throws. */
function configured(): string | null {
  try {
    return loadConfig()?.pubkey ?? null;
  } catch {
    return null;
  }
}

function clear(pubkey: string | null): void {
  seen.clear();
  watchKey = pubkey;
  asked = false;
  last = null;
  version += 1;
}

/** Makes the record about the watch this phone was given now, before a signal's answer goes in. */
function adopt(): boolean {
  const pubkey = configured();
  if (!pubkey) return false;
  if (watchKey !== pubkey) clear(pubkey);
  return true;
}

/** Something in the record changed: the count is read again, with the moment it was read. */
function changed(): void {
  version += 1;
  if (!asked) return;
  const h = count(Date.now());
  last = { on: h.known ? h.on.length : null, of: h.of, atMs: Date.now(), watch: watchKey };
}

function count(nowMs: number): Heard {
  let targets: string[] = [];
  let withheld: RelayReason[] = [];
  try {
    targets = watchTargets();
    withheld = watchWithheld();
  } catch {
    // No watch this phone can read: nothing to count against.
  }
  // A record about another watch is not this one's.
  const mine = watchKey !== null && watchKey === configured();
  const nowS = Math.floor(nowMs / 1000);
  const dark = mine ? newestDark() : null;
  const relays = targets.map((url): HeardRelay => {
    const s = mine ? seen.get(key(url)) : undefined;
    const { state, ageSeconds } = classify(s, nowS, dark);
    const refused = s?.refused?.reason ?? null;
    return {
      url,
      heard: state === 'heard' && refused === null,
      state,
      ageSeconds,
      refused,
      text: relayLine({ url, state, ageSeconds, refused })
    };
  });
  const verdict = mine && asked;
  return {
    of: targets.length,
    on: relays.filter((r) => r.heard).map((r) => r.url),
    relays,
    withheld,
    asked: verdict,
    known: verdict && relays.some((r) => r.state !== 'unanswered')
  };
}

export const heard = {
  /**
   * Where a reader of this watch's state hands what it hears.
   *
   * A different watch's key than the record holds starts the record over. A sink handed out for
   * one watch writes nothing once the record is about another. Nothing it is told throws.
   */
  sink(pubkey: string): RelaySink {
    if (watchKey !== pubkey) clear(pubkey);
    const ours = () => watchKey === pubkey;
    return {
      arrived(url, event) {
        try {
          if (!ours() || !event || event.kind !== KIND_WATCH_STATE || event.pubkey !== pubkey) return;
          if (typeof event.created_at !== 'number' || typeof event.id !== 'string') return;
          const s = entry(url);
          const now = Date.now();
          s.answeredMs ??= now;
          const state: State = { at: event.created_at, id: event.id, content: String(event.content ?? ''), receivedMs: now };
          if (!s.state || newer(state, s.state)) s.state = state;
          changed();
        } catch {
          /* a reader's callback: never thrown into a screen */
        }
      },
      listening(urls) {
        try {
          if (!ours()) return;
          let any = false;
          for (const url of urls) {
            const s = entry(url);
            if (s.answeredMs === null) {
              s.answeredMs = Date.now();
              any = true;
            }
          }
          if (any) changed();
        } catch {
          /* as above */
        }
      },
      // How many answered is read from the record, relay by relay: a verdict of none is a verdict, and
      // the count then says it could not ask rather than that the watch is heard nowhere.
      settled() {
        try {
          if (!ours()) return;
          asked = true;
          changed();
        } catch {
          /* as above */
        }
      }
    };
  },

  /**
   * Reads the watch's state on `targets`, into the record, until closed.
   *
   * For a running `Distress`, opened when it starts and only where it goes: the read tells those
   * relays nothing the `Distress` does not. Never throws; a read that cannot open closes nothing.
   */
  read(targets: readonly string[], pubkey: string): { close(): void } {
    const into = heard.sink(pubkey);
    try {
      const sub = subscribeLive(targets, { kinds: [KIND_WATCH_STATE], authors: [pubkey], limit: 1 }, {
        onevent: (event, url) => into.arrived(url, event),
        onrepeat: (event, url) => into.arrived(url, event),
        onlisten: (urls) => into.listening(urls),
        oneose: (answered) => into.settled(answered)
      });
      return {
        close() {
          try {
            sub.close();
          } catch {
            /* already gone */
          }
        }
      };
    } catch {
      return { close() {} };
    }
  },

  /** Each relay's answer to this phone's signal: a refusal is kept against it, anything else clears one. */
  answered(result: PublishResult | null | undefined): void {
    try {
      if (!result || !adopt()) return;
      const now = Date.now();
      for (const a of result.answers ?? []) {
        entry(a.url).refused = !a.ok && a.failure === 'refused' ? { reason: a.reason, atMs: now } : null;
      }
      changed();
    } catch {
      /* the signal is out either way */
    }
  },

  /** A `Distress` attempt's account: took clears a refusal, refused sets one, the rest clear. */
  accounted(p: Extract<DistressPhase, { phase: 'accounted' }>): void {
    try {
      if (!adopt()) return;
      const now = Date.now();
      for (const url of p.took) entry(url).refused = null;
      for (const r of p.refused) entry(r.url).refused = { reason: r.reason, atMs: now };
      for (const r of [...p.unconfirmed, ...p.unreached]) entry(r.url).refused = null;
      changed();
    } catch {
      /* as above */
    }
  },

  /**
   * Milliseconds since the newest watch state `url` served was signed, for core's
   * `watchStateAgeMs`: only where it reads live and no newer Dark has been published anywhere.
   * Null otherwise. A refusal is not folded in: the account it feeds is fed back here after.
   */
  stateAgeMs(url: string, nowMs: number = Date.now()): number | null {
    const held = seen.get(key(url))?.state;
    if (!held) return null;
    if (readWatchStateAt(held.content, { createdAt: held.at, now: Math.floor(nowMs / 1000) }).dark) return null;
    const dark = newestDark();
    if (dark && newer(dark, held)) return null;
    return nowMs - held.at * 1000;
  },

  /** The count as of `nowMs`, over `watchTargets()`. Reactive: it reads the record's version. */
  now(nowMs: number = Date.now()): Heard {
    void version;
    return count(nowMs);
  },

  /** The count this phone last held and when it read it, or null with nothing read since it opened. */
  get last(): HeldCount | null {
    const held = last;
    if (!held || held.watch === null || held.watch !== configured()) return null;
    return { on: held.on, of: held.of, atMs: held.atMs };
  },

  get version(): number {
    return version;
  },

  get asked(): boolean {
    return asked;
  },

  /** Whether the count is known now: see {@link Heard.known}. Reactive. */
  get known(): boolean {
    void version;
    return count(Date.now()).known;
  },

  /** A panic wipe: everything this phone saw of where its watch is heard, gone. */
  forget(): void {
    clear(null);
  }
};
