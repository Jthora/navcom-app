/**
 * The board a watch reads during an incident.
 *
 * The watch's address is handed to every operator, so anybody holding it can put something
 * here — the same open door the escalation executor has. What matters is that the one signal
 * that means somebody is hurt cannot be buried by the rest.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import type { Event } from 'nostr-tools/core';
import type { Filter } from 'nostr-tools/filter';
import {
  KIND_RESPONSE,
  KIND_WATCH_STATE,
  buildSignal,
  buildDistress,
  buildWatchStateEvent,
  newSecretKey,
  publicKeyOf
} from '@navcom/core';
import { finalizeEvent } from 'nostr-tools/pure';

const watch = newSecretKey();
const watchPub = publicKeyOf(watch);

vi.mock('./identity', () => ({
  loadIdentity: () => ({ secretKey: watch, pubkey: watchPub, callsign: 'Watch' })
}));
vi.mock('./config', () => ({ loadConfig: () => ({ watchtower: watchPub, relays: watchList }) }));
vi.mock('./watch-key', () => ({ watchKey: () => watch, watchPubkey: () => watchPub }));
vi.mock('./relays', () => ({ relays: () => watchList, watchRelays: () => watchList }));
vi.mock('./pq.svelte', () => ({ kemKeys: () => ({}), pq: { known: {} } }));

/** The watch's relays, as Setup last saved them. A holder can change them mid-shift. */
let watchList = ['wss://r'];
/** Whether relays accept anything. A watch on a phone is offline as often as an operator. */
let relaysUp = true;
/** Relays that refuse what is published to them, while the rest take it. */
let refusing = new Set<string>();
/** Everything the board published, in order, with the relay it was offered to. */
const published: { url: string; event: Event }[] = [];

/**
 * How a relay treats a subscription: answers it, refuses it with a `CLOSED` the way a relay
 * asking for AUTH does, takes it and says nothing, or answers it and ends it 50 ms later — a
 * relay in a crash loop, or a proxy that kills sockets.
 */
type Treatment = 'answer' | 'refuse' | 'silent' | 'flap';
/**
 * While set, publishes are held here instead of settling, so a test can act while one is out and
 * then decide how it ends.
 */
let holding: { url: string; event: Event; settle: (ok: boolean) => void }[] | null = null;
let treatment = new Map<string, Treatment>();
/** What a relay serves to a new subscription before its end-of-stored-events. */
let stored = new Map<string, Event[]>();

type Handlers = { onevent: (e: Event) => void; oneose?: () => void; onclose?: (r: unknown) => void };
type Sub = { url: string; filters: Filter[]; h: Handlers; open: boolean };
/** Every subscription opened, in order. */
const subs: Sub[] = [];
/**
 * Opens and closes, as they happened. Which relays were opened and closed is checked here; their
 * order is not, because this stand-in answers at once and the app's pool does not.
 */
const order: string[] = [];

const matches = (f: Filter, e: Event) =>
  (!f.kinds || f.kinds.includes(e.kind)) &&
  (!f.authors || f.authors.includes(e.pubkey)) &&
  (!f['#p'] || e.tags.some((t) => t[0] === 'p' && f['#p']!.includes(t[1]!)));

/**
 * One relay's subscription, the way nostr-tools reports it through `subscribeMany`: an answer is
 * an end-of-stored-events, and a refusal is an end-of-answer and a close in the same moment.
 * This stand-in honours filters, so a subscription on the wrong relay hears nothing.
 */
function subscribe(url: string, filters: Filter[], h: Handlers) {
  const sub: Sub = { url, filters, h, open: true };
  subs.push(sub);
  order.push(`open ${url}`);
  const how = treatment.get(url) ?? 'answer';
  queueMicrotask(() => {
    if (!sub.open) return;
    if (how === 'answer' || how === 'flap') {
      for (const e of stored.get(url) ?? []) if (filters.some((f) => matches(f, e))) h.onevent(e);
      h.oneose?.();
      if (how === 'flap') {
        setTimeout(() => {
          if (!sub.open) return;
          sub.open = false;
          h.onclose?.([{ url, reason: 'error: subscription ended' }]);
        }, 50);
      }
    } else if (how === 'refuse') {
      sub.open = false;
      h.oneose?.();
      h.onclose?.([{ url, reason: 'auth-required: members only' }]);
    }
  });
  return {
    close: () => {
      if (sub.open) order.push(`close ${url}`);
      sub.open = false;
    }
  };
}

vi.mock('./pool', () => ({
  pool: () => ({
    subscribeMany: (urls: string[], filter: Filter, h: Handlers) => subscribe(urls[0]!, [filter], h),
    /*
     * The board uses `subscribeMap`, because `subscribeMany` takes one filter and the board
     * needs two — passing an array to it was the defect that let a corrupted `#p` filter go
     * unnoticed for weeks. The real proof still lives in `e2e/real-relay.spec.ts`, against a
     * relay that honours filters.
     */
    subscribeMap: (requests: { url: string; filter: Filter }[], h: Handlers) =>
      subscribe(requests[0]!.url, requests.map((r) => r.filter), h),
    publish: (urls: string[], event: Event) =>
      urls.map((url) => {
        published.push({ url, event });
        if (holding) {
          const held = holding;
          return new Promise((resolve, reject) =>
            held.push({ url, event, settle: (ok) => (ok ? resolve('ok') : reject(new Error('publish timed out'))) })
          );
        }
        return relaysUp && !refusing.has(url) ? Promise.resolve('ok') : Promise.reject(new Error('blocked: no'));
      })
  })
}));

/** An event arriving on a relay, to whichever open subscriptions there it matches. */
function deliver(event: Event, url = 'wss://r'): void {
  for (const s of [...subs]) if (s.open && s.url === url && s.filters.some((f) => matches(f, event))) s.h.onevent(event);
}

/** A relay ending every subscription this phone has open on it, as a dropped connection does. */
function dropAll(url: string): void {
  for (const s of [...subs]) {
    if (!s.open || s.url !== url) continue;
    s.open = false;
    s.h.onclose?.([{ url, reason: 'relay connection closed' }]);
  }
}

/** Whether something on this relay is listening for Distress addressed to this watch. */
const listeningOn = (url: string) =>
  subs.some((s) => s.open && s.url === url && s.filters.some((f) => f.kinds?.includes(20911)));

/** Lets the stand-in's answers, and the board's reading of them, land. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

/**
 * A fresh module per test.
 *
 * The board is module-level `$state` and deliberately has no reset — it expires on its own
 * and nothing persists it [C27]. That is right for the product and means a test must not
 * inherit the previous one's traffic.
 */
let board: typeof import('./board.svelte').board;
/** How long a relay must keep answering before the holder's claim is renewed there. */
let HEARD_FOR = 0;

const T = 1_800_000_000;
const to = { pubkey: watchPub, holders: [watchPub] };

/** Signed the way a relay would deliver it — the builders return unsigned templates. */
const query = (i: number): Event => {
  const sender = newSecretKey();
  return finalizeEvent(buildSignal(sender, to, 'query', { text: `q${i}`, area: 'north' }, T + i), sender);
};

const onStation = (who: Uint8Array, at: number): Event =>
  finalizeEvent(
    buildSignal(who, to, 'on-station', {
      callsign: 'Raven', area: 'north side', expected_duration: 7200,
      routine_interval: null, share_position: false, position: null
    }, at),
    who
  );

const stoodDown = (who: Uint8Array, at: number): Event =>
  finalizeEvent(buildSignal(who, to, 'stood-down', {}, at), who);

const distress = (): Event => {
  const sender = newSecretKey();
  return finalizeEvent(
    buildDistress(sender, to, { position: null, area: 'north side' }, T + 99_999),
    sender
  );
};

beforeEach(async () => {
  watchList = ['wss://r'];
  relaysUp = true;
  refusing = new Set();
  treatment = new Map();
  stored = new Map();
  holding = null;
  published.length = 0;
  subs.length = 0;
  order.length = 0;
  vi.resetModules();
  ({ board, HEARD_FOR_MS: HEARD_FOR } = await import('./board.svelte'));
  board.start();
  await settle();
});

afterEach(() => {
  // Nothing from one test's listener retries into the next one's relays.
  board.forget();
  vi.useRealTimers();
});


/*
 * These process tens of thousands of real events, which takes seconds rather than
 * milliseconds — that is the point of them, and it is not a cost worth optimising away.
 *
 * With vitest's 5s default they sat close enough to the limit that a **busy machine failed
 * them**, which is the worst place for a flaky test to live: they are the two anti-flooding
 * properties, so an intermittent red trains somebody to re-run rather than to look, and a
 * shared CI runner is exactly where it fires [`audit-tests.md` 9.S].
 */
describe('a Distress arriving after a flood of routine traffic', () => {
  it('is not buried underneath it', () => {
    // `20911` is a separate kind precisely so a client can prioritise it independently of
    // routine traffic. The board flattened it into one queue sorted by arrival, coloured red
    // and otherwise equal — so a hundred queries arriving first put it a hundred rows down
    // the screen a watch reads when somebody is in trouble.
    for (let i = 0; i < 150; i++) deliver(query(i));
    deliver(distress());

    expect(board.distress).toHaveLength(1);
    expect(board.waiting.every((w) => w.type !== 'distress')).toBe(true);
  });

  it('is still admitted when the routine board is completely full', () => {
    // Routine traffic is dropped once the board is full. A Distress must never be one of
    // the things dropped to make room for a query.
    for (let i = 0; i < 400; i++) deliver(query(i));
    expect(board.routineDropped).toBe(true);

    deliver(distress());
    expect(board.distress).toHaveLength(1);
  });

  it('keeps the routine board usable rather than holding everything', () => {
    for (let i = 0; i < 400; i++) deliver(query(i));
    expect(board.waiting.length).toBeLessThanOrEqual(200);
  });

  it('says routine traffic is being dropped, rather than dropping it quietly', () => {
    for (let i = 0; i < 400; i++) deliver(query(i));
    expect(board.routineDropped).toBe(true);
    expect(board.distressDropped).toBe(false);
  });

  it('leaves an ordinary night alone', () => {
    for (let i = 0; i < 5; i++) deliver(query(i));
    deliver(distress());
    expect(board.waiting).toHaveLength(5);
    expect(board.distress).toHaveLength(1);
    expect(board.routineDropped).toBe(false);
  });
}, { timeout: 30_000 });

describe('a watch whose publishes do not land', () => {
  it('does not report standing down when the world still sees it on station', async () => {
    // This is what standDown exists to prevent, stated two lines above it: watch state is
    // replaceable, so going quiet leaves the previous state on the relay and every operator
    // reading it believes a human is watching. A Dark that fails to publish IS that — and
    // it is worse than never standing down, because the heartbeat that kept refreshing has
    // just been cleared, so nothing retries and nothing expires it soon.
    await board.takeWatch();
    expect(board.onStation).toBe(true);

    relaysUp = false;
    await board.standDown();
    expect(board.onStation).toBe(false);
    expect(board.stillAdvertised).toBe(true);
  });

  it('says nobody can see a watch that never announced itself', async () => {
    // Being on station is a claim made to other people. A holder whose screen says "On
    // station" while nothing was published is covering nobody and does not know it.
    relaysUp = false;
    await board.takeWatch();
    expect(board.unannounced).toBe(true);
  });

  it('is quiet when taking the watch actually worked', async () => {
    await board.takeWatch();
    expect(board.unannounced).toBe(false);
    expect(board.stillAdvertised).toBe(false);
  });

  it('keeps an unsent answer on the board instead of clearing it', async () => {
    // The result was discarded, so an answer that reached no relay still cleared the item:
    // the watch believed they had replied and the operator got nothing.
    deliver(query(1));
    const item = board.waiting[0]!;

    relaysUp = false;
    expect(await board.answer(item, 'the shelter on 8th')).toBe(false);
    expect(board.waiting.map((w) => w.id)).toContain(item.id);
  });

  it('clears it once the answer has actually gone', async () => {
    deliver(query(1));
    const item = board.waiting[0]!;
    expect(await board.answer(item, 'the shelter on 8th')).toBe(true);
    expect(board.waiting.map((w) => w.id)).not.toContain(item.id);
  });

  it('never clears a Distress, even on a successful acknowledgement', async () => {
    // Acknowledging is telling them somebody is awake, not that it is over. Only a human
    // ending it clears one [invariant 2].
    deliver(distress());
    const item = board.distress[0]!;
    expect(await board.answer(item, 'awake, on my way')).toBe(true);
    expect(board.distress.map((w) => w.id)).toContain(item.id);
  });
});

describe('state changes arriving out of order', () => {
  it('does not let a replayed stand-down take somebody off the board', () => {
    // The presence store already guards this and says why — out-of-order delivery is normal
    // on relays. The board, which is the watch's picture of who is out, did not: a stale
    // stand-down removed an operator who was actually out, and the watch stopped seeing them.
    const raven = newSecretKey();
    deliver(stoodDown(raven, T));
    deliver(onStation(raven, T + 3600));
    expect(board.entries).toHaveLength(1);

    deliver(stoodDown(raven, T + 60));
    expect(board.entries).toHaveLength(1);
  });

  it('does not let a replayed sign-on put somebody back who has gone home', () => {
    // The other direction, and the reason the timestamp is remembered after the entry is
    // deleted rather than read off it.
    const raven = newSecretKey();
    deliver(onStation(raven, T));
    deliver(stoodDown(raven, T + 3600));
    expect(board.entries).toHaveLength(0);

    deliver(onStation(raven, T + 60));
    expect(board.entries).toHaveLength(0);
  });

  it('still follows a genuine stand-down', () => {
    const raven = newSecretKey();
    deliver(onStation(raven, T));
    deliver(stoodDown(raven, T + 3600));
    expect(board.entries).toHaveLength(0);
  });

  it('orders the queue by when we received it, not when they say they sent it', () => {
    // Sorted oldest first because those people have waited longest — and ordered by the
    // sender's own created_at, anything backdated went straight to the top of the queue.
    deliver(query(1));
    const backdated = (() => {
      const sender = newSecretKey();
      return finalizeEvent(
        buildSignal(sender, to, 'query', { text: 'jumped the queue', area: 'north' }, T - 999_999),
        sender
      );
    })();
    deliver(backdated);

    expect(board.waiting.map((w) => w.text)).toEqual(['q1', 'jumped the queue']);
  });
});

/** The watch's own state, as a relay serves it. */
const advertisedState = (holder: string, at: number): Event =>
  finalizeEvent(
    buildWatchStateEvent(
      { state: 'station', holder, holder_kind: 'human', oncall: [], since: at, agent_health: 'down', last_drill: null, now: at },
      at
    ),
    watch
  );
const states = () =>
  published.filter((p) => p.event.kind === KIND_WATCH_STATE).map((p) => JSON.parse(p.event.content).state as string);

describe('a watch held while its screen is closed [audit: relay paths]', () => {
  it('still hears a Distress after the holder leaves the Watch screen', async () => {
    await board.takeWatch();
    board.stop();
    deliver(distress());
    expect(board.distress, 'the holder is announced on station and heard nothing').toHaveLength(1);
  });

  it('goes quiet when forgotten: nothing heard, nothing announced, nothing sent', async () => {
    vi.useFakeTimers();
    try {
      await board.takeWatch();
      const before = published.length;
      board.forget();
      deliver(distress());
      vi.advanceTimersByTime(600_000);
      expect(board.onStation).toBe(false);
      expect(board.distress).toHaveLength(0);
      expect(published.length, 'a forgotten watch went on announcing its holder').toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the watch’s own state, from relays that disagree [audit: relay paths]', () => {
  it('lets a stand-down say Dark when a lagging relay still serves an older holder', async () => {
    const now = Math.floor(Date.now() / 1000);
    await board.takeWatch();
    deliver(advertisedState('Watch', now));
    deliver(advertisedState('Raven', now - 180));
    await board.standDown();
    expect(states().at(-1), 'an older Station from one relay stopped the stand-down').toBe('dark');
  });
});

/** The relays each Station claim the board published was offered to, in order. */
const stations = () =>
  published
    .filter((p) => p.event.kind === KIND_WATCH_STATE && JSON.parse(p.event.content).state === 'station')
    .map((p) => p.url);
const acks = () => published.filter((p) => p.event.kind === KIND_RESPONSE).map((p) => p.url);

describe('a holder who changes relays while on station [review: relay paths]', () => {
  /*
   * Only the watch was compared, so the listener stayed on the relays the watch was taken on for
   * the whole shift, while the beat announced the holder on the new ones. Operators who had moved
   * read On station, and nothing on this phone heard their Distress.
   */
  it('hears a Distress on the new relay once back on the Watch screen', async () => {
    await board.takeWatch();
    watchList = ['wss://b'];
    // Setup, then back to Watch: the screen closes and opens again.
    board.stop();
    board.start();
    await settle();
    deliver(distress(), 'wss://b');
    expect(board.distress, 'announced on the new relay and deaf on it').toHaveLength(1);
    expect(listeningOn('wss://r'), 'still listening where the watch no longer is').toBe(false);
  });

  it('follows it on the beat, for a holder who never goes back to the Watch screen', async () => {
    vi.useFakeTimers();
    await board.takeWatch();
    watchList = ['wss://b'];
    await vi.advanceTimersByTimeAsync(120_000);
    await settle();
    deliver(distress(), 'wss://b');
    expect(board.distress).toHaveLength(1);
    // Announced there once it has kept hearing there, and not before.
    expect(stations()).toEqual(['wss://r']);
    await vi.advanceTimersByTimeAsync(HEARD_FOR);
    expect(stations().at(-1)).toBe('wss://b');
  });

  it('moves the listener to the new relay and lets go of the old one', async () => {
    // Which goes first is not claimed: on the app's pool a new relay is asked only once its
    // connection is up, and a dropped one is let go at once (subscribe-relays.test.ts).
    await board.takeWatch();
    watchList = ['wss://b'];
    order.length = 0;
    board.start();
    expect([...order].sort()).toEqual(['close wss://r', 'open wss://b']);
  });

  it('leaves the subscription on a relay both lists share alone', async () => {
    watchList = ['wss://r', 'wss://b'];
    await board.takeWatch();
    order.length = 0;
    watchList = ['wss://r', 'wss://c'];
    board.start();
    expect([...order].sort()).toEqual(['close wss://b', 'open wss://c']);
  });
});

describe('an answer to somebody heard on a relay the watch has since left [review: relay paths]', () => {
  /*
   * The answer went only to the watch's relays as they are now and counted as sent if any took
   * it, so an acknowledgement could go where its sender never listens, be reported sent, and leave
   * the sender's phone saying nobody was coming.
   */
  it('goes to the relay they were heard on, and counts as sent only if that relay took it', async () => {
    deliver(distress(), 'wss://r');
    const item = board.distress[0]!;
    watchList = ['wss://b'];
    board.start();
    await settle();

    refusing = new Set(['wss://r']);
    expect(await board.answer(item, 'awake'), 'reported sent to a relay they never listen on').toBe(false);
    expect(acks()).toContain('wss://r');

    refusing = new Set();
    published.length = 0;
    expect(await board.answer(item, 'awake')).toBe(true);
    expect(acks()).toEqual(['wss://r', 'wss://b']);
  });

  it('remembers every relay a signal arrived on', async () => {
    watchList = ['wss://r', 'wss://b'];
    board.start();
    await settle();
    const d = distress();
    deliver(d, 'wss://r');
    deliver(d, 'wss://b');
    expect(board.distress).toHaveLength(1);
    expect(board.distress[0]!.heardOn).toEqual(['wss://r', 'wss://b']);
  });
});

describe('standing down after a change of relays [review: relay paths]', () => {
  /*
   * The handover guard trusted what the listener had heard, and the listener had not heard the
   * new relays — so Dark went out over a holder who had taken over there.
   */
  it('does not say Dark over somebody who took over on the new relays', async () => {
    const now = Math.floor(Date.now() / 1000);
    await board.takeWatch();
    // The squad moved and Raven took the watch there. This phone has not looked since.
    watchList = ['wss://b'];
    stored.set('wss://b', [advertisedState('Raven', now)]);
    await board.standDown();
    expect(states().at(-1), 'Dark went out over the holder who took over').toBe('station');
  });

  it('still says Dark when nobody else holds it', async () => {
    await board.takeWatch();
    watchList = ['wss://b'];
    await board.standDown();
    expect(states().at(-1)).toBe('dark');
  });
});

describe('a phone holding the watch that cannot hear on its relays [review: relay paths]', () => {
  /*
   * The beat checked only that a listener existed, and one whose every relay refused it, or held
   * it without a word, still existed — so a named human went on being announced while nothing on
   * this phone could hear a Distress.
   */
  it('stops renewing the claim on a relay that refuses its subscription, so it reads Dark there', async () => {
    vi.useFakeTimers();
    watchList = ['wss://r', 'wss://q'];
    treatment.set('wss://q', 'refuse');
    board.start();
    await settle();
    await board.takeWatch();
    await vi.advanceTimersByTimeAsync(3 * 120_000);
    expect(stations().length, 'nothing was announced at all').toBeGreaterThanOrEqual(4);
    expect(stations().filter((url) => url === 'wss://q'), 'announced where it cannot hear').toEqual([]);
  });

  it('says so, and announces nobody, when it hears on no relay at all', async () => {
    treatment.set('wss://r', 'refuse');
    board.stop();
    board.start();
    await settle();
    expect(board.deaf).toBe(true);
    await board.takeWatch();
    expect(stations(), 'a human announced while nothing on this phone can hear a Distress').toEqual([]);
    expect(board.unannounced).toBe(false);
  });

  it('counts a relay that takes the subscription and says nothing as not hearing', async () => {
    vi.useFakeTimers();
    treatment.set('wss://r', 'silent');
    board.stop();
    board.start();
    await settle();
    expect(board.deaf, 'decided before the relay had its chance').toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(board.deaf).toBe(true);
  });

  it('announces once when the listener it opened answers, not twice', async () => {
    board.stop();
    await board.takeWatch();
    await settle();
    expect(board.deaf).toBe(false);
    expect(stations()).toEqual(['wss://r']);
  });

  it('announces once a relay has kept answering again, without waiting for the beat', async () => {
    vi.useFakeTimers();
    treatment.set('wss://r', 'refuse');
    board.stop();
    board.start();
    await settle();
    await board.takeWatch();
    expect(stations()).toEqual([]);
    treatment.set('wss://r', 'answer');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(board.deaf).toBe(false);
    expect(stations(), 'announced the moment a relay answered, before it had kept at it').toEqual([]);
    expect(board.announced).toBe(false);
    await vi.advanceTimersByTimeAsync(HEARD_FOR);
    expect(stations(), 'heard again, and not announced until the next beat').toEqual(['wss://r']);
    expect(board.announced).toBe(true);
  });

  it('announces nobody on a relay that answers and drops again straight away', async () => {
    // Each reopen answered for a moment, and the claim went out in that moment: renewed every
    // thirty seconds or less, it never went stale, while nothing on this phone heard a Distress
    // for more than a fraction of a second at a time [review: relay paths].
    vi.useFakeTimers();
    treatment.set('wss://r', 'flap');
    board.stop();
    board.start();
    await settle();
    await vi.advanceTimersByTimeAsync(100);
    expect(board.deaf).toBe(true);
    await board.takeWatch();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(subs.length, 'the relay was not asked again: nothing was tested').toBeGreaterThan(10);
    expect(stations(), 'a human announced on a relay this phone hears on for 50 ms at a time').toEqual([]);
    expect(board.onStation).toBe(true);
    expect(board.announced).toBe(false);
  });

  it('stops saying operators read the holder as here once a claim would have gone stale', async () => {
    vi.useFakeTimers();
    await board.takeWatch();
    expect(board.announced).toBe(true);
    // The relay goes on refusing from here: nothing is renewed.
    treatment.set('wss://r', 'refuse');
    dropAll('wss://r');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(board.deaf).toBe(true);
    expect(board.announced, 'the take is still the newest claim, and fresh').toBe(true);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(board.announced, 'five minutes with nothing renewed, which operators read as Dark').toBe(false);
  });
});

describe('taking the watch before every relay has answered [review: relay paths]', () => {
  /*
   * A take before the listener's first verdict went to every watch relay — so one that had
   * already refused the board was told a human was on station, while one relay was still to
   * answer and the verdict was not in.
   */
  it('announces only where it hears, once a relay has answered', async () => {
    watchList = ['wss://r', 'wss://s', 'wss://q'];
    treatment.set('wss://s', 'silent');
    treatment.set('wss://q', 'refuse');
    board.stop();
    board.start();
    await settle();
    expect(board.deaf).toBe(false);
    await board.takeWatch();
    expect(stations()).toEqual(['wss://r']);
  });

  it('never announces where a relay has already refused, before any has answered', async () => {
    watchList = ['wss://q', 'wss://s'];
    treatment.set('wss://s', 'silent');
    treatment.set('wss://q', 'refuse');
    board.stop();
    board.start();
    await settle();
    await board.takeWatch();
    // Nothing is known about s yet, so it is told; q has said no to the board.
    expect(stations()).toEqual(['wss://s']);
  });

  it('says operators do not read the holder as here when the take reached nobody', async () => {
    treatment.set('wss://r', 'refuse');
    board.stop();
    board.start();
    await settle();
    await board.takeWatch();
    expect(board.announced).toBe(false);
  });
});

describe('standing down while something else happens [review: relay paths]', () => {
  const sent = (from: number) => published.slice(from).map((p) => JSON.parse(p.event.content).state as string);

  it('starts no Dark retry over a holder who took the watch back while it was out', async () => {
    vi.useFakeTimers();
    await board.takeWatch();
    holding = [];
    const down = board.standDown();
    await vi.advanceTimersByTimeAsync(10);
    const dark = holding.splice(0);
    expect(dark.map((d) => JSON.parse(d.event.content).state)).toEqual(['dark']);
    holding = null;
    // Back on station while the Dark is still out, and then the Dark fails.
    await board.takeWatch();
    const retaken = published.length;
    for (const d of dark) d.settle(false);
    await down;
    expect(board.onStation).toBe(true);
    expect(board.stillAdvertised, 'says the watch is still advertised to a holder who is on it').toBe(false);
    await vi.advanceTimersByTimeAsync(3 * 120_000);
    expect(sent(retaken), 'a Dark went out over the holder back on station').not.toContain('dark');
  });

  it('sends nothing after a wipe that lands while it reads who holds the watch', async () => {
    vi.useFakeTimers();
    await board.takeWatch();
    // The read takes its time: the relay says nothing to it.
    treatment.set('wss://r', 'silent');
    const before = published.length;
    const down = board.standDown();
    await vi.advanceTimersByTimeAsync(1_000);
    board.forget();
    await vi.advanceTimersByTimeAsync(5_000);
    await down;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(sent(before), 'the wipe promised nothing would be sent').toEqual([]);
    expect(board.stillAdvertised).toBe(false);
  });

  it('stamps each state later than the last, so a quick change of mind is never a tie', async () => {
    // Two replaceable events from one second are settled by id, so a stand-down straight after an
    // accidental take left the take standing — a named human announced — half the time.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T * 1000 + 100));
    await board.takeWatch();
    await board.standDown();
    await board.takeWatch();
    const watchStates = published.filter((p) => p.event.kind === KIND_WATCH_STATE).map((p) => p.event);
    expect(watchStates.map((e) => JSON.parse(e.content).state)).toEqual(['station', 'dark', 'station']);
    const at = watchStates.map((e) => e.created_at);
    expect(at[1]!, 'Dark and the claim it replaces share a second').toBeGreaterThan(at[0]!);
    expect(at[2]!).toBeGreaterThan(at[1]!);
  });
});
