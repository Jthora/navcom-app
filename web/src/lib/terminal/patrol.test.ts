/**
 * The operator's own record.
 *
 * Two things carry weight here: that it stays on the device, and that the export cannot
 * expose somebody who never agreed to anything.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { exportPatrols, formatDuration, keepsHistory, patrols, recordPatrol, setKeepHistory, type Patrol } from './patrol';
import { burn, clearStorageError, onStorageError, panicWipe, set, storageError } from './storage';

function installLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null
  };
}

const T = Date.UTC(2026, 7, 14, 21, 40) / 1000;
const night = (over: Partial<Patrol> = {}): Patrol => ({
  started: T, ended: T + 3 * 3600 + 35 * 60, area: 'Downtown', ...over
});

beforeEach(installLocalStorage);

describe('where it lives', () => {
  it('is destroyed by a panic wipe unless the operator said otherwise', () => {
    // Off by default. The Protest Medic needs a phone that is useless to whoever takes it.
    expect(keepsHistory()).toBe(false);
    recordPatrol(night());
    panicWipe();
    expect(patrols()).toEqual([]);
  });

  it('survives a panic wipe when the operator chose that, and a burn takes it anyway', () => {
    setKeepHistory(true);
    recordPatrol(night());
    panicWipe();
    expect(patrols()).toHaveLength(1);
    burn();
    expect(patrols()).toEqual([]);
  });

  it('moves what already exists when the answer changes', () => {
    // Changing your mind must not be a way to lose a year of nights by accident.
    recordPatrol(night());
    recordPatrol(night({ area: 'Riverfront' }));
    setKeepHistory(true);
    expect(patrols()).toHaveLength(2);
    setKeepHistory(false);
    expect(patrols()).toHaveLength(2);
  });

  it('does not leave a copy behind in the tier it moved out of', () => {
    recordPatrol(night());
    setKeepHistory(true);
    // A forgotten copy in the wipeable tier would survive nothing and confuse everything.
    panicWipe();
    expect(patrols()).toHaveLength(1);
  });
});

describe('what leaves the phone', () => {
  const opts = { callsign: 'Wren' };

  it('names the operator and totals the nights', () => {
    const out = exportPatrols([night(), night({ started: T + 86400, ended: T + 86400 + 7200 })], opts);
    expect(out).toContain('Wren');
    expect(out).toContain('2 patrols');
    expect(out).toMatch(/5h 35m/);
  });

  it('carries no coordinates at any precision', () => {
    // The stream showed a street corner. The export should not carry a GPS fix the stream
    // never did -- and there is no field here that could hold one.
    const out = exportPatrols([night({ note: 'quiet' })], opts);
    expect(out).not.toMatch(/\d+\.\d{4,}/);
  });

  it('carries nobody but the operator', () => {
    // Your movements are yours to publish. Raven's are not, and Raven agreed to nothing.
    const out = exportPatrols([night({ closedBy: 'Raven' })], opts);
    expect(out).not.toContain('Raven');
  });

  it('can leave the areas out', () => {
    expect(exportPatrols([night()], opts)).toContain('Downtown');
    expect(exportPatrols([night()], { ...opts, includeAreas: false })).not.toContain('Downtown');
  });

  it('reads sensibly with no callsign and no patrols', () => {
    const out = exportPatrols([], { callsign: null });
    expect(out).toContain('0 patrols');
    expect(out).not.toContain('null');
    expect(out).not.toContain('undefined');
  });

  it('includes the operator\'s own words, and only those', () => {
    const out = exportPatrols([night({ note: 'two handouts at the underpass' })], opts);
    expect(out).toContain('two handouts at the underpass');
  });

  it('can leave the notes out', () => {
    // This option existed in `ExportOptions` and was honoured here from the start, and no
    // screen ever bound it -- so it silently read as on, and the riskiest free text in the
    // system had no reachable switch in the one artifact built to be pasted in public.
    // `reachable.spec.ts` holds the other half: that a person can actually operate it.
    const out = exportPatrols([night({ note: 'two handouts at the underpass' })], {
      ...opts,
      includeNotes: false
    });
    expect(out).not.toContain('two handouts at the underpass');
    // The night itself still has to survive, or the control deletes the record rather than
    // redacting one field of it.
    expect(out).toContain('Downtown');
    expect(out).toContain('1 patrol');
  });
});

describe('durations read like a person wrote them', () => {
  it('drops the hours when there are none', () => {
    expect(formatDuration(35 * 60)).toBe('35m');
    expect(formatDuration(3 * 3600 + 35 * 60)).toBe('3h 35m');
    expect(formatDuration(0)).toBe('0m');
  });

  it('never renders a negative night', () => {
    expect(formatDuration(-500)).toBe('0m');
  });
});

describe('when the phone is full', () => {
  /** Fails every write, the way a phone at quota does. */
  const jam = () => {
    // Reads still work — the record is on the phone, there is simply no room to write. That
    // is the situation, and swapping in an empty store instead would test a different one.
    const real = globalThis.localStorage;
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => real.getItem(k),
      removeItem: (k: string) => real.removeItem(k),
      setItem: () => {
        const e = new Error('exceeded the quota');
        e.name = 'QuotaExceededError';
        throw e;
      }
    };
    return () => {
      (globalThis as Record<string, unknown>).localStorage = real;
    };
  };

  it('does not clear the history it failed to copy', () => {
    // Three unchecked writes meant the copy failed and the original was cleared anyway —
    // the one operation whose whole purpose is not losing the record was what lost it.
    recordPatrol({ started: 1, ended: 2, area: 'North' });
    expect(patrols()).toHaveLength(1);

    const release = jam();
    try {
      expect(setKeepHistory(true)).toBe(false);
    } finally {
      release();
    }
    expect(patrols()).toHaveLength(1);
  });

  it('leaves the setting where the record actually is', () => {
    // A setting that says "kept" while the record sits in the wipeable tier would send the
    // operator into a panic wipe believing their history was safe.
    recordPatrol({ started: 1, ended: 2, area: '' });
    const release = jam();
    try {
      setKeepHistory(true);
    } finally {
      release();
    }
    expect(keepsHistory()).toBe(false);
    expect(patrols()).toHaveLength(1);
  });

  it('says a patrol was not recorded, rather than returning as though it were', () => {
    const release = jam();
    try {
      expect(recordPatrol({ started: 3, ended: 4, area: '' })).toBe(false);
      expect(storageError()).toMatch(/out of storage/);
    } finally {
      release();
    }
  });

  it('tells whoever is listening, at the moment it happens', () => {
    // The report used to be read once, at mount, on one screen. An operator on any other
    // screen was told nothing at all.
    // Starting clean on purpose: the notifier deliberately does not fire when the message
    // has not changed, and a failure from an earlier test is still standing.
    clearStorageError();
    const heard: (string | null)[] = [];
    const unsubscribe = onStorageError((m) => heard.push(m));
    const release = jam();
    try {
      recordPatrol({ started: 5, ended: 6, area: '' });
    } finally {
      release();
      unsubscribe();
    }
    expect(heard.filter(Boolean)).toHaveLength(1);
    expect(heard[0]).toMatch(/out of storage/);
  });
});

describe('a patrol field that is not a list', () => {
  it('reads as empty rather than throwing out of sign-off', () => {
    // Reachable through a restored backup or a hand-edited blob. Unguarded, the spread in
    // recordPatrol threw — which reaches the operator as a sign-off button that does
    // nothing and says nothing.
    set('wipeable', 'patrols', { nope: true });
    expect(patrols()).toEqual([]);
    expect(() => recordPatrol({ started: 1, ended: 2, area: '' })).not.toThrow();
    expect(patrols()).toHaveLength(1);
  });

  it('survives an export too', () => {
    set('wipeable', 'patrols', 'not a list at all');
    expect(() => exportPatrols(patrols(), { callsign: 'Wren' })).not.toThrow();
  });
});
