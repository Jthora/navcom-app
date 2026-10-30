/**
 * Who a `Distress` reaches, as Status and sign-on both say it [distress-read.ts].
 *
 * It read *No addressee* to an operator with no watch whose own person was set, while the Distress
 * screen put that person first: the one net most operators have, called absent on the screen that
 * says what is behind them [the live walk, 2026-10-29].
 */

import { describe, expect, it } from 'vitest';
import { wordCount } from './panel';
import { distressRead } from './distress-read';

const base = { reachable: 0, configured: false, station: false, person: null };

describe('who a Distress reaches', () => {
  it('names your own person when no watch would raise anybody, and says you press send', () => {
    expect(distressRead({ ...base, person: 'Sam' })).toEqual({ value: 'Your person', tone: 'neutral', sub: 'Sam: you press send' });
  });

  it('says it reaches nobody when nobody at all is set, as before', () => {
    expect(distressRead(base)).toEqual({ value: 'No addressee', tone: 'warn', sub: 'pages nobody, and says so' });
  });

  it('puts the watch first when a person is on station, and your person beside them', () => {
    expect(distressRead({ ...base, configured: true, station: true }).value).toBe('To the watch');
    expect(distressRead({ ...base, configured: true, station: true, person: 'Sam' }).sub).toBe('and Sam, by your own text');
  });

  it('pages on-call when anybody can be raised, whatever else is set', () => {
    expect(distressRead({ ...base, reachable: 2, configured: true, person: 'Sam' }).value).toBe('Pages on-call');
    expect(distressRead({ ...base, reachable: 1, configured: true }).sub).toBeNull();
  });

  it('never calls a watch nobody is on, and that this page cannot send to, a way to be reached', () => {
    expect(distressRead({ ...base, configured: false, station: true }).value).toBe('No addressee');
  });

  it('keeps every value to the panel’s five words', () => {
    for (const reachable of [0, 1]) {
      for (const configured of [false, true]) {
        for (const station of [false, true]) {
          for (const person of [null, 'Sam']) expect(wordCount(distressRead({ reachable, configured, station, person }).value)).toBeLessThanOrEqual(5);
        }
      }
    }
  });
});
