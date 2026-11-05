import { describe, expect, it } from 'vitest';
import { ANSWER_MS, noWatchSays, phaseAt, PRETEND, pretendAnswer, SIGNAL_BACK_MS, type PracticeItem } from './practice';

const item = (over: Partial<PracticeItem>): PracticeItem => ({ id: 1, kind: 'query', pressedAt: 0, noSignal: false, noWatch: false, ...over });

describe('practice against a pretend watch', () => {
  it('waits for the watch, then answers', () => {
    expect(phaseAt(item({}), 0)).toEqual({ phase: 'waiting', sentAt: 0 });
    expect(phaseAt(item({}), ANSWER_MS.query - 1).phase).toBe('waiting');
    expect(phaseAt(item({}), ANSWER_MS.query).phase).toBe('answered');
  });

  it('with no signal, waits for signal first, then goes by itself and is answered after', () => {
    const i = item({ kind: 'check-in', noSignal: true });
    expect(phaseAt(i, SIGNAL_BACK_MS - 1)).toEqual({ phase: 'waiting-signal', sentAt: null });
    expect(phaseAt(i, SIGNAL_BACK_MS)).toEqual({ phase: 'waiting', sentAt: SIGNAL_BACK_MS });
    expect(phaseAt(i, SIGNAL_BACK_MS + ANSWER_MS['check-in']).phase).toBe('answered');
  });

  it('with no watch, says so at once and never answers', () => {
    for (const kind of ['check-in', 'query', 'assist', 'distress'] as const) {
      expect(phaseAt(item({ kind, noWatch: true }), 10 ** 9).phase).toBe('no-watch');
    }
    expect(noWatchSays('distress').value).toBe('No watch to send it to');
  });

  it('says it is pretend on every answer, and a Distress answer is never a name', () => {
    for (const kind of ['check-in', 'query', 'assist', 'distress'] as const) {
      expect(pretendAnswer(kind).sub).toContain(PRETEND);
    }
    expect(pretendAnswer('distress').value).toBe('Answered');
  });

  it('a practice answer shows its age and says call first, as a stale record does', () => {
    expect(pretendAnswer('query').sub).toMatch(/checked .* ago · call first/);
  });
});
