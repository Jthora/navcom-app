/**
 * Watch state, as the terminal sees it.
 *
 * Dark is the starting value and the fallback, never a placeholder: a terminal that has not
 * connected genuinely has no watch, and saying so is the honest answer rather than a
 * holding message.
 */

import { readWatchStateAt, type RootAlarm, type WatchStateRead } from '@navcom/core';
import { loadConfig } from './config';
import { watchWatchtower, type Connection } from './relay';
import { recordRoot, rootAlarms } from './roots';

/**
 * The last holder this device actually saw, and who to tell when it changes.
 *
 * **Not cleared by a Dark read.** A handover is normally holder A, then a moment of Dark
 * while nobody has taken it up, then holder B — and treating that gap as "no previous
 * holder" would swallow exactly the change worth reacting to.
 */
let knownHolder: string | null = null;
let onHandover: (() => void) | null = null;

/**
 * Registers what to do when the watch changes hands.
 *
 * The board is rebuilt by whoever holds it, from signals they hear themselves — nobody
 * hands a board over, because nobody holds anybody else's picture. So the incoming watch
 * starts empty, and the way it fills is that **operators say they are out again**, which is
 * what this exists to trigger.
 *
 * Deliberately not the other design. Passing the outgoing holder's board to the incoming
 * one would make the new watch's picture a thing it was told rather than a thing it
 * derived, and that is the property this whole system is built to avoid.
 */
export function whenWatchChangesHands(cb: () => void): void {
  onHandover = cb;
}

let read = $state<WatchStateRead>(readWatchStateAt(null));
/** No relay answered: this phone could not ask, which is not the same as nothing published. */
let unanswered = $state(false);
let connected = $state(false);
let alarms = $state<RootAlarm[]>([]);
let connection: Connection | null = null;

export const watch = {
  get read(): WatchStateRead {
    return read;
  },
  get state() {
    return read.state;
  },
  /** True once a subscription is open — not that a watch exists. */
  get connected(): boolean {
    return connected;
  },

  /** Whether the Dark being shown is because no relay answered at all [audit: relay paths, F20]. */
  get unanswered(): boolean {
    return unanswered;
  },

  /**
   * Contradictions this device has seen in what the watch published about its own log.
   *
   * Never cleared. A watch that rewrote history cannot make both of its published roots
   * true, and the operator holding the pair is the only party who can say so.
   */
  get alarms(): RootAlarm[] {
    return alarms;
  },

  /** Starts watching, if this terminal has been given a Watchtower. */
  start(): void {
    const config = loadConfig();
    if (!config) return;
    connection?.close();
    alarms = rootAlarms();
    connection = watchWatchtower(config, (r, heard) => {
      read = r;
      // Said when the relays were asked; any reading that came from an event means one answered.
      unanswered = heard ? heard.unanswered : false;

      const holder = r.dark ? null : r.state.holder;
      if (holder) {
        if (knownHolder !== null && holder !== knownHolder) onHandover?.();
        knownHolder = holder;
      }
      // Only a live read tells us anything about the log. A Dark read means we could not
      // reach the watch, which is not the same as a watch that stopped committing.
      if (!r.dark) {
        recordRoot(r.state.log_root);
        alarms = rootAlarms();
      }
    });
    connected = true;
  },

  stop(): void {
    connection?.close();
    connection = null;
    connected = false;
    unanswered = false;
    read = readWatchStateAt(null);
  }
};
