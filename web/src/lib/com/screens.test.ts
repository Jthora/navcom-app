/**
 * Com's registry: every screen has an entry and a height, history is read as another version's,
 * and one entry's failure is that entry's alone [groups.md §13].
 */

import { describe, expect, it } from 'vitest';
import { ENTRIES, SCREENS, readScreen, type Screen } from './screens';
import { entryLoader } from './entries.svelte';

/** One of each screen this version has, as `open()` would push it. */
const EACH: Screen[] = [
  { kind: 'missions', province: null },
  { kind: 'missions', province: 'us-ca' },
  { kind: 'mission', address: '30079:abc:d' },
  { kind: 'yours' },
  { kind: 'report', address: '30079:abc:d' },
  { kind: 'reports', address: '30079:abc:d' },
  // A shape tapped on the map, a region's circle, and a record's point in that region.
  // `within` is how far the tap may be from `at`, in km; `unmapped`, how many of a region's places the map does not draw.
  { kind: 'place', code: 'ke', region: null, name: 'Kenya', at: '-1,37', record: null, within: '820', unmapped: null },
  { kind: 'place', code: null, region: 'birmingham-uk', name: 'Birmingham', at: null, record: null, within: null, unmapped: '12' },
  { kind: 'place', code: null, region: 'birmingham-uk', name: 'Birmingham', at: '52.4791,-1.8936', record: '3', within: null, unmapped: null },
  // The map's layers: the picker, a Zone and a Sector by their ZSP ids, which Sector this phone is in
  // (its fix is never in history), and a time zone by its offset.
  { kind: 'layers' },
  { kind: 'zone', id: 'terra:africana' },
  { kind: 'zone', id: 'zone:east-african-rift/sector:afar' },
  { kind: 'lookup' },
  { kind: 'time', offset: '5.75' }
];

describe('the screens Com has', () => {
  it('gives every kind an entry that exists and a height', () => {
    for (const [kind, s] of Object.entries(SCREENS)) {
      expect(Object.keys(ENTRIES), `${kind} names no entry`).toContain(s.entry);
      expect(['half', 'full'], kind).toContain(s.height);
    }
    expect(new Set(EACH.map((s) => s.kind))).toEqual(new Set(Object.keys(SCREENS)));
  });

  it('opens every mission screen at half, so the map stays in view behind it [com.md §7]', () => {
    for (const [kind, s] of Object.entries(SCREENS)) if (s.entry === 'missions') expect(s.height, kind).toBe('half');
  });
});

describe('a screen read back from history', () => {
  it('is shown when this version has it', () => {
    for (const s of EACH) expect(readScreen(structuredClone(s))).toEqual(s);
  });

  it('is not, when another version wrote it: a kind this one lacks, or a field it needs gone', () => {
    // A newer build's people screen, reached by Back after the phone went back to an older one.
    expect(readScreen({ kind: 'profile', handle: 'h1' })).toBeNull();
    expect(readScreen({ kind: 'mission' })).toBeNull();
    expect(readScreen({ kind: 'mission', address: 7 })).toBeNull();
    expect(readScreen({ kind: 'mission', address: null })).toBeNull();
    expect(readScreen({ kind: 'reports', id: '30079:abc:d' })).toBeNull();
    expect(readScreen({ kind: 'zone' })).toBeNull();
    expect(readScreen({ kind: 'time', offset: 3 })).toBeNull();
  });

  it('is not, when a field that may be empty holds something else: it reached the host and threw there', () => {
    // A province that is a number reached MissionList, whose place name splits it, and the sheet
    // read "This screen could not be shown" with a Try again that threw again.
    expect(readScreen({ kind: 'missions', province: 7 })).toBeNull();
    expect(readScreen({ kind: 'missions', province: { code: 'us-ca' } })).toBeNull();
    expect(readScreen({ kind: 'missions' })).toBeNull();
    expect(readScreen({ kind: 'missions', province: null })).toEqual({ kind: 'missions', province: null });
    // A place needs its name, whatever else it lacks: it is what the screen is headed with.
    expect(readScreen({ kind: 'place', code: 'ke', region: null, name: null, at: null, record: null, within: null, unmapped: null })).toBeNull();
    expect(readScreen({ kind: 'place', code: 'ke', region: null, name: 'Kenya', at: null })).toBeNull();
    // A tap's place without how far off it may be would be measured to the kilometre from a guess.
    expect(readScreen({ kind: 'place', code: 'ke', region: null, name: 'Kenya', at: '-1,37', record: null })).toBeNull();
  });

  it('checks every field of every screen it has', () => {
    for (const s of EACH) {
      for (const field of Object.keys(s).filter((k) => k !== 'kind')) {
        expect(readScreen({ ...s, [field]: 7 }), `${s.kind}.${field} as a number`).toBeNull();
      }
    }
  });

  it('is not, when it is not a screen at all', () => {
    for (const raw of [null, undefined, 'missions', 3, [], { kind: 'toString' }, { kind: '__proto__' }, { kind: 'constructor' }, {}]) {
      expect(readScreen(raw), JSON.stringify(raw) ?? String(raw)).toBeNull();
    }
  });
});

describe('each entry, held on its own', () => {
  /** An entry whose arrival the test decides. */
  function gated<H>() {
    let settle!: { ok: (h: H) => void; fail: () => void };
    let calls = 0;
    const load = () => {
      calls += 1;
      return new Promise<{ Host: H }>((ok, fail) => (settle = { ok: (h) => ok({ Host: h }), fail: () => fail(new Error('offline')) }));
    };
    return { load, settle: () => settle, calls: () => calls };
  }

  it('lets a missions chunk that fails leave another entry untouched', async () => {
    const missions = gated<string>();
    const people = gated<string>();
    const loader = entryLoader({ missions: missions.load, people: people.load });
    const both = [loader.load('missions'), loader.load('people')];
    expect(loader.held('missions')).toEqual({ status: 'loading' });
    missions.settle().fail();
    people.settle().ok('PeopleHost');
    await Promise.all(both);
    expect(loader.held('missions')).toEqual({ status: 'failed' });
    expect(loader.held('people')).toEqual({ status: 'ready', Host: 'PeopleHost' });
  });

  it('does not mark an entry nobody asked for', async () => {
    const missions = gated<string>();
    const loader = entryLoader({ missions: missions.load, people: gated<string>().load });
    const p = loader.load('missions');
    missions.settle().fail();
    await p;
    expect(loader.held('people')).toBeUndefined();
  });

  it('asks for an entry once: arriving, arrived, or failed', async () => {
    const missions = gated<string>();
    const loader = entryLoader({ missions: missions.load });
    const first = loader.load('missions');
    // Asked twice while arriving: one fetch, one promise.
    expect(loader.load('missions')).toBe(first);
    missions.settle().fail();
    await first;
    /*
     * Failed stays failed. The browser keeps a module's failure for the life of the page and
     * fetches nothing for a second import of it, so asking again only looked like a retry: the
     * screen said "Not loaded" until the page reloaded, which is what it now offers [ComScreen].
     */
    expect(loader.load('missions')).toBe(first);
    expect(missions.calls()).toBe(1);
    expect(loader.held('missions')).toEqual({ status: 'failed' });

    const arrived = entryLoader({ missions: async () => ({ Host: 'MissionsHost' }) });
    await arrived.load('missions');
    expect(arrived.held('missions')).toEqual({ status: 'ready', Host: 'MissionsHost' });
  });

  it('never rejects, so a screen that opens offline cannot take the page with it', async () => {
    const missions = gated<string>();
    const loader = entryLoader({ missions: missions.load });
    const p = loader.load('missions');
    missions.settle().fail();
    await expect(p).resolves.toBeUndefined();
  });
});
