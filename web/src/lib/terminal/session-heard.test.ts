/**
 * Where the watch is heard, through the session every screen sends with [relay-lists §6, §7].
 *
 * Core already took `watchStateAgeMs`, and with it each attempt's account named which relays that
 * took it the watch was heard on — and the session never passed it, so no account ever did. Nor
 * did it keep any relay's answer to a signal, so a relay refusing this phone counted the same as
 * one taking it. These run the session against a stand-in pool that knows which relay is which:
 * what each relay was handed, what each was asked for, and what each said back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Event } from 'nostr-tools/core';
import type { Filter } from 'nostr-tools/filter';
import { finalizeEvent } from 'nostr-tools/pure';
import {
  KIND_DISTRESS,
  KIND_RESPONSE,
  KIND_SIGNAL,
  KIND_WATCH_STATE,
  THE_RECORD,
  buildWatchStateEvent,
  newSecretKey,
  publicKeyOf,
  seal,
  type DistressPhase,
  type ResponsePayload
} from '@navcom/core';

const WATCH = newSecretKey();
const W = publicKeyOf(WATCH);
const EXECUTOR = newSecretKey();
const X = publicKeyOf(EXECUTOR);
const ME = newSecretKey();
const MY = publicKeyOf(ME);

const R = 'wss://r';
const S = 'wss://s';

let config: { pubkey: string; relays: string[]; holders: string[]; executor?: string } | null = null;

vi.mock('./identity', () => ({ loadIdentity: () => ({ secretKey: ME, pubkey: MY, callsign: 'Wren' }) }));
vi.mock('./config', () => ({ loadConfig: () => config, storedWatch: () => config }));
vi.mock('./pq.svelte', () => ({ kemKeys: () => ({}) }));

type Handlers = { onevent: (e: Event) => void; oneose?: () => void; onclose?: (r: unknown) => void };
interface Sub {
  urls: string[];
  filters: Filter[];
  h: Handlers;
  open: boolean;
}
const subs: Sub[] = [];
/** Each relay every event was handed to, in order. */
const handed: { kind: number; url: string }[] = [];
/** What each relay stores and serves to a request: the watch's state. */
let stored: Record<string, Event[]> = {};
/** A relay's refusal of an event, in its own words, or null to take it. */
let refuse: (url: string, event: Event) => string | null = () => null;
/** What the watch says back to something published. */
let replies: (event: Event) => Event[] = () => [];
/**
 * A relay's answer to a subscription opened on it alone: nothing to serve it, a reason to refuse it
 * with, or `hold` to take it and never say a word.
 */
let answerSub: (url: string, filters: Filter[]) => string | undefined = () => undefined;
const HOLD = 'hold';

const matches = (f: Filter, e: Event) =>
  (!f.kinds || f.kinds.includes(e.kind)) &&
  (!f.authors || f.authors.includes(e.pubkey)) &&
  (!f['#p'] || e.tags.some((t) => t[0] === 'p' && f['#p']!.includes(t[1]!))) &&
  (!f['#e'] || e.tags.some((t) => t[0] === 'e' && f['#e']!.includes(t[1]!)));

const deliver = (event: Event) => {
  for (const s of [...subs]) if (s.open && s.filters.some((f) => matches(f, event))) s.h.onevent(event);
};

function subscribe(urls: string[], filters: Filter[], h: Handlers) {
  const sub: Sub = { urls, filters, h, open: true };
  subs.push(sub);
  queueMicrotask(() => {
    if (!sub.open) return;
    const verdict = urls.length === 1 ? answerSub(urls[0]!, filters) : undefined;
    if (verdict === HOLD) return;
    if (verdict !== undefined) {
      sub.open = false;
      h.onclose?.(verdict);
      return;
    }
    for (const url of urls) for (const e of stored[url] ?? []) if (filters.some((f) => matches(f, e))) h.onevent(e);
    if (sub.open) h.oneose?.();
  });
  return { close: () => void (sub.open = false) };
}

const bus = {
  subscribeMany: (urls: string[], filter: Filter, h: Handlers) => subscribe([...urls], [filter], h),
  subscribeMap: (requests: { url: string; filter: Filter }[], h: Handlers) =>
    subscribe([...new Set(requests.map((r) => r.url))], requests.map((r) => r.filter), h),
  publish: (urls: string[], event: Event) => {
    for (const url of urls) handed.push({ kind: event.kind, url });
    for (const r of replies(event)) setTimeout(() => deliver(r), 5);
    return urls.map((url) => {
      const why = refuse(url, event);
      return why ? Promise.reject(new Error(why)) : Promise.resolve('ok');
    });
  },
  close: () => {}
};
vi.mock('./pool', () => ({ pool: () => bus }));

const now = () => Math.floor(Date.now() / 1000);
/** The watch's own state, signed, `ago` seconds old. */
const watchState = (ago: number) =>
  finalizeEvent(
    buildWatchStateEvent(
      { state: 'automated', holder: 'nightwatch', holder_kind: 'agent', oncall: [], since: now() - 600, agent_health: 'ok', last_drill: null, now: now() - ago },
      now() - ago
    ),
    WATCH
  );

/** A `20912` from the executor's own key, sealed to this phone, answering `id`. */
const answer = (id: string, body: Partial<ResponsePayload>): Event =>
  finalizeEvent(
    {
      kind: KIND_RESPONSE,
      created_at: now(),
      tags: [['p', MY], ['e', id]],
      content: seal(EXECUTOR, MY, { text: null, provenance: null, type: 'answer', responder: { kind: 'node', callsign: 'escalation' }, ...body })
    },
    EXECUTOR
  );

let session: typeof import('./session.svelte');
let heard: typeof import('./heard.svelte').heard;

beforeEach(async () => {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  };
  subs.length = 0;
  handed.length = 0;
  stored = {};
  refuse = () => null;
  replies = () => [];
  answerSub = () => undefined;
  config = { pubkey: W, relays: [R, S], holders: [], executor: X };
  vi.resetModules();
  session = await import('./session.svelte');
  ({ heard } = await import('./heard.svelte'));
});

afterEach(async () => {
  session.operator.forget();
  await new Promise((r) => setTimeout(r, 0));
});

async function until(check: () => boolean, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const accounted = () =>
  session.operator.distress.find((p): p is Extract<DistressPhase, { phase: 'accounted' }> => p.phase === 'accounted');
const reads = () => subs.filter((s) => s.filters.some((f) => f.kinds?.includes(KIND_WATCH_STATE)));

/** Records the watch as Status's read would have: a fresh state on `url`, which answered. */
function heardOn(url: string) {
  const into = heard.sink(W);
  into.arrived(url, watchState(10));
  into.listening([url]);
  into.settled(1);
}

async function standDown() {
  session.operator.standDownDistress();
  await until(() => !session.operator.distressRunning, 3_000, 'the Distress standing down');
}

describe('a Distress, accounted relay by relay', () => {
  it('names which relays that took an attempt the watch was heard on', async () => {
    stored[R] = [watchState(10)];
    heardOn(R);
    void session.operator.raiseDistress('');
    await until(() => accounted() !== undefined, 3_000, 'the first attempt accounted for');
    expect(accounted()!.took).toEqual([R, S]);
    expect(accounted()!.heard, 'the account said nothing about where the watch was heard').toEqual([R]);
    await standDown();
  });

  it('goes where the receipt counts, and The Record is neither', async () => {
    config = { pubkey: W, relays: [R, THE_RECORD, S], holders: [], executor: X };
    void session.operator.raiseDistress('');
    await until(() => accounted() !== undefined, 3_000, 'the first attempt accounted for');
    expect(handed.filter((h) => h.kind === KIND_DISTRESS).map((h) => h.url)).toEqual([R, S]);
    expect(heard.now().of).toBe(2);
    expect(reads().flatMap((s) => s.urls), 'the watch-state read went somewhere the Distress does not').toEqual([R, S]);
    await standDown();
  });

  it('opens a read of the watch’s state when it starts, and closes it when it is stood down', async () => {
    expect(reads(), 'read before any Distress').toHaveLength(0);
    void session.operator.raiseDistress('');
    await until(() => reads().length === 2, 3_000, 'the watch-state read opening');
    for (const s of reads()) expect(s.filters).toEqual([{ kinds: [KIND_WATCH_STATE], authors: [W], limit: 1 }]);
    expect(reads().every((s) => s.open)).toBe(true);
    await standDown();
    expect(reads().every((s) => !s.open), 'left asking after the Distress was over').toBe(true);
  });

  it('says nothing of where the watch was heard while this phone has no count to say it from', async () => {
    // Opened cold: the read starts beside the first attempt, and here no relay answers it. "The watch
    // heard on 0" would be a race between that read and the relays' OK, read by a person in distress
    // as nothing hearing them.
    stored[R] = [watchState(10)];
    answerSub = (_url, filters) => (filters.some((f) => f.kinds?.includes(KIND_WATCH_STATE)) ? HOLD : undefined);
    void session.operator.raiseDistress('');
    await until(() => accounted() !== undefined, 3_000, 'the first attempt accounted for');
    expect(accounted()!.took).toEqual([R, S]);
    expect('heard' in accounted()!, 'said where the watch was heard before this phone had read it anywhere').toBe(false);
    await standDown();
  });

  it('says it could not hear where the watch answers only on a relay that refused this phone’s listener', async () => {
    // The watch is heard on R alone, and R refuses the request for answers; S serves it. An answer would
    // come on R, so S listening is no help: the window is "could not hear", never "sent, no answer".
    stored[R] = [watchState(10)];
    heardOn(R);
    // Core asks each relay as the pool spells it, with a trailing slash.
    answerSub = (url, filters) =>
      url.replace(/\/$/, '') === R && filters.some((f) => f.kinds?.includes(KIND_RESPONSE)) ? 'restricted: not for you' : undefined;
    void session.operator.raiseDistress('');
    const ended = () => session.operator.distress.find((p) => p.phase === 'no-answer' || p.phase === 'could-not-hear');
    await until(() => ended() !== undefined, 30_000, 'the first window ending');
    expect(ended()!.phase, 'said "no answer" while the only relay an answer would come on could not be read').toBe('could-not-hear');
    await standDown();
  }, 40_000);

  it('says why nothing went anywhere, for a watch whose every relay is one nothing is sent to', async () => {
    config = { pubkey: W, relays: [THE_RECORD], holders: [], executor: X };
    void session.operator.raiseDistress('');
    const failed = () =>
      session.operator.distress.find((p): p is Extract<DistressPhase, { phase: 'unreachable' }> => p.phase === 'unreachable');
    await until(() => failed() !== undefined, 3_000, 'the first attempt failing');
    expect(failed()!.error).toContain(new URL(THE_RECORD).host);
    expect(failed()!.error).toMatch(/not sent, .*mission relay/);
    expect(failed()!.error, 'told the attempt failed, and not why').not.toMatch(/no relay was given/);
    expect(handed.filter((h) => h.kind === KIND_DISTRESS)).toEqual([]);
    await standDown();
  });

  it('sends to a relay the watch adds while it runs', async () => {
    // Read again before every attempt: handed a list taken once, a relay added mid-Distress was never sent to.
    config = { pubkey: W, relays: [R], holders: [], executor: X };
    void session.operator.raiseDistress('');
    await until(() => accounted() !== undefined, 3_000, 'the first attempt accounted for');
    config = { pubkey: W, relays: [R, S], holders: [], executor: X };
    await until(() => session.operator.distress.some((p) => p.phase === 'also-sending'), 35_000, 'the next attempt');
    const also = session.operator.distress.find((p): p is Extract<DistressPhase, { phase: 'also-sending' }> => p.phase === 'also-sending')!;
    expect(also.relays).toEqual([S]);
    await until(() => handed.some((h) => h.kind === KIND_DISTRESS && h.url === S), 5_000, 'the Distress handed to the relay added');
    await standDown();
  }, 45_000);

  it('counts a relay that refused an attempt as not heard on', async () => {
    heardOn(R);
    heardOn(S);
    refuse = (url, event) => (url === S && event.kind === KIND_DISTRESS ? 'blocked: not from you' : null);
    void session.operator.raiseDistress('');
    await until(() => accounted() !== undefined, 3_000, 'the first attempt accounted for');
    expect(heard.now().on).toEqual([R]);
    expect(heard.now().relays.find((r) => r.url === S)!.text).toMatch(/blocked: not from you/);
    await standDown();
  });
});

describe('a signal a relay refuses', () => {
  it('is kept against that relay, in its own words', async () => {
    heardOn(R);
    heardOn(S);
    refuse = (url) => (url === S ? 'blocked: no' : null);
    replies = (event) => (event.kind === KIND_SIGNAL ? [answer(event.id, { text: 'noted' })] : []);
    await session.operator.routine();
    expect(session.operator.lastResponse?.text).toBe('noted');
    const s = heard.now().relays.find((r) => r.url === S)!;
    expect(s.refused).toBe('blocked: no');
    expect(s.text).toMatch(/It refused this phone’s last signal: blocked: no\./);
    expect(heard.now().on).toEqual([R]);
  });

  it('is kept when every relay refused it, before the failure is said', async () => {
    refuse = () => 'blocked: no';
    await session.operator.routine();
    expect(session.operator.error).toMatch(/Failed to publish/);
    expect(heard.now().relays.map((r) => r.refused)).toEqual(['blocked: no', 'blocked: no']);
  });

  it('is said plainly when every relay the watch names is one nothing is sent to', async () => {
    config = { pubkey: W, relays: [THE_RECORD], holders: [], executor: X };
    await session.operator.query('anyone?');
    expect(session.operator.error).toBe('Every relay this watch names is one nothing is sent to. Setup says why for each.');
    expect(handed).toEqual([]);
  });
});

describe('the operator’s own record of what they were told', () => {
  it('keeps where the watch was heard with what it said it could do', async () => {
    heardOn(R);
    replies = (event) => (event.kind === KIND_SIGNAL ? [answer(event.id, { text: 'Out. Noted.' })] : []);
    await session.operator.signOn('Downtown', 1, null);
    expect(session.operator.session?.toldAtSignOn).toMatch(/ Heard on 1 relay only: if it fails, nothing would hear a Distress\.$/);
  });
});

describe('a wipe', () => {
  it('forgets where the watch was heard', () => {
    heardOn(R);
    expect(heard.last).not.toBeNull();
    session.operator.forget();
    expect(heard.last).toBeNull();
  });
});

describe('the session, as written', () => {
  it('hands the Distress loop the function itself, read before every attempt, not a list taken once', () => {
    const src = readFileSync(new URL('./session.svelte.ts', import.meta.url), 'utf8');
    // `distressRelays,` and never `distressRelays(),` or `watchTargets(),`: a call is a list taken once.
    expect(src).toMatch(/sendDistressUntilAcknowledged\(\s*pool\(\),\s*distressRelays\s*,/);
    expect(src).toMatch(/watchStateAgeMs:\s*\(url\)\s*=>\s*heard\.stateAgeMs\(url\)/);
  });
});
