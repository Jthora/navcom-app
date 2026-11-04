import { beforeEach, describe, expect, it, vi } from 'vitest';

let mod: typeof import('./watch-night.svelte');
const store = new Map<string, string>();

beforeEach(async () => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  });
  vi.resetModules();
  mod = await import('./watch-night.svelte');
});

describe('what the watch did tonight', () => {
  it('keeps each action in order, and survives a reload of the screen', async () => {
    mod.night.note('Took the watch', 1_800_000_000);
    mod.night.note('Answered Raven’s query, after 40s', 1_800_000_060);
    vi.resetModules();
    const again = await import('./watch-night.svelte');
    expect(again.night.entries.map((e) => e.what)).toEqual(['Took the watch', 'Answered Raven’s query, after 40s']);
  });

  it('is tonight’s: it lives in the tier a panic wipe destroys', () => {
    mod.night.note('Took the watch');
    const tier = [...store.keys()].find((k) => (store.get(k) ?? '').includes('Took the watch'));
    expect(tier).toBeDefined();
    expect(tier).toMatch(/wipe/i);
  });

  it('copies out as one line each, with the time', () => {
    mod.night.note('Took the watch', 1_800_000_000);
    expect(mod.night.text()).toBe('2027-01-15 08:00Z  Took the watch');
  });

  it('is cleared by the holder, and bounded', () => {
    for (let i = 0; i < 450; i++) mod.night.note(`n${i}`, i);
    expect(mod.night.entries).toHaveLength(400);
    expect(mod.night.entries[0]!.what).toBe('n50');
    mod.night.clear();
    expect(mod.night.entries).toHaveLength(0);
  });

  it('says how long a signal waited', () => {
    expect(mod.waited(40)).toBe('after 40s');
    expect(mod.waited(300)).toBe('after 5 min');
  });

  it('sums the night up for whoever reviews it: how many of each it answered, the middle wait and the longest, a Distress first', () => {
    mod.night.note('Answered Kite’s query, after 40s', 1_800_000_060, { type: 'query', waited: 40 });
    mod.night.note('Acknowledged Raven’s distress, after 25s', 1_800_000_100, { type: 'distress', waited: 25 });
    mod.night.note('Answered Owl’s query, after 6 min', 1_800_000_500, { type: 'query', waited: 360 });
    mod.night.note('Answered Ash’s query, after 90s', 1_800_000_600, { type: 'query', waited: 90 });
    mod.night.note('Took the watch', 1_800_000_000);
    expect(mod.night.recap()).toEqual([
      { type: 'distress', count: 1, median: 25, longest: 25 },
      { type: 'query', count: 3, median: 90, longest: 360 }
    ]);
    // Copied out, the recap leads, and the night follows as it happened.
    const lines = mod.night.text().split('\n');
    expect(lines.slice(0, 3)).toEqual(['1 distress: middle 25s, longest 25s', '3 query: middle 90s, longest 6 min', '']);
    // And it holds the watch's own acts only: no words anybody sent, no place.
    expect(JSON.stringify(mod.night.entries)).not.toMatch(/Herald|lat|lon/);
  });

  it('says nothing to sum when the watch answered nothing', () => {
    mod.night.note('Took the watch', 1_800_000_000);
    expect(mod.night.recap()).toEqual([]);
    expect(mod.night.text()).toBe('2027-01-15 08:00Z  Took the watch');
  });
});
