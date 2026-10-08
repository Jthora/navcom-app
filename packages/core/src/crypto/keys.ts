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

/** secp256k1's field prime. */
const FIELD_P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;

function powModP(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let b = base % FIELD_P;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % FIELD_P;
    b = (b * b) % FIELD_P;
    e >>= 1n;
  }
  return result;
}

/**
 * Whether this is a public key somebody could actually hold: {@link isPubkey}, and an x-coordinate
 * on secp256k1, as BIP-340's `lift_x` requires.
 *
 * **About half of all 64-hex strings are not.** One character mistyped in a key handed over by hand
 * lands off the curve as often as not, and a key off the curve is a key nobody can sign as, seal to,
 * or be sealed to. `isPubkey` checks only the spelling.
 *
 * Done here with the curve's own arithmetic, rather than by importing a curve library: the web
 * bundle already carries one copy of secp256k1 through nostr-tools, and a second for one check
 * would be paid by every phone on its first load.
 */
export function isCurveKey(value: unknown): boolean {
  if (typeof value !== 'string' || !isPubkey(value)) return false;
  const x = BigInt('0x' + value);
  if (x >= FIELD_P) return false;
  const c = (((x * x) % FIELD_P) * x + 7n) % FIELD_P;
  const y = powModP(c, (FIELD_P + 1n) / 4n);
  return (y * y) % FIELD_P === c;
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
