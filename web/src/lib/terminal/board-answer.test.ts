/**
 * A squad member's answer, signed for themselves [G3; `signals.spec.md`, *The answer signature*].
 *
 * Every member holds the watch key, and so does everybody who ever did, so an answer the watch key
 * alone signs says only that somebody who once held the watch sent it. An operator's phone that knows
 * its holders now ends a `Distress` only on an answer carrying one of their own signatures, and the
 * board answered unsigned: every acknowledgement a squad member sent read on the operator's phone as
 * one it could not confirm, and the phone went on sending.
 *
 * Driven end to end on one stand-in relay: the operator's phone runs core's own Distress loop, the
 * board hears it, the member answers, and the operator's phone decides.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from 'nostr-tools/core';
import type { Filter } from 'nostr-tools/filter';
import { finalizeEvent } from 'nostr-tools/pure';
import {
  KIND_RESPONSE,
  answerSignedByResponder,
  buildSignal,
  newSecretKey,
  open,
  publicKeyOf,
  sendDistressUntilAcknowledged,
  watchtowerAt,
  type DistressPhase,
  type ResponsePayload
} from '@navcom/core';

const WATCH = newSecretKey();
const W = publicKeyOf(WATCH);
/** The squad member holding the watch on this phone. Their own key, not the watch's. */
const MEMBER = newSecretKey();
const M = publicKeyOf(MEMBER);
/** An operator out under this squad's watch. */
const OPERATOR = newSecretKey();
const OP = publicKeyOf(OPERATOR);
const SQUAD = watchtowerAt(W, [M]);

vi.mock('./identity', () => ({ loadIdentity: () => ({ secretKey: MEMBER, pubkey: M, callsign: 'Wren' }) }));
vi.mock('./config', () => ({ loadConfig: () => null }));
vi.mock('./watch-key', () => ({ watchKey: () => WATCH, watchPubkey: () => W }));
vi.mock('./relays', () => ({ relays: () => ['wss://r'], watchRelays: () => ['wss://r'] }));

type Handlers = { onevent: (e: Event) => void; oneose?: () => void; onclose?: (r: unknown) => void };
interface Sub {
  filters: Filter[];
  h: Handlers;
  open: boolean;
}
/** One relay that everybody here is on: what is published reaches every open subscription it matches. */
const subs: Sub[] = [];
const published: Event[] = [];

const matches = (f: Filter, e: Event) =>
  (!f.kinds || f.kinds.includes(e.kind)) &&
  (!f.authors || f.authors.includes(e.pubkey)) &&
  (!f['#p'] || e.tags.some((t) => t[0] === 'p' && f['#p']!.includes(t[1]!))) &&
  (!f['#e'] || e.tags.some((t) => t[0] === 'e' && f['#e']!.includes(t[1]!)));

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
    queueMicrotask(() => {
      for (const s of [...subs]) if (s.open && s.filters.some((f) => matches(f, event))) s.h.onevent(event);
    });
    return urls.map(() => Promise.resolve('ok'));
  },
  close: () => {}
};
vi.mock('./pool', () => ({ pool: () => bus }));

let board: typeof import('./board.svelte').board;

beforeEach(async () => {
  subs.length = 0;
  published.length = 0;
  vi.resetModules();
  ({ board } = await import('./board.svelte'));
  board.start();
  await new Promise((r) => setTimeout(r, 0));
});

afterEach(() => board.forget());

async function until(check: () => boolean, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** What the board sent the operator, opened with the operator's key. */
function answersTo(operator: Uint8Array): { event: Event; payload: ResponsePayload }[] {
  return published
    .filter((e) => e.kind === KIND_RESPONSE)
    .map((event) => ({ event, payload: open<ResponsePayload>(operator, W, event.content) }));
}

describe('a squad member acknowledging a Distress from the board', () => {
  it('ends it on the operator’s phone, as an answer from one of its holders', async () => {
    const phases: DistressPhase[] = [];
    const stop = new AbortController();
    const run = sendDistressUntilAcknowledged(
      bus as never,
      ['wss://r'],
      OPERATOR,
      OP,
      SQUAD,
      { position: null, area: 'north side' },
      { signal: stop.signal, onPhase: (p) => phases.push(p) }
    );
    try {
      await until(() => board.distress.length === 1, 3_000, 'the board hearing the Distress');
      expect(await board.answer(board.distress[0]!, 'awake, on my way')).toBe(true);
      await until(
        () => phases.some((p) => p.phase === 'acknowledged' || p.phase === 'human-unconfirmed'),
        3_000,
        'the operator’s phone hearing the answer'
      );
      const unconfirmed = phases.find((p) => p.phase === 'human-unconfirmed');
      expect(unconfirmed, 'the operator’s phone could not confirm a holder’s answer, and kept sending').toBeUndefined();
      const done = phases.find((p) => p.phase === 'acknowledged');
      expect(done).toMatchObject({ phase: 'acknowledged', by: 'holder', response: { responder: { callsign: 'Wren' } } });
      await run;
    } finally {
      stop.abort();
      await run.catch(() => undefined);
    }
  });

  it('signs exactly what it said, about exactly what it answers, with the member’s own key', async () => {
    const sender = newSecretKey();
    const query = finalizeEvent(
      buildSignal(sender, SQUAD, 'query', { text: 'nearest bed?', area: 'north' }, Math.floor(Date.now() / 1000)),
      sender
    );
    bus.publish(['wss://r'], query);
    await until(() => board.waiting.length === 1, 3_000, 'the board hearing the query');
    expect(await board.answer(board.waiting[0]!, 'St Anne’s, 40 beds')).toBe(true);
    const [{ event, payload }] = answersTo(sender);
    expect(event.pubkey, 'the answer is still the watch’s').toBe(W);
    expect(payload.responder.pubkey).toBe(M);
    const about = { watch: W, operator: publicKeyOf(sender), ids: [query.id] };
    expect(answerSignedByResponder(about, payload), 'not the member’s signature on this answer').toBe(true);
    // And nothing else: other words, or another signal, and it no longer checks.
    expect(answerSignedByResponder(about, { ...payload, text: 'nobody is coming' })).toBe(false);
    expect(answerSignedByResponder({ ...about, ids: ['f'.repeat(64)] }, payload)).toBe(false);
  });
});
