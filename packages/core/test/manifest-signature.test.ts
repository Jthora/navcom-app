import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { bytesToHex } from '@noble/hashes/utils';
import { base64 } from '@scure/base';
import { MISSION_PUBLISHERS, manifestDigest, manifestKeySha256, manifestSignedBy, type ManifestKeyPin } from '../src/index.js';

/**
 * The second signature on a package [missions/manifest-signature.ts]: ML-DSA-65 over the manifest,
 * under a key the exposed Nostr secret is not. Read against Mecha Jono's own packages, as NavCom
 * captured them on 2026-10-06, and against forgeries a stand-in signs.
 */

const FIXTURES = JSON.parse(readFileSync(new URL('./fixtures/mission-packages.json', import.meta.url), 'utf8')) as { id: string; content: string }[];
const MECHA = MISSION_PUBLISHERS[0]!.manifestKey!;

/** A stand-in manifest key, and a manifest signed by it the way Starcom's signer signs. */
const seed = new Uint8Array(32).fill(7);
const stand = ml_dsa65.keygen(seed);
const standPin: ManifestKeyPin = { alg: 'ml-dsa-65', sha256: manifestKeySha256(bytesToHex(stand.publicKey))! };
function signed(manifest: Record<string, unknown>, keys = stand, encode: (b: Uint8Array) => string = bytesToHex): string {
  const sig = ml_dsa65.sign(manifestDigest(manifest), keys.secretKey);
  const metadata = { ...((manifest['metadata'] ?? {}) as object), signature: { alg: 'ml-dsa-65', pubkey: encode(keys.publicKey), sig: encode(sig) } };
  return JSON.stringify({ ...manifest, metadata });
}

describe('Mecha Jono’s packages, as captured', () => {
  it('each carries a signature by the key the registry pins', () => {
    expect(FIXTURES.length).toBeGreaterThan(0);
    for (const e of FIXTURES) expect(manifestSignedBy(e.content, MECHA), e.id).toBe(true);
  });

  it('pins that key by the sha256 of its bytes', () => {
    const block = JSON.parse(FIXTURES[0]!.content).metadata.signature;
    expect(manifestKeySha256(block.pubkey)).toBe(MECHA.sha256);
  });

  it('a word changed after signing, and it no longer verifies', () => {
    const m = JSON.parse(FIXTURES[0]!.content);
    m.description = `${m.description} `;
    expect(manifestSignedBy(JSON.stringify(m), MECHA)).toBe(false);
    m.description = m.description.slice(0, -1);
    expect(manifestSignedBy(JSON.stringify(m), MECHA)).toBe(true);
  });
});

describe('what a second signature is not', () => {
  const manifest = { name: 'Hand out water', objectives: [{ id: 'a#do', ask: 'Hand out water.' }], metadata: { mechaJono: { state: 'open' } } };

  it('a signature by any key but the pinned one, however good', () => {
    expect(manifestSignedBy(signed(manifest), standPin)).toBe(true);
    // Whoever holds the exposed Nostr secret can sign the manifest with a key of their own: it is not the pinned one.
    expect(manifestSignedBy(signed(manifest), MECHA)).toBe(false);
  });

  it('the pinned key’s bytes beside a signature that is not its own', () => {
    const real = JSON.parse(FIXTURES[0]!.content).metadata.signature;
    const forged = JSON.parse(signed(manifest));
    forged.metadata.signature.pubkey = real.pubkey;
    expect(manifestSignedBy(JSON.stringify(forged), MECHA)).toBe(false);
  });

  it('no block, another algorithm, a short key, content that is not a manifest: false, never a throw', () => {
    const plain = JSON.stringify(manifest);
    expect(manifestSignedBy(plain, standPin)).toBe(false);
    const ed = JSON.parse(signed(manifest));
    ed.metadata.signature.alg = 'ed25519';
    expect(manifestSignedBy(JSON.stringify(ed), standPin)).toBe(false);
    const short = JSON.parse(signed(manifest));
    short.metadata.signature.pubkey = short.metadata.signature.pubkey.slice(2);
    expect(manifestSignedBy(JSON.stringify(short), standPin)).toBe(false);
    for (const junk of ['', 'null', '[]', '{"metadata":null}', '{"metadata":{"signature":7}}', '{']) expect(manifestSignedBy(junk, standPin)).toBe(false);
  });

  it('reads key order as the signer wrote it at any depth, and base64 as well as hex', () => {
    const reordered = JSON.parse(signed(manifest));
    const turned = { metadata: { signature: reordered.metadata.signature, mechaJono: { state: 'open' } }, objectives: [{ ask: 'Hand out water.', id: 'a#do' }], name: 'Hand out water' };
    expect(manifestSignedBy(JSON.stringify(turned), standPin)).toBe(true);
    expect(manifestSignedBy(signed(manifest, stand, (b) => base64.encode(b)), standPin)).toBe(true);
  });
});
