/**
 * What the device keeps of the watch's account of its own log, as readings arrive and age.
 *
 * A reading is aged again on screen every thirty seconds, so a Status screen left open goes Dark
 * once it is stale [invariant 7]. That re-ran everything an arrival does — and a watch that had
 * stopped committing raised "stopped" each time, into a record only a burn clears, carried into
 * every backup [audit: relay paths, review].
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogRoot, WatchStatePayload, WatchStateRead } from '@navcom/core';

type Handler = (read: WatchStateRead, heard?: { unanswered: boolean }) => void;
let handler: Handler | null = null;

vi.mock('./relay', () => ({
  watchWatchtower: (_config: unknown, onRead: Handler) => {
    handler = onRead;
    return { close: () => {} };
  }
}));
vi.mock('./config', () => ({
  loadConfig: () => ({ pubkey: 'a'.repeat(64), relays: ['wss://watch.example'], holders: [] })
}));

let watch: typeof import('./watch.svelte').watch;
let whenWatchChangesHands: typeof import('./watch.svelte').whenWatchChangesHands;
let rootAlarms: typeof import('./roots').rootAlarms;
let set: typeof import('./storage').set;

beforeEach(async () => {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  };
  vi.resetModules();
  handler = null;
  ({ watch, whenWatchChangesHands } = await import('./watch.svelte'));
  ({ rootAlarms } = await import('./roots'));
  ({ set } = await import('./storage'));
});

const R1: LogRoot = { root: 'r1', size: 3, at: 100 };
const R2: LogRoot = { root: 'r2', size: 5, at: 200 };

/** A live reading, as the relay module hands it over — on arrival, and again each time it ages. */
function live(log_root: LogRoot | null, extra: Partial<WatchStatePayload> = {}): WatchStateRead {
  return {
    state: {
      v: 4,
      state: 'station',
      holder: 'Wren',
      holder_kind: 'human',
      oncall: [],
      since: 1_000,
      agent_health: 'down',
      last_drill: null,
      log_root,
      ...extra
    },
    dark: false,
    reason: null,
    ageSeconds: 30
  };
}

describe('a watch that stopped committing to its log', () => {
  beforeEach(() => set('accruing', 'seen_roots', [R1]));

  it('is recorded once, however often the same reading is aged again', () => {
    watch.start();
    // The arrival, then three thirty-second re-reads of the same event.
    for (let i = 0; i < 4; i++) handler!(live(null));
    expect(rootAlarms()).toHaveLength(1);
    expect(watch.alarms).toHaveLength(1);
  });

  it('is recorded once across heartbeats that restate it, and across the screen opening again', () => {
    watch.start();
    handler!(live(null, { since: 1_000 }));
    handler!(live(null, { since: 1_060 }));
    watch.stop();
    watch.start();
    // A new screen is handed the stored event again.
    handler!(live(null, { since: 1_060 }));
    expect(rootAlarms()).toHaveLength(1);
  });

  it('is recorded again when it stops a second time, after committing to something newer', () => {
    watch.start();
    handler!(live(null));
    handler!(live(R2));
    handler!(live(null));
    expect(rootAlarms().map((a) => [a.kind, a.was.root])).toEqual([
      ['stopped', 'r1'],
      ['stopped', 'r2']
    ]);
  });
});

describe('a reading aged again on screen', () => {
  it('does not rewrite the accruing tier when it says nothing new', () => {
    set('accruing', 'seen_roots', [R1]);
    watch.start();
    handler!(live(R1));
    const writes = vi.spyOn(localStorage, 'setItem');
    handler!(live(R1));
    handler!(live(R1));
    expect(writes).not.toHaveBeenCalled();
  });

  it('still lets a handover through, once', () => {
    const changed = vi.fn();
    whenWatchChangesHands(changed);
    watch.start();
    handler!(live(R1, { holder: 'Wren' }));
    handler!(live(R1, { holder: 'Raven' }));
    handler!(live(R1, { holder: 'Raven' }));
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('still shows its age: the reading itself is taken every time', () => {
    watch.start();
    handler!(live(R1));
    handler!({ ...live(R1), dark: true, reason: 'stale', ageSeconds: 301 });
    expect(watch.read.reason).toBe('stale');
    expect(watch.read.dark).toBe(true);
  });
});
