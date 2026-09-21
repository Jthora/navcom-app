import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils';
import { nip44 } from 'nostr-tools';
import type { SecretKey } from './keys.js';

/**
 * Post-quantum cover, beside the classical exchange rather than instead of it.
 *
 * The threat is **harvest now, decrypt later**: somebody recording relay traffic today so a
 * quantum computer can read it in fifteen years. Everything in this system is exactly the
 * kind of traffic that is worth recording — who was out, where, what they asked for, and
 * what they were told. Nothing about that stops being sensitive when it stops being current.
 *
 * ## Hybrid, and what "hybrid" buys
 *
 * The wrapping key is derived from **both** an ordinary elliptic-curve exchange and an
 * ML-KEM-768 encapsulation. If ML-KEM turns out to be broken — it is younger than the
 * curve — the classical half still holds. If a quantum computer arrives, the ML-KEM half
 * still holds. **The message stays private unless both fail.**
 *
 * This is the shape TLS 1.3 ships as `X25519MLKEM768`. It is the boring standard answer,
 * and the implementation is `@noble/post-quantum` — the same author as the curve and hash
 * libraries this project already depends on.
 *
 * ## Nostr is untouched
 *
 * The event, its tags and its signature are unchanged. NIP-44's AEAD, padding and format are
 * unchanged. The only thing that differs is the 32 bytes fed in as the conversation key, and
 * relays never read that anyway.
 *
 * ## The KEM keypair is derived, not stored
 *
 * From the operator's own secret, through HKDF with a domain separator. That means:
 *
 * - **No second key to lose.** It exists wherever the identity exists
 * - **A burn destroys it** with the identity, because there is nothing else to destroy
 * - Restoring an identity restores it, so an operator does not silently become
 *   un-decryptable to their own past messages
 *
 * The public half is 1184 bytes, which is why it travels as a published bundle rather than
 * in a pairing QR — see `events/key-bundle.ts`.
 *
 * Normative source: docs/spec/signals.spec.md
 */

/** Domain separator. A key derived for one purpose must never collide with another. */
const KEM_SEED_INFO = 'navcom-ml-kem-768-v1';
const HYBRID_INFO = 'navcom-hybrid-wrap-v1';

export interface KemKeypair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/**
 * This operator's ML-KEM keypair, derived from their nostr secret.
 *
 * Deterministic: the same secret always produces the same keypair, which is what makes it
 * safe to have no storage for it.
 */
export function kemKeypair(secret: SecretKey): KemKeypair {
  const seed = hkdf(sha256, secret, undefined, KEM_SEED_INFO, 64);
  const keys = ml_kem768.keygen(seed);
  return { publicKey: keys.publicKey, secretKey: keys.secretKey };
}

/** The published half, as hex. 1184 bytes, so 2368 characters. */
export const kemPublicHex = (secret: SecretKey): string => bytesToHex(kemKeypair(secret).publicKey);

export class PqError extends Error {}

/** Parses a published KEM public key, or throws. Wrong-length keys are refused, not padded. */
export function kemPublicFromHex(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(clean)) throw new PqError('A KEM key is hexadecimal.');
  const bytes = hexToBytes(clean);
  if (bytes.length !== 1184) {
    throw new PqError(`An ML-KEM-768 public key is 1184 bytes, got ${bytes.length}.`);
  }
  return bytes;
}

/**
 * Mixes a classical conversation key with a KEM shared secret into one wrapping key.
 *
 * Concatenated and run through HKDF, so the result depends on **both** inputs. Feeding
 * either one in alone would produce a different key, which is the property that makes this
 * hybrid rather than a choice between two schemes.
 */
const mix = (classical: Uint8Array, quantum: Uint8Array): Uint8Array =>
  hkdf(sha256, concatBytes(classical, quantum), undefined, HYBRID_INFO, 32);

export interface HybridWrap {
  /** The KEM ciphertext the recipient decapsulates. 1088 bytes, hex. */
  kem: string;
  /** The conversation key to hand NIP-44. */
  key: Uint8Array;
}

/**
 * Sets up a hybrid wrap for one recipient.
 *
 * The KEM ciphertext must travel with the message: it is what lets the recipient recover
 * their half of the shared secret, and it is different for every message.
 */
export function hybridSeal(
  secret: SecretKey,
  recipientPubkey: string,
  recipientKem: Uint8Array
): HybridWrap {
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(recipientKem);
  return {
    kem: bytesToHex(cipherText),
    key: mix(nip44.getConversationKey(secret, recipientPubkey), sharedSecret)
  };
}

/** Recovers the wrapping key for a hybrid wrap addressed to us. Throws if it was not. */
export function hybridOpen(
  secret: SecretKey,
  senderPubkey: string,
  kemCiphertextHex: string
): Uint8Array {
  const { secretKey } = kemKeypair(secret);
  const shared = ml_kem768.decapsulate(hexToBytes(kemCiphertextHex), secretKey);
  return mix(nip44.getConversationKey(secret, senderPubkey), shared);
}

/**
 * How a message was protected — reported to the operator, never inferred.
 *
 * `classical` is a real, supported outcome rather than an error. A recipient who has not
 * published a KEM key, or whose bundle this device has not fetched, still gets the message:
 * **the alternative is refusing to send, and the message that would fail to send is a
 * `Distress`.** What must not happen is the operator believing they had cover they did not.
 */
export type Cover = 'hybrid' | 'classical';

/*
 * There is deliberately no exported sentence for this.
 *
 * `COVER_NOTE` was here — the canonical wording to show when a message went without
 * post-quantum cover — and nothing outside its own test ever read it, while the Status screen
 * said the same thing in better words: it names who has to open the app, and that cover then
 * happens on its own. **Two copies of one safety sentence drift, and the copy nobody renders
 * drifts first.**
 *
 * The wording lives on the screen. `web/e2e/reachable.spec.ts` holds it to being a note rather
 * than an alarm — on the built page, which is where the promise is actually made. Removed
 * 2026-09-20, by an audit for mechanisms nobody can reach.
 */
