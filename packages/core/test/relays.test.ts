import { describe, expect, it } from 'vitest';
import { DEFAULT_RELAYS, listable, whyNotListable } from '../src/relays';
import { MISSION_RELAYS, THE_RECORD } from '../src/missions/package';

/**
 * Which addresses may carry operator traffic [G3 phase 1].
 *
 * The owner's decision of 2026-10-07: operator traffic never goes to a private or allowlisted
 * relay, and The Record and the Pi's read-only mirror never receive an operator's event from any
 * path. One rule in core decides it, so the `Distress` loop, the signals and the listeners cannot
 * drift apart.
 */
describe('listable: where operator traffic may go', () => {
  it('refuses every mission relay, however a config spells it', () => {
    expect(MISSION_RELAYS.length, 'nothing to test').toBeGreaterThan(0);
    for (const relay of MISSION_RELAYS) {
      const host = new URL(relay).hostname;
      const spellings = [
        relay,
        `${relay}/`,
        relay.toUpperCase(),
        `https://${host}`,
        `wss://${host}:443`,
        `wss://${host}.`,
        `wss://${host}./`,
        `wss://someone@${host}`,
        `wss://${host}/some/path?x=1`,
        `ws://${host}`,
        host,
        `  ${relay}  `
      ];
      for (const spelling of spellings) {
        expect(listable(spelling), `${spelling} would receive operator traffic`).toBe(false);
        expect(whyNotListable(spelling)).toMatch(/mission relay/);
      }
    }
    expect(listable(THE_RECORD)).toBe(false);
  });

  it('refuses what this pool cannot parse, and anything that is not a relay address', () => {
    for (const bad of ['', '   ', 'wss://', 'wss://a b', 'ftp://relay.example', 'http://', 'wss://:443']) {
      expect(listable(bad), JSON.stringify(bad)).toBe(false);
      expect(whyNotListable(bad)).toBeTruthy();
    }
    for (const junk of [null, undefined, 42, {}, ['wss://relay.example']]) {
      expect(listable(junk), String(junk)).toBe(false);
    }
  });

  it('takes the public relays, a relay on this machine, and a host name with no scheme', () => {
    for (const ok of [...DEFAULT_RELAYS, 'wss://relay.primal.net/', 'ws://127.0.0.1:7777', 'relay.example.org']) {
      expect(whyNotListable(ok), ok).toBeNull();
      expect(listable(ok)).toBe(true);
    }
  });

  it('does not refuse another host on the same domain: the rule is the mission relays, by name', () => {
    expect(listable('wss://relay.cosmiccodex.app')).toBe(true);
    expect(listable('wss://notrecord.cosmiccodex.app')).toBe(true);
  });
});
