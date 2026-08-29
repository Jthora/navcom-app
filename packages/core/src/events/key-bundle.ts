import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import { kemPublicFromHex, kemPublicHex, PqError } from '../crypto/pq.js';
import type { SecretKey } from '../crypto/keys.js';
import { KIND_KEY_BUNDLE } from './kinds.js';

/**
 * *"Here is my post-quantum key."* — kind 10912.
 *
 * ## Why this is published rather than exchanged in person
 *
 * An ML-KEM-768 public key is **1184 bytes**. A pairing code is 32. Putting the KEM key in
 * the pairing QR would take it from a code somebody can scan in the dark on a cheap phone —
 * or read aloud — to a dense block that needs good light and a good camera, and it would do
 * the same to the Watchtower address handed over on paper.
 *
 * The part of this system that least deserves a casual change is how people exchange
 * identity in person. So the pairing code stays exactly what it was, and the KEM key is
 * looked up afterwards, by pubkey, from a relay.
 *
 * ## Why a relay cannot substitute one
 *
 * The bundle is **signed by the operator's own key**, and a reader checks that the signature
 * belongs to the pubkey they already have from pairing. A relay serving a KEM key it
 * generated would have to forge that signature.
 *
 * The worst a hostile relay can do is **withhold** — serve nothing, and let the sender fall
 * back to classical. That is a real downgrade and it is why the fallback is reported to the
 * operator rather than being silent [`crypto/pq.ts`].
 *
 * ## Public on purpose
 *
 * Unencrypted, like the card. A KEM public key is a public key; there is nothing in it to
 * seal, and requiring a handshake to fetch one would mean nobody could send you anything
 * until you were online.
 *
 * Replaceable, so an operator has one bundle rather than a history of them.
 *
 * Normative source: docs/spec/signals.spec.md
 */

export interface KeyBundle {
  /** The operator this belongs to, proven by the event signature. */
  pubkey: string;
  /** ML-KEM-768 public key, hex. */
  kem: string;
  at: number;
}

/** Builds this operator's bundle. The KEM key is derived from their secret, never stored. */
export function buildKeyBundle(secret: SecretKey, createdAt: number): Event {
  return finalizeEvent(
    {
      kind: KIND_KEY_BUNDLE,
      created_at: createdAt,
      tags: [],
      content: JSON.stringify({ kem: kemPublicHex(secret) })
    },
    secret
  );
}

/**
 * Reads a bundle, or returns null.
 *
 * **`expect` is required, not optional.** A bundle is only ever useful for somebody whose
 * pubkey you already hold — from pairing, from a watch address, from an invite. Accepting a
 * bundle without checking who it is for would let a relay answer a question nobody asked,
 * which is the one thing this event has to be proof against.
 *
 * A list rather than one pubkey, because the one real caller subscribes for several people
 * at once (a peer, a watch, anyone a published card lets ask) and needs to accept a bundle
 * from any of them. A single-value `expect` here once made that check a tautology at the
 * call site — `readKeyBundle(event, event.pubkey)` always passes — with the real gate
 * living one line further down instead. Found in a robustness audit; not exploitable as
 * written (a relay cannot forge `event.pubkey`), but a landmine: this docstring's own claim
 * that this function is "proof against" an unasked answer was false until this changed.
 */
export function readKeyBundle(event: Event, expect: readonly string[]): KeyBundle | null {
  if (event.kind !== KIND_KEY_BUNDLE) return null;
  if (!expect.includes(event.pubkey)) return null;
  if (!verifyEvent(event)) return null;

  try {
    const parsed = JSON.parse(event.content) as { kem?: unknown };
    if (typeof parsed.kem !== 'string') return null;
    // Parsed rather than trusted: a wrong-length key would fail deep inside the KEM on the
    // first send, which is a bad place to find out.
    kemPublicFromHex(parsed.kem);
    return { pubkey: event.pubkey, kem: parsed.kem, at: event.created_at };
  } catch (e) {
    if (e instanceof PqError) return null;
    return null;
  }
}
