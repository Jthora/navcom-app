/**
 * Keys.
 *
 * Platform-neutral on purpose: this module never touches a filesystem, so the same code
 * runs in a browser and on the node. Loading a key from disk is the node's job.
 */

import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

export type SecretKey = Uint8Array;

/** A new operator or Watchtower identity. Generated where it will live, never transmitted. */
export function newSecretKey(): SecretKey {
  return generateSecretKey();
}

export function publicKeyOf(secret: SecretKey): string {
  return getPublicKey(secret);
}

export const secretToHex = (secret: SecretKey): string => bytesToHex(secret);

export function secretFromHex(hex: string): SecretKey {
  const clean = hex.trim().replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error('A secret key is 64 hex characters');
  }
  return hexToBytes(clean);
}

export function isPubkey(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/**
 * The part of a public key a person compares by eye: sixteen hex characters, in fours.
 *
 * A callsign is not unique -- there is no registry, so two operators may both be Raven -- and a
 * name is therefore not who said something. The key is. Nobody reads sixty-four characters, so
 * this is the part that goes beside a name wherever somebody's own words are shown.
 *
 * Sixteen rather than eight because the reader this protects is comparing against a key an
 * impersonator would like to match. Eight hex characters is 2^32 keys to grind, within reach of
 * one GPU in an afternoon; sixteen is 2^64, which nobody does. Hex, so there is no `O` to mistake
 * for `0`.
 *
 * `null` for anything that is not a public key, so a caller renders nothing rather than a
 * fragment that looks like an identity.
 */
export function keyPrint(pubkey: string): string | null {
  if (!isPubkey(pubkey)) return null;
  return (pubkey.slice(0, 16).match(/.{4}/g) as string[]).join(' ');
}
