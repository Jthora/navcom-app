import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { PACKAGES_MAX, subscribeMissions, type Feed } from './live';

/**
 * The subscription across several relays [docs/design/grid.md]: every relay at once, the newest
 * signed copy of each package wins, and no relay answering alone is ever a reason to say
 * "unavailable". The browser tests drive the built page; these drive the timing, which a browser
 * test can only sample.
 */

const RECORD = 'wss://record.test';
const MIRROR = 'wss://mirror.test';
const NOW = new Date('2026-10-06T20:00:00Z');

const secret = generateSecretKey();
const publishers = { [getPublicKey(secret)]: { name: 'Test', agent: true } };
const pkg = (d: string, title: string, created_at = 1791300000) =>
  finalizeEvent(
    {
      kind: 30079,
      created_at,
      content: JSON.stringify({ name: title, objectives: [{ id: 'do:it', ask: 'Do it.' }] }),
      tags: [['d', d], ['t', 'starcom_mission_package'], ['t', 'navcom_handoff'], ['t', 'navcom_mission'],
        ['mission_state', 'open'], ['valid_until', '1791608400']]
    },
    secret
  );

/** A relay the test drives by hand. */
class FakeSocket extends EventTarget {
  static made: FakeSocket[] = [];
  closed = false;
  constructor(readonly url: string) {
    super();
    FakeSocket.made.push(this);
  }
  sent: unknown[][] = [];
  send(data: string): void {
    this.sent.push(JSON.parse(data) as unknown[]);
  }
  close(): void {
    this.closed = true;
  }
  answer(...events: unknown[]): void {
    this.dispatchEvent(new Event('open'));
    for (const e of events) this.frame(['EVENT', 'missions', e]);
    this.frame(['EOSE', 'missions']);
  }
  frame(f: unknown[]): void {
    this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(f) }));
  }
  fail(): void {
    this.dispatchEvent(new Event('error'));
  }
}
const socket = (url: string) => FakeSocket.made.filter((s) => s.url === url).at(-1)!;

let feeds: Feed[];
const last = () => feeds.at(-1)!;
const titles = () => {
  const f = last();
  return f.status === 'live' || f.status === 'cached' ? f.missions.map((m) => m.title).sort() : [];
};
const subscribe = () => subscribeMissions((f) => feeds.push(f), { relays: [RECORD, MIRROR], publishers });

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  FakeSocket.made = [];
  feeds = [];
  const store = new Map<string, string>();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('reading missions from The Record and its mirror at once', () => {
  it('opens one subscription to each, and draws from whichever answers first', () => {
    subscribe();
    expect(FakeSocket.made.map((s) => s.url)).toEqual([RECORD, MIRROR]);
    expect(last().status).toBe('connecting');
    socket(MIRROR).answer(pkg('a', 'From the mirror'));
    expect(last().status).toBe('live');
    expect(titles()).toEqual(['From the mirror']);
    socket(RECORD).answer(pkg('b', 'From The Record'));
    expect(titles()).toEqual(['From The Record', 'From the mirror']);
  });

  it('shows the newest signed copy, so a mirror that has fallen behind cannot hide a change', () => {
    subscribe();
    socket(MIRROR).answer(pkg('x', 'old', 1791200000));
    expect(titles()).toEqual(['old']);
    socket(RECORD).answer(pkg('x', 'new', 1791300000));
    expect(titles()).toEqual(['new']);
  });

  it('draws the map from the mirror alone when The Record is down, and never says unavailable first', () => {
    subscribe();
    socket(RECORD).fail();
    expect(last().status).toBe('connecting');
    socket(MIRROR).answer(pkg('a', 'From the mirror'));
    expect(feeds.map((f) => f.status)).not.toContain('unavailable');
    expect(titles()).toEqual(['From the mirror']);
  });

  it('says unavailable only once every relay has failed', () => {
    subscribe();
    socket(MIRROR).fail();
    expect(last().status).toBe('connecting');
    socket(RECORD).fail();
    expect(last().status).toBe('unavailable');
  });

  it('keeps a dropped relay’s last answer, until that relay answers again without it', () => {
    subscribe();
    socket(RECORD).answer(pkg('a', 'Only on The Record'));
    socket(MIRROR).answer(pkg('b', 'On the mirror'));
    socket(RECORD).fail();
    // A dropped connection says nothing about what was withdrawn.
    expect(last().status).toBe('live');
    expect(titles()).toEqual(['On the mirror', 'Only on The Record']);
    vi.advanceTimersByTime(5_000);
    socket(RECORD).answer();
    // Answering again without it does.
    expect(titles()).toEqual(['On the mirror']);
  });

  it('keeps the last picture when every relay drops, dated to the moment the last one went', () => {
    subscribe();
    socket(RECORD).answer(pkg('a', 'Seen'));
    socket(MIRROR).answer();
    vi.advanceTimersByTime(60_000);
    socket(RECORD).fail();
    vi.advanceTimersByTime(60_000);
    socket(MIRROR).fail();
    expect(last().status).toBe('cached');
    // The mirror answered until two minutes in, so the picture held until then and no later.
    expect((last() as { at: Date }).at.getTime()).toBe(NOW.getTime() + 120_000);
    expect(titles()).toEqual(['Seen']);
  });

  it('starts from the copy kept on this device, then goes live', () => {
    const stop = subscribe();
    socket(RECORD).answer(pkg('a', 'Kept'));
    stop();
    feeds = [];
    subscribe();
    expect(last().status).toBe('cached');
    expect(titles()).toEqual(['Kept']);
  });

  it('tries a failed relay again later, without waiting on the other', () => {
    subscribe();
    socket(RECORD).fail();
    expect(FakeSocket.made.filter((s) => s.url === RECORD)).toHaveLength(1);
    vi.advanceTimersByTime(5_000);
    expect(FakeSocket.made.filter((s) => s.url === RECORD)).toHaveLength(2);
    socket(RECORD).answer(pkg('a', 'Back'));
    expect(titles()).toEqual(['Back']);
  });

  it('closes every subscription when the page lets go', () => {
    const stop = subscribe();
    stop();
    expect(FakeSocket.made.every((s) => s.closed)).toBe(true);
  });
});

describe('a relay that is not on our side, or not all there', () => {
  const stored = () => JSON.parse(localStorage.getItem('navcom.wipeable') ?? '{}').missions?.events ?? [];

  it('drops a malformed frame rather than keeping it, so the feed and the next visit go on [11.R]', () => {
    const stop = subscribe();
    const poison = { kind: 30079, pubkey: '', id: 'x', created_at: 0, tags: [null], content: '', sig: '' };
    socket(MIRROR).answer(poison, pkg('a', 'Real'));
    vi.advanceTimersByTime(5_000);
    expect(titles()).toEqual(['Real']);
    socket(RECORD).answer(pkg('a', 'Closed now', 1791400000));
    expect(titles()).toEqual(['Closed now']);
    stop();
    feeds = [];
    const before = FakeSocket.made.length;
    subscribe();
    expect(FakeSocket.made.length).toBe(before + 2);
  });

  it('keeps nothing that is not a package from a publisher it reads', () => {
    subscribe();
    const stranger = finalizeEvent({ kind: 30079, created_at: 1791300000, content: '{}', tags: [['d', 'z'], ['t', 'navcom_mission']] }, generateSecretKey());
    socket(RECORD).answer(stranger, { ...pkg('b', 'Wrong kind'), kind: 1 }, pkg('a', 'Real'));
    vi.advanceTimersByTime(5_000);
    expect(stored().map((e: { content: string }) => JSON.parse(e.content).name)).toEqual(['Real']);
  });

  it('keeps at most a bounded number of packages, however many a relay sends', () => {
    subscribe();
    socket(RECORD).answer(...Array.from({ length: PACKAGES_MAX + 20 }, (_, i) => pkg(`p${i}`, `P${i}`)));
    vi.advanceTimersByTime(5_000);
    expect(stored().length).toBeLessThanOrEqual(PACKAGES_MAX);
  });

  it('does not let a mirror that has fallen behind roll back a version this device already read', () => {
    const stop = subscribe();
    socket(RECORD).answer(pkg('x', 'newer', 1791300000));
    socket(MIRROR).answer(pkg('x', 'older', 1791200000));
    expect(titles()).toEqual(['newer']);
    vi.advanceTimersByTime(5_000);
    stop();
    feeds = [];
    subscribe();
    socket(RECORD).fail();
    socket(MIRROR).answer(pkg('x', 'older', 1791200000));
    expect(titles()).toEqual(['newer']);
  });

  it('counts a refused subscription as a failure, rather than reaching for it forever', () => {
    subscribe();
    socket(RECORD).dispatchEvent(new Event('open'));
    socket(RECORD).frame(['CLOSED', 'missions', 'auth-required: sign in']);
    socket(MIRROR).fail();
    expect(last().status).toBe('unavailable');
  });

  it('gives up on an answer that never finishes', () => {
    subscribe();
    socket(RECORD).dispatchEvent(new Event('open'));
    socket(MIRROR).dispatchEvent(new Event('open'));
    vi.advanceTimersByTime(31_000);
    expect(last().status).toBe('unavailable');
  });

  it('asks a quiet relay whether it is still there, and stops calling it live when it does not answer', () => {
    subscribe();
    socket(RECORD).answer(pkg('a', 'Seen'));
    socket(MIRROR).fail();
    expect(last().status).toBe('live');
    vi.advanceTimersByTime(240_000);
    expect(socket(RECORD).sent.some((f) => f[0] === 'REQ' && f[1] === 'still-there')).toBe(true);
    vi.advanceTimersByTime(8_001);
    expect(last().status).toBe('cached');
    // Dated to the last thing the relay said, not to when its silence was noticed.
    expect((last() as { at: Date }).at.getTime()).toBe(NOW.getTime());
  });

  it('keeps calling a relay live while it answers that question', () => {
    subscribe();
    socket(RECORD).answer(pkg('a', 'Seen'));
    vi.advanceTimersByTime(240_000);
    socket(RECORD).frame(['EOSE', 'still-there']);
    vi.advanceTimersByTime(8_001);
    expect(last().status).toBe('live');
  });
});
