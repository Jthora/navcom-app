/**
 * What the receipt says about where the watch is heard, word for word [relay-lists §7].
 *
 * §7's table is normative, so its three sentences are asserted exactly. **A count of relays is not
 * a count of people**, and §7 asks for a test of the wording: none of the count's words names a
 * person, and the receipt says it counts relays in those words.
 */
import { describe, expect, it } from 'vitest';
import { THE_RECORD, whyNotListable } from '@navcom/core';
import { HEARD_RULE, NOT_PEOPLE, ago, heardLine, heardReadout, relayLine, withheldLine, type HeardState } from './heard-copy';
import { isOverlong } from './panel';

/** Words that would make a count of relays read as a count of people. */
const PEOPLE = /\b(people|person|someone|somebody|anyone|anybody|nobody|operators?|watchers?|listeners?|on call)\b/i;

const CASES: [number | null, number][] = [
  [3, 3],
  [2, 3],
  [1, 3],
  [1, 1],
  [0, 3],
  [0, 2],
  [0, 1],
  [0, 0],
  [null, 3],
  [null, 1],
  [null, 0]
];

const STATES: HeardState[] = ['heard', 'stale', 'dark', 'superseded', 'ahead', 'corrupt', 'none', 'unanswered'];

describe('§7’s sentence, before sign-on', () => {
  it('is the table’s own words, exactly', () => {
    expect(heardLine(2, 3)).toBe('Heard on 2 of 3 relays');
    expect(heardLine(1, 3)).toBe('Heard on 1 relay only: if it fails, nothing would hear a Distress');
    expect(heardLine(1, 1)).toBe('Heard on 1 relay only: if it fails, nothing would hear a Distress');
    expect(heardLine(0, 3)).toBe('Not heard on any of 3 relays. If the watch moved, ask whoever gave you its address');
  });

  it('words the two cases the table does not name the same way', () => {
    expect(heardLine(0, 1)).toBe('Not heard on its only relay. If the watch moved, ask whoever gave you its address');
    expect(heardLine(0, 0)).toBe('Not heard on any relay: none this watch names may carry a Distress');
  });

  it('says this phone could not ask when no relay answered, and never sends anybody after the watch', () => {
    expect(heardLine(null, 3)).toBe('Unknown: no relay answered, so this phone could not ask where the watch is heard');
    expect(heardLine(null, 1)).toBe(heardLine(null, 3));
    expect(heardLine(null, 3)).not.toMatch(/watch moved/);
    // A watch that names nothing a Distress may go to is that, whatever answered.
    expect(heardLine(null, 0)).toBe(heardLine(0, 0));
  });
});

describe('the count as a readout', () => {
  it('fits a readout every time, under the key that carries "Heard on"', () => {
    for (const [on, of] of CASES) {
      const r = heardReadout(on, of);
      expect(isOverlong(r.value), `${on} of ${of}: "${r.value}" is a sentence`).toBe(false);
    }
    expect(heardReadout(2, 3)).toEqual({ value: '2 of 3 relays', tone: 'neutral', sub: null });
    expect(heardReadout(1, 3)).toMatchObject({ value: '1 relay only', tone: 'warn' });
    expect(heardReadout(0, 3)).toMatchObject({ value: 'Nowhere', tone: 'warn', sub: 'not on any of 3 relays' });
    expect(heardReadout(0, 1)).toMatchObject({ value: 'Nowhere', sub: 'not on its one relay' });
    expect(heardReadout(0, 0)).toMatchObject({ value: 'Nowhere', sub: 'no relay it names may carry one' });
    expect(heardReadout(null, 3)).toEqual({ value: 'Unknown', tone: 'cold', sub: 'no relay answered this phone' });
  });

  it('never reads as good: one relay, or none, is the thin part, said loudest', () => {
    for (const [on, of] of CASES) expect(heardReadout(on, of).tone).not.toBe('good');
    expect(heardReadout(1, 3).tone).toBe('warn');
  });
});

describe('a count of relays, never of people', () => {
  it('names nobody in any line, value or qualifier', () => {
    for (const [on, of] of CASES) {
      const r = heardReadout(on, of);
      for (const said of [heardLine(on, of), r.value, r.sub ?? '']) {
        expect(said, `${on} of ${of}: "${said}"`).not.toMatch(PEOPLE);
      }
    }
    expect(HEARD_RULE).not.toMatch(PEOPLE);
  });

  it('names nobody in any relay’s line either, in the same Why', () => {
    for (const state of STATES) {
      for (const refused of [null, 'blocked: no']) {
        const said = relayLine({ url: 'wss://a.relay', state, ageSeconds: 30, refused });
        expect(said, `${state}: "${said}"`).not.toMatch(PEOPLE);
      }
    }
    // Core's reason for a mission relay names a kind of traffic, "operator traffic", not anybody, and is
    // allowed as that phrase alone: any other person word in the line still fails.
    const withheld = withheldLine({ url: THE_RECORD, reason: whyNotListable(THE_RECORD)! });
    expect(withheld).toMatch(/operator traffic/);
    expect(withheld.replace(/\boperator traffic\b/g, 'traffic')).not.toMatch(PEOPLE);
  });

  it('says what it counts, in those words', () => {
    expect(NOT_PEOPLE).toContain('This counts relays, not people');
    expect(NOT_PEOPLE).toMatch(/nothing about whether anybody is awake/);
  });

  it('says what counts, all four conditions', () => {
    expect(HEARD_RULE).toMatch(/Distress from this phone would go there/);
    expect(HEARD_RULE).toMatch(/answered this phone/);
    expect(HEARD_RULE).toMatch(/under five minutes old/);
    expect(HEARD_RULE).toMatch(/did not refuse this phone’s last signal/);
  });
});

describe('ages and relay lines', () => {
  it('reads an age at a glance', () => {
    expect(ago(59)).toBe('59s');
    expect(ago(119)).toBe('119s');
    expect(ago(300)).toBe('5 min');
    expect(ago(7200)).toBe('2 h');
    expect(ago(-4)).toBe('0s');
  });

  it('gives each relay by its host, where it came from, and what it showed', () => {
    const line = (state: HeardState, ageSeconds: number | null = 12, refused: string | null = null) =>
      relayLine({ url: 'wss://a.relay', state, ageSeconds, refused });
    expect(line('heard')).toBe('a.relay — handed over. The watch was last heard there 12s ago.');
    expect(line('stale', 400)).toMatch(/last heard there 7 min ago, more than five minutes, so it does not count/);
    expect(line('ahead')).toMatch(/dated ahead of this phone’s clock/);
    expect(line('none', null)).toMatch(/holds no state from this watch/);
    expect(line('unanswered', null)).toMatch(/has not answered this phone/);
  });

  it('adds a refusal of this phone’s last signal, in the relay’s words, clipped and on one line', () => {
    expect(relayLine({ url: 'wss://c.relay', state: 'heard', ageSeconds: 5, refused: 'blocked: no.' })).toBe(
      'c.relay — handed over. The watch was last heard there 5s ago. It refused this phone’s last signal: blocked: no.'
    );
    const long = relayLine({ url: 'wss://c.relay', state: 'heard', ageSeconds: 5, refused: `x\u202e${'y'.repeat(400)}` });
    expect(long).not.toMatch(/\u202e/);
    expect(long, 'clipped, and still closed').toMatch(/y…\.$/);
    expect(long.length).toBeLessThanOrEqual(260);
  });

  it('names a relay nothing is sent to, and why', () => {
    expect(withheldLine({ url: 'wss://record.example', reason: 'a mission relay: it keeps everything' })).toBe(
      'record.example — not counted, and nothing is sent there: a mission relay: it keeps everything.'
    );
  });
});
