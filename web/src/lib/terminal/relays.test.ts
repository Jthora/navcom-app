/**
 * Which relays this device talks to.
 *
 * 9.R established what this list decides: everything an operator sends goes through it, which
 * is why a crafted backup setting it was a real finding. The validation on the operator's own
 * path was equally load-bearing and equally unverified.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  DEFAULT_RELAYS,
  missionRelays,
  ownRelays,
  refusedOwnRelays,
  relays,
  savedOwnRelays,
  setRelays,
  usingDefaults,
  watchRelays
} from './relays';
import { set } from './storage';
import { loadConfig } from './config';
import { watchRelayList } from './watch-relays';
import { operatorRelays } from '$lib/missions/claims';

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

describe('an own list saved before the check, that this page refuses [audit: relay paths, review]', () => {
  // Written straight to storage: `setRelays` filters today, and the list was saved before it did.
  const LAN = ['ws://192.168.1.50:7777', 'ws://192.168.1.51:7777'];

  it('is said, line by line, rather than swapped for the defaults in silence', () => {
    set('accruing', 'relays_own', LAN);
    expect(usingDefaults(), 'the defaults do stand in').toBe(true);
    expect(refusedOwnRelays().map((r) => r.address), 'and the screen can say why').toEqual(LAN);
    expect(refusedOwnRelays()[0]?.why).toMatch(/needs wss:\/\//);
  });

  it('is still there as saved, so it can be fixed rather than retyped', () => {
    set('accruing', 'relays_own', [...LAN, 'wss://mine.example']);
    expect(savedOwnRelays()).toEqual([...LAN, 'wss://mine.example']);
    expect(relays()).toEqual(['wss://mine.example']);
  });

  it('names nothing when nothing was refused', () => {
    setRelays(['wss://mine.example']);
    expect(refusedOwnRelays()).toEqual([]);
  });
});

describe('where mission traffic goes [audit: relay paths, review]', () => {
  /*
   * Peers named "everything" as following the operator's own list, while claims and reports go to
   * the shipped defaults as well, where posters read [mission-interchange spec §5.0]. The screen
   * now names them from `missionRelays`; this holds that to the rule the claims are sent by.
   */
  it('adds the shipped defaults to a list that left them out', () => {
    setRelays(['wss://mine.example']);
    expect(missionRelays()).toEqual(['wss://mine.example', ...DEFAULT_RELAYS]);
  });

  it('is the list claims and reports are actually sent to, in every arrangement', () => {
    const arrangements: (() => void)[] = [
      () => {},
      () => setRelays(['wss://mine.example']),
      () => {
        set('accruing', 'watchtower', 'f'.repeat(64));
        set('accruing', 'relays', ['wss://watch.example']);
      },
      () => {
        set('accruing', 'watchtower', 'f'.repeat(64));
        set('accruing', 'relays', ['wss://watch.example']);
        setRelays(['wss://mine.example', 'wss://nos.lol']);
      }
    ];
    for (const arrange of arrangements) {
      arrange();
      expect(missionRelays()).toEqual(operatorRelays());
    }
  });
});

describe('the watch’s relays, read without its escalation key [budget: public roster]', () => {
  it('are exactly what the whole watch reads', () => {
    const cases: [unknown, unknown][] = [
      [undefined, undefined],
      ['f'.repeat(64), ['wss://watch.example', 'wss://two.example']],
      ['f'.repeat(64), []],
      ['f'.repeat(64), ['not a relay', 42, 'wss://watch.example']],
      ['f'.repeat(64), ['http://nope.example']],
      ['', ['wss://watch.example']]
    ];
    for (const [watchtower, list] of cases) {
      set('accruing', 'watchtower', watchtower);
      set('accruing', 'relays', list);
      expect(watchRelayList(), JSON.stringify([watchtower, list])).toEqual(loadConfig()?.relays ?? null);
    }
  });
});
