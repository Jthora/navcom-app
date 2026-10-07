/**
 * When a window's silence is "no answer", and when it is "could not hear" [review: G3 phase 1].
 *
 * "No answer" says this phone was listening, for the whole window, where an answer would come. The
 * first rule counted any listener that was open or opening as the window began, on any relay. So it
 * said "no answer" while the only relay that could be read was one the attempt never reached, and
 * while the relay that would carry the answer was still completing its handshake, with Wren's answer
 * already gone past. These tests run the real pool for both, and stand-ins for the edges.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { DistressPhase } from '../src/transport';
import { KIND_DISTRESS } from '../src/events/kinds';
import {
  answer,
  briefly,
  cleanup,
  distress,
  distresses,
  eventually,
  guardedPool,
  manyPool,
  relay,
  slowHandshakeRelay
} from './helpers/distress';

afterEach(cleanup);

/** The window outcomes, in order. */
const outcomes = (phases: DistressPhase[]) =>
  phases.filter((p) => p.phase === 'no-answer' || p.phase === 'could-not-hear').map((p) => p.phase);

describe('"no answer" only where an answer would come', () => {
  it('listening only on a relay that refused the attempt is not listening for an answer to it', async () => {
    // A serves this phone's request and refuses every write: a paid relay it is not a member of.
    const a = await relay();
    a.refuseEvent = () => 'blocked: this relay is for paying members';
    // B takes the Distress, and refuses this phone's request.
    const b = await relay();
    b.refuseReq = () => 'auth-required: sign in to read';
    const { pool } = guardedPool();
    const run = distress(pool, [a.url, b.url], { ackWindowMs: 1_500, backoffMs: 5_000, maxBackoffMs: 5_000 });

    await eventually(() => expect(run.said('sent')).toHaveLength(1), 4_000);
    // Wren answers attempt 1 where it went.
    b.deliver(answer([distresses(b)[0]!.id]));

    await eventually(() => expect(outcomes(run.phases)).toHaveLength(1), 4_000);
    expect(run.names(), 'said "no answer" while a person had answered where the Distress went').not.toContain('no-answer');
    expect(run.said('could-not-hear')[0]!.attempt).toBe(1);
    expect(run.said('accounted')[0]!.took).toEqual([b.url]);
    expect(run.names()).not.toContain('acknowledged');
  }, 10_000);

  it('nor only where the watch has not been heard, when the caller says where it has', async () => {
    const a = await relay();
    const b = await relay();
    b.refuseReq = () => 'rate-limited: too many subscriptions';
    const { pool } = guardedPool();
    const run = distress(pool, [a.url, b.url], {
      ackWindowMs: 1_500,
      backoffMs: 5_000,
      maxBackoffMs: 5_000,
      watchStateAgeMs: (url) => (url === b.url ? 20_000 : null)
    });

    await eventually(() => expect(run.said('sent')).toHaveLength(1), 4_000);
    b.deliver(answer([distresses(b)[0]!.id]));

    await eventually(() => expect(outcomes(run.phases)).toHaveLength(1), 4_000);
    expect(run.names(), 'said "no answer" while a person had answered on the one relay the watch is heard on').not.toContain(
      'no-answer'
    );
    const account = run.said('accounted')[0]!;
    expect(account.took).toEqual([a.url, b.url]);
    expect(account.heard).toEqual([b.url]);
  }, 10_000);

  it('a watch heard nowhere is not a phone that cannot hear: "no answer", where the attempt went', async () => {
    // A watch that has gone dark: listening where the attempts went is listening. "Could not hear"
    // would be hope that nothing supports, at the moment the operator most needs the truth.
    const phases = await briefly(manyPool({ eose: true }), ['wss://a', 'wss://b'], 2, { watchStateAgeMs: () => null });
    expect(outcomes(phases)).toEqual(['no-answer', 'no-answer']);
    const account = phases.find((p) => p.phase === 'accounted');
    expect(account && account.phase === 'accounted' ? account.heard : null).toEqual([]);
  });

  it('listening where the watch has been heard counts, though that relay refused this attempt', async () => {
    // The watch answers on its own relays: an attempt it read on A is answered on C too, and this
    // phone is listening on C.
    const pool = manyPool({
      eose: false,
      publish: (url) => (url === 'wss://c' ? Promise.reject(new Error('rate-limited: slow down')) : Promise.resolve('')),
      onSubscribe: (url, params) =>
        queueMicrotask(() => (url.startsWith('wss://c') ? params.oneose?.() : params.onclose?.('auth-required: sign in to read')))
    });
    const phases = await briefly(pool, ['wss://a', 'wss://c'], 2, { watchStateAgeMs: () => 10_000 });
    expect(outcomes(phases)).toEqual(['no-answer', 'no-answer']);
  });
});

describe('"no answer" only for a window heard from its start', () => {
  it('a listener still connecting when the window opens did not hear an answer sent before it was asked', async () => {
    // A takes the Distress and refuses this phone's request, as a relay that wants AUTH does. B's
    // handshake takes 700ms. The watch reads the attempt on A and answers on B at once, while nothing
    // there is subscribed: relays keep no `20912` to hand the request that arrives after it.
    const a = await relay();
    a.refuseReq = () => 'auth-required: sign in to read';
    const b = await slowHandshakeRelay(700);
    const deliveredWith: number[] = [];
    a.refuseEvent = (e) => {
      if (e.kind === KIND_DISTRESS && deliveredWith.length === 0) {
        setTimeout(() => {
          deliveredWith.push(b.subscriptions());
          b.deliver(answer([e.id], 'agent'));
        }, 150);
      }
      return null;
    };
    const { pool } = guardedPool();
    const run = distress(pool, [a.url, b.url], { ackWindowMs: 2_000, backoffMs: 30_000, maxBackoffMs: 30_000 });

    await eventually(() => expect(outcomes(run.phases).length + run.said('agent-holding').length).toBeGreaterThan(0), 6_000);
    expect(deliveredWith, 'the answer reached B before this phone had asked B for anything').toEqual([0]);
    expect(b.reqs.length, 'B was never asked').toBeGreaterThan(0);
    expect(run.names(), 'called silence from the watch, of a window it could not hear the start of').not.toContain('no-answer');
    expect(run.said('could-not-hear')[0]!.attempt).toBe(1);
  }, 10_000);

  it('a relay that says OK before it ends the request\'s stored events costs that window, and only that one', async () => {
    const pool = manyPool({ eose: false, onSubscribe: (_url, params) => setTimeout(() => params.oneose?.(), 30) });
    const phases = await briefly(pool, ['wss://r'], 2, { ackWindowMs: 100 });
    expect(outcomes(phases)).toEqual(['could-not-hear', 'no-answer']);
  });

  it('a relay that delivers an event on the subscription is listening, though it never ends the stored events', async () => {
    // Any event: one naming an id this Distress never sent is not for it, but shows the relay is
    // delivering on the subscription.
    const stray = answer(['0'.repeat(64)], 'agent');
    const pool = manyPool({ eose: false, onSubscribe: (_url, params) => queueMicrotask(() => params.onevent?.(stray)) });
    const phases = await briefly(pool, ['wss://r'], 2);
    expect(outcomes(phases)).toEqual(['no-answer', 'no-answer']);
  });

  it('a subscription reported ended and closed in the same moment never counts as listening', async () => {
    // nostr-tools' pool reports a failed subscription as an end-of-stored-events and a close at once.
    const pool = manyPool({
      eose: false,
      onSubscribe: (_url, params) =>
        queueMicrotask(() => {
          params.oneose?.();
          params.onclose?.('connection failed');
        })
    });
    const phases = await briefly(pool, ['wss://r'], 4);
    expect(outcomes(phases)).toEqual(['could-not-hear', 'could-not-hear', 'could-not-hear', 'could-not-hear']);
    expect(phases.filter((p) => p.phase === 'listening-nowhere'), 'said once').toHaveLength(1);
    expect(phases.filter((p) => p.phase === 'listening-again'), 'listening again, for a moment, at every reopen').toHaveLength(0);
    expect(pool.subscribed.length, 'asked again with each attempt').toBeGreaterThanOrEqual(4);
  });
});

describe('"nobody is answering", qualified', () => {
  it('counts, of the attempts that left, those this phone could not hear', async () => {
    // Attempt 1 never leaves; attempts 2 and 3 leave, and neither is heard.
    let published = 0;
    const pool = manyPool({
      eose: false,
      publish: () => (++published === 1 ? Promise.reject('connection failure: offline') : Promise.resolve(''))
    });
    let sendings = 0;
    const phases = await briefly(pool, ['wss://r'], 3, {
      // Ten minutes pass at attempt 3, so the line comes after all three.
      clock: () => (sendings >= 3 ? 10_000_000 : 0),
      onPhase: (p) => {
        if (p.phase === 'sending') sendings++;
      }
    });
    expect(phases.map((p) => p.phase)).toContain('unreachable');
    const nobody = phases.find((p) => p.phase === 'nobody-answering');
    expect(nobody && nobody.phase === 'nobody-answering' ? nobody.couldNotHear : null).toEqual({ attempts: 2, of: 2 });
  });
});
