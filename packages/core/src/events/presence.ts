import { finalizeEvent, generateSecretKey, verifyEvent } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import { open, seal } from '../crypto/envelope.js';
import type { SecretKey } from '../crypto/keys.js';
import { KIND_PEER_PRESENCE, tagRecipient } from './kinds.js';
import { AREA_MAX, CALLSIGN_MAX, withinLimit } from '../limits.js';
import type { Position } from './signal.js';

/**
 * Peer presence — kind 20913.
 *
 * The one message in this system that involves no watch at all. An operator publishes it to
 * the peers they have paired with, and each device draws its own picture of who is out.
 *
 * ## Why one event per peer, from a key that is thrown away
 *
 * The obvious design is one event `p`-tagged to everybody. It is also a **social graph
 * published to a public relay**: anyone watching sees that this key sends presence to those
 * keys, every minute, forever. The Doxxer is a named adversary here and that is precisely
 * their material — and *"no central social graph"* is not a preference, it is one of the
 * things this design is for.
 *
 * Signing separate events with the real key is no better: a relay correlates them by author
 * and reconstructs the same graph.
 *
 * So each peer gets their own event, signed by a **fresh ephemeral key that is discarded
 * immediately**. A relay sees unrelated one-off keys publishing to unrelated recipients and
 * can link none of them. The real sender is inside the ciphertext, where only the recipient
 * can read it.
 *
 * ## And why the inside is a signed event rather than a name
 *
 * A payload that merely *says* who it is from can say anything. The inner content is a
 * complete nostr event signed by the sender's real key, so a recipient verifies authorship
 * with the same function they use everywhere else. The wrapper hides who is talking; the
 * inner signature proves it.
 *
 * This is the shape NIP-59 uses, built from primitives already in the project rather than
 * invented here.
 *
 * Normative source: docs/spec/signals.spec.md
 */

export type PresenceStatus = 'out' | 'stood-down';

export interface PresencePayload {
  callsign: string;
  status: PresenceStatus;
  /** Coarse — a district, never an address. Null where the operator shares nothing. */
  area: string | null;
  /** Unix seconds they expect to be back. */
  until: number;
  /** Present only where the operator chose to share it, at the precision they chose. */
  position?: Position;
  /**
   * *"I am watching for you tonight."*
   *
   * Sent **only to the peer it concerns**, which is what keeps it from becoming a graph —
   * nobody else learns who watches whom, not even another peer.
   *
   * It exists because the alternative is worse than nothing. A buddy arrangement kept as a
   * private note on one phone means somebody can believe they are being watched while
   * nobody is, which is invariant 4 failing at the scale of two people instead of a
   * network. Saying it out loud is the only version that is honest.
   */
  watching?: boolean;
}

/**
 * One wrapped event per peer.
 *
 * The caller publishes all of them. There is deliberately no batching: a batch is a link.
 */
export function buildPresence(
  secret: SecretKey,
  peers: string[],
  /**
   * The payload, per peer.
   *
   * A function rather than one shared object, because `watching` differs by recipient —
   * telling every peer you are watching them when you are watching one would be a lie told
   * to several people at once, which is a worse failure than the one it replaced.
   */
  payloadFor: PresencePayload | ((peer: string) => PresencePayload),
  createdAt: number,
  /**
   * Published ML-KEM keys, by peer pubkey.
   *
   * A peer missing from this map gets classical cover. Presence is the highest-volume thing
   * on this wire, and hybrid adds 1088 bytes per peer per beat — the cost is real and was
   * costed in the spec, because a heartbeat says who was out, where, and until when, and
   * none of that stops being sensitive when it stops being current.
   */
  kem: Readonly<Record<string, string>> = {}
): Event[] {
  const forPeer = typeof payloadFor === 'function' ? payloadFor : () => payloadFor;

  return peers.map((peer) => {
    const payload = forPeer(peer);
    // The real message, signed by the real key. Never published as-is.
    const inner = finalizeEvent(
      {
        kind: KIND_PEER_PRESENCE,
        created_at: createdAt,
        tags: [tagRecipient(peer)],
        content: JSON.stringify(payload)
      },
      secret
    );

    // A key that exists for one message and is never stored, so nobody reading a relay can tell
    // who sent it. Not more than that: the relay carrying it sees the connection, and every wrap
    // in one beat shares this createdAt, so a beat's wraps can be grouped (what-leaves.md).
    const ephemeral = generateSecretKey();
    return finalizeEvent(
      {
        kind: KIND_PEER_PRESENCE,
        created_at: createdAt,
        tags: [tagRecipient(peer)],
        content: seal(ephemeral, peer, inner, kem[peer])
      },
      ephemeral
    );
  });
}

export interface PresenceFrom {
  /** The sender's real pubkey, proven by the inner signature rather than claimed. */
  from: string;
  payload: PresencePayload;
  /** Unix seconds the sender stamped it. */
  at: number;
}

/**
 * Unwraps a presence event addressed to us.
 *
 * Returns null for anything that does not verify, rather than throwing: a relay delivers
 * whatever it likes, and one malformed event must not take down a client's whole feed.
 *
 * **Only a peer we recognise is accepted.** Without that check, anybody who learns a pubkey
 * could publish presence into somebody's screen — and a stranger appearing on the list of
 * who is out is both alarming and a way to make a real peer easy to miss.
 */
export function readPresence(
  secret: SecretKey,
  wrap: Event,
  knownPeers: readonly string[]
): PresenceFrom | null {
  let inner: Event;
  try {
    inner = open<Event>(secret, wrap.pubkey, wrap.content);
  } catch {
    return null;
  }

  // Authorship is proven here, not asserted anywhere.
  if (!inner || typeof inner !== 'object' || !verifyEvent(inner)) return null;
  if (inner.kind !== KIND_PEER_PRESENCE) return null;
  if (!knownPeers.includes(inner.pubkey)) return null;

  try {
    const payload = JSON.parse(inner.content) as PresencePayload;
    if (!withinLimit(payload.callsign, CALLSIGN_MAX)) return null;
    if (payload.status !== 'out' && payload.status !== 'stood-down') return null;
    // A peer's area lands on this screen too, so it is bounded for the same reason.
    if (payload.area !== null && payload.area !== undefined && !withinLimit(payload.area, AREA_MAX)) {
      return null;
    }
    /*
     * The only number anything acts on, and `buddyState` compares it arithmetically.
     *
     * A string makes every comparison false, so the peer reads `out` forever and is never
     * nudged; a null makes them all true, so they read `overdue` from the first second. Both
     * are invisible, and both break the promise this object exists to keep — that somebody
     * cannot believe they are watched while nobody is.
     */
    if (typeof payload.until !== 'number' || !Number.isFinite(payload.until)) return null;
    return { from: inner.pubkey, payload, at: inner.created_at };
  } catch {
    return null;
  }
}

/**
 * How long past their declared time before a buddy is told.
 *
 * The same grace the watch uses for an overdue board entry, and for the same reason:
 * **people are late for ordinary reasons far more often than dangerous ones.** A number
 * short enough to be useful and long enough that a slow walk home is not an event.
 */
export const BUDDY_GRACE_SECONDS = 1800;

export type BuddyState =
  /** Out, and inside the time they said. */
  | 'out'
  /** Past their declared time. **A nudge, never an alarm** — see below. */
  | 'overdue'
  /** They said they were home. */
  | 'home'
  /** Nothing heard lately. Not home, not in trouble — unknown [invariant 3]. */
  | 'unheard';

/**
 * What a buddy's phone should say about them.
 *
 * `overdue` is the only new judgement here and it is deliberately weak. **Nothing escalates
 * from it**: no page, no ladder, no contact, and no rung of anything. It tells a person who
 * asked to be told that somebody is past the time they gave, and that person decides what
 * it means.
 *
 * That restraint is the point rather than caution. Escalating on a missed window would make
 * false alarms routine, and alarm fatigue destroys the one mechanism where failure means
 * somebody is actually hurt [C4, invariant 3]. Duress is always deliberate; silence is
 * never duress.
 */
export function buddyState(
  payload: PresencePayload,
  heardAt: number,
  now: number,
  opts: { graceSeconds?: number; unheardAfterSeconds?: number; skewSeconds?: number } = {}
): BuddyState {
  if (payload.status === 'stood-down') return 'home';

  // Silence first. Somebody whose phone died an hour into a four-hour patrol is unheard,
  // not overdue -- calling that overdue would invent a fact from an absence.
  const unheardAfter = opts.unheardAfterSeconds ?? 180;
  if (now - heardAt > unheardAfter) return 'unheard';

  /*
   * Their deadline, moved into our clock.
   *
   * `until` is a claim about their own future in their own frame — *"back by nine"* means
   * nine o'clock according to the phone that said it. Compared straight against our `now`, a
   * peer whose clock runs ten minutes slow reads **overdue the moment they set out**, and one
   * whose clock runs fast is never overdue at all.
   *
   * The first of those is the one that matters: `overdue` is a nudge to a buddy, and the
   * anti-pattern table names overdue nudges as the thing that produces alarm fatigue. A
   * signal that fires because somebody's clock is wrong is exactly the noise that teaches
   * people to ignore the real one.
   *
   * The skew is observable from the same message — the gap between when they said they sent
   * it and when we received it — so no extra round trip and nothing to configure. The caller
   * measures it because only the caller knows when it arrived.
   */
  const skew = opts.skewSeconds ?? 0;
  const grace = opts.graceSeconds ?? BUDDY_GRACE_SECONDS;
  return now > payload.until + skew + grace ? 'overdue' : 'out';
}
