/**
 * Which relays this device talks to.
 *
 * 9.R established what this list decides: everything an operator sends goes through it, which
 * is why a crafted backup setting it was a real finding. The validation on the operator's own
 * path was equally load-bearing and equally unverified.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { DEFAULT_RELAYS, ownRelays, relays, setRelays, usingDefaults, watchRelays } from './relays';
import { set } from './storage';

beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  };
});

describe('setting your own relays', () => {
  it('keeps only things that are actually relay URLs', () => {
    // A relay is a websocket. Anything else in this list is either a mistake or somebody
    // else's idea of where this operator's traffic should go.
    setRelays([
      'wss://relay.example',
      'http://not-a-relay.example',
      'javascript:alert(1)',
      'relay.example',
      ''
    ]);
    expect(relays()).toEqual(['wss://relay.example']);
  });

  it('accepts ws:// as well as wss://, because a local relay is a real thing', () => {
    setRelays(['ws://localhost:7777']);
    expect(relays()).toEqual(['ws://localhost:7777']);
  });

  it('trims what somebody pasted', () => {
    setRelays(['  wss://relay.example  ']);
    expect(relays()).toEqual(['wss://relay.example']);
  });

  it('falls back to the shipped defaults rather than to nothing', () => {
    // An empty relay list would silently disable presence, pairing and the watch — the
    // fallback is why `urls.length === 0` is unreachable everywhere else.
    setRelays(['not a relay at all']);
    expect(relays()).toEqual(DEFAULT_RELAYS);
    expect(usingDefaults()).toBe(true);
  });

  it('reports that a chosen list is not the default', () => {
    setRelays(['wss://relay.example']);
    expect(usingDefaults()).toBe(false);
  });

  it('starts on the defaults, and there is more than one of them', () => {
    // A single relay is a single point of failure for presence, and these are volunteer
    // services that owe nobody uptime.
    expect(relays()).toEqual(DEFAULT_RELAYS);
    expect(DEFAULT_RELAYS.length).toBeGreaterThan(1);
  });
});

describe('ws:// from a page served over https [audit: relay paths, F21]', () => {
  it('is kept only for a relay on this device', () => {
    setRelays(['ws://relay.example.com', 'ws://192.168.1.50:7777', 'ws://127.0.0.1:7777', 'wss://relay.example']);
    expect(relays()).toEqual(['ws://127.0.0.1:7777', 'wss://relay.example']);
  });
});

describe('a Watched operator [audit: relay paths, F15]', () => {
  it('publishes beside the watch, not only where the watch listens', () => {
    set('accruing', 'watchtower', 'f'.repeat(64));
    set('accruing', 'relays', ['wss://watch.example']);
    expect(relays()).toEqual(['wss://watch.example', ...DEFAULT_RELAYS]);
    expect(watchRelays(), 'the watch itself stays on its own relays').toEqual(['wss://watch.example']);
    expect(ownRelays(), 'what the operator edits is their own part').toEqual([...DEFAULT_RELAYS]);
  });

  it('keeps the operator’s own list beside the watch’s, each relay once', () => {
    set('accruing', 'watchtower', 'f'.repeat(64));
    set('accruing', 'relays', ['wss://watch.example']);
    setRelays(['wss://mine.example', 'wss://watch.example']);
    expect(relays()).toEqual(['wss://watch.example', 'wss://mine.example']);
  });
});
