/**
 * The second signature on a Mission Package: ML-DSA-65 over its manifest [interchange spec §3].
 *
 * Every package Mecha Jono publishes is signed twice. The Nostr event carries the Schnorr signature
 * NIP-01 requires, under the key whose secret was exposed on 2026-09-28; the manifest inside it
 * carries a post-quantum one, `metadata.signature`, under a separate ML-DSA-65 key. **The exposed
 * secret signs the first and cannot make the second.** So a version under the frozen key that is not
 * on its list, which nothing could tell from a planted one, can be told apart after all: by whether
 * its manifest carries a signature from the key the registry pins for its publisher
 * [package.ts, `manifestKey`; trust.ts, `gate`].
 *
 * The digest is Starcom's (`services/exchange/signing.ts`, `manifestDigest`): the manifest without its
 * signature block, keys sorted by UTF-16 code unit at every depth, undefined values left out as
 * JSON.stringify leaves them out, then sha256. The key and signature are hex, or base64 when that is
 * what decodes to the right length, as Starcom reads them.
 *
 * Not imported by anything a page loads at first paint or mount: verifying costs a few milliseconds a
 * package on a laptop and the code is the ML-DSA implementation, so the live feed loads it only when a
 * package needs it [web: missions/second-signature.ts]. Pure: no network, no clock.
 */
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { base64 } from '@scure/base';

/** FIPS 204 sizes for ML-DSA-65. */
export const ML_DSA_65_PUBKEY_BYTES = 1952;
export const ML_DSA_65_SIG_BYTES = 3309;

/** A publisher's manifest key as the registry pins it: the sha256 of its public key's bytes, in hex. */
export interface ManifestKeyPin {
  alg: 'ml-dsa-65';
  sha256: string;
}

/** Canonical JSON, as the signer wrote it: keys by UTF-16 code unit, undefined values omitted. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** What the manifest signature covers: the manifest without its signature block, canonical, sha256. */
export function manifestDigest(manifest: Record<string, unknown>): Uint8Array {
  const metadata = { ...((manifest['metadata'] ?? {}) as Record<string, unknown>) };
  delete metadata['signature'];
  return sha256(utf8ToBytes(canonicalJson({ ...manifest, metadata })));
}

/** Hex, or base64 when hex does not give `bytes`; null when neither does. */
function decode(value: unknown, bytes: number): Uint8Array | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value.length === bytes * 2 && /^[0-9a-fA-F]+$/.test(value)) return hexToBytes(value.toLowerCase());
  try {
    const b = base64.decode(value);
    return b.length === bytes ? b : null;
  } catch {
    return null;
  }
}

/** The sha256 of an ML-DSA-65 public key, as the registry pins it, or null when it is not one. */
export function manifestKeySha256(pubkey: string): string | null {
  const bytes = decode(pubkey, ML_DSA_65_PUBKEY_BYTES);
  return bytes ? bytesToHex(sha256(bytes)) : null;
}

/**
 * Whether a package's content carries an ML-DSA-65 signature over its manifest by the pinned key.
 * False for anything else: no block, another algorithm, another key, a signature that does not
 * verify, content that is not a manifest. Never throws.
 */
export function manifestSignedBy(content: string, pin: ManifestKeyPin): boolean {
  try {
    const manifest = JSON.parse(content) as unknown;
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return false;
    const metadata = (manifest as Record<string, unknown>)['metadata'];
    if (!metadata || typeof metadata !== 'object') return false;
    const block = (metadata as Record<string, unknown>)['signature'] as Record<string, unknown> | undefined;
    if (!block || block['alg'] !== pin.alg) return false;
    const pubkey = decode(block['pubkey'], ML_DSA_65_PUBKEY_BYTES);
    const sig = decode(block['sig'], ML_DSA_65_SIG_BYTES);
    if (!pubkey || !sig || bytesToHex(sha256(pubkey)) !== pin.sha256) return false;
    return ml_dsa65.verify(sig, manifestDigest(manifest as Record<string, unknown>), pubkey);
  } catch {
    return false;
  }
}
