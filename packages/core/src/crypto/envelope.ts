/**
 * Encrypting to the Watchtower.
 *
 * **Signals are encrypted to the Watchtower key, not to the individual holding watch.**
 * Encrypting to whoever currently holds the board breaks on handover, locks the agent out
 * of anything addressed to a human, and makes shared watch impossible.
 *
 * The cost is explicit rather than implied: the box can read every signal. It already holds
 * the board, runs the agent and executes escalation.
 *
 * NIP-44 comes from nostr-tools — the reference implementation. This project does not ship
 * its own cryptography on a boundary protecting people at risk.
 */

import * as nip44 from 'nostr-tools/nip44';
import type { SecretKey } from './keys.js';
import { hybridOpen, hybridSeal, kemPublicFromHex } from './pq.js';

/**
 * Seal a payload so only the holder of `recipientPubkey`'s secret can read it.
 *
 * With `recipientKem` — their published ML-KEM public key — the wrapping key is derived
 * from **both** that and the classical exchange, so the message stays private unless both
 * primitives fall [`pq.ts`]. Without it, classical only: a real, supported outcome, because
 * the alternative is refusing to send and the message that would fail to send is a
 * `Distress`.
 *
 * The output is self-describing (`q:` or `c:`), so a recipient never has to be told which
 * kind is arriving and a sender can change its mind between messages.
 */
export function seal(
  secret: SecretKey,
  recipientPubkey: string,
  payload: unknown,
  recipientKem?: string
): string {
  const plaintext = JSON.stringify(payload);
  if (!recipientKem) {
    return `c:${nip44.encrypt(plaintext, nip44.getConversationKey(secret, recipientPubkey))}`;
  }
  const wrap = hybridSeal(secret, recipientPubkey, kemPublicFromHex(recipientKem));
  return `q:${wrap.kem}.${nip44.encrypt(plaintext, wrap.key)}`;
}

/** Open a payload sealed to us by `senderPubkey`. Throws if it was not. */
export function open<T = unknown>(secret: SecretKey, senderPubkey: string, ciphertext: string): T {
  if (ciphertext.startsWith('q:')) {
    const dot = ciphertext.indexOf('.');
    if (dot < 0) throw new Error('Malformed hybrid envelope');
    const key = hybridOpen(secret, senderPubkey, ciphertext.slice(2, dot));
    return JSON.parse(nip44.decrypt(ciphertext.slice(dot + 1), key)) as T;
  }
  const body = ciphertext.startsWith('c:') ? ciphertext.slice(2) : ciphertext;
  return JSON.parse(nip44.decrypt(body, nip44.getConversationKey(secret, senderPubkey))) as T;
}
