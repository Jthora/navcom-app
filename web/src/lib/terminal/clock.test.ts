import { describe, expect, it } from 'vitest';
import { BEHIND_TOLERANCE_SECONDS, readClock } from './clock';

const BUILT = '2026-09-01T00:00:00.000Z';
const at = (iso: string) => Date.parse(iso);

describe('reading the device clock against the build it is running', () => {
  it('says nothing about a clock that is ahead of the build, which is every healthy one', () => {
    expect(readClock(BUILT, at('2026-09-01T00:00:01Z')).behind).toBe(false);
    expect(readClock(BUILT, at('2026-11-20T00:00:00Z')).behind).toBe(false);
  });

  it('says nothing about a page opened long after it was built', () => {
    // The ordinary offline case, and the one a naive check would flag: a cached page opened
    // three weeks later is not evidence of anything wrong with the phone.
    expect(readClock(BUILT, at('2026-09-22T00:00:00Z')).behind).toBe(false);
  });

  it('stays quiet inside the staleness margin, which already absorbs a day of drift', () => {
    // Deliberately just inside. A clock in here changes no confidence judgement, so saying
    // so would be noise on the screen where noise is least affordable.
    const inside = at(BUILT) - (BEHIND_TOLERANCE_SECONDS - 60) * 1000;
    expect(readClock(BUILT, inside).behind).toBe(false);
  });

  it('names the week-behind phone, which is the one that actually does harm', () => {
    /*
     * Not the spectacular failure. A phone reset to 1970 reads every record as its own
     * future and everything renders stale — the safe answer, reached by accident. It is
     * seven days of drift that turns a 14-day-old record into a 7-day-old one and shows its
     * hours instead of suppressing them.
     */
    const read = readClock(BUILT, at('2026-08-25T00:00:00Z'));
    expect(read.behind).toBe(true);
    expect(read.behindDays).toBe(7);
  });

  it('names the badly wrong one too, rather than only the subtle one', () => {
    const read = readClock(BUILT, at('2020-01-01T00:00:00Z'));
    expect(read.behind).toBe(true);
    expect(read.behindDays).toBeGreaterThan(2000);
  });

  it('treats a missing or unusable stamp as no evidence, never as a fault', () => {
    // A check that failed closed here would put a warning about the operator's phone on the
    // screen every time a load function changed shape.
    for (const stamp of [null, undefined, '', 'not a date']) {
      expect(readClock(stamp, at('2026-08-25T00:00:00Z')).behind).toBe(false);
    }
  });

  it('reports zero rather than a stale number when it has nothing to report', () => {
    // So a caller cannot render "0 days behind" by reading the figure without the flag.
    const read = readClock(BUILT, at('2026-11-20T00:00:00Z'));
    expect(read.behindSeconds).toBe(0);
    expect(read.behindDays).toBe(0);
  });
});
