import { describe, expect, it } from 'vitest';
import { effort, endsIn, endsSoon, placeName, stampUtc } from './format';

const NOW = Date.UTC(2026, 9, 6, 20, 0, 0);
const at = (hoursFromNow: number) => Math.floor(NOW / 1000) + hoursFromNow * 3600;

describe('how a mission’s place and end read', () => {
  it('names a US state from the package’s own code, and leaves anything else as its code', () => {
    expect(placeName('us-ca')).toBe('California');
    expect(placeName('us-dc')).toBe('Washington, DC');
    expect(placeName('us')).toBe('United States');
    // Not a guess: a code it does not know reads as that code.
    expect(placeName('gb-eng')).toBe('GB-ENG');
    expect(placeName(null)).toBe('—');
  });

  it('says how long is left in the largest whole unit, and says when it has ended', () => {
    expect(endsIn(at(24 * 3 + 5), NOW)).toBe('3 days');
    expect(endsIn(at(30), NOW)).toBe('30 hours');
    expect(endsIn(at(1.5), NOW)).toBe('1 hour');
    expect(endsIn(at(0.25), NOW)).toBe('15 min');
    expect(endsIn(at(-1), NOW)).toBe('Ended');
  });

  it('marks under a day as soon, and nothing that has ended', () => {
    expect(endsSoon(at(5), NOW)).toBe(true);
    expect(endsSoon(at(30), NOW)).toBe(false);
    expect(endsSoon(at(-1), NOW)).toBe(false);
  });

  it('stamps an end the way Mecha Jono’s own clock lines read', () => {
    expect(stampUtc(1791608400)).toBe('10 Oct, 05:00 UTC');
  });

  it('reads effort as an estimate, and says nothing when there is none', () => {
    expect(effort(20)).toBe('about 20 minutes');
    expect(effort(90)).toBe('about 1.5 hours');
    expect(effort(60)).toBe('about 1 hour');
    expect(effort(null)).toBeNull();
  });
});
