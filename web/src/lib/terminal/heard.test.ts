/**
 * Where this phone has heard its watch, relay by relay [relay-lists §7].
 *
 * A relay counts as heard on when a `Distress` from this phone would go there, it answered this
 * phone, its newest watch state is live and no newer Dark has been published anywhere, and it did
 * not refuse this phone's last signal. Each clause is a test here, against the record the screens
 * read, and against the reader in `relay.ts` that feeds it. The record is memory only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from 'nostr-tools/core';
import type { Filter } from 'nostr-tools/filter';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { THE_RECORD, buildWatchStateEvent, type DistressPhase } from '@navcom/core';

const WATCH = generateSecretKey();
const W = getPublicKey(WATCH);
const OTHER = getPublicKey(generateSecretKey());

const A = 'wss://a.relay';
const B = 'wss://b.relay';
const C = 'wss://c.relay';

let config: { pubkey: string; relays: string[]; holders: string[] } | null = null;
vi.mock('./config', () => ({ loadConfig: () => config }));

type Handlers = { onevent: (e: Event) => void; oneose?: () => void; onclose?: (r: unknown) => void };
const subscribed: { url: string; filter: Filter; h: Handlers; open: boolean }[] = [];
vi.mock('./pool', () => ({
  pool: () => ({
    subscribeMany: (urls: string[], filter: Filter, h: Handlers) => {
      const s = { url: urls[0]!, filter, h, open: true };
      subscribed.push(s);
      return { close: () => void (s.open = false) };
    }
  })
}));

const { heard } = await import('./heard.svelte');
const { watchWatchtower } = await import('./relay');
const openedAtImport = subscribed.length;

const now = () => Math.floor(Date.now() / 1000);

/** The watch's own state, signed, dated `at`. */
function state(s: 'automated' | 'dark', at: number, key = WATCH): Event {
  return finalizeEvent(
    buildWatchStateEvent(
      {
        state: s,
        holder: s === 'dark' ? null : 'nightwatch',
        holder_kind: s === 'dark' ? null : 'agent',
        oncall: [],
        since: at - 60,
        agent_health: 'ok',
        last_drill: null,
        now: at
      },
      at
    ),
    key
  );
}

const ok = (url: string) => ({ url, ok: true, reason: '' });
const no = (url: string, reason: string) => ({ url, ok: false, failure: 'refused' as const, reason });
const line = (url: string) => heard.now().relays.find((r) => r.url === url)!;

beforeEach(() => {
  heard.forget();
  subscribed.length = 0;
  config = { pubkey: W, relays: [A, B, C, THE_RECORD], holders: [] };
});

/** The night §7 is written for: one relay live, one gone quiet, one that refused, and The Record. */
function night() {
  const into = heard.sink(W);
  into.arrived(A, state('automated', now() - 10));
  into.arrived(B, state('automated', now() - 400));
  into.arrived(C, state('automated', now() - 10));
  into.arrived(THE_RECORD, state('automated', now() - 5));
  heard.answered({ answers: [ok(A), ok(B), no(C, 'blocked: no')], withheld: [] });
  into.settled(4);
  return into;
}

describe('a relay heard on', () => {
  it('is only one a Distress goes to, that answered, is under five minutes, and did not refuse', () => {
    night();
    const h = heard.now();
    expect(h.of, 'The Record counted among the relays a Distress goes to').toBe(3);
    expect(h.on).toEqual([A]);
    expect(h.asked).toBe(true);
    expect(line(B)).toMatchObject({ heard: false, state: 'stale' });
    expect(line(B).text).toMatch(/more than five minutes, so it does not count/);
    expect(line(C)).toMatchObject({ heard: false, state: 'heard', refused: 'blocked: no' });
    expect(line(C).text).toMatch(/It refused this phone’s last signal: blocked: no\./);
    expect(h.withheld.map((w) => w.url)).toEqual([THE_RECORD]);
    expect(h.relays.map((r) => r.url), 'a relay nothing is sent to has a line of its own').not.toContain(THE_RECORD);
  });

  it('is none once the watch has published Dark since, on any relay, The Record included', () => {
    const into = night();
    into.arrived(THE_RECORD, state('dark', now() - 2));
    expect(heard.now().on).toEqual([]);
    expect(line(A)).toMatchObject({ heard: false, state: 'superseded' });
    expect(line(A).text).toMatch(/has said since, on another relay, that it is Dark/);
  });

  it('is not one whose newest state is the watch’s own Dark', () => {
    const into = night();
    into.arrived(A, state('dark', now() - 1));
    expect(heard.now().on).toEqual([]);
    expect(line(A).state).toBe('dark');
  });

  it('is not one whose state is dated ahead of this phone’s clock, and says so', () => {
    const into = heard.sink(W);
    into.arrived(A, state('automated', now() + 200));
    into.settled(1);
    expect(heard.now().on).toEqual([]);
    expect(line(A).state).toBe('ahead');
    expect(line(A).text).toMatch(/dated ahead/);
    expect(heard.stateAgeMs(A)).toBeNull();
  });

  it('counts again once a later signal is taken where one was refused', () => {
    night();
    heard.answered({ answers: [ok(A), ok(B), ok(C)], withheld: [] });
    expect(heard.now().on).toEqual([A, C]);
  });

  it('follows a Distress attempt’s account: refused sets it, took clears it', () => {
    night();
    const account = (took: string[], refused: { url: string; reason: string }[]): Extract<DistressPhase, { phase: 'accounted' }> => ({
      phase: 'accounted',
      attempt: 1,
      took,
      refused,
      unconfirmed: [],
      unreached: [],
      withheld: []
    });
    heard.accounted(account([C], [{ url: A, reason: 'rate-limited: slow down' }]));
    expect(heard.now().on).toEqual([C]);
    expect(line(A).text).toMatch(/rate-limited: slow down/);
    heard.accounted(account([A, C], []));
    expect(heard.now().on).toEqual([A, C]);
  });

  it('is not one that has answered with nothing, nor one that never answered', () => {
    const into = heard.sink(W);
    into.listening([B]);
    into.settled(1);
    expect(line(B)).toMatchObject({ heard: false, state: 'none' });
    expect(line(C)).toMatchObject({ heard: false, state: 'unanswered' });
    expect(line(C).text).toMatch(/has not answered this phone/);
  });

  it('is unknown, never none, when no relay answered this phone: it could not ask', () => {
    // Offline, or every relay failing: the read's verdict is that nobody answered, which is not the
    // watch heard nowhere, and "if the watch moved" would be the wrong fix [invariant 7].
    const into = heard.sink(W);
    into.settled(0);
    const h = heard.now();
    expect(h.asked).toBe(true);
    expect(h.known, 'a read nobody answered counted as a count').toBe(false);
    expect(h.on).toEqual([]);
    expect(heard.last, 'held as heard on none').toEqual({ on: null, of: 3, atMs: expect.any(Number) });
    expect(heard.known).toBe(false);
    expect(h.relays.every((r) => r.state === 'unanswered')).toBe(true);
  });

  it('is unknown when only a relay nothing is sent to answered', () => {
    // The Record is read, and never counted: it answering says nothing about the relays a Distress goes to.
    const into = heard.sink(W);
    into.arrived(THE_RECORD, state('automated', now() - 5));
    into.settled(1);
    expect(heard.now().known).toBe(false);
    expect(heard.last?.on).toBeNull();
  });

  it('is known, and counted, once any relay it counts against answers', () => {
    const into = heard.sink(W);
    into.settled(0);
    into.listening([B]);
    expect(heard.now().known).toBe(true);
    expect(heard.last).toMatchObject({ on: 0, of: 3 });
    into.arrived(A, state('automated', now() - 10));
    expect(heard.last).toMatchObject({ on: 1, of: 3 });
  });

  it('is no count at all until a read has had its verdict', () => {
    const into = heard.sink(W);
    into.arrived(A, state('automated', now() - 10));
    expect(heard.now().asked).toBe(false);
    expect(heard.last).toBeNull();
    into.settled(1);
    expect(heard.now().asked).toBe(true);
    expect(heard.last).toMatchObject({ on: 1, of: 3 });
  });
});

describe('the age core is handed for each relay', () => {
  it('is given only for a live state no newer Dark has superseded, and ignores a refusal', () => {
    const into = night();
    const a = heard.stateAgeMs(A)!;
    expect(a).toBeGreaterThanOrEqual(9_000);
    expect(a).toBeLessThan(15_000);
    expect(heard.stateAgeMs(B), 'a state older than five minutes').toBeNull();
    expect(heard.stateAgeMs(C), 'the refusal is fed back after core counts').not.toBeNull();
    expect(heard.stateAgeMs('wss://never.relay')).toBeNull();
    into.arrived(THE_RECORD, state('dark', now() - 2));
    expect(heard.stateAgeMs(A), 'superseded by a newer Dark').toBeNull();
  });
});

describe('another watch', () => {
  it('starts the record over, and a reader of the old one writes nothing into it', () => {
    const old = night();
    heard.sink(OTHER);
    config = { pubkey: OTHER, relays: [A, B, C], holders: [] };
    old.arrived(A, state('automated', now() - 1));
    old.settled(1);
    const h = heard.now();
    expect(h.on).toEqual([]);
    expect(h.asked).toBe(false);
    expect(h.relays.every((r) => r.state === 'unanswered')).toBe(true);
    expect(heard.last).toBeNull();
  });

  it('is not counted with this watch’s record when the phone is given another watch', () => {
    night();
    config = { pubkey: OTHER, relays: [A, B, C], holders: [] };
    expect(heard.now().on).toEqual([]);
    expect(heard.last, 'the held count was about the old watch').toBeNull();
  });
});

describe('the reader the screens already make', () => {
  it('records a copy repeated from a second relay under that relay', () => {
    // `subscribeLive` hands each event over once; the same copy from a second relay is a repeat,
    // and the watch is heard there too.
    const c = watchWatchtower({ pubkey: W, relays: [A, B], holders: [] }, () => {}, { sink: heard.sink(W) });
    const a = subscribed.find((s) => s.url === A)!;
    const b = subscribed.find((s) => s.url === B)!;
    const ev = state('automated', now() - 5);
    a.h.onevent(ev);
    b.h.onevent(ev);
    a.h.oneose?.();
    b.h.oneose?.();
    c.close();
    expect(line(A).state).toBe('heard');
    expect(line(B).state, 'the second relay’s copy went nowhere').toBe('heard');
  });

  it('records which relays answered, and the verdict, from the reader', async () => {
    const c = watchWatchtower({ pubkey: W, relays: [A, B, C], holders: [] }, () => {}, { sink: heard.sink(W) });
    for (const s of subscribed) s.h.oneose?.();
    await new Promise((r) => setTimeout(r, 0));
    c.close();
    expect(heard.now().asked).toBe(true);
    expect(line(A).state).toBe('none');
  });

  it('takes nothing a reader for another watch is handed', () => {
    const into = heard.sink(W);
    into.arrived(A, state('automated', now() - 5, generateSecretKey()));
    into.settled(1);
    expect(line(A)).toMatchObject({ heard: false, state: 'unanswered' });
    expect(heard.stateAgeMs(A)).toBeNull();
  });
});

describe('memory only', () => {
  it('opens nothing at import', () => {
    expect(openedAtImport).toBe(0);
  });

  it('writes nothing to storage, session storage or IndexedDB', async () => {
    const writes = vi.fn();
    const store = { getItem: () => null, setItem: writes, removeItem: writes, clear: writes };
    (globalThis as Record<string, unknown>).localStorage = store;
    (globalThis as Record<string, unknown>).sessionStorage = store;
    let idb = 0;
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get: () => (idb++, undefined) });
    try {
      const into = night();
      into.listening([A, B]);
      heard.now();
      heard.stateAgeMs(A);
      const read = heard.read([A, B, C], W);
      for (const s of subscribed) s.h.oneose?.();
      await new Promise((r) => setTimeout(r, 0));
      read.close();
      heard.forget();
    } finally {
      delete (globalThis as Record<string, unknown>).indexedDB;
    }
    expect(writes).not.toHaveBeenCalled();
    expect(idb).toBe(0);
  });

  it('imports nothing that persists', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./heard.svelte.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from '\.\/(storage|persist|backup)'/);
    expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });

  it('is gone after a wipe', () => {
    night();
    heard.forget();
    expect(heard.last).toBeNull();
    expect(heard.now().asked).toBe(false);
    expect(heard.stateAgeMs(A)).toBeNull();
  });
});

describe('the read a Distress opens', () => {
  it('asks only the relays it is given, for this watch’s state, and closes', () => {
    const read = heard.read([A, B], W);
    expect(subscribed.map((s) => s.url)).toEqual([A, B]);
    for (const s of subscribed) expect(s.filter).toEqual({ kinds: [10910], authors: [W], limit: 1 });
    read.close();
    expect(subscribed.every((s) => !s.open)).toBe(true);
  });
});
