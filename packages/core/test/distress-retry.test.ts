import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { seal } from '../src/crypto/envelope';
import { KIND_RESPONSE } from '../src/events/kinds';
import { sendDistressUntilAcknowledged } from '../src/transport';

/**
 * Whether an acknowledgement can arrive too late to be seen.
 *
 * `verification.md` has carried "the daemon and the executor together — both subscribe to
 * `20911`; that they do not confuse a client is reasoned, not observed". This observes the
 * client half of it, which is where the consequence lands.
 *
 * **The existing fake pool cannot see this.** It hands every event straight to `onevent` and
 * puts no `#e` tag on its responses at all, so `waitForResponse`'s `'#e': [sent.id]` term has
 * never been exercised by anything — the same shape as the relay stub that let the board's
 * filter go missing for weeks. The pool here matches `#e` the way a relay does.
 *
 * The question is narrow and safety-critical. A client republishes an unacknowledged Distress
 * as a **new signed event with a new id**, and waits `ackWindowMs` (20s by default) for a
 * response to *that* id. A person woken at 3am takes longer than 20s. So: if they acknowledge
 * the signal they were paged about, and the operator's phone has already moved on, does the
 * operator ever learn a human answered?
 */

const OPERATOR = generateSecretKey();
const OUR_PUBKEY = getPublicKey(OPERATOR);
const WATCH = generateSecretKey();
const WATCH_PUBKEY = getPublicKey(WATCH);

/** A response really signed by the watch, tagged to one specific signal. */
function humanAck(signalId: string) {
  return finalizeEvent(
    {
      kind: KIND_RESPONSE,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', OUR_PUBKEY],
        ['e', signalId]
      ],
      content: seal(WATCH, OUR_PUBKEY, {
        type: 'ack',
        responder: { kind: 'human', callsign: 'Vale' },
        text: null,
        provenance: null
      })
    },
    WATCH
  );
}

/**
 * A pool that honours `#e`, which is the whole point.
 *
 * `ackFor` decides which published signal gets answered, by its 1-based attempt number. The
 * answer is delivered when `deliverOn` is published — so "acknowledge attempt 1, after
 * attempt 2 has gone out" is expressible, and that is the case a person's reaction time
 * actually produces.
 */
function fakePool(plan: { ackFor: number; deliverOn: number }) {
  const sent: { id: string }[] = [];
  const subs: { filter: Record<string, unknown>; onevent: (e: unknown) => void }[] = [];

  const deliver = (event: { tags: string[][] }) => {
    for (const sub of subs) {
      const wantIds = sub.filter['#e'] as string[] | undefined;
      const has = event.tags.filter((t) => t[0] === 'e').map((t) => t[1]);
      if (wantIds && !wantIds.some((w) => has.includes(w))) continue;
      sub.onevent(event);
    }
  };

  return {
    publish(_urls: string[], event: { id: string }) {
      sent.push(event);
      return [Promise.resolve('ok')];
    },
    /*
     * Delivery happens here, not at publish. `sendDistressUntilAcknowledged` publishes and
     * *then* opens the subscription, so an event queued at publish time arrives before
     * anything is listening — which made the control case fail and would have been read as
     * the app dropping acknowledgements. The relay's own ordering is the same: a REQ that
     * arrives after an EVENT gets it from the store, not from the live feed.
     */
    subscribeMany(
      _urls: string[],
      filter: Record<string, unknown>,
      params: { onevent: (e: unknown) => void }
    ) {
      subs.push({ filter, onevent: params.onevent });
      if (sent.length >= plan.deliverOn && plan.ackFor <= sent.length) {
        const target = sent[plan.ackFor - 1];
        if (target) queueMicrotask(() => deliver(humanAck(target.id)));
      }
      return {
        close() {
          const i = subs.findIndex((s) => s.onevent === params.onevent);
          if (i >= 0) subs.splice(i, 1);
        }
      };
    },
    close() {},
    /** Delivers an ack for a given attempt at a moment of the test's choosing. */
    deliverAckFor(attempt: number) {
      const target = sent[attempt - 1];
      if (target) deliver(humanAck(target.id));
    },
    get attempts() {
      return sent.length;
    }
  };
}

async function run(
  pool: ReturnType<typeof fakePool>,
  stopAfterMs: number,
  onSleep?: (pool: ReturnType<typeof fakePool>) => void
) {
  const controller = new AbortController();
  const phases: string[] = [];
  let clock = 0;
  let acknowledged = false;

  await sendDistressUntilAcknowledged(
    pool as never,
    ['wss://r'],
    OPERATOR,
    OUR_PUBKEY,
    { pubkey: WATCH_PUBKEY, holders: [WATCH_PUBKEY] } as never,
    { area: 'Downtown' } as never,
    {
      ackWindowMs: 1,
      backoffMs: 1_000,
      localExhaustedAfterMs: 600_000,
      clock: () => clock,
      sleep: async (ms: number) => {
        // The backoff gap: nothing is subscribed here except the persistent listener.
        onSleep?.(pool);
        clock += ms;
        if (clock > stopAfterMs) controller.abort();
      },
      signal: controller.signal,
      onPhase: (p: { phase: string }) => {
        phases.push(p.phase);
        if (p.phase === 'acknowledged') acknowledged = true;
      }
    } as never
  ).catch(() => {
    /* aborting is how this loop ends when nobody answers; only the phases matter */
  });

  return { phases, acknowledged, attempts: pool.attempts };
}

describe('an acknowledgement that arrives after the client has retried', () => {
  it('is seen when it answers the signal the client is currently waiting on', async () => {
    // The control. Without this, a failing case below could mean the harness is broken
    // rather than the behaviour being what it is.
    const pool = fakePool({ ackFor: 1, deliverOn: 1 });
    const out = await run(pool, 30_000);
    expect(out.acknowledged, 'a same-signal human ack was not seen at all').toBe(true);
    expect(out.phases).toContain('acknowledged');
  });

  it('is still seen when it answers an earlier signal, not the newest one', async () => {
    /*
     * The case this file was written to observe, and it was real: before the fix the
     * operator never learned a human had answered.
     *
     * A person is paged about attempt 1 and answers it. By then the phone has published
     * attempt 2, and it used to listen only on `'#e': [attempt2.id]` — so the answer was
     * filtered out **at the relay** and never arrived. The ladder kept running and at ten
     * minutes told the operator *nobody is answering*, which was false and is the one thing
     * invariant 2 forbids getting wrong. `ackWindowMs` is 20s in production and somebody
     * woken at 3am is slower than that, so this was the expected case, not a narrow race.
     *
     * The loop now listens for a response to any signal it has sent.
     */
    const pool = fakePool({ ackFor: 1, deliverOn: 2 });
    const out = await run(pool, 30_000);

    expect(out.attempts, 'the loop never retried, so nothing was being tested').toBeGreaterThan(1);
    expect(out.acknowledged, 'a human answered and the operator was not told').toBe(true);
  });

  it('is seen even when it lands in the gap between attempts, where nothing used to listen', async () => {
    /*
     * The other half, and the larger one.
     *
     * The per-attempt wait listens for `ackWindowMs` and then the loop sleeps for the
     * backoff — twenty seconds of listening in every eighty once the backoff has grown.
     * **`20912` is ephemeral, so relays do not store it**: an acknowledgement published
     * while nothing is subscribed is not delayed, it is gone. Roughly three quarters of the
     * time a human could answer in had no listener at all, and the executor publishes its
     * ack exactly once, on the ladder's transition.
     *
     * Delivered here from inside the sleep, so the per-attempt subscription is provably
     * closed and only the Distress-long listener can catch it.
     */
    let delivered = false;
    const pool = fakePool({ ackFor: 99, deliverOn: 99 });
    const out = await run(pool, 30_000, (p) => {
      if (delivered || p.attempts < 1) return;
      delivered = true;
      p.deliverAckFor(1);
    });

    expect(delivered, 'the ack was never delivered, so nothing was tested').toBe(true);
    expect(out.acknowledged, 'a human answered between attempts and was not heard').toBe(true);
  });

  it('and one that lands several retries later still reaches the operator', async () => {
    // The same hole at a longer delay, which is also the "answered during the backoff" case:
    // no subscription is open while the loop sleeps, so an answer published in the gap is
    // only ever seen because the next subscription still asks for that signal's id.
    const pool = fakePool({ ackFor: 1, deliverOn: 4 });
    const out = await run(pool, 60_000);

    expect(out.attempts).toBeGreaterThan(3);
    expect(out.acknowledged).toBe(true);
  });

});
