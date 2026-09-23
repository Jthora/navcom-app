/**
 * Who else is out, as this device sees it.
 *
 * Derived, never held. Each phone builds its own picture from the presence events it can
 * decrypt — there is no server-side list, nothing is persisted, and it expires on its own.
 *
 * **Absence reads as unknown**, never as home and never as in trouble. A peer whose
 * heartbeat stops has a flat battery, no signal, or a phone in a pocket, and the system
 * saying anything more than "I do not know" would be inventing a fact [invariant 3].
 */

import type { Event } from 'nostr-tools/core';
import {
  buddyState,
  buildPresence,
  KIND_PEER_PRESENCE,
  readPresence,
  type BuddyState,
  type PresencePayload
} from '@navcom/core';
import { loadIdentity } from './identity';
import { buddies, peerPubkeys, peers } from './peers';
import { relays } from './relays';
import { pool } from './pool';
import { kemKeys } from './pq.svelte';

/** How often presence is republished, and therefore how quickly a peer appears. */
export const HEARTBEAT_SECONDS = 60;

/**
 * How many missed heartbeats before a peer reads as unknown.
 *
 * Three rather than one: a single missed beat is a subway, a lift, or a relay hiccup, and
 * flipping somebody to "unknown" every time they walk past a building would make the whole
 * view worthless.
 */
const MISSES_BEFORE_UNKNOWN = 3;

export interface PeerPresence {
  pubkey: string;
  /** What you call them, from your own peer list. Never what they call themselves. */
  callsign: string;
  payload: PresencePayload;
  /**
   * What their phone said the time was. **Used only to order events.**
   *
   * Never for staleness — see `heard`. It is a number chosen by another device, and a peer
   * with a slow clock read as *unknown* while they were actively out, while one with a fast
   * clock read as *out* for half an hour after they had stopped. The second is the dangerous
   * direction: it tells a buddy somebody is fine when nothing has been heard, which is
   * precisely what this module's own rule forbids.
   */
  at: number;
  /**
   * When **this** device received it. What staleness is measured from.
   *
   * The only honest answer to *"how long since I heard from them"* is one this phone can
   * observe. Somebody else's clock is not evidence about our own silence.
   */
  heard: number;
}

let seen = $state<Record<string, PeerPresence>>({});
let connected = $state(false);
let closer: { close(): void } | null = null;
let beat: ReturnType<typeof setInterval> | null = null;

export const presence = {
  /** Everyone heard from recently enough to say anything about. */
  get out(): PeerPresence[] {
    const cutoff = Math.floor(Date.now() / 1000) - HEARTBEAT_SECONDS * MISSES_BEFORE_UNKNOWN;
    return Object.values(seen)
      .filter((p) => p.heard >= cutoff && p.payload.status === 'out')
      .sort((a, b) => a.callsign.localeCompare(b.callsign));
  },

  /**
   * Peers we have not heard from lately.
   *
   * Reported as unknown, deliberately and by name. Leaving them off the screen entirely
   * would read as "not out", which is a claim nobody made.
   */
  get unknown(): { pubkey: string; callsign: string }[] {
    const cutoff = Math.floor(Date.now() / 1000) - HEARTBEAT_SECONDS * MISSES_BEFORE_UNKNOWN;
    return peers()
      .filter((p) => {
        const last = seen[p.pubkey];
        return !last || last.heard < cutoff;
      })
      .map((p) => ({ pubkey: p.pubkey, callsign: p.callsign }));
  },

  get connected(): boolean {
    return connected;
  },

  /** Starts listening. Safe to call repeatedly. */
  start(): void {
    const identity = loadIdentity();
    const urls = relays();
    if (!identity || urls.length === 0 || peerPubkeys().length === 0) return;

    closer?.close();
    closer = pool().subscribeMany(
      urls,
      { kinds: [KIND_PEER_PRESENCE], '#p': [identity.pubkey] },
      {
        onevent: (event: Event) => {
          const read = readPresence(identity.secretKey, event, peerPubkeys());
          if (!read) return;
          const known = peers().find((p) => p.pubkey === read.from);
          if (!known) return;

          // Out-of-order delivery is normal on relays. An older heartbeat must not
          // overwrite a newer one and make somebody look stale who is not.
          const existing = seen[read.from];
          // Ordering is the one thing their clock is good for: it is the only way to tell
          // which of two of their own heartbeats came later.
          if (existing && existing.at >= read.at) return;

          seen = {
            ...seen,
            [read.from]: {
              pubkey: read.from,
              callsign: known.callsign,
              payload: read.payload,
              at: read.at,
              heard: Math.floor(Date.now() / 1000)
            }
          };
        }
      }
    );
    connected = true;
  },

  /**
   * Who has told you they are watching for you tonight.
   *
   * Only what they said — never inferred from you watching them. Two people can each think
   * they are the one keeping an eye out, and the app must not paper over that by assuming
   * symmetry nobody agreed to.
   */
  get watchingYou(): string[] {
    const cutoff = Math.floor(Date.now() / 1000) - HEARTBEAT_SECONDS * MISSES_BEFORE_UNKNOWN;
    return Object.values(seen)
      .filter((p) => p.payload.watching === true && p.heard >= cutoff)
      .map((p) => p.callsign)
      .sort();
  },

  /** What a buddy's phone should say about them. Never anything that reads as an alarm. */
  stateOf(p: PeerPresence, now = Math.floor(Date.now() / 1000)): BuddyState {
    // `heard - at` is how far their clock sat from ours in the message we actually got.
    return buddyState(p.payload, p.heard, now, { skewSeconds: p.heard - p.at });
  },

  /** Publishes where you are to the peers you paired with, and to nobody else. */
  async announce(payload: PresencePayload): Promise<void> {
    const identity = loadIdentity();
    const urls = relays();
    const to = peerPubkeys();
    if (!identity || urls.length === 0 || to.length === 0) return;

    // `watching` differs by recipient. Telling every peer you are watching them when you
    // are watching one would be a lie told to several people at once.
    const watched = new Set(buddies().map((b) => b.pubkey));
    const events = buildPresence(
      identity.secretKey,
      to,
      (peer) => ({ ...payload, watching: watched.has(peer) }),
      Math.floor(Date.now() / 1000),
      kemKeys()
    );
    // Settled, not raced: one peer's relay failing must not stop the others being told.
    await Promise.allSettled(events.flatMap((e) => pool().publish(urls, e)));
  },

  /** Republishes on a heartbeat, because relays store none of this. */
  beat(payload: () => PresencePayload | null): void {
    if (beat) clearInterval(beat);
    beat = setInterval(() => {
      const p = payload();
      if (p) void this.announce(p);
    }, HEARTBEAT_SECONDS * 1000);
  },

  /**
   * Stops **listening**. The outgoing beat is not ended here, and that is the fix.
   *
   * This cleared the interval too, and the only caller is the Status screen's `onMount`
   * cleanup — so the first time an operator left Status for any other screen, their own
   * heartbeat stopped while they were still out. Nothing restarted it: `start()` touches only
   * the subscription, and only a fresh `signOn()` calls `beat()`. Three minutes later every
   * paired peer moved them to `unknown · nothing heard`, and a buddy who agreed to watch could
   * no longer tell a flat battery from trouble.
   *
   * The asymmetry was the tell: `stopListed()`, the public board's beat, is deliberately absent
   * from that cleanup for exactly this reason.
   */
  stop(): void {
    closer?.close();
    closer = null;
    connected = false;
  },

  /** Ends the outgoing heartbeat. Belongs to the patrol: stand-down, or a wipe. */
  stopBeat(): void {
    if (beat) clearInterval(beat);
    beat = null;
  }
};
