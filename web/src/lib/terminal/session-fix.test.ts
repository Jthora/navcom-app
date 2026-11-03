/**
 * Where an operator who shares their position is, told to a watch held on phones.
 *
 * Peers were sent a fix on every heartbeat and the watch only at sign-on, so the one person whose
 * job is knowing where everybody is knew it least (NYC audit, 2026-11-02). One stand-in relay.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from 'nostr-tools/core';
import type { Filter } from 'nostr-tools/filter';
import { KIND_DISTRESS, KIND_SIGNAL, newSecretKey, openFromGroup, publicKeyOf, type Position } from '@navcom/core';

const ME = newSecretKey();
const MY = publicKeyOf(ME);
/** The phone holding the watch: what the operator seals to. */
const HOLDER = newSecretKey();
const HOLDER_PUB = publicKeyOf(HOLDER);
const WATCH_PUB = publicKeyOf(newSecretKey());

let config: { pubkey: string; relays: string[]; holders: string[] } | null = null;
let fix: Position | null = null;

vi.mock('./identity', () => ({ loadIdentity: () => ({ secretKey: ME, pubkey: MY, callsign: 'Wren' }) }));
vi.mock('./config', () => ({ loadConfig: () => config, storedWatch: () => config }));
vi.mock('./pq.svelte', () => ({ kemKeys: () => ({}) }));
let firstFix: (() => void) | null = null;
vi.mock('./position.svelte', () => ({
  position: {
    get current() {
      return fix;
    },
    start: () => {},
    stop: () => {},
    whenFirstFix: (then: () => void) => {
      firstFix = then;
    }
  },
  precision: () => 'exact',
  setPrecision: () => {}
}));

type Handlers = { onevent: (e: Event) => void; oneose?: () => void; onclose?: (r: unknown) => void };
const published: Event[] = [];
const bus = {
  subscribeMany: (_u: string[], _f: Filter, h: Handlers) => (queueMicrotask(() => h.oneose?.()), { close() {} }),
  subscribeMap: (_r: unknown[], h: Handlers) => (queueMicrotask(() => h.oneose?.()), { close() {} }),
  publish: (urls: string[], event: Event) => {
    published.push(event);
    return urls.map(() => Promise.resolve('ok'));
  },
  close: () => {}
};
vi.mock('./pool', () => ({ pool: () => bus }));

/** The signals of one type this phone sent the watch, opened as the holder reads them. */
const sent = (type: string) =>
  published
    .filter((e) => e.kind === KIND_SIGNAL && e.tags.some((t) => t[0] === 't' && t[1] === type))
    .map((e) => openFromGroup<Record<string, unknown>>(HOLDER, MY, e.content));

let session: typeof import('./session.svelte');

beforeEach(async () => {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    // What a panic wipe counts through: it destroys every key under tonight's name.
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null
  };
  published.length = 0;
  fix = { lat: 40.7128, lon: -74.006, precision_m: 0 };
  config = { pubkey: WATCH_PUB, relays: ['wss://r'], holders: [HOLDER_PUB] };
  vi.useFakeTimers();
  vi.resetModules();
  session = await import('./session.svelte');
});

afterEach(() => {
  session.operator.forget();
  vi.useRealTimers();
});

describe('a check-in to a watch held on phones', () => {
  it('carries where they are, when they share it', async () => {
    await session.operator.signOn('Downtown', 2, 30);
    await session.operator.routine();
    expect(sent('routine')).toEqual([{ position: fix }]);
  });

  it('carries nothing more when they do not', async () => {
    fix = null;
    await session.operator.signOn('Downtown', 2, 30);
    await session.operator.routine();
    expect(sent('routine')).toEqual([{}]);
  });
});

describe('while they move', () => {
  it('tells the watch where they are each minute they have moved', async () => {
    await session.operator.signOn('Downtown', 2, 30);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent('position')).toEqual([{ position: fix }]);

    fix = { lat: 40.72, lon: -74.0, precision_m: 0 };
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent('position').at(-1)).toEqual({ position: fix });
  });

  it('says nothing while they stand still, until five minutes have passed', async () => {
    await session.operator.signOn('Downtown', 2, 30);
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(sent('position')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(sent('position')).toHaveLength(2);
  });

  it('sends nothing when they do not share where they are', async () => {
    fix = null;
    await session.operator.signOn('Downtown', 2, 30);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(sent('position')).toHaveLength(0);
  });

  it('stops when they stand down', async () => {
    await session.operator.signOn('Downtown', 2, 30);
    await session.operator.standDown();
    const before = published.length;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(sent('position')).toHaveLength(0);
    expect(published.slice(before).filter((e) => e.kind === KIND_SIGNAL)).toHaveLength(0);
  });

  it('is never sent to a box, where no screen shows it', async () => {
    config = { pubkey: WATCH_PUB, relays: ['wss://r'], holders: [] };
    void session.operator.signOn('Downtown', 2, 30);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(published.filter((e) => e.tags.some((t) => t[0] === 't' && t[1] === 'position'))).toHaveLength(0);
  });
});

describe('signing on with a team (2026-11-02)', () => {
  it('tells the watch the team, as one line, and offers it again next time', async () => {
    await session.operator.signOn('Midtown', 2, 30, '  Rescue   Rangers ');
    expect(sent('on-station')[0]).toMatchObject({ area: 'Midtown', team: 'Rescue Rangers' });
    expect(session.operator.session?.team).toBe('Rescue Rangers');
    expect(session.lastTeam()).toBe('Rescue Rangers');
  });

  it('sends no team when none is given, and forgets the last one', async () => {
    await session.operator.signOn('Midtown', 2, 30, 'Rescue Rangers');
    session.operator.forget();
    await session.operator.signOn('Midtown', 2, 30, '   ');
    expect('team' in sent('on-station')[1]!).toBe(false);
    expect(session.lastTeam()).toBe('');
  });

  it('keeps it in tonight’s tier, so a panic wipe takes it', async () => {
    await session.operator.signOn('Midtown', 2, 30, 'Rescue Rangers');
    const { panicWipe } = await import('./storage');
    panicWipe();
    expect(session.lastTeam()).toBe('');
  });
});

describe('a Distress from somebody signed on with a team (2026-11-02)', () => {
  it('says who it is from and their team, for a board that never heard them sign on', async () => {
    await session.operator.signOn('Penn Station', 2, 30, 'Rescue Rangers');
    void session.operator.raiseDistress('');
    await vi.advanceTimersByTimeAsync(50);
    const raised = published.filter((e) => e.kind === KIND_DISTRESS).map((e) => openFromGroup<Record<string, unknown>>(HOLDER, MY, e.content));
    expect(raised[0]).toMatchObject({ callsign: 'Wren', team: 'Rescue Rangers', area: 'Penn Station' });
  });
});

describe('the first fix after sign-on (2026-11-02)', () => {
  it('goes to the watch at once, not at the next beat', async () => {
    fix = null;
    await session.operator.signOn('Penn Station', 2, 30);
    expect(sent('position')).toHaveLength(0);
    fix = { lat: 40.7506, lon: -73.9935, precision_m: 0 };
    firstFix?.();
    await vi.advanceTimersByTimeAsync(10);
    expect(sent('position')).toEqual([{ position: fix }]);
  });
});

describe('a question nobody answered, asked again (2026-11-02)', () => {
  it('goes again in one tap with the same words, and waits afresh', async () => {
    await session.operator.signOn('Penn Station', 2, 30);
    await session.operator.query('somewhere warm near Penn');
    await vi.advanceTimersByTimeAsync(session.ANSWER_WAIT_MS + 1_000);
    expect(session.operator.asked?.gaveUp).toBe(true);
    await session.operator.askAgain();
    const asked = sent('query');
    expect(asked).toHaveLength(2);
    expect(asked[1]).toMatchObject({ text: 'somewhere warm near Penn', area: 'Penn Station' });
    expect(session.operator.asked?.gaveUp).toBe(false);
  });

  it('does nothing while an answer may still come', async () => {
    await session.operator.signOn('Penn Station', 2, 30);
    await session.operator.query('somewhere warm near Penn');
    await session.operator.askAgain();
    expect(sent('query')).toHaveLength(1);
  });
});
