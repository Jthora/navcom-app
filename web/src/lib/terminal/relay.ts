/**
 * The terminal's connection to a Watchtower.
 *
 * Subscribes to the watch state and nothing else, for now. The important behaviour is not
 * the subscribe — it is what happens when nothing arrives, or when what arrives is old.
 *
 * `10910` is a **replaceable** kind, so a relay keeps serving the daemon's last published
 * copy long after the daemon has died. A client that treats "I got an event" as "there is a
 * watch" will tell an operator a human is watching when nothing is running. Found by the
 * daemon running against a real relay, and the reason `readWatchStateAt` needs an age it
 * cannot infer for itself.
 */

import { KIND_WATCH_STATE, readWatchStateAt, type WatchStateRead } from '@navcom/core';
import type { WatchtowerConfig } from './config';
import type { RelaySink } from './heard.svelte';
import { subscribeLive } from './subscribe';

export interface Connection {
  close(): void;
}

/**
 * `heard.unanswered` is set when no relay answered at all: this phone could not ask, which is a
 * different thing from the watch having published nothing [audit: relay paths, F20].
 */
export type WatchStateHandler = (read: WatchStateRead, heard?: { unanswered: boolean }) => void;

/** How often a held reading is aged again, so a screen left open goes Dark once it is stale. */
const REREAD_MS = 30_000;

/**
 * Opens a subscription and reports every reading, including the ones that mean Dark.
 *
 * `onRead` fires immediately with an absent reading, so a terminal that never connects
 * still shows the truth rather than an empty screen or a spinner. Silence is an answer
 * here, and the answer is Dark.
 *
 * `sink` is told each relay's own copy as well, with the relay it came from, and which relays
 * have answered [relay-lists §7]: the reading here is the newest across all of them, and says
 * nothing about where the watch was heard. Every relay the watch names is read, mission relays
 * included; only the ones a `Distress` goes to are counted, and that is the sink's to decide.
 */
export function watchWatchtower(
  config: WatchtowerConfig,
  onRead: WatchStateHandler,
  opts: { staleAfterSeconds?: number; sink?: RelaySink } = {}
): Connection {
  onRead(readWatchStateAt(null));

  let closed = false;

  let sawEvent = false;

  /*
   * Newest wins [audit: relay paths, F11]. Each relay serves its own last copy of this
   * replaceable event, and they need not agree: a stand-down's Dark that reached one relay and
   * not the other left the other serving the old Station. Applied in arrival order, whichever
   * relay answered last decided — so a dark watch could read "On station". The NIP-01 tie-break
   * settles two copies from the same second, the way `--check` already does.
   */
  let newest: { at: number; id: string; content: string } | null = null;
  const reread = () =>
    newest && onRead(readWatchStateAt(newest.content, { createdAt: newest.at, staleAfterSeconds: opts.staleAfterSeconds }));

  /** Tells the sink, which must never take the reading down with it. */
  const tell = (fn: (sink: RelaySink) => void) => {
    if (closed || !opts.sink) return;
    try {
      fn(opts.sink);
    } catch {
      /* the count is the sink's; the reading goes on */
    }
  };

  let sub: { close(): void };
  try {
    sub = subscribeLive(
    config.relays,
    { kinds: [KIND_WATCH_STATE], authors: [config.pubkey], limit: 1 },
    {
      onevent(event, url) {
        if (closed) return;
        tell((sink) => sink.arrived(url, event));
        if (newest && (event.created_at < newest.at || (event.created_at === newest.at && event.id >= newest.id))) return;
        newest = { at: event.created_at, id: event.id, content: event.content };
        sawEvent = true;
        reread();
      },
      // The same copy from a second relay: the reading has it, and the sink learns it was there too.
      onrepeat(event, url) {
        tell((sink) => sink.arrived(url, event));
      },
      onlisten(urls) {
        tell((sink) => sink.listening(urls));
      },
      oneose(answered) {
        tell((sink) => sink.settled(answered));
        // Every relay has answered or failed. Nothing heard from any that answered is genuinely
        // absent; no relay answering at all is this phone being unable to ask. Called again if a
        // relay answers after none did, which turns the second reading into the first.
        if (!closed && !sawEvent) onRead(readWatchStateAt(null), { unanswered: answered === 0 });
      }
    }
  );
  } catch {
    // Never out of a screen's onMount: a throw here froze the start screen without its Distress
    // control [audit: relay paths, F01]. The reading already given stands — Dark, the safe one.
    return { close() {} };
  }

  /*
   * Aged on the screen, not only on arrival [invariant 7]. A reading was judged once, when it
   * arrived, so a Status screen left open showed "On station" for as long as nothing new came —
   * which, with the subscription dead, was forever.
   */
  const aging = setInterval(() => !closed && reread(), REREAD_MS);

  return {
    close() {
      closed = true;
      clearInterval(aging);
      try {
        sub.close();
        // The subscription, not the connection. Closing the connection here used to be
        // harmless because this module owned its own pool; against the shared one it would
        // drop the socket every other module is still reading from.
      } catch {
        // Closing a pool that never opened is not an error worth surfacing.
      }
    }
  };
}
