/**
 * Post-quantum keys, and what the device keeps.
 *
 * A key bundle is only useful for somebody this device might send to. Anything beyond that
 * is a record of a relationship, held somewhere nobody thought to look.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Event } from 'nostr-tools/core';
import { newSecretKey, publicKeyOf } from '@navcom/core';

const me = newSecretKey();
const myPubkey = publicKeyOf(me);
const raven = publicKeyOf(newSecretKey());
const wren = publicKeyOf(newSecretKey());

let currentPeers: string[] = [];
let currentConfig: { pubkey: string; relays: string[]; holders: string[]; executor?: string } | null = null;
let currentRelays: string[] = ['wss://fake.relay'];
/** Every request and publish, as a relay would see it: one relay, and what was named on it. */
let asked: { url: string; authors: string[] }[] = [];
let published: string[][] = [];

vi.mock('./identity', () => ({
  loadIdentity: () => ({ secretKey: me, pubkey: myPubkey, callsign: 'Me' })
}));
vi.mock('./config', () => ({ loadConfig: () => currentConfig }));
vi.mock('./card', () => ({ contactPubkey: () => null }));
vi.mock('./peers', () => ({ peerPubkeys: () => currentPeers }));
vi.mock('./relays', () => ({
  relays: () => currentRelays,
  watchRelays: () => currentConfig?.relays ?? currentRelays
}));
vi.mock('./pool', () => ({
  pool: () => ({
    subscribeMany: (urls: string[], filter: { authors?: string[] }) => {
      for (const url of urls) asked.push({ url, authors: filter.authors ?? [] });
      return { close: () => {} };
    },
    publish: (urls: string[]) => {
      published.push(urls);
      return urls.map(() => Promise.resolve('ok'));
    }
  })
}));

let pq: typeof import('./pq.svelte').pq;
let set: typeof import('./storage').set;
let get: typeof import('./storage').get;

beforeEach(async () => {
  currentConfig = null;
  currentRelays = ['wss://fake.relay'];
  asked = [];
  published = [];
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  };
  vi.resetModules();
  ({ pq } = await import('./pq.svelte'));
  ({ set, get } = await import('./storage'));
});

describe('keys for people this device no longer sends to', () => {
  it('are dropped rather than kept forever', () => {
    // `unpair` is unilateral, immediate and tells nobody — and it left the key here, so this
    // map became a shadow copy of every relationship the device has ever had.
    set('accruing', 'kem_keys', { [raven]: 'raven-kem', [wren]: 'wren-kem' });
    currentPeers = [wren];

    pq.start();
    expect(Object.keys(pq.known)).toEqual([wren]);
  });

  it('are dropped from storage too, not just from memory', () => {
    // The tier that survives a panic wipe is the whole point of the finding.
    set('accruing', 'kem_keys', { [raven]: 'raven-kem', [wren]: 'wren-kem' });
    currentPeers = [wren];

    pq.start();
    expect(get<Record<string, string>>('accruing', 'kem_keys')).toEqual({ [wren]: 'wren-kem' });
  });

  it('keeps the keys of people still paired with', () => {
    set('accruing', 'kem_keys', { [raven]: 'raven-kem', [wren]: 'wren-kem' });
    currentPeers = [wren, raven];

    pq.start();
    expect(Object.keys(pq.known).sort()).toEqual([wren, raven].sort());
  });

  it('leaves an operator with no peers holding nothing', () => {
    set('accruing', 'kem_keys', { [raven]: 'raven-kem' });
    currentPeers = [];

    pq.start();
    expect(pq.known).toEqual({});
  });
});

describe('asking for keys, and where [audit: relay paths, review]', () => {
  /*
   * One request named every peer, the watch and each holder, and went to every relay — the
   * shipped public ones included, once a watch's relays were added to them rather than put in
   * their place. A squad that kept its watch off strangers' relays then had its membership read
   * there, one member at a time.
   */
  const W = publicKeyOf(newSecretKey());
  const H1 = publicKeyOf(newSecretKey());
  const H2 = publicKeyOf(newSecretKey());
  const WATCH = 'wss://watch.example';
  const PUBLIC = ['wss://relay.damus.io', 'wss://nos.lol'];

  beforeEach(() => {
    currentConfig = { pubkey: W, relays: [WATCH], holders: [H1, H2] };
    currentRelays = [WATCH, ...PUBLIC];
  });

  const naming = (keys: string[]) => asked.filter((a) => a.authors.some((k) => keys.includes(k)));

  it('names the watch and its holders only on the watch’s own relays', () => {
    currentPeers = [raven];
    pq.start();
    expect(naming([W, H1, H2]).length, 'the watch’s keys were never asked for').toBeGreaterThan(0);
    expect(naming([W, H1, H2]).map((a) => a.url)).toEqual([WATCH]);
    expect(naming([W, H1, H2])[0]?.authors.sort()).toEqual([W, H1, H2].sort());
  });

  it('still asks for peers wherever peers are', () => {
    currentPeers = [raven];
    pq.start();
    expect(naming([raven]).map((a) => a.url).sort()).toEqual([WATCH, ...PUBLIC].sort());
    expect(naming([raven]).every((a) => !a.authors.includes(W)), 'no peer request names the watch').toBe(true);
  });

  it('sends a Watched operator with no peers nothing that names the watch on a public relay', () => {
    currentPeers = [];
    pq.start();
    expect(asked.filter((a) => PUBLIC.includes(a.url))).toEqual([]);
  });

  it('publishes the operator’s own bundle where it always went', () => {
    currentPeers = [raven];
    pq.start();
    expect(published).toEqual([[WATCH, ...PUBLIC]]);
  });
});

describe('the escalation executor’s key, where the watch names one [G3]', () => {
  /*
   * An acknowledgement and a request to wake the others are sealed to the executor's own key as
   * well as to the holders. Its wrap is classical until its key bundle is on this phone, and nothing
   * fetched it: every acknowledgement's content key sat in a classical wrap however long the box had
   * published one.
   */
  const W = publicKeyOf(newSecretKey());
  const X = publicKeyOf(newSecretKey());
  const WATCH = 'wss://watch.example';

  it('is asked for, on the watch’s own relays, beside the watch’s key', () => {
    currentConfig = { pubkey: W, relays: [WATCH], holders: [], executor: X };
    currentPeers = [];
    pq.start();
    const named = asked.filter((a) => a.authors.includes(X));
    expect(named.map((a) => a.url), 'the executor’s key bundle was never asked for').toEqual([WATCH]);
    expect(named[0]?.authors).toContain(W);
  });

  it('is kept once it has been fetched, rather than pruned as somebody this phone does not send to', () => {
    currentConfig = { pubkey: W, relays: [WATCH], holders: [], executor: X };
    set('accruing', 'kem_keys', { [X]: 'executor-kem' });
    pq.start();
    expect(pq.known[X]).toBe('executor-kem');
  });
});
