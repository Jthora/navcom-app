import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey } from 'nostr-tools/pure';
import { panicWipe, set } from '$lib/terminal/storage';
import { KEPT_CHARS_MAX, PACKAGES_MAX, UNVERIFIED_MAX, subscribeMissions, type Feed } from './live';

/** Every package read, counted: what a relay can make this phone verify is the cost to bound. */
const reads = vi.hoisted(() => ({ n: 0 }));
vi.mock('@navcom/core', async (original) => {
  const core = await original<typeof import('@navcom/core')>();
  return {
    ...core,
    readMissionPackage: (...args: Parameters<typeof core.readMissionPackage>) => {
      reads.n++;
      return core.readMissionPackage(...args);
    }
  };
});

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
const pkg = (d: string, title: string, created_at = 1791300000, state = 'open', padding = 0) =>
  finalizeEvent(
    {
      kind: 30079,
      created_at,
      content: JSON.stringify({ name: title, objectives: [{ id: 'do:it', ask: 'Do it.' }], ...(padding ? { padding: 'x'.repeat(padding) } : {}) }),
      tags: [['d', d], ['t', 'starcom_mission_package'], ['t', 'navcom_handoff'], ['t', 'navcom_mission'],
        ['mission_state', state], ['valid_until', '1791608400']]
    },
    secret
  );

/**
 * A relay the test drives by hand, failing the way a browser's socket does: an error and then a
 * close for one failed connection, and a close event a moment after `close()` [audit 11, second
 * grid — a socket that never fired 'close' left the guard against a double retry untested].
 */
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
    if (this.closed) return;
    this.closed = true;
    setTimeout(() => this.dispatchEvent(new Event('close')), 0);
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
    this.dispatchEvent(new Event('close'));
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
    removeItem: (k: string) => void store.delete(k),
    // A wipe destroys every key under the tier's name, so it has to be able to list them.
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null
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

describe('what the second audit of Milestone 11 found', () => {
  const made = (url: string) => FakeSocket.made.filter((s) => s.url === url).length;
  const stored = () => (JSON.parse(localStorage.getItem('navcom.wipeable') ?? '{}').missions?.events ?? []) as { content: string }[];
  /** What any relay can send: a genuine version's id and key, over content and a signature of its own. */
  const forgedAs = (e: object, over: Record<string, unknown> = {}) => ({ ...JSON.parse(JSON.stringify(e)), content: '{"name":"x"}', sig: '0'.repeat(128), ...over });
  /** A frame with an honest id and a signature that does not verify: one full check each, and nothing kept. */
  const junk = (i: number) => {
    const e = { kind: 30079, pubkey: getPublicKey(secret), created_at: 1791300000, content: '{}', tags: [['d', `junk-${i}`], ['t', 'navcom_mission']] };
    return { ...e, id: getEventHash(e), sig: Array.from(crypto.getRandomValues(new Uint8Array(64)), (b) => b.toString(16).padStart(2, '0')).join('') };
  };

  it('retries once per failure, however many ways the socket says it failed', () => {
    subscribe();
    // Each wait in turn — 5, 10, 20, 40 seconds — and each new socket failed as soon as it is made.
    for (const wait of [5_000, 10_000, 20_000, 40_000]) {
      socket(RECORD).fail();
      vi.advanceTimersByTime(wait);
    }
    expect(made(RECORD)).toBe(5);
  });

  it('shows a mission closed, and a new one posted, while the map is open, without a reload', () => {
    subscribe();
    socket(RECORD).answer(pkg('a', 'Open'));
    socket(MIRROR).answer();
    expect(titles()).toEqual(['Open']);
    socket(RECORD).frame(['EVENT', 'missions', pkg('a', 'Open', 1791400000, 'closed')]);
    expect(titles()).toEqual([]);
    socket(RECORD).frame(['EVENT', 'missions', pkg('b', 'New', 1791400001)]);
    expect(titles()).toEqual(['New']);
  });

  it('starts from a kept copy holding frames stored before 11.R, drawing what is real in it [11.R]', () => {
    const real = pkg('a', 'Real');
    set('wipeable', 'missions', {
      at: NOW.toISOString(),
      events: [
        { kind: 30079, pubkey: '', id: 'x', created_at: 0, tags: [null], content: '', sig: '' },
        { ...JSON.parse(JSON.stringify(real)), id: 'f'.repeat(64), tags: [null] },
        real
      ]
    });
    expect(() => subscribe()).not.toThrow();
    expect(last().status).toBe('cached');
    expect(titles()).toEqual(['Real']);
  });

  describe('two versions signed in the same second, from two relays', () => {
    const a = pkg('t', 'A', 1791350000);
    const b = pkg('t', 'B', 1791350000);
    const lower = a.id < b.id ? 'A' : 'B';
    it('draws the lower id, when The Record answers first', () => {
      subscribe();
      socket(RECORD).answer(a);
      socket(MIRROR).answer(b);
      expect(titles()).toEqual([lower]);
    });
    it('and when the mirror does', () => {
      subscribe();
      socket(MIRROR).answer(b);
      socket(RECORD).answer(a);
      expect(titles()).toEqual([lower]);
    });
  });

  describe('a forged copy under a genuine id, from one relay', () => {
    const open = pkg('a', 'Open', 1791200000);
    const closed = pkg('a', 'Closed', 1791300000, 'closed');

    it('cannot keep open a mission the other relay serves as closed', () => {
      subscribe();
      socket(MIRROR).answer(forgedAs(closed));
      socket(RECORD).answer(open, closed);
      expect(titles()).toEqual([]);
    });

    it('cannot take the place of the genuine version in the copy this device keeps', () => {
      const stop = subscribe();
      socket(RECORD).answer(open);
      socket(MIRROR).answer(forgedAs(open, { created_at: 1791400000 }));
      expect(titles()).toEqual(['Open']);
      vi.advanceTimersByTime(5_000);
      stop();
      feeds = [];
      subscribe();
      expect(titles()).toEqual(['Open']);
    });
  });

  describe('what one relay can make this phone do', () => {
    it('checks only so many frames that do not verify before it stops listening to that relay', () => {
      subscribe();
      socket(RECORD).answer(pkg('a', 'Real'));
      socket(MIRROR).answer();
      const before = reads.n;
      for (let i = 0; i < 300; i++) socket(RECORD).frame(['EVENT', 'missions', junk(i)]);
      expect(reads.n - before).toBeLessThanOrEqual(UNVERIFIED_MAX);
      expect(socket(RECORD).closed).toBe(true);
      // Its last answer stands, as for any relay that dropped.
      expect(titles()).toEqual(['Real']);
    });

    it('checks nothing it would not keep: an older version, or a new one past the cap', () => {
      subscribe();
      socket(RECORD).answer(pkg('x', 'Newer', 1791300000), ...Array.from({ length: PACKAGES_MAX - 1 }, (_, i) => pkg(`p${i}`, `P${i}`)));
      const before = reads.n;
      socket(RECORD).frame(['EVENT', 'missions', pkg('x', 'Older', 1791200000)]);
      socket(RECORD).frame(['EVENT', 'missions', pkg('over', 'Over the cap')]);
      expect(reads.n - before).toBe(0);
    });

    it('draws at most the cap from one relay', () => {
      subscribe();
      socket(RECORD).answer(...Array.from({ length: PACKAGES_MAX + 20 }, (_, i) => pkg(`p${i}`, `P${i}`)));
      expect(titles()).toHaveLength(PACKAGES_MAX);
    });

    it('keeps at most the cap on this device, though two relays together send more', () => {
      subscribe();
      socket(RECORD).answer(...Array.from({ length: 60 }, (_, i) => pkg(`r${i}`, `R${i}`)));
      socket(MIRROR).answer(...Array.from({ length: 60 }, (_, i) => pkg(`m${i}`, `M${i}`)));
      expect(titles()).toHaveLength(120);
      expect(stored()).toHaveLength(PACKAGES_MAX);
    });

    it('keeps no more characters than its share of the tier', () => {
      subscribe();
      socket(RECORD).answer(...Array.from({ length: 30 }, (_, i) => pkg(`big${i}`, `Big ${i}`, 1791300000 + i, 'open', 40_000)));
      const kept = stored();
      expect(kept.length).toBeLessThan(30);
      expect(kept.reduce((n, e) => n + e.content.length + 512, 0)).toBeLessThanOrEqual(KEPT_CHARS_MAX);
    });
  });

  describe('when a relay is tried again', () => {
    it('waits longer each time a relay opens and then refuses, rather than asking every five seconds', () => {
      subscribe();
      const refuse = () => {
        socket(RECORD).dispatchEvent(new Event('open'));
        socket(RECORD).frame(['CLOSED', 'missions', 'auth-required: sign in']);
      };
      refuse();
      vi.advanceTimersByTime(5_000);
      expect(made(RECORD)).toBe(2);
      refuse();
      vi.advanceTimersByTime(5_000);
      expect(made(RECORD)).toBe(2);
      vi.advanceTimersByTime(5_000);
      expect(made(RECORD)).toBe(3);
    });

    it('waits longer each time a relay answers and then sends what does not verify, rather than asking every five seconds', () => {
      subscribe();
      const answerThenJunk = () => {
        socket(RECORD).answer(pkg('a', 'Real'));
        for (let i = 0; i < UNVERIFIED_MAX; i++) socket(RECORD).frame(['EVENT', 'missions', junk(i)]);
      };
      answerThenJunk();
      vi.advanceTimersByTime(5_000);
      expect(made(RECORD)).toBe(2);
      answerThenJunk();
      vi.advanceTimersByTime(5_000);
      expect(made(RECORD)).toBe(2);
      vi.advanceTimersByTime(5_000);
      expect(made(RECORD)).toBe(3);
      // And one that answers and then refuses, the same.
      socket(RECORD).answer(pkg('a', 'Real'));
      socket(RECORD).frame(['CLOSED', 'missions', 'rate-limited: slow down']);
      vi.advanceTimersByTime(10_000);
      expect(made(RECORD)).toBe(3);
      vi.advanceTimersByTime(10_000);
      expect(made(RECORD)).toBe(4);
    });

    it('starts the wait over once a relay has really answered', () => {
      subscribe();
      socket(RECORD).fail();
      vi.advanceTimersByTime(5_000);
      socket(RECORD).fail();
      vi.advanceTimersByTime(10_000);
      socket(RECORD).fail();
      vi.advanceTimersByTime(20_000);
      socket(RECORD).answer(pkg('a', 'Back'));
      socket(RECORD).fail();
      vi.advanceTimersByTime(5_000);
      expect(made(RECORD)).toBe(5);
    });
  });

  it('keeps calling a relay live when it refuses the are-you-there question, since refusing is answering', () => {
    subscribe();
    socket(RECORD).answer(pkg('a', 'Seen'));
    vi.advanceTimersByTime(240_000);
    socket(RECORD).frame(['CLOSED', 'still-there', 'rate-limited']);
    vi.advanceTimersByTime(8_001);
    expect(last().status).toBe('live');
  });

  it('never lets a tampered newer copy on this device outrank what a relay serves', () => {
    const genuine = pkg('x', 'Genuine', 1791200000);
    const tampered = { ...JSON.parse(JSON.stringify(pkg('x', 'Newer', 1791300000))), content: JSON.stringify({ name: 'Tampered', objectives: [{ id: 'do:it', ask: 'Do it.' }] }) };
    set('wipeable', 'missions', { at: NOW.toISOString(), events: [tampered] });
    subscribe();
    socket(RECORD).answer(genuine);
    expect(titles()).toEqual(['Genuine']);
  });

  it('keeps each relay’s full answer at once, and what follows it when the page lets go', () => {
    const stop = subscribe();
    socket(RECORD).answer(pkg('a', 'At once'));
    expect(stored().map((e) => JSON.parse(e.content).name)).toEqual(['At once']);
    socket(RECORD).frame(['EVENT', 'missions', pkg('b', 'Just after', 1791300001)]);
    stop();
    expect(stored().map((e) => JSON.parse(e.content).name).sort()).toEqual(['At once', 'Just after']);
  });

  it('says nothing once the page has let go, whatever a socket still delivers', () => {
    const stop = subscribe();
    socket(RECORD).answer(pkg('a', 'Seen'));
    stop();
    const count = feeds.length;
    socket(RECORD).frame(['EVENT', 'missions', pkg('b', 'Late', 1791300001)]);
    expect(feeds.length).toBe(count);
  });
});

/**
 * A wipe while the map is open, in this page or another tab [invariant 5].
 *
 * Mission history is Wipeable, and this subscription held a copy in memory and saved it every
 * two seconds and as the page closed — so a wipe was followed by the copy coming straight back.
 */
describe('a wipe while missions are open', () => {
  const kept = () =>
    ((JSON.parse(localStorage.getItem('navcom.wipeable') ?? '{}').missions?.events ?? []) as { content: string }[])
      .map((e) => JSON.parse(e.content).name as string)
      .sort();

  it('writes nothing back, however the save was waiting, and the next page keeps its own copy again', () => {
    const stop = subscribe();
    socket(RECORD).answer(pkg('a', 'Before'));
    expect(kept()).toEqual(['Before']);
    // Arrived after the answer, so its save is waiting on the timer.
    socket(RECORD).frame(['EVENT', 'missions', pkg('b', 'Just after', 1791300001)]);

    panicWipe();
    vi.advanceTimersByTime(5_000);
    expect(localStorage.getItem('navcom.wipeable'), 'the waiting save put tonight back').toBeNull();

    // News after the wipe is drawn, live, and still not kept by a subscription from before it.
    socket(RECORD).frame(['EVENT', 'missions', pkg('c', 'After', 1791300002)]);
    expect(last().status).toBe('live');
    expect(titles()).toContain('After');
    vi.advanceTimersByTime(5_000);
    // Nor as the page closes.
    socket(RECORD).frame(['EVENT', 'missions', pkg('d', 'As it closed', 1791300003)]);
    stop();
    expect(localStorage.getItem('navcom.wipeable'), 'the page closing put tonight back').toBeNull();

    // A page opened after the wipe is a new visit, and keeps its copy for offline as before.
    subscribe();
    socket(RECORD).answer(pkg('e', 'Next visit'));
    expect(kept()).toEqual(['Next visit']);
  });

  it('stops drawing the copy this device kept, once a wipe has taken it', () => {
    const stop = subscribe();
    socket(RECORD).answer(pkg('a', 'Kept'));
    stop();
    feeds = [];
    // Offline: the map is drawn from the copy on the device.
    subscribe();
    expect(last().status).toBe('cached');
    expect(titles()).toEqual(['Kept']);

    panicWipe();
    expect(titles(), 'the map still shows what the wipe destroyed').toEqual([]);
    expect(last().status).toBe('connecting');
  });
});
