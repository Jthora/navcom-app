/**
 * The phone's half of G3, through the session that every screen sends with.
 *
 * Core decides who may close a `Distress`, and seals to the executor's key — but only when the
 * address it is handed names that key. The session built every address from the watch's pubkey and
 * holders alone, so none of it reached a phone: the executor's answer was not even asked for, and an
 * answer the watch key alone signed — which the daemon beside the agent can send — still ended a
 * `Distress` on a box that had handed over its escalation key.
 *
 * One stand-in relay that honours `authors`, as a relay does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from 'nostr-tools/core';
import type { Filter } from 'nostr-tools/filter';
import { finalizeEvent } from 'nostr-tools/pure';
import {
  KIND_RESPONSE,
  KIND_SIGNAL,
  THE_RECORD,
  buildWatchStateEvent,
  newSecretKey,
  openFromGroup,
  publicKeyOf,
  seal,
  type ResponsePayload
} from '@navcom/core';

const WATCH = newSecretKey();
const W = publicKeyOf(WATCH);
const EXECUTOR = newSecretKey();
const X = publicKeyOf(EXECUTOR);
/** The phone: an operator, or a person on call — the same key either way, the one on the roster. */
const ME = newSecretKey();
const MY = publicKeyOf(ME);
const A = 'a'.repeat(64);

let config: { pubkey: string; relays: string[]; holders: string[]; executor?: string } | null = null;

vi.mock('./identity', () => ({ loadIdentity: () => ({ secretKey: ME, pubkey: MY, callsign: 'Wren' }) }));
vi.mock('./config', () => ({ loadConfig: () => config, storedWatch: () => config }));
vi.mock('./pq.svelte', () => ({ kemKeys: () => ({}) }));

type Handlers = { onevent: (e: Event) => void; oneose?: () => void; onclose?: (r: unknown) => void };
interface Sub {
  filters: Filter[];
  h: Handlers;
  open: boolean;
}
const subs: Sub[] = [];
const published: Event[] = [];
/** Every relay each publish was handed, in order. */
const publishedTo: string[] = [];
/** How a relay answers a publish, where a test needs other than `take`. */
let answerOf: ((url: string) => Promise<string>) | null = null;
/** How the relay answers what is published to it. */
let take = true;
/** What the relay delivers back after something is published: the watch's answers, say. */
let replies: (event: Event) => Event[] = () => [];

const matches = (f: Filter, e: Event) =>
  (!f.kinds || f.kinds.includes(e.kind)) &&
  (!f.authors || f.authors.includes(e.pubkey)) &&
  (!f['#p'] || e.tags.some((t) => t[0] === 'p' && f['#p']!.includes(t[1]!))) &&
  (!f['#e'] || e.tags.some((t) => t[0] === 'e' && f['#e']!.includes(t[1]!)));

const deliver = (event: Event) => {
  for (const s of [...subs]) if (s.open && s.filters.some((f) => matches(f, event))) s.h.onevent(event);
};

function subscribe(filters: Filter[], h: Handlers) {
  const sub: Sub = { filters, h, open: true };
  subs.push(sub);
  queueMicrotask(() => sub.open && h.oneose?.());
  return { close: () => void (sub.open = false) };
}

const bus = {
  subscribeMany: (_urls: string[], filter: Filter, h: Handlers) => subscribe([filter], h),
  subscribeMap: (requests: { url: string; filter: Filter }[], h: Handlers) =>
    subscribe(requests.map((r) => r.filter), h),
  publish: (urls: string[], event: Event) => {
    published.push(event);
    publishedTo.push(...urls);
    if (take || answerOf) for (const r of replies(event)) setTimeout(() => deliver(r), 5);
    return urls.map((url) =>
      answerOf ? answerOf(url) : take ? Promise.resolve('ok') : Promise.reject(new Error('blocked: no'))
    );
  },
  close: () => {}
};
vi.mock('./pool', () => ({ pool: () => bus }));

/** A `20912` from `author`, sealed by it to this phone, answering `ids`. */
function answer(author: Uint8Array, ids: string[], body: Partial<ResponsePayload>): Event {
  return finalizeEvent(
    {
      kind: KIND_RESPONSE,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', MY], ...ids.map((id) => ['e', id])],
      content: seal(author, MY, { text: null, provenance: null, ...body })
    },
    author
  );
}
const human = { type: 'ack' as const, responder: { kind: 'human' as const, callsign: 'Raven' }, text: 'on my way' };

let session: typeof import('./session.svelte');

beforeEach(async () => {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  };
  subs.length = 0;
  published.length = 0;
  publishedTo.length = 0;
  answerOf = null;
  take = true;
  replies = () => [];
  config = { pubkey: W, relays: ['wss://r'], holders: [], executor: X };
  vi.resetModules();
  session = await import('./session.svelte');
});

afterEach(() => {
  session.operator.forget();
  vi.useRealTimers();
});

async function until(check: () => boolean, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('who may end a Distress, as Status reads it', () => {
  it('is the executor, on a watch handed over with its escalation key', () => {
    expect(session.watchClosure()).toMatchObject({ attributed: true, executor: X });
  });

  it('is anybody holding the watch key, on a box handed over before it named one', () => {
    config = { pubkey: W, relays: ['wss://r'], holders: [] };
    expect(session.watchClosure()).toMatchObject({ attributed: false, executor: null });
  });
});

describe('a Distress on a box that named its executor', () => {
  it('is not ended by a person’s answer the watch key alone signed, and is ended by the executor’s', async () => {
    replies = (event) => (event.kind === 20911 ? [answer(WATCH, [event.id], human)] : []);
    void session.operator.raiseDistress('');
    await until(
      () => session.operator.distress.some((p) => p.phase === 'human-unconfirmed' || p.phase === 'acknowledged'),
      3_000,
      'the watch key’s answer arriving'
    );
    expect(
      session.operator.distress.some((p) => p.phase === 'acknowledged'),
      'the daemon’s key told an operator in trouble a person had it, and the phone stopped sending'
    ).toBe(false);
    expect(session.operator.distressRunning).toBe(true);

    const sent = published.find((e) => e.kind === 20911)!;
    deliver(answer(EXECUTOR, [sent.id], human));
    await until(() => !session.operator.distressRunning, 3_000, 'the executor’s answer ending it');
    expect(session.operator.distress.at(-1)).toMatchObject({ phase: 'acknowledged', by: 'executor' });
  });
});

describe('a question to the watch', () => {
  it('hears the answer the executor’s own key signed', async () => {
    replies = (event) => (event.kind === KIND_SIGNAL ? [answer(EXECUTOR, [event.id], { type: 'answer', responder: { kind: 'node', callsign: 'escalation' }, text: 'heard' })] : []);
    void session.operator.query('anyone?');
    await until(() => session.operator.lastResponse !== null, 2_000, 'the executor’s answer');
    expect(session.operator.lastResponse?.text).toBe('heard');
  });
});

describe('asking the watch to wake the others', () => {
  it('goes from this phone’s own key, names the attempt, and the executor can open it', async () => {
    replies = (event) => [answer(EXECUTOR, [event.id], { type: 'answer', responder: { kind: 'node', callsign: 'escalation' }, text: 'Paging Raven.' })];
    const outcome = await session.operator.wakeOthers(A);
    const sent = published.find((e) => e.kind === KIND_SIGNAL)!;
    expect(sent.pubkey, 'sent from a key the roster does not hold').toBe(MY);
    expect(sent.tags).toContainEqual(['t', 'wake-others']);
    expect(sent.tags).toContainEqual(['p', W]);
    expect(openFromGroup<{ distress_id: string }>(EXECUTOR, MY, sent.content)).toEqual({ distress_id: A });
    expect(outcome).toMatchObject({ took: 1, error: null, from: 'executor', answer: { text: 'Paging Raven.' } });
  });

  it('says so when the watch does not answer, and that it went', async () => {
    vi.useFakeTimers();
    const pending = session.operator.wakeOthers(A);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(await pending).toEqual({ took: 1, answer: null, from: null, error: null });
  });

  it('takes the executor’s answer over a watch-key one that came first [review: live hole, phone]', async () => {
    // The daemon beside the agent holds the watch key, and the signal is public: a compromised agent
    // answers in milliseconds that the roster is being paged, ahead of the executor's real refusal.
    replies = (event) => {
      setTimeout(
        () => deliver(answer(EXECUTOR, [event.id], { type: 'answer', responder: { kind: 'node', callsign: 'escalation' }, text: 'Not done -- the hold had already ended.' })),
        50
      );
      return [answer(WATCH, [event.id], { type: 'answer', responder: { kind: 'node', callsign: 'escalation' }, text: 'Done. The watch is paging Raven, Kestrel about them.' })];
    };
    const outcome = await session.operator.wakeOthers(A);
    expect(outcome.answer?.text, 'a forged "paging Raven" shown while nobody was paged').toBe('Not done -- the hold had already ended.');
    expect(outcome.from).toBe('executor');
  });

  it('shows the watch key’s answer only as unconfirmed, once the executor’s has not come in the window', async () => {
    vi.useFakeTimers();
    replies = (event) => [answer(WATCH, [event.id], { type: 'answer', responder: { kind: 'node', callsign: 'escalation' }, text: 'Paging Raven.' })];
    const pending = session.operator.wakeOthers(A);
    await vi.advanceTimersByTimeAsync(100);
    let done = false;
    void pending.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done, 'settled on the watch key’s answer without waiting for the executor’s').toBe(false);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(await pending).toMatchObject({ took: 1, from: 'watch-key', answer: { text: 'Paging Raven.' }, error: null });
  });

  it('on a box that names no executor, takes the watch key’s answer as it comes, and says whose it is', async () => {
    config = { pubkey: W, relays: ['wss://r'], holders: [] };
    replies = (event) => [answer(WATCH, [event.id], { type: 'answer', responder: { kind: 'node', callsign: 'escalation' }, text: 'Paging Raven.' })];
    const outcome = await session.operator.wakeOthers(A);
    expect(outcome).toMatchObject({ took: 1, from: 'watch-key', answer: { text: 'Paging Raven.' } });
  });

  it('never goes to a mission relay, whatever the watch’s list says [review: live hole, phone]', async () => {
    config = { pubkey: W, relays: ['wss://r', THE_RECORD], holders: [], executor: X };
    replies = (event) => [answer(EXECUTOR, [event.id], { type: 'answer', responder: { kind: 'node', callsign: 'escalation' }, text: 'Paging Raven.' })];
    const outcome = await session.operator.wakeOthers(A);
    expect(publishedTo, 'a wake-others naming this person’s roster key went to The Record').toEqual(['wss://r']);
    expect(outcome.took).toBe(1);
  });

  it('hands it to each relay on its own, so one the pool cannot read refuses only itself', async () => {
    config = { pubkey: W, relays: ['wss://r', 'wss://b'], holders: [], executor: X };
    replies = (event) => [answer(EXECUTOR, [event.id], { type: 'answer', responder: { kind: 'node', callsign: 'escalation' }, text: 'Paging Raven.' })];
    answerOf = (url) => {
      if (url === 'wss://b') throw new Error('invalid relay url');
      return Promise.resolve('ok');
    };
    const outcome = await session.operator.wakeOthers(A).catch((e: unknown) => ({ thrown: e }));
    expect(outcome).toMatchObject({ took: 1 });
  });

  it('keeps an answer it already has when no relay’s OK came back in time, rather than saying it never left', async () => {
    // A slow relay forwards the signal, the executor answers at once, and the pool gives up on the OK.
    answerOf = () => new Promise((_, reject) => setTimeout(() => reject(new Error('publish timed out')), 60));
    replies = (event) => [answer(EXECUTOR, [event.id], { type: 'answer', responder: { kind: 'node', callsign: 'escalation' }, text: 'Paging Raven.' })];
    const outcome = await session.operator.wakeOthers(A);
    expect(outcome, 'told the person it did not send while the roster was being paged').toMatchObject({
      took: 0,
      from: 'executor',
      error: null,
      answer: { text: 'Paging Raven.' }
    });
  });

  it('says it never left, when no relay took it', async () => {
    take = false;
    const outcome = await session.operator.wakeOthers(A);
    expect(outcome.took).toBe(0);
    expect(outcome.answer).toBeNull();
    expect(outcome.error).toMatch(/no relay took it/i);
  });

  it('sends nothing without an attempt to name', async () => {
    const outcome = await session.operator.wakeOthers('not-an-id');
    expect(outcome.took).toBe(0);
    expect(outcome.error).toMatch(/which Distress/);
    expect(published).toEqual([]);
  });

  it('says there is no watch to send it to, and sends nothing', async () => {
    config = null;
    const outcome = await session.operator.wakeOthers(A);
    expect(outcome.took).toBe(0);
    expect(outcome.error).toMatch(/you have not added one/);
    expect(published).toEqual([]);
  });
});

describe('a watch taken again by the same holder', () => {
  /** The watch's Station, holder Raven, holding since `since`, signed now. */
  const station = (since: number) => {
    const now = Math.floor(Date.now() / 1000);
    return finalizeEvent(
      buildWatchStateEvent(
        { state: 'station', holder: 'Raven', holder_kind: 'human', oncall: [], since, agent_health: 'down', last_drill: null, log_root: null, now },
        now
      ),
      WATCH
    );
  };
  const onStations = () =>
    published.filter((e) => e.kind === KIND_SIGNAL && e.tags.some((t) => t[0] === 't' && t[1] === 'on-station'));

  it('is told this operator is out again, with the time remaining rather than the time declared', async () => {
    // Raven's board reloaded, which empties it, and Raven took the watch back: the same holder, a
    // new holding. Comparing the callsign alone, nobody out ever told it again.
    replies = (event) =>
      event.kind === KIND_SIGNAL ? [answer(WATCH, [event.id], { type: 'answer', responder: { kind: 'human', callsign: 'Raven' }, text: 'Out. Noted.' })] : [];
    const { watch } = await import('./watch.svelte');
    watch.start();
    const now = Math.floor(Date.now() / 1000);
    deliver(station(now - 600));
    await session.operator.signOn('Downtown', 2, null);
    expect(onStations()).toHaveLength(1);

    // The same holding, restated by the beat: nothing to say.
    deliver(station(now - 600));
    await new Promise((r) => setTimeout(r, 20));
    expect(onStations()).toHaveLength(1);

    // Ten minutes later Raven takes the watch again.
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(Date.now() + 600_000);
    deliver(station(now + 600));
    await until(() => onStations().length === 2, 3_000, 'the operator saying they are out again');
    const again = openFromGroup<{ expected_duration: number; area: string }>(WATCH, MY, onStations()[1]!.content);
    expect(again.area).toBe('Downtown');
    expect(Math.abs(again.expected_duration - (2 * 3600 - 600))).toBeLessThanOrEqual(5);
    watch.stop();
  });
});
