/**
 * The words on the screen a repeat page opens [`escalation.spec.md`, *Wake the others*].
 *
 * Fixed words, with every number taken from the page that opened the screen. Where the page did not
 * say, the sentence goes without the number rather than with a guess — a person woken at 3am acts on
 * "in 4 min", and a 4 that is wrong sends them back to sleep while the operator keeps sending.
 */
import { describe, expect, it } from 'vitest';
import { wakeFrom, wakeWords } from './wake';

const NOW = 1_800_000_000;
const A = 'a'.repeat(64);

describe('what the screen was opened with', () => {
  it('reads the attempt and the times a repeat page carries', () => {
    expect(wakeFrom(`?attempt=${A}&paged=${NOW}&acked=${NOW - 720}&widens=${NOW + 240}`, NOW)).toEqual({
      attempt: A,
      pagedAt: NOW,
      ackedAt: NOW - 720,
      widensAt: NOW + 240
    });
  });

  it('takes nothing that is not an id or a time, because anybody can send anybody a link', () => {
    expect(wakeFrom(`?attempt=${A.toUpperCase()}&paged=soon&acked=-5&widens=${NOW + 9_999_999}`, NOW)).toEqual({
      attempt: null,
      pagedAt: null,
      ackedAt: null,
      widensAt: null
    });
    expect(wakeFrom('', NOW).attempt).toBeNull();
  });
});

describe('the words', () => {
  it('say when they acknowledged, and when the watch treats it as new, where the page said', () => {
    const w = wakeWords({ attempt: A, pagedAt: NOW, ackedAt: NOW - 720, widensAt: NOW + 240 }, NOW);
    expect(w.lead).toBe('Distress again from the operator you acknowledged 12 min ago.');
    expect(w.next).toBe('If their phone is still sending in 4 min, the watch treats it as new and pages everyone.');
  });

  it('say the next attempt does it, once that time has passed', () => {
    const w = wakeWords({ attempt: A, pagedAt: NOW - 400, ackedAt: NOW - 900, widensAt: NOW - 10 }, NOW);
    expect(w.next).toBe('If their phone is still sending, the watch treats its next attempt as new and pages everyone.');
  });

  it('give no number they do not have', () => {
    const w = wakeWords({ attempt: A, pagedAt: null, ackedAt: null, widensAt: null }, NOW);
    expect(w.lead).toBe('Distress again from an operator you acknowledged.');
    expect(`${w.lead} ${w.next}`).not.toMatch(/\d/);
  });

  it('say what the watch does as built, with no time, when the page said only when it arrived [review: live hole, phone]', () => {
    /*
     * As built, the executor pages only the person who acknowledged, once an interval, until the hold
     * ends — `ack_holds_seconds`, 30 minutes by default and longer where a box sets it. Silence widens
     * is not built. "Pages everyone, not sooner than 5 min from now" sent somebody back to sleep for
     * up to 25 minutes more with nobody else woken.
     */
    for (const pagedAt of [NOW, NOW - 60, NOW - 600]) {
      const w = wakeWords({ attempt: A, pagedAt, ackedAt: null, widensAt: null }, NOW);
      expect(w.next).toBe(
        'If their phone keeps sending, you are paged again. The watch may not page everyone until your acknowledgement stops holding.'
      );
      expect(w.next, 'a time the page never gave').not.toMatch(/\d|min|soon/);
    }
  });

  it('never say anybody has it, or that nobody else was woken', () => {
    for (const ctx of [
      { attempt: A, pagedAt: NOW, ackedAt: NOW - 30, widensAt: NOW + 300 },
      { attempt: null, pagedAt: null, ackedAt: null, widensAt: null }
    ]) {
      const { lead, next } = wakeWords(ctx, NOW);
      expect(`${lead} ${next}`).not.toMatch(/has it|nobody else|no one else|closed/i);
    }
    expect(wakeWords({ attempt: A, pagedAt: NOW, ackedAt: NOW - 30, widensAt: null }, NOW).lead).toBe(
      'Distress again from the operator you acknowledged under a minute ago.'
    );
  });
});
