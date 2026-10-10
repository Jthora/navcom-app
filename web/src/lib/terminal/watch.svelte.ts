/**
 * Watch state, as the terminal sees it.
 *
 * Dark is the starting value and the fallback, never a placeholder: a terminal that has not
 * connected genuinely has no watch, and saying so is the honest answer rather than a
 * holding message.
 */

import { readWatchStateAt, type LogRoot, type RootAlarm, type WatchStateRead } from '@navcom/core';
import { loadConfig } from './config';
import { watchWatchtower, type Connection } from './relay';
import { heard } from './heard.svelte';
import { recordRoot, rootAlarms, seenRoots } from './roots';

/**
 * Whether a published root says nothing the device's record does not already hold.
 *
 * A null root raises "stopped" every time it is read, because the null is never recorded — so the
 * same stop was appended again with every reading: each heartbeat, each screen that started the
 * watch, and since readings are aged on screen, every thirty seconds, into a record only a burn
 * clears [audit: relay paths, review]. A stop is recorded once, against the root it stopped at;
 * one that follows a newer root is a new stop and is recorded again.
 */
function restated(root: LogRoot | null): boolean {
  const last = seenRoots().at(-1);
  if (root) return !!last && last.root === root.root && last.size === root.size;
  if (!last) return true;
  const said = rootAlarms().at(-1);
  return said?.kind === 'stopped' && said.was.root === last.root && said.was.size === last.size;
}

/**
 * The last holding this device actually saw — who held the watch, and since when — and who to tell
 * when it changes.
 *
 * **Not cleared by a Dark read.** A handover is normally holder A, then a moment of Dark
 * while nobody has taken it up, then holder B — and treating that gap as "no previous
 * holder" would swallow exactly the change worth reacting to.
 *
 * **A holding, not only a holder.** It compared the callsign alone, so the same person taking the
 * watch again was not a change: a holder who reloaded their board — which empties it, because it
 * lives in that page — took the watch back to a board nobody would refill until each operator
 * signed on again. Every Station carries the moment its holding began (`since`), so the same holder
 * with a later `since` is a new holding and the board is refilled the way a handover's is. A box
 * whose daemon restarted is the same case: it publishes no holder, and its `since` is its start.
 *
 * The same holder with an **earlier** `since` is an older copy of a holding already seen, from a
 * relay that has not caught up — not a change, and not recorded over the newer one.
 */
let knownHolding: { holder: string | null; since: number } | null = null;
let onHandover: (() => void) | null = null;

/** Whether this reading begins a holding other than the one last seen, and records it if so. */
function newHolding(holder: string | null, since: number): boolean {
  const was = knownHolding;
  if (was && was.holder === holder && since <= was.since) return false;
  knownHolding = { holder, since };
  return was !== null;
}

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

  /**
   * Starts watching, if this terminal has been given a Watchtower.
   *
   * Each relay's own copy goes into `heard` as well, so the receipt can say where the watch was
   * heard [relay-lists §7]. `stop()` leaves that record alone: the `Distress` screen shows the
   * count this phone already holds, with its age, and opens no read of its own to get it.
   */
  start(): void {
    const config = loadConfig();
    if (!config) return;
    connection?.close();
    alarms = rootAlarms();
    /** The live reading last acted on, so one aged again on screen is not taken for a new one. */
    let acted: string | null = null;
    connection = watchWatchtower(config, (r, heard) => {
      read = r;
      // Said when the relays were asked; any reading that came from an event means one answered.
      unanswered = heard ? heard.unanswered : false;

      // Only a live read tells us anything about the log. A Dark read means we could not
      // reach the watch, which is not the same as a watch that stopped committing.
      if (r.dark) return;
      const said = JSON.stringify(r.state);
      if (said === acted) return;
      acted = said;

      if (newHolding(r.state.holder, r.state.since)) onHandover?.();
      if (!restated(r.state.log_root)) recordRoot(r.state.log_root);
      alarms = rootAlarms();
    }, { sink: heard.sink(config.pubkey) });
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
