/**
 * Invariant 5, as assertions.
 *
 * "Panic wipe destroys the Wipeable tier and nothing else. Burn destroys everything on the
 * device. The node-side accountability log is outside both."
 *
 * Written because the invariant existed only as a comment above two functions that no
 * screen could reach — and a wipe that quietly took the wrong tier would be discovered by
 * an operator who had just lost their standing on the worst night of their year.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  burn, burnArmed, burnCaches, burnConfirmed, clearField, clearStorageError, corruptTiers, get,
  onStorageError, panicWipe, set, storageError, tierSizes, tierSummary
} from './storage';
import * as storage from './storage';
import { pendingMission, rememberMission } from '$lib/missions/pending';

/** Enough of the real thing for these assertions; the browser API is tiny here. */
function makeStorage() {
  const store = new Map<string, string>();
  return {
    store,
    api: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      get length() { return store.size; },
      key: (i: number) => [...store.keys()][i] ?? null
    }
  };
}

function installLocalStorage() {
  const { store, api } = makeStorage();
  (globalThis as Record<string, unknown>).localStorage = api;
  return store;
}

/** This tab's own storage: the pending mission lives here [missions/pending.ts]. */
function installSessionStorage() {
  const { store, api } = makeStorage();
  (globalThis as Record<string, unknown>).sessionStorage = api;
  return store;
}

let raw: Map<string, string>;
let session: Map<string, string>;

beforeEach(() => {
  raw = installLocalStorage();
  session = installSessionStorage();
  set('accruing', 'callsign', 'Wren');
  set('accruing', 'secret', 'deadbeef');
  set('wipeable', 'signon', { area: 'Downtown' });
  set('wipeable', 'draft', 'bed tonight');
});

describe('the two tiers', () => {
  it('keeps them under separate keys, so a wipe cannot take the wrong half', () => {
    // One key holding both tiers would make panic wipe a read-modify-write, and a partial
    // failure there destroys identity. Two keys makes the destructive path a single delete.
    expect([...raw.keys()].sort()).toEqual(['navcom.accruing', 'navcom.wipeable']);
  });

  it('reads corrupt storage as empty rather than refusing to start', () => {
    raw.set('navcom.wipeable', '{not json');
    expect(get('wipeable', 'signon')).toBeNull();
    // And identity is unaffected by the neighbouring corruption.
    expect(get('accruing', 'callsign')).toBe('Wren');
  });
});

describe('panic wipe destroys the Wipeable tier and nothing else', () => {
  it('takes tonight', () => {
    panicWipe();
    expect(get('wipeable', 'signon')).toBeNull();
    expect(get('wipeable', 'draft')).toBeNull();
    expect(tierSummary().wipeable).toEqual([]);
  });

  it('keeps the decade', () => {
    // The whole point of the split: lose the evening, keep identity and standing. An
    // operator who wipes on a bad night must not need re-provisioning by another person
    // before they can work again.
    panicWipe();
    expect(get('accruing', 'callsign')).toBe('Wren');
    expect(get('accruing', 'secret')).toBe('deadbeef');
    expect(raw.has('navcom.accruing')).toBe(true);
  });

  it('is safe to run twice, and on a terminal that has nothing', () => {
    panicWipe();
    panicWipe();
    expect(get('accruing', 'callsign')).toBe('Wren');
  });
});

describe('burn destroys everything on the device', () => {
  it('takes both tiers, identity included', () => {
    burn();
    expect(tierSummary()).toEqual({ accruing: [], wipeable: [] });
    expect(raw.size).toBe(0);
  });

  it('takes the offline caches too, so the claim is true', () => {
    // "Everything on this device" stopped at localStorage until this existed -- the service
    // worker cache kept the cached directory and every terminal page.
    const deleted: string[] = [];
    (globalThis as Record<string, unknown>).caches = {
      keys: async () => ['navcom-terminal-1', 'navcom-terminal-2'],
      delete: async (k: string) => {
        deleted.push(k);
        return true;
      }
    };
    return burnCaches().then(() => {
      expect(deleted.sort()).toEqual(['navcom-terminal-1', 'navcom-terminal-2']);
    });
  });

  it('does not throw where the Cache API is absent', () => {
    delete (globalThis as Record<string, unknown>).caches;
    return expect(burnCaches()).resolves.toBeUndefined();
  });
});

describe('the gate the button asks', () => {
  /*
   * `burnArmed` exists because the wipe screen could not ask `burnConfirmed` anything — it
   * destroys the device as it answers. So the button re-derived the comparison with a raw
   * `!==`, without the NFC normalisation the gate applies and without trimming the stored
   * callsign, and an operator whose name carries combining characters watched the only control
   * that survives seizure stay disabled forever. These assert the two answers agree.
   */
  it('accepts the same name typed in a different normalisation', () => {
    // "José" decomposed (e + combining acute) against the composed form a second keyboard sends.
    expect(burnArmed('Jose\u0301', 'Jos\u00e9')).toBe(true);
    expect(burnArmed('Jos\u00e9', 'Jose\u0301')).toBe(true);
  });

  it('tolerates a stored callsign with surrounding whitespace, as the gate does', () => {
    expect(burnArmed('Wren', ' Wren ')).toBe(true);
  });

  it('refuses a different name, and refuses everything when there is no identity', () => {
    expect(burnArmed('Raven', 'Wren')).toBe(false);
    expect(burnArmed('', null)).toBe(false);
    expect(burnArmed('Wren', null)).toBe(false);
  });

  it('destroys nothing by being asked', () => {
    set('accruing', 'callsign', 'Wren');
    expect(burnArmed('Wren', 'Wren')).toBe(true);
    expect(get('accruing', 'callsign'), 'asking must not burn').toBe('Wren');
  });
});

describe('burn is gated on typing the callsign', () => {
  it('refuses anything that is not an exact match', () => {
    // Surrounding whitespace is tolerated on purpose (see below), so it is not listed here.
    for (const wrong of ['', 'wren', 'Wre', 'Wren2', 'WREN', 'W ren']) {
      expect(burnConfirmed(wrong, 'Wren'), `"${wrong}" should not burn`).toBe(false);
    }
    // Nothing was destroyed by any of those attempts.
    expect(get('accruing', 'callsign')).toBe('Wren');
  });

  it('tolerates the surrounding whitespace a phone keyboard adds', () => {
    expect(burnConfirmed('  Wren  ', 'Wren')).toBe(true);
    expect(tierSummary()).toEqual({ accruing: [], wipeable: [] });
  });

  it('never burns when there is no identity, even on an empty confirmation', () => {
    // The dangerous case: '' === '' would otherwise read as a match and destroy a device
    // whose identity had simply not loaded yet.
    expect(burnConfirmed('', null)).toBe(false);
    expect(get('accruing', 'callsign')).toBe('Wren');
  });
});

describe('tierSummary tells the operator what a wipe would take', () => {
  it('names the fields rather than counting them', () => {
    // A count invites gaming and tells an operator nothing about what they are losing.
    const summary = tierSummary();
    expect(summary.wipeable.sort()).toEqual(['draft', 'signon']);
    expect(summary.accruing.sort()).toEqual(['callsign', 'secret']);
  });

  it('stops naming a field once it is gone', () => {
    clearField('wipeable', 'draft');
    expect(tierSummary().wipeable).toEqual(['signon']);
  });
});


/**
 * What happens when the phone runs out of room.
 *
 * Added by audit. The one storage failure that must not be silent: quota is typically
 * 5–10 MB, and this device accumulates a metro's corrections, peers, endorsements and a
 * patrol record. **An operator whose storage is full silently stops recording patrols** and
 * finds out by looking for one later.
 */
function installRefusingStorage(name = 'QuotaExceededError') {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: () => {
      const e = new Error('exceeded the quota');
      e.name = name;
      throw e;
    },
    removeItem: (k: string) => void store.delete(k)
  };
}

describe('a device that cannot save', () => {
  it('reports the failure rather than throwing into whoever was writing', () => {
    // Throwing surfaces as a rejected click somewhere with no message.
    installRefusingStorage();
    expect(() => set('accruing', 'callsign', 'Wren')).not.toThrow();
    expect(set('accruing', 'callsign', 'Wren')).toBe(false);
  });

  it('says it is out of room, in words an operator can act on', () => {
    installRefusingStorage();
    set('accruing', 'callsign', 'Wren');
    expect(storageError()).toMatch(/out of storage/i);
    expect(storageError()).toMatch(/clearing an area/i);
  });

  it('distinguishes a full phone from a refusing one', () => {
    // Private browsing throws here too. Both mean "this was not saved", but only one is
    // fixed by clearing an area, so only one says so.
    installRefusingStorage('SecurityError');
    set('accruing', 'callsign', 'Wren');
    expect(storageError()).not.toMatch(/out of storage/i);
    expect(storageError()).toMatch(/could not be saved/i);
  });

  it('clears the report once a write succeeds', () => {
    installRefusingStorage();
    set('accruing', 'callsign', 'Wren');
    expect(storageError()).not.toBeNull();

    installLocalStorage();
    expect(set('accruing', 'callsign', 'Wren')).toBe(true);
    expect(storageError()).toBeNull();
  });

  it('does not let a throwing watcher break the write for the caller or any other watcher (found in robustness audit)', () => {
    const seen: (string | null)[] = [];
    const unsubBad = onStorageError(() => {
      throw new Error('a watcher with a bug');
    });
    const unsubGood = onStorageError((m) => seen.push(m));

    installRefusingStorage();
    expect(() => set('accruing', 'callsign', 'Wren')).not.toThrow();
    expect(set('accruing', 'callsign', 'Wren')).toBe(false);
    expect(seen).toContain(storageError());

    unsubBad();
    unsubGood();
  });
});

describe('when it can save', () => {
  it('says so, and the value is there', () => {
    installLocalStorage();
    expect(set('accruing', 'callsign', 'Wren')).toBe(true);
    expect(get<string>('accruing', 'callsign')).toBe('Wren');
    expect(storageError()).toBeNull();
  });

  it('can say what is taking the room', () => {
    // A measurement of a device, not a count of anything anybody did.
    installLocalStorage();
    set('accruing', 'callsign', 'Wren');
    expect(tierSizes().accruing).toBeGreaterThan(0);
    expect(tierSizes().wipeable).toBe(0);
  });
});


/**
 * Storage that is damaged rather than absent.
 *
 * Reading it as empty is right — a terminal that will not start because of a bad key is
 * worse than one that asks to be set up again. Presenting it as a **first run** is not: an
 * operator whose identity blob got damaged saw "pick a callsign" and concluded they had been
 * wiped, and the next write destroyed the only copy.
 */
function installDamagedStorage() {
  const store = new Map<string, string>([['navcom.accruing', '{ not json']]);
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    _store: store
  };
  return store;
}

describe('storage that will not parse', () => {
  it('still starts, rather than refusing to', () => {
    installDamagedStorage();
    expect(() => get('accruing', 'callsign')).not.toThrow();
    expect(get('accruing', 'callsign')).toBeNull();
  });

  it('says so, instead of looking like a fresh phone', () => {
    installDamagedStorage();
    get('accruing', 'callsign');
    expect(corruptTiers()).toContain('accruing');
  });

  it('keeps the damaged text instead of overwriting it', () => {
    // The next write would have destroyed the only copy -- and a damaged blob is JSON in
    // localStorage, which somebody can often read by hand. A decade of standing is worth a
    // few kilobytes of salvage.
    const store = installDamagedStorage();
    set('accruing', 'callsign', 'Wren');
    expect(store.get('navcom.accruing.damaged')).toBe('{ not json');
    expect(store.get('navcom.accruing')).toContain('Wren');
  });

  it('does not overwrite the salvage with a copy of itself', () => {
    // A second failure after the first write has already replaced the original.
    const store = installDamagedStorage();
    set('accruing', 'callsign', 'Wren');
    store.set('navcom.accruing', '{ broken again');
    set('accruing', 'callsign', 'Raven');
    expect(store.get('navcom.accruing.damaged')).toBe('{ not json');
  });

  it('stops reporting once the tier reads again', () => {
    installDamagedStorage();
    get('accruing', 'callsign');
    expect(corruptTiers()).toContain('accruing');

    installLocalStorage();
    set('accruing', 'callsign', 'Wren');
    get('accruing', 'callsign');
    expect(corruptTiers()).not.toContain('accruing');
  });

  it('treats absent storage as absent, not as damaged', () => {
    // A first run really is a first run, and must not be reported as a loss.
    installLocalStorage();
    expect(get('accruing', 'callsign')).toBeNull();
    expect(corruptTiers()).toHaveLength(0);
  });
});

describe('the salvage copy is part of the tier [invariant 5]', () => {
  it('panic wipe destroys a damaged wipeable blob too', () => {
    // Reading corrupt storage keeps the raw text under `.damaged` so it can be recovered by
    // hand. That copy IS the wipeable tier, and it survived the wipe for two passes: the
    // operator holds the button down, watches it clear, and it is still on the phone.
    localStorage.setItem('navcom.wipeable', '{not json');
    get('wipeable', 'callsign');
    expect(localStorage.getItem('navcom.wipeable.damaged')).toBe('{not json');

    panicWipe();
    expect(localStorage.getItem('navcom.wipeable.damaged')).toBeNull();
    expect(localStorage.getItem('navcom.wipeable')).toBeNull();
  });

  it('panic wipe still leaves the accruing tier alone, damaged copy included', () => {
    // "and nothing else" is the other half of the invariant.
    localStorage.setItem('navcom.accruing', '{not json');
    get('accruing', 'callsign');
    panicWipe();
    expect(localStorage.getItem('navcom.accruing.damaged')).toBe('{not json');
  });

  it('burn takes both tiers and both salvage copies', () => {
    localStorage.setItem('navcom.wipeable', '{not json');
    localStorage.setItem('navcom.accruing', 'also not json');
    get('wipeable', 'callsign');
    get('accruing', 'callsign');

    burn();
    for (const key of ['navcom.wipeable', 'navcom.accruing',
                       'navcom.wipeable.damaged', 'navcom.accruing.damaged']) {
      expect(localStorage.getItem(key)).toBeNull();
    }
  });
});

/**
 * The whole of storage after each destroy path, not the two blobs.
 *
 * Every test above reads `navcom.accruing` and `navcom.wipeable` and nothing else, so they would
 * stay green with tonight's data still on the phone under any other name — the failure the
 * salvage copy already was once. These seed every key this app writes, plus stand-ins for the
 * ones it is about to (a crew roster, a cache), and then list what is left.
 */
describe('everything this app keeps, after a wipe and after a burn [invariant 5]', () => {
  const MISSION = `30079:${'a'.repeat(64)}:heat-relief`;

  /** Every key NavCom writes, in both storages, the way it writes them. */
  function everything() {
    set('accruing', 'callsign', 'Wren');
    set('accruing', 'peers', [{ pubkey: 'b'.repeat(64), callsign: 'Raven', since: 1 }]);
    set('wipeable', 'signon', { area: 'Downtown', since: 1 });
    set('wipeable', 'mission_claims', [{ address: MISSION, ends: 2_000_000_000 }]);
    // The salvage copies, as `read` leaves them for a damaged blob.
    raw.set('navcom.accruing.damaged', '{ last year');
    raw.set('navcom.wipeable.damaged', '{ last night');
    // Wipeable data that is not in the blob [groups.md §8]: a crew roster and a keyed cache.
    raw.set('navcom.wipeable.crews', '{"stand-in":true}');
    raw.set('navcom.wipeable.cache.missions', '{"stand-in":true}');
    // The mission somebody left to take a callsign, in this tab [missions/pending.ts].
    rememberMission(MISSION, 'Heat relief');
  }
  const local = () => [...raw.keys()].sort();
  const ours = (m: Map<string, string>) => [...m.keys()].filter((k) => k.startsWith('navcom.')).sort();

  it('a panic wipe leaves the decade, its salvage copy, and nothing else', () => {
    everything();
    expect(ours(session), 'the test seeded this tab').toHaveLength(2);
    panicWipe();
    expect(local()).toEqual(['navcom.accruing', 'navcom.accruing.damaged']);
    expect(ours(session)).toEqual([]);
    // "and nothing else": the decade reads exactly as it did.
    expect(get('accruing', 'callsign')).toBe('Wren');
    expect(raw.get('navcom.accruing.damaged')).toBe('{ last year');
  });

  it('a burn leaves no key of ours in either storage', () => {
    everything();
    burn();
    expect(local()).toEqual([]);
    expect(ours(session)).toEqual([]);
  });

  it('leaves the framework’s own scroll positions, which are not ours to classify', () => {
    // SvelteKit keeps scroll offsets in this tab under its own name. Numbers, not anything
    // anybody did; named here so the boundary is a decision rather than an accident.
    everything();
    session.set('sveltekit:scroll', '{"1":0}');
    burn();
    expect([...session.keys()]).toEqual(['sveltekit:scroll']);
  });

  it('after a wipe, nothing offers to take anyone back to a mission', () => {
    // Status said "Back to Heat relief" on a phone just wiped: the title outlived the wipe in
    // this tab's storage, which neither destroy path reached.
    everything();
    expect(pendingMission()?.title).toBe('Heat relief');
    panicWipe();
    expect(pendingMission()).toBeNull();
  });

  it('after a burn either', () => {
    everything();
    burn();
    expect(pendingMission()).toBeNull();
  });

  it('a prefix that matched the decade would be the worst bug here, so its neighbours are pinned', () => {
    // `navcom.wipeable` must never be read as a prefix of anything Accruing, or of the root. And a
    // key is tonight's by being *under* the name, not by starting with its letters: a later build's
    // `navcom.wipeablex` or `navcom.wipeable_history` could be somebody's decade.
    everything();
    raw.set('navcom.accruingx', 'not a tier');
    raw.set('navcom.wipeablex', 'not tonight either');
    raw.set('navcom.wipeable_history', 'nor this');
    panicWipe();
    expect(local()).toEqual([
      'navcom.accruing', 'navcom.accruing.damaged', 'navcom.accruingx', 'navcom.wipeable_history', 'navcom.wipeablex'
    ]);
  });

  it('works where this tab has no storage of its own to reach', () => {
    // A private window can refuse sessionStorage; the wipe of localStorage must still happen.
    everything();
    delete (globalThis as Record<string, unknown>).sessionStorage;
    expect(() => panicWipe()).not.toThrow();
    expect(local()).toEqual(['navcom.accruing', 'navcom.accruing.damaged']);
  });
});

/**
 * A wipe is honoured by whatever was already under way.
 *
 * Writers that wait — a debounced save, a publish that records its result — read storage, go
 * away, and come back to write. One that started before a wipe and wrote after it put tonight
 * straight back: a second tab's missions copy recreated `navcom.wipeable` within two seconds.
 * The guard the board already had for its own sends (`board.svelte.ts`, `generation`), moved
 * down to where every writer gets it.
 */
describe('a write that began before a wipe [invariant 5]', () => {
  it('is refused after it, and leaves nothing behind', () => {
    const since = storage.generation('wipeable');
    panicWipe();
    expect(set('wipeable', 'missions', { at: 'then', events: [] }, since)).toBe(false);
    expect(raw.has('navcom.wipeable')).toBe(false);
    // Refused on purpose is not "this phone could not save": nothing for the operator to fix.
    expect(storageError()).toBeNull();
  });

  it('is still written when no wipe came between', () => {
    const since = storage.generation('wipeable');
    expect(set('wipeable', 'missions', { at: 'now', events: [] }, since)).toBe(true);
    expect(get('wipeable', 'missions')).toEqual({ at: 'now', events: [] });
  });

  it('starts again from the wipe: a writer that began after it writes', () => {
    panicWipe();
    const since = storage.generation('wipeable');
    expect(set('wipeable', 'signon', { area: 'Downtown' }, since)).toBe(true);
  });

  it('to the decade, is not refused by a panic wipe, which takes nothing of the decade', () => {
    // "and nothing else": a correction recorded as it lands must not be lost to a wipe of tonight.
    const since = storage.generation('accruing');
    panicWipe();
    expect(set('accruing', 'corrections', { 'st-louis-0001': 'closed' }, since)).toBe(true);
  });

  it('to the decade, is refused by a burn, which takes everything', () => {
    const since = storage.generation('accruing');
    burn();
    expect(set('accruing', 'callsign', 'Wren', since)).toBe(false);
    expect(raw.size).toBe(0);
  });
});

describe('what holds tonight in memory is told of a wipe [invariant 5]', () => {
  it('is told, and told which', () => {
    const heard: string[] = [];
    const stop = storage.onWipe((what) => heard.push(what));
    panicWipe();
    burn();
    stop();
    panicWipe();
    expect(heard).toEqual(['wipe', 'burn']);
  });

  it('is told after the tier is gone, so it cannot read tonight back', () => {
    let seen: unknown = 'not told';
    const stop = storage.onWipe(() => (seen = get('wipeable', 'signon')));
    panicWipe();
    stop();
    expect(seen).toBeNull();
  });

  it('a watcher that throws does not stop the others, or the wipe', () => {
    const heard: string[] = [];
    const bad = storage.onWipe(() => {
      throw new Error('a watcher with a bug');
    });
    const good = storage.onWipe((what) => heard.push(what));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => panicWipe()).not.toThrow();
    quiet.mockRestore();
    bad();
    good();
    expect(heard).toEqual(['wipe']);
    expect(raw.has('navcom.wipeable')).toBe(false);
  });
});

/**
 * Another document's wipe: a second tab, or this one coming back from the back-forward cache.
 *
 * A wipe ran only in the document that wiped. A second tab went on holding tonight in memory
 * and writing it back, and a page restored by Back showed what it had drawn before the wipe.
 * These load storage fresh, in a document with event listeners, and drive those listeners.
 */
describe('a wipe in another document [invariant 5]', () => {
  type Listener = (e: unknown) => void;
  let listeners: Map<string, Listener>;
  let reload: ReturnType<typeof vi.fn>;

  /** Storage as a page loads it, with what hears other documents (`wiped-elsewhere.ts`) attached. */
  async function loaded() {
    listeners = new Map();
    reload = vi.fn();
    vi.stubGlobal('addEventListener', (type: string, fn: Listener) => listeners.set(type, fn));
    vi.stubGlobal('location', { reload });
    vi.resetModules();
    const s = await import('./storage');
    await import('./wiped-elsewhere');
    return s;
  }
  const fire = (type: string, e: unknown) => listeners.get(type)?.(e);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('in a second tab, is honoured here: the registry runs and an older write is refused', async () => {
    const s = await loaded();
    const heard: string[] = [];
    s.onWipe((what) => heard.push(what));
    const since = s.generation('wipeable');
    // This tab's own storage, which only this tab can reach: the wiping tab cleared its own.
    rememberMission(`30079:${'a'.repeat(64)}:heat-relief`, 'Heat relief');

    // The other tab removed it; this one hears the event, after the fact, as a browser delivers it.
    raw.delete('navcom.wipeable');
    fire('storage', { key: 'navcom.wipeable', newValue: null });

    expect(heard).toEqual(['wipe']);
    expect(s.set('wipeable', 'missions', { at: 'then', events: [] }, since)).toBe(false);
    expect(raw.has('navcom.wipeable')).toBe(false);
    expect(pendingMission(), 'this tab still offers the way back after a wipe in another').toBeNull();
  });

  it('a burn in a second tab is a burn here', async () => {
    const s = await loaded();
    const heard: string[] = [];
    s.onWipe((what) => heard.push(what));
    const since = s.generation('accruing');
    fire('storage', { key: 'navcom.accruing', newValue: null });
    expect(heard).toEqual(['burn']);
    expect(s.set('accruing', 'callsign', 'Wren', since)).toBe(false);

    // And storage cleared outright is a burn too.
    const t = await loaded();
    const after: string[] = [];
    t.onWipe((what) => after.push(what));
    fire('storage', { key: null, newValue: null });
    expect(after).toEqual(['burn']);
  });

  it('a burn in a second tab loads this page again, so nothing it holds of the decade is written back', async () => {
    /*
     * Corrections for a metro, places and other people's key bundles are held in memory and
     * written whole on the next event: a correction arriving here after a burn there put the
     * decade back on a phone its owner had just burned.
     */
    const s = await loaded();
    const heard: string[] = [];
    s.onWipe((what) => heard.push(what));
    expect(s.get('accruing', 'callsign')).toBe('Wren');
    raw.clear();
    fire('storage', { key: 'navcom.accruing', newValue: null });
    expect(reload).toHaveBeenCalledTimes(1);
    // Loading again: what it hears after that is not its to act on, and until the new page
    // replaces it, a correction a relay still delivers here is not written.
    fire('storage', { key: 'navcom.wipeable', newValue: null });
    expect(heard).toEqual(['burn']);
    expect(s.set('accruing', 'corrections', { 'st-louis-0001': 'held before the burn' })).toBe(false);
    expect(raw.size).toBe(0);

    /*
     * But not the tab that burned. It hears the other tab clearing up after itself, part-way
     * through its own burn, and a reload there would stop that burn before the offline copies go.
     */
    raw.set('navcom.accruing', '{"callsign":"Wren"}');
    const burning = await loaded();
    burning.get('accruing', 'callsign');
    burning.burn();
    fire('storage', { key: 'navcom.accruing', newValue: null });
    expect(reload).not.toHaveBeenCalled();
    // Once it has an identity again, it is a page like any other.
    burning.set('accruing', 'callsign', 'Raven');
    raw.clear();
    fire('storage', { key: 'navcom.accruing', newValue: null });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a burn heard as two removals, in either order, is one burn', async () => {
    // A burn removes every key of ours, and each removal is an event: a watcher told "wipe" and
    // then "burn", or the reverse, would act on an identity it was about to drop as one it keeps.
    for (const order of [['navcom.accruing', 'navcom.wipeable'], ['navcom.wipeable', 'navcom.accruing']]) {
      raw.set('navcom.accruing', '{"callsign":"Wren"}');
      raw.set('navcom.wipeable', '{"signon":{}}');
      const s = await loaded();
      const heard: string[] = [];
      s.onWipe((what) => heard.push(what));
      s.get('accruing', 'callsign');
      s.get('wipeable', 'signon');
      raw.clear();
      for (const key of order) fire('storage', { key, newValue: null });
      expect(heard, order.join(' then ')).toEqual(['burn']);
    }

    // And the burning tab sends the decade first, so another tab hears the burn first.
    raw.clear();
    raw.set('navcom.wipeable', '{"signon":{}}');
    raw.set('navcom.accruing', '{"callsign":"Wren"}');
    const removed: string[] = [];
    const remove = localStorage.removeItem;
    localStorage.removeItem = (k: string) => (removed.push(k), remove(k));
    burn();
    expect(removed).toEqual(['navcom.accruing', 'navcom.wipeable']);
  });

  it('a write this page made between the other tab’s wipe and hearing it goes too', async () => {
    // The removal and the event are not one moment: a save landing between them recreated tonight
    // under the old generation, and the event then found nothing to refuse.
    const s = await loaded();
    s.get('wipeable', 'signon');
    raw.delete('navcom.wipeable');
    s.set('wipeable', 'missions', { at: 'then', events: [] });
    fire('storage', { key: 'navcom.wipeable', newValue: null });
    expect(raw.has('navcom.wipeable'), 'a save from before the wipe outlived it').toBe(false);

    /*
     * Only a blob this page made. A tab frozen through a wipe hears it late, after the operator
     * signed on again somewhere else, and that sign-on is not tonight's to take.
     */
    const late = await loaded();
    late.get('accruing', 'callsign');
    late.set('wipeable', 'signon', { area: 'Before' });
    raw.delete('navcom.wipeable');
    raw.set('navcom.wipeable', JSON.stringify({ signon: { area: 'Since' }, '~': 'theirs' }));
    fire('storage', { key: 'navcom.wipeable', newValue: null });
    expect(late.get('wipeable', 'signon')).toEqual({ area: 'Since' });
  });

  it('an ordinary write in a second tab is not a wipe', async () => {
    const s = await loaded();
    const heard: string[] = [];
    s.onWipe((what) => heard.push(what));
    fire('storage', { key: 'navcom.wipeable', newValue: '{"signon":{}}' });
    fire('storage', { key: 'navcom.wipeable.damaged', newValue: null });
    fire('storage', { key: 'navcom.pending-mission', newValue: null });
    expect(heard).toEqual([]);
  });

  it('a page brought back by Back after a wipe draws again from what is left', async () => {
    const s = await loaded();
    const heard: string[] = [];
    s.onWipe((what) => heard.push(what));
    // The page read tonight before it went into the cache...
    expect(s.get('wipeable', 'signon')).toEqual({ area: 'Downtown' });
    // ...and while it was frozen another page of this tab wiped. A frozen page hears no event.
    raw.delete('navcom.wipeable');
    fire('pageshow', { persisted: true });
    expect(heard).toEqual(['wipe']);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('after a burn, as a burn', async () => {
    const s = await loaded();
    const heard: string[] = [];
    s.onWipe((what) => heard.push(what));
    s.get('accruing', 'callsign');
    raw.clear();
    fire('pageshow', { persisted: true });
    expect(heard).toEqual(['burn']);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('after a wipe and a new sign-on, which leave a blob on the phone again', async () => {
    /*
     * Asking only whether the blob was there missed this: wipe, sign on again, then Back to a page
     * frozen before the wipe, which found a blob and went on drawing — and saving — what it held.
     */
    const s = await loaded();
    const heard: string[] = [];
    s.onWipe((what) => heard.push(what));
    expect(s.get('wipeable', 'signon')).toEqual({ area: 'Downtown' });
    // An ordinary write elsewhere keeps the blob's name: still not a wipe.
    raw.set('navcom.wipeable', JSON.stringify({ ...JSON.parse(raw.get('navcom.wipeable')!), draft: 'more' }));
    fire('pageshow', { persisted: true });
    expect(heard).toEqual([]);
    // Wiped, then signed on again by another page: a blob, made since.
    raw.delete('navcom.wipeable');
    raw.set('navcom.wipeable', JSON.stringify({ signon: { area: 'Elsewhere' }, '~': 'made-since' }));
    fire('pageshow', { persisted: true });
    expect(heard).toEqual(['wipe']);
    expect(reload).toHaveBeenCalledTimes(1);

    // A blob from a build before names can only be told apart by being gone: named since by an
    // ordinary write is not a wipe.
    raw.set('navcom.wipeable', '{"signon":{}}');
    const older = await loaded();
    older.get('wipeable', 'signon');
    raw.set('navcom.wipeable', '{"signon":{},"~":"named-now"}');
    fire('pageshow', { persisted: true });
    expect(reload).not.toHaveBeenCalled();
  });

  it('an ordinary Back changes nothing: no registry, no reload', async () => {
    // Running every forget on any restore would drop a watch and a Distress on a plain Back.
    const s = await loaded();
    const heard: string[] = [];
    s.onWipe((what) => heard.push(what));
    s.get('wipeable', 'signon');
    s.get('accruing', 'callsign');
    fire('pageshow', { persisted: true });
    expect(heard).toEqual([]);
    expect(reload).not.toHaveBeenCalled();

    // Nor does one after this page's own wipe, read again since: it already drew what is left.
    s.panicWipe();
    heard.length = 0;
    s.get('wipeable', 'signon');
    fire('pageshow', { persisted: true });
    expect(heard).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('a first load is not a restore, and a tier this page never saw is not a wipe it missed', async () => {
    const s = await loaded();
    const heard: string[] = [];
    s.onWipe((what) => heard.push(what));
    raw.delete('navcom.wipeable');
    fire('pageshow', { persisted: false });
    // Restored, but it never read tonight, so it drew nothing of it.
    fire('pageshow', { persisted: true });
    expect(heard).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('confirming a burn', () => {
  it('accepts the callsign as a person reads it, not as it is stored', () => {
    // `José` is one code point or two depending on the keyboard, and the two render
    // identically. Unnormalised, an operator who set up on one device and confirmed on
    // another was refused their own callsign while trying to destroy the phone.
    const precomposed = 'José';
    const decomposed = 'José';
    expect(precomposed).not.toBe(decomposed);

    set('accruing', 'callsign', precomposed);
    expect(burnConfirmed(decomposed, precomposed)).toBe(true);
    expect(localStorage.getItem('navcom.accruing')).toBeNull();
  });

  it('still refuses a callsign that is merely similar', () => {
    // NFC and not NFKC: canonical equivalence is the same character written two ways, and
    // this gate ends in destroying everything on the device.
    set('accruing', 'callsign', 'Wren');
    expect(burnConfirmed('ｗｒｅｎ', 'Wren')).toBe(false);
    expect(burnConfirmed('Wren ', 'Wren')).toBe(true);
  });

  it('never matches an empty confirmation against no identity', () => {
    expect(burnConfirmed('', null)).toBe(false);
    expect(burnConfirmed('   ', null)).toBe(false);
  });
});
