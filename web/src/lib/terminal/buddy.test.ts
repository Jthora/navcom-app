/**
 * Who is watching whom.
 *
 * A buddy is somebody who watches your patrols. It decides what `watching` says in the
 * presence sent to each peer, and presence is explicit about why that must be per-recipient:
 * *"telling every peer you are watching them when you are watching one would be a lie told to
 * several people at once, which is a worse failure than the one it replaced."*
 *
 * The guard against that lie existed and nothing proved it.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { buddies, pair, peers, setBuddy } from './peers';

const A = 'aa'.repeat(32);
const B = 'bb'.repeat(32);

beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  };
  pair(A, 'Raven');
  pair(B, 'Wren');
});

describe('taking on watching somebody', () => {
  it('marks that peer and nobody else', () => {
    // Marking everybody would put `watching: true` in the presence sent to every peer — the
    // lie told to several people at once.
    setBuddy(A, true);
    expect(peers().find((p) => p.pubkey === A)?.buddy).toBe(true);
    expect(peers().find((p) => p.pubkey === B)?.buddy).not.toBe(true);
  });

  it('lists only the ones actually being watched', () => {
    setBuddy(A, true);
    expect(buddies().map((p) => p.pubkey)).toEqual([A]);
  });

  it('is empty until somebody takes it on', () => {
    // Nobody is watching anybody by default. A buddy is a commitment, not a side effect of
    // pairing.
    expect(buddies()).toEqual([]);
  });

  it('can be put down as unceremoniously as it was taken up', () => {
    setBuddy(A, true);
    setBuddy(A, false);
    expect(buddies()).toEqual([]);
    // And putting it down does not unpair them.
    expect(peers().map((p) => p.pubkey).sort()).toEqual([A, B].sort());
  });

  it('leaves the other peer untouched when one is put down', () => {
    setBuddy(A, true);
    setBuddy(B, true);
    setBuddy(A, false);
    expect(buddies().map((p) => p.pubkey)).toEqual([B]);
  });
});
