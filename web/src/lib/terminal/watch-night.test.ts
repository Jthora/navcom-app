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
});
