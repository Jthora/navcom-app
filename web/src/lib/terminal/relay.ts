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
import { pool } from './pool';

export interface Connection {
  close(): void;
}

export type WatchStateHandler = (read: WatchStateRead) => void;

/**
 * Opens a subscription and reports every reading, including the ones that mean Dark.
 *
 * `onRead` fires immediately with an absent reading, so a terminal that never connects
 * still shows the truth rather than an empty screen or a spinner. Silence is an answer
 * here, and the answer is Dark.
 */
export function watchWatchtower(
  config: WatchtowerConfig,
  onRead: WatchStateHandler,
  opts: { staleAfterSeconds?: number } = {}
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
  let newest: { at: number; id: string } | null = null;

  let sub: { close(): void };
  try {
    sub = pool().subscribeMany(
    config.relays,
    { kinds: [KIND_WATCH_STATE], authors: [config.pubkey], limit: 1 },
    {
      onevent(event) {
        if (closed) return;
        if (newest && (event.created_at < newest.at || (event.created_at === newest.at && event.id >= newest.id))) return;
        newest = { at: event.created_at, id: event.id };
        sawEvent = true;
        onRead(
          readWatchStateAt(event.content, {
            createdAt: event.created_at,
            staleAfterSeconds: opts.staleAfterSeconds
          })
        );
      },
      oneose() {
        // The relay has sent everything it holds. If that was nothing, this is genuinely
        // absent rather than still arriving — a real signal, not a timeout guess.
        if (!closed && !sawEvent) onRead(readWatchStateAt(null));
      }
    }
  );
  } catch {
    // Never out of a screen's onMount: a throw here froze the start screen without its Distress
    // control [audit: relay paths, F01]. The reading already given stands — Dark, the safe one.
    return { close() {} };
  }

  return {
    close() {
      closed = true;
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
