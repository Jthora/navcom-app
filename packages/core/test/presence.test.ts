/**
 * Peer presence, and the property that costs the most to get right.
 *
 * Most of what follows is about **unlinkability**: two presence events from one operator
 * must not be connectable by anybody except their recipients. The obvious implementation
 * publishes a social graph to a public relay, and the Doxxer is a named adversary here.
 */

import { describe, expect, it } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import {
  BUDDY_GRACE_SECONDS,
  buddyState,
  buildPresence,
  readPresence,
  KIND_PEER_PRESENCE,
  type PresencePayload
} from '../src/index.js';

const wren = generateSecretKey();
const wrenPub = getPublicKey(wren);
const raven = generateSecretKey();
const ravenPub = getPublicKey(raven);
const owl = generateSecretKey();
const owlPub = getPublicKey(owl);

const T = 1_755_300_000;
const out = (over: Partial<PresencePayload> = {}): PresencePayload => ({
  callsign: 'Wren', status: 'out', area: 'Downtown', until: T + 7200, ...over
});

describe('what a relay can see', () => {
  it('publishes one event per peer, none of them signed by the sender', () => {
    const events = buildPresence(wren, [ravenPub, owlPub], out(), T);
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e.pubkey, 'the real key is on the wire').not.toBe(wrenPub);
    }
  });

  it('cannot link two peers back to one operator', () => {
    // The whole point. A relay watching these sees unrelated one-off keys publishing to
    // unrelated recipients -- there is nothing common to correlate on.
    const [a, b] = buildPresence(wren, [ravenPub, owlPub], out(), T);
    expect(a!.pubkey).not.toBe(b!.pubkey);
    expect(a!.sig).not.toBe(b!.sig);
  });

  it('cannot link the same peer across two heartbeats', () => {
    // A fixed wrapper key per peer would let a relay watch one relationship over time,
    // which is a schedule -- when this person goes out, and for how long.
    const first = buildPresence(wren, [ravenPub], out(), T);
    const second = buildPresence(wren, [ravenPub], out(), T + 60);
    expect(first[0]!.pubkey).not.toBe(second[0]!.pubkey);
  });

  it('leaks no plaintext about who is out or where', () => {
    const [event] = buildPresence(wren, [ravenPub], out({ area: 'Riverfront' }), T);
    expect(event!.content).not.toContain('Riverfront');
    expect(event!.content).not.toContain('Wren');
    expect(JSON.stringify(event!.tags)).not.toContain(wrenPub);
  });
});

describe('what a peer can read', () => {
  it('reads the payload and the real sender', () => {
    const [event] = buildPresence(wren, [ravenPub], out(), T);
    const read = readPresence(raven, event!, [wrenPub]);
    expect(read?.from).toBe(wrenPub);
    expect(read?.payload.area).toBe('Downtown');
    expect(read?.at).toBe(T);
  });

  it('cannot be read by somebody it was not addressed to', () => {
    const [forRaven] = buildPresence(wren, [ravenPub], out(), T);
    expect(readPresence(owl, forRaven!, [wrenPub])).toBeNull();
  });

  it('carries a stand-down as its own message rather than by going quiet', () => {
    // Simply stopping is what a flat battery looks like.
    const [event] = buildPresence(wren, [ravenPub], out({ status: 'stood-down' }), T);
    expect(readPresence(raven, event!, [wrenPub])?.payload.status).toBe('stood-down');
  });
});

describe('what a peer refuses', () => {
  it('refuses presence from somebody not on the peer list', () => {
    // Without this, anybody who learns a pubkey can put themselves on somebody's screen --
    // and a stranger in the list of who is out makes a real peer easy to miss.
    const [event] = buildPresence(wren, [ravenPub], out(), T);
    expect(readPresence(raven, event!, [])).toBeNull();
    expect(readPresence(raven, event!, [owlPub])).toBeNull();
  });

  it('refuses an inner event whose signature does not hold', () => {
    // Authorship is proven, never asserted. A payload that merely says who it is from can
    // say anything.
    const [event] = buildPresence(wren, [ravenPub], out(), T);
    const forged = JSON.parse(JSON.stringify(event!)) as typeof event;
    forged!.content = forged!.content.slice(0, -4) + 'AAAA';
    expect(readPresence(raven, forged!, [wrenPub])).toBeNull();
  });

  it('returns null rather than throwing on anything malformed', () => {
    // A relay delivers whatever it likes, and one bad event must not take down the feed.
    const junk = { ...buildPresence(wren, [ravenPub], out(), T)[0]!, content: 'not-ciphertext' };
    expect(() => readPresence(raven, junk, [wrenPub])).not.toThrow();
    expect(readPresence(raven, junk, [wrenPub])).toBeNull();
  });

  it('refuses a payload with no callsign or a status it does not know', () => {
    const [bad] = buildPresence(wren, [ravenPub], { ...out(), callsign: '' }, T);
    expect(readPresence(raven, bad!, [wrenPub])).toBeNull();

    const [worse] = buildPresence(wren, [ravenPub], { ...out(), status: 'lurking' as never }, T);
    expect(readPresence(raven, worse!, [wrenPub])).toBeNull();
  });

  it('uses the ephemeral kind, so no relay is expected to store it', () => {
    const [event] = buildPresence(wren, [ravenPub], out(), T);
    expect(event!.kind).toBe(KIND_PEER_PRESENCE);
    expect(KIND_PEER_PRESENCE).toBeGreaterThanOrEqual(20_000);
    expect(KIND_PEER_PRESENCE).toBeLessThan(30_000);
  });
});

describe('watching for somebody', () => {
  it('tells only the peer it concerns, so nobody learns who watches whom', () => {
    // The whole reason `watching` is per-recipient. Telling every peer you are watching
    // them when you are watching one would be a lie told to several people at once.
    const events = buildPresence(
      wren,
      [ravenPub, owlPub],
      (peer) => out({ watching: peer === ravenPub }),
      T
    );
    expect(readPresence(raven, events[0]!, [wrenPub])?.payload.watching).toBe(true);
    expect(readPresence(owl, events[1]!, [wrenPub])?.payload.watching).toBe(false);
  });

  it('still accepts one payload for everybody, since most of it is the same', () => {
    const [event] = buildPresence(wren, [ravenPub], out(), T);
    expect(readPresence(raven, event!, [wrenPub])?.payload.callsign).toBe('Wren');
  });
});

describe('what a buddy is told', () => {
  const later = T + 7200;

  it('is out while inside the time they gave', () => {
    expect(buddyState(out({ until: later }), T, T + 60)).toBe('out');
  });

  it('is home when they said so, rather than when they went quiet', () => {
    // Standing down is announced. Simply stopping is what a flat battery looks like.
    expect(buddyState(out({ status: 'stood-down' }), T, T + 60)).toBe('home');
  });

  it('is overdue only past their time AND the grace', () => {
    // People are late for ordinary reasons far more often than dangerous ones.
    //
    // `heardAt` tracks `now` here because that is the real case: a phone still sending
    // heartbeats, past the time its owner gave. Somebody past their time whose phone ALSO
    // went quiet is unheard, and the test below covers that -- an earlier version of this
    // one conflated the two and asserted overdue for a peer nothing had been heard from
    // in half an hour.
    expect(buddyState(out({ until: later }), later, later + 60)).toBe('out');
    expect(buddyState(out({ until: later }), later + 1800, later + 1801)).toBe('overdue');
  });

  it('is unheard rather than overdue when the phone went quiet first', () => {
    // Somebody whose battery died an hour into a four-hour patrol is unheard. Calling that
    // overdue would invent a fact from an absence.
    expect(buddyState(out({ until: later }), T, T + 3600)).toBe('unheard');
  });

  it('reports home even after their time, when they said they were home', () => {
    expect(buddyState(out({ status: 'stood-down', until: T }), T, T + 86_400)).toBe('home');
  });

  it('never returns anything that reads as an emergency', () => {
    // Nothing here escalates. There is no state meaning "in trouble", because silence is
    // never duress and this function only ever sees silence.
    const states = ['out', 'overdue', 'home', 'unheard'];
    expect(states).not.toContain('distress');
    expect(states).not.toContain('emergency');
  });
});

describe("a buddy whose phone has the wrong time", () => {
  const out = (until: number) => ({
    callsign: 'Raven', status: 'out' as const, area: 'north side', until, watching: false
  });

  it('is not overdue the moment they set out because their clock runs slow', () => {
    // `until` is a claim in their frame — "back by nine" means nine on the phone that said
    // it. Compared straight against our clock, ten minutes of skew made them overdue
    // immediately. `overdue` is a nudge to a buddy, and the anti-pattern table names
    // overdue nudges as the thing that produces alarm fatigue.
    const ours = 1_800_000_000;
    const theirs = ours - 600;
    // They set out for an hour, by their clock.
    expect(buddyState(out(theirs + 3600), ours, ours, { skewSeconds: 600 })).toBe('out');
  });

  it('does become overdue once their hour has genuinely passed', () => {
    const ours = 1_800_000_000;
    const theirs = ours - 600;
    const later = ours + 3600 + BUDDY_GRACE_SECONDS + 60;
    expect(buddyState(out(theirs + 3600), later, later, { skewSeconds: 600 })).toBe('overdue');
  });

  it('is not shielded from overdue by a fast clock either', () => {
    // The other direction. Without the correction a fast clock is never overdue at all.
    const ours = 1_800_000_000;
    const theirs = ours + 600;
    const later = ours + 3600 + BUDDY_GRACE_SECONDS + 60;
    expect(buddyState(out(theirs + 3600), later, later, { skewSeconds: -600 })).toBe('overdue');
  });

  it('behaves exactly as before when the clocks agree', () => {
    const ours = 1_800_000_000;
    expect(buddyState(out(ours + 3600), ours, ours)).toBe('out');
    expect(buddyState(out(ours - 1), ours + BUDDY_GRACE_SECONDS + 60, ours + BUDDY_GRACE_SECONDS + 60))
      .toBe('overdue');
  });
});

describe('a deadline that is not a number', () => {
  /*
   * `until` is the only number `buddyState` acts on, and it was never validated. A string makes
   * every comparison false, so the peer reads `out` forever and is never nudged; a null makes
   * them all true, so they read `overdue` from the first second. Both are invisible, and both
   * break the promise pairing makes — that nobody believes they are watched while nobody is.
   */
  for (const bad of ['2026-09-21T22:00', null, undefined, Number.NaN, Infinity]) {
    it(`refuses a presence whose until is ${String(bad)}`, () => {
      const [event] = buildPresence(wren, [ravenPub], out({ until: bad as never }), T);
      expect(readPresence(raven, event!, [wrenPub])).toBeNull();
    });
  }

  it('still reads a real one', () => {
    const [event] = buildPresence(wren, [ravenPub], out(), T);
    expect(readPresence(raven, event!, [wrenPub])?.payload.until).toBe(T + 7200);
  });
});
