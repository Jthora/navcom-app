/**
 * Which relays this device talks to.
 *
 * 9.R established what this list decides: everything an operator sends goes through it, which
 * is why a crafted backup setting it was a real finding. The validation on the operator's own
 * path was equally load-bearing and equally unverified.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { DEFAULT_RELAYS, relays, setRelays, usingDefaults } from './relays';

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
