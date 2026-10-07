/**
 * A subscription that outlives its socket [audit: relay paths, F19, F20; review: relay paths].
 *
 * The pool here behaves the way nostr-tools' `subscribeMany` does for one relay: a failed
 * connection ends with its end-of-answer and its close in the same moment, and closing one that
 * has not answered reports both again, a moment later. The stand-in used to fire nothing on close,
 * and that is how a closed subscription telling its screen "nobody answered" went unseen.
 *
 * `subscribe-relays.test.ts` runs the same module against real relays on this machine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handlers = { onevent: (e: unknown) => void; oneose?: () => void; onclose?: (r: unknown) => void };
type Sub = { url: string; h: Handlers; open: boolean; answered: boolean };
const subs: Sub[] = [];

/** `subscribeMany` only, as a test stand-in has: the path a pool that cannot hand over a relay takes. */
const wrapped = {
  burned: false,
  subscribeMany: (urls: string[], _f: unknown, h: Handlers) => {
    const sub: Sub = { url: urls[0]!, h, open: true, answered: false };
    subs.push(sub);
    return {
      close: () => {
        if (!sub.open) return;
        sub.open = false;
        // nostr-tools: `await allOpened`, then the relay's close, which reports an end-of-answer
        // first for a relay that had not sent one.
        queueMicrotask(() => {
          if (!sub.answered) h.oneose?.();
          h.onclose?.([{ url: sub.url, reason: 'closed by caller' }]);
        });
      }
    };
  }
};
let current: object = wrapped;

vi.mock('./pool', () => ({ pool: () => current }));

const { subscribeLive, SILENT_MS } = await import('./subscribe');

const opened = (url: string) => subs.filter((s) => s.url === url);
const answer = (s: Sub) => {
  s.answered = true;
  s.h.oneose?.();
};
const drop = (s: Sub, reason: unknown = 'relay connection closed') => {
  s.open = false;
  s.h.onclose?.([{ url: s.url, reason }]);
};
/** A connection that never came up: end-of-answer and close together, as nostr-tools reports it. */
const fail = (s: Sub) => {
  s.h.oneose?.();
  drop(s);
};
const event = (id: string) => ({ id, kind: 1, tags: [], content: '', created_at: 0, pubkey: '', sig: '' });
const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

beforeEach(() => {
  subs.length = 0;
  current = wrapped;
  wrapped.burned = false;
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

  it('reopens whatever reason its own close handler is handed, or none', () => {
    // Only that this module never reads the reason: a null, or the {} a JavaScript relay makes of
    // an Error, reaches its handler here straight from the stand-in. The defect was upstream of
    // the handler — the pool's wrapper threw on those before passing them on — and HEAD's handler
    // passed this too. That is covered where the wrapper is real: 'a pool that can hand over its
    // relay' below, and the CLOSED cases in subscribe-relays.test.ts.
    const live = subscribeLive(['wss://a.example'], { kinds: [1] }, { onevent: () => {} });
    answer(opened('wss://a.example')[0]!);
    drop(opened('wss://a.example')[0]!, null);
    vi.advanceTimersByTime(1_100);
    drop(opened('wss://a.example')[1]!, {});
    vi.advanceTimersByTime(2_100);
    expect(opened('wss://a.example')).toHaveLength(3);
    live.close();
  });
});

describe('how long it waits before asking a failing relay again [review: relay paths]', () => {
  /** The gaps between one opening and the next, for a relay that fails every time. */
  async function gaps(count: number): Promise<number[]> {
    const live = subscribeLive(['wss://down.example'], { kinds: [1] }, { onevent: () => {} });
    const at: number[] = [Date.now()];
    for (let i = 0; i < count; i++) {
      fail(opened('wss://down.example').at(-1)!);
      await flush();
      const before = opened('wss://down.example').length;
      let waited = 0;
      while (opened('wss://down.example').length === before && waited < 120_000) {
        vi.advanceTimersByTime(100);
        waited += 100;
      }
      at.push(Date.now());
    }
    live.close();
    return at.slice(1).map((t, i) => Math.round((t - at[i]!) / 1000));
  }

  it('doubles to thirty seconds, rather than asking every second for ever', async () => {
    // Every failure arrives as an end-of-answer and a close in one moment, and the first half
    // used to reset the wait: a relay that was down, or refusing, was asked once a second.
    expect(await gaps(7)).toEqual([1, 2, 4, 8, 16, 30, 30]);
  });

  it('starts again from one second after a relay has answered and stayed answering', async () => {
    const live = subscribeLive(['wss://a.example'], { kinds: [1] }, { onevent: () => {} });
    for (let i = 0; i < 4; i++) {
      fail(opened('wss://a.example').at(-1)!);
      await flush();
      vi.advanceTimersByTime(30_000);
    }
    answer(opened('wss://a.example').at(-1)!);
    await flush();
    vi.advanceTimersByTime(61_000);
    const before = opened('wss://a.example').length;
    drop(opened('wss://a.example').at(-1)!);
    vi.advanceTimersByTime(1_100);
    expect(opened('wss://a.example'), 'a dropped connection that had been fine waited the long wait').toHaveLength(before + 1);
    live.close();
  });

  it('starts the wait over on a wake for a relay that could not be reached', async () => {
    // The network that failed it may be back, and the board's listener should not sit out thirty
    // seconds for one attempt made a moment too early. A relay that refused is another matter:
    // see 'a pool that can hand over its relay' below.
    const live = subscribeLive(['wss://down.example'], { kinds: [1] }, { onevent: () => {} });
    const waits: number[] = [];
    const failAndWait = async () => {
      fail(opened('wss://down.example').at(-1)!);
      await flush();
      const before = opened('wss://down.example').length;
      const from = Date.now();
      while (opened('wss://down.example').length === before) vi.advanceTimersByTime(100);
      waits.push(Math.round((Date.now() - from) / 1000));
    };
    for (let i = 0; i < 5; i++) await failAndWait();
    expect(waits).toEqual([1, 2, 4, 8, 16]);
    fail(opened('wss://down.example').at(-1)!);
    await flush();
    const closed = opened('wss://down.example').length;
    window.dispatchEvent(new Event('online'));
    expect(opened('wss://down.example'), 'not asked again on the wake').toHaveLength(closed + 1);
    for (let i = 0; i < 2; i++) await failAndWait();
    expect(waits.slice(5)).toEqual([1, 2]);
    live.close();
  });

  it('keeps waiting longer for a relay that answers and drops straight away', async () => {
    const live = subscribeLive(['wss://a.example'], { kinds: [1] }, { onevent: () => {} });
    const at: number[] = [];
    for (let i = 0; i < 4; i++) {
      answer(opened('wss://a.example').at(-1)!);
      await flush();
      drop(opened('wss://a.example').at(-1)!);
      const before = opened('wss://a.example').length;
      const from = Date.now();
      while (opened('wss://a.example').length === before) vi.advanceTimersByTime(100);
      at.push(Math.round((Date.now() - from) / 1000));
    }
    expect(at).toEqual([1, 2, 4, 8]);
    live.close();
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

  it('says where each event came from, and where else it was heard', () => {
    const first: [string, string][] = [];
    const again: [string, string][] = [];
    const live = subscribeLive(['wss://a.example', 'wss://b.example'], { kinds: [1] }, {
      onevent: (e, url) => first.push([e.id, url]),
      onrepeat: (e, url) => again.push([e.id, url])
    });
    opened('wss://b.example')[0]!.h.onevent(event('x'));
    opened('wss://a.example')[0]!.h.onevent(event('x'));
    expect(first).toEqual([['x', 'wss://b.example']]);
    expect(again).toEqual([['x', 'wss://a.example']]);
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

  it('counts a relay that holds the subscription without a word as not answering', async () => {
    // nostr-tools fires its own stand-in for an EOSE after 4.4 seconds and this counted it, so a
    // hung relay read as one that had answered with nothing [review: relay paths].
    const told: number[] = [];
    const live = subscribeLive(['wss://hung.example'], { kinds: [1] }, { onevent: () => {}, oneose: (n) => told.push(n) });
    vi.advanceTimersByTime(SILENT_MS - 100);
    expect(told, 'decided before the relay had its chance').toEqual([]);
    vi.advanceTimersByTime(200);
    expect(told).toEqual([0]);
    // Left open, so a late answer still counts.
    answer(opened('wss://hung.example')[0]!);
    await flush();
    expect(told).toEqual([0, 1]);
    live.close();
  });

  it('says nothing at all once the screen has closed it', async () => {
    // Find closes one area's subscription and opens the next, and both write the same screen.
    // The closed one's late "nobody answered" put Unknown over an area being asked.
    const told: number[] = [];
    const live = subscribeLive(['wss://a.example', 'wss://b.example'], { kinds: [1] }, { onevent: () => {}, oneose: (n) => told.push(n) });
    answer(opened('wss://a.example')[0]!);
    await flush();
    live.close();
    await flush();
    vi.advanceTimersByTime(60_000);
    expect(told, 'a closed subscription spoke for the screen that replaced it').toEqual([]);
  });
});

describe('which relays it is listening on [review: relay paths]', () => {
  it('names a relay only while its subscription has answered and stayed open', async () => {
    const heard: string[][] = [];
    const live = subscribeLive(['wss://a.example', 'wss://b.example'], { kinds: [1] }, {
      onevent: () => {},
      onlisten: (now) => heard.push(now)
    });
    expect(live.listening()).toEqual([]);
    answer(opened('wss://a.example')[0]!);
    fail(opened('wss://b.example')[0]!);
    await flush();
    expect(live.listening(), 'a refused relay counted as listening').toEqual(['wss://a.example']);
    drop(opened('wss://a.example')[0]!);
    expect(live.listening()).toEqual([]);
    expect(heard).toEqual([['wss://a.example'], []]);
    live.close();
  });

  it('says who is listening before it says how many answered', async () => {
    const said: string[] = [];
    const live = subscribeLive(['wss://a.example'], { kinds: [1] }, {
      onevent: () => {},
      oneose: (n) => said.push(`answered ${n}`),
      onlisten: (now) => said.push(`listening ${now.length}`)
    });
    answer(opened('wss://a.example')[0]!);
    await flush();
    expect(said).toEqual(['listening 1', 'answered 1']);
    live.close();
  });

  it('counts an event as an answer, EOSE or not', () => {
    const live = subscribeLive(['wss://a.example'], { kinds: [1] }, { onevent: () => {} });
    opened('wss://a.example')[0]!.h.onevent(event('x'));
    expect(live.listening()).toEqual(['wss://a.example']);
    live.close();
  });

  it('names, when asked, only a relay that has kept answering that long', async () => {
    const live = subscribeLive(['wss://a.example'], { kinds: [1] }, { onevent: () => {} });
    answer(opened('wss://a.example')[0]!);
    await flush();
    vi.advanceTimersByTime(4_000);
    expect(live.listening()).toEqual(['wss://a.example']);
    expect(live.listening(10_000), 'answered four seconds ago').toEqual([]);
    vi.advanceTimersByTime(6_000);
    expect(live.listening(10_000)).toEqual(['wss://a.example']);
    // A drop and a quick reopen start the count again.
    drop(opened('wss://a.example')[0]!);
    vi.advanceTimersByTime(1_100);
    answer(opened('wss://a.example')[1]!);
    await flush();
    expect(live.listening(10_000)).toEqual([]);
    live.close();
  });

  it('names the relays not yet heard from at all', async () => {
    const live = subscribeLive(['wss://a.example', 'wss://b.example', 'wss://c.example'], { kinds: [1] }, { onevent: () => {} });
    expect(live.pending()).toEqual(['wss://a.example', 'wss://b.example', 'wss://c.example']);
    answer(opened('wss://a.example')[0]!);
    fail(opened('wss://b.example')[0]!);
    await flush();
    expect(live.pending(), 'a relay that answered or refused is not unknown').toEqual(['wss://c.example']);
    vi.advanceTimersByTime(SILENT_MS);
    expect(live.pending(), 'a relay that said nothing for that long has been heard from: as silent').toEqual([]);
    live.close();
  });
});

describe('moving to another list of relays [review: relay paths]', () => {
  // The order of the new relay's REQ and the old one's CLOSE is not claimed here: this stand-in
  // answers synchronously. On the app's pool, see subscribe-relays.test.ts.
  it('asks the new relays, lets go of the old, and leaves shared ones alone', async () => {
    const live = subscribeLive(['wss://a.example', 'wss://b.example'], { kinds: [1] }, { onevent: () => {} });
    const a = opened('wss://a.example')[0]!;
    const b = opened('wss://b.example')[0]!;
    answer(a);
    answer(b);
    await flush();
    live.follow(['wss://a.example', 'wss://c.example']);
    expect(a.open, 'a relay on both lists was dropped and asked again').toBe(true);
    expect(opened('wss://a.example')).toHaveLength(1);
    expect(b.open).toBe(false);
    expect(opened('wss://c.example')).toHaveLength(1);
    expect(live.listening()).toEqual(['wss://a.example']);
    // A relay let go of is not reopened when its close arrives.
    vi.advanceTimersByTime(60_000);
    expect(opened('wss://b.example')).toHaveLength(1);
    live.close();
  });
});

describe('a pool a burn has finished [review: relay paths]', () => {
  it('opens nothing, and says nobody answered', () => {
    wrapped.burned = true;
    const told: number[] = [];
    subscribeLive(['wss://a.example'], { kinds: [1] }, { onevent: () => {}, oneose: (n) => told.push(n) });
    expect(subs).toHaveLength(0);
    expect(told).toEqual([0]);
  });

  it('reopens nothing it carried before the burn, on any wake', () => {
    const live = subscribeLive(['wss://a.example'], { kinds: [1] }, { onevent: () => {} });
    answer(opened('wss://a.example')[0]!);
    wrapped.burned = true;
    drop(opened('wss://a.example')[0]!, 'relay connection closed by us');
    vi.advanceTimersByTime(60_000);
    window.dispatchEvent(new Event('online'));
    expect(opened('wss://a.example'), 'a burned phone went on talking').toHaveLength(1);
    live.close();
  });
});

describe('a pool that can hand over its relay [review: relay paths]', () => {
  type RelayParams = Handlers & { eoseTimeout?: number };
  const given: RelayParams[] = [];
  const direct = {
    ensureRelay: async () => ({
      connected: true,
      subscribe: (_filters: unknown[], params: RelayParams) => {
        given.push(params);
        return { close: () => {}, eoseTimeoutHandle: setTimeout(() => params.oneose?.(), 4_400) };
      }
    })
  };

  beforeEach(() => {
    given.length = 0;
    current = direct;
  });

  it('subscribes on the relay itself, with nostr-tools’ stand-in EOSE switched off', async () => {
    const told: number[] = [];
    const live = subscribeLive(['wss://a.example'], { kinds: [1] }, { onevent: () => {}, oneose: (n) => told.push(n) });
    await flush();
    expect(given).toHaveLength(1);
    expect(given[0]!.eoseTimeout).toBeGreaterThanOrEqual(2 ** 31 - 1);
    vi.advanceTimersByTime(4_500);
    await flush();
    expect(told, 'the stand-in counted as the relay answering').toEqual([]);
    live.close();
  });

  it('keeps its wait across a wake when the relay itself refused, and asks again at once', async () => {
    // A wake reset every wait, so a relay refusing this phone was asked again at one, three and
    // seven seconds each time the phone came back to the screen — and a holder glances at it often.
    const live = subscribeLive(['wss://a.example'], { kinds: [1] }, { onevent: () => {} });
    await flush();
    const waits: number[] = [];
    const refuseAndWait = async () => {
      // A CLOSED over a connection that is still up.
      given.at(-1)!.onclose?.('auth-required: members only');
      const before = given.length;
      const from = Date.now();
      while (given.length === before) {
        vi.advanceTimersByTime(100);
        await flush();
      }
      waits.push(Math.round((Date.now() - from) / 1000));
    };
    for (let i = 0; i < 5; i++) await refuseAndWait();
    expect(waits).toEqual([1, 2, 4, 8, 16]);
    given.at(-1)!.onclose?.('auth-required: members only');
    const before = given.length;
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(given, 'not asked again on the wake').toHaveLength(before + 1);
    for (let i = 0; i < 2; i++) await refuseAndWait();
    expect(waits.slice(5), 'the wake started the wait over for a relay that refused').toEqual([30, 30]);
    live.close();
  });

  it('reopens a subscription the relay closed with no reason at all', async () => {
    const live = subscribeLive(['wss://a.example'], { kinds: [1] }, { onevent: () => {} });
    await flush();
    given[0]!.oneose?.();
    await flush();
    expect(live.listening()).toEqual(['wss://a.example']);
    given[0]!.onclose?.(null);
    expect(live.listening()).toEqual([]);
    vi.advanceTimersByTime(1_100);
    await flush();
    expect(given, 'a CLOSED with a null reason left it closed for good').toHaveLength(2);
    live.close();
  });
});
