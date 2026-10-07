/**
 * A subscription that outlives its socket [audit: relay paths, F19, F20].
 *
 * The pool here behaves the way nostr-tools does for one relay: a failed connection ends with its
 * end-of-answer and its close in the same moment, and a closed subscription hears nothing more.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handlers = { onevent: (e: unknown) => void; oneose?: () => void; onclose?: (r: string[]) => void };
type Sub = { url: string; h: Handlers; open: boolean };
const subs: Sub[] = [];

vi.mock('./pool', () => ({
  pool: () => ({
    subscribeMany: (urls: string[], _f: unknown, h: Handlers) => {
      const sub: Sub = { url: urls[0]!, h, open: true };
      subs.push(sub);
      return { close: () => void (sub.open = false) };
    }
  })
}));

const { subscribeLive } = await import('./subscribe');

const opened = (url: string) => subs.filter((s) => s.url === url);
const answer = (s: Sub) => s.h.oneose?.();
const drop = (s: Sub) => {
  s.open = false;
  s.h.onclose?.(['relay connection closed']);
};
/** A connection that never came up: end-of-answer and close together, as nostr-tools reports it. */
const fail = (s: Sub) => {
  s.h.oneose?.();
  drop(s);
};
const event = (id: string) => ({ id, kind: 1, tags: [], content: '', created_at: 0, pubkey: '', sig: '' });

beforeEach(() => {
  subs.length = 0;
  vi.useFakeTimers();
  // The tests run in Node: a window that can say it is online again is all that is needed.
  (globalThis as { window?: EventTarget }).window = new EventTarget();
});
afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { window?: EventTarget }).window;
});

describe('a subscription whose socket drops', () => {
  it('opens again by itself after a short wait', () => {
    const live = subscribeLive(['wss://a.example'], { kinds: [1] }, { onevent: () => {} });
    drop(opened('wss://a.example')[0]!);
    expect(opened('wss://a.example')).toHaveLength(1);
    vi.advanceTimersByTime(1_100);
    expect(opened('wss://a.example'), 'nothing reopened it: the screen would go on showing the last state').toHaveLength(2);
    live.close();
  });

  it('opens again at once when the phone comes back online', () => {
    const live = subscribeLive(['wss://a.example'], { kinds: [1] }, { onevent: () => {} });
    drop(opened('wss://a.example')[0]!);
    window.dispatchEvent(new Event('online'));
    expect(opened('wss://a.example')).toHaveLength(2);
    live.close();
  });

  it('stays closed once the screen closes it', () => {
    const live = subscribeLive(['wss://a.example'], { kinds: [1] }, { onevent: () => {} });
    live.close();
    drop(opened('wss://a.example')[0]!);
    vi.advanceTimersByTime(60_000);
    expect(opened('wss://a.example')).toHaveLength(1);
  });
});

describe('what reaches the screen', () => {
  it('is each event once, however many relays or reopenings carry it', () => {
    const got: string[] = [];
    const live = subscribeLive(['wss://a.example', 'wss://b.example'], { kinds: [1] }, { onevent: (e) => got.push(e.id) });
    for (const s of subs) s.h.onevent(event('x'));
    expect(got).toEqual(['x']);
    live.close();
  });

  it('says how many relays answered, so nobody answering is not read as nothing there', async () => {
    let answered: number | null = null;
    subscribeLive(['wss://a.example', 'wss://b.example'], { kinds: [1] }, { onevent: () => {}, oneose: (n) => (answered = n) });
    fail(opened('wss://a.example')[0]!);
    answer(opened('wss://b.example')[0]!);
    await Promise.resolve();
    await Promise.resolve();
    expect(answered).toBe(1);
  });

  it('says none answered when none could be reached', async () => {
    let answered: number | null = null;
    subscribeLive(['wss://a.example'], { kinds: [1] }, { onevent: () => {}, oneose: (n) => (answered = n) });
    fail(opened('wss://a.example')[0]!);
    await Promise.resolve();
    expect(answered).toBe(0);
  });

  it('says so again when a relay answers after none did', async () => {
    const told: number[] = [];
    const live = subscribeLive(['wss://a.example'], { kinds: [1] }, { onevent: () => {}, oneose: (n) => told.push(n) });
    fail(opened('wss://a.example')[0]!);
    await Promise.resolve();
    vi.advanceTimersByTime(1_100);
    answer(opened('wss://a.example')[1]!);
    await Promise.resolve();
    expect(told, 'the screen would go on saying nobody answered after somebody had').toEqual([0, 1]);
    live.close();
  });

  it('counts a relay that answered on its second try while another was still trying', async () => {
    let answered: number | null = null;
    const live = subscribeLive(['wss://a.example', 'wss://b.example'], { kinds: [1] }, { onevent: () => {}, oneose: (n) => (answered = n) });
    fail(opened('wss://a.example')[0]!);
    await Promise.resolve();
    vi.advanceTimersByTime(1_100);
    answer(opened('wss://a.example')[1]!);
    await Promise.resolve();
    fail(opened('wss://b.example')[0]!);
    await Promise.resolve();
    expect(answered, 'a relay that had answered was reported as nobody answering').toBe(1);
    live.close();
  });

  it('says nothing more once somebody has answered', async () => {
    const told: number[] = [];
    const live = subscribeLive(['wss://a.example'], { kinds: [1] }, { onevent: () => {}, oneose: (n) => told.push(n) });
    answer(opened('wss://a.example')[0]!);
    await Promise.resolve();
    drop(opened('wss://a.example')[0]!);
    vi.advanceTimersByTime(1_100);
    answer(opened('wss://a.example')[1]!);
    await Promise.resolve();
    expect(told).toEqual([1]);
    live.close();
  });
});
