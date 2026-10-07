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
 * The pools here put an `e` tag on every response and honour `#e` the way a relay does, because
 * the loop's listener accepts an answer only when it names an id the loop sent — a fake that
 * handed every event to every subscription would pass with that check removed.
 *
 * The question is narrow and safety-critical. A client republishes an unacknowledged Distress
 * as a **new signed event with a new id** every `ackWindowMs` (20s by default) plus a backoff. A
 * person woken at 3am takes longer than 20s. So: if they acknowledge the signal they were paged
 * about, and the operator's phone has already moved on, does the operator ever learn a human
 * answered?
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
 * A pool that honours `#e`, and keeps nothing — as a relay serving an ephemeral kind does.
 *
 * `ackFor` decides which published signal gets answered, by its 1-based attempt number. The
 * answer is delivered when `deliverOn` is published, once, to whatever is subscribed at that
 * moment — so "acknowledge attempt 1, after attempt 2 has gone out" is expressible, and that is
 * the case a person's reaction time actually produces.
 *
 * It once delivered when a subscription opened, as though the relay kept a store to serve a late
 * REQ from. Relays mostly keep no `20912` at all [audit: relay paths, F25], and the loop no longer
 * opens a subscription per attempt: its listener, open from the start, is the only thing that can
 * hear this [#30].
 *
 * Every pool here sends an end-of-stored-events for each subscription, as a relay does: the loop
 * counts a listener only once its relay has, and says it could not hear until then [G3 phase 1].
 */
function fakePool(plan: { ackFor: number; deliverOn: number }) {
  const sent: { id: string }[] = [];
  const subs: { filter: Record<string, unknown>; onevent: (e: unknown) => void }[] = [];

  const deliver = (event: { tags: string[][] }) => {
    for (const sub of [...subs]) {
      const wantIds = sub.filter['#e'] as string[] | undefined;
      const has = event.tags.filter((t) => t[0] === 'e').map((t) => t[1]);
      if (wantIds && !wantIds.some((w) => has.includes(w))) continue;
      sub.onevent(event);
    }
  };

  return {
    publish(_urls: string[], event: { id: string }) {
      sent.push(event);
      if (sent.length === plan.deliverOn) {
        const target = sent[plan.ackFor - 1];
        if (target) queueMicrotask(() => deliver(humanAck(target.id)));
      }
      return [Promise.resolve('ok')];
    },
    subscribeMany(
      _urls: string[],
      filter: Record<string, unknown>,
      params: { onevent: (e: unknown) => void; oneose?: () => void }
    ) {
      subs.push({ filter, onevent: params.onevent });
      // The end of stored events, as a relay sends it: nothing is kept, so it comes at once.
      queueMicrotask(() => params.oneose?.());
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
     * The loop once listened only for `ackWindowMs` after each attempt and then slept for the
     * backoff — twenty seconds of listening in every eighty once the backoff had grown.
     * **`20912` is ephemeral, so relays do not store it**: an acknowledgement published while
     * nothing is subscribed is not delayed, it is gone. The executor sends a person's answer once,
     * when they give it; it repeats it to a later attempt only while it holds it, and not after a
     * restart or once the hold has closed.
     *
     * Delivered here from inside the sleep, where only the Distress-long listener is open.
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
    // The same case at a longer delay: an answer to the first attempt, published as the fourth
    // goes out. Heard because the listener accepts an answer to any attempt this Distress sent.
    const pool = fakePool({ ackFor: 1, deliverOn: 4 });
    const out = await run(pool, 60_000);

    expect(out.attempts).toBeGreaterThan(3);
    expect(out.acknowledged).toBe(true);
  });

});

/**
 * A pool whose connections can drop, the way a phone's do: on a network handoff, or when the app
 * is set aside to dial somebody. A dropped subscription hears its `onclose` and nothing after it;
 * an address the pool cannot parse throws for the whole call, as nostr-tools does.
 */
function droppingPool() {
  const sent: { id: string }[] = [];
  type Sub = { urls: string[]; filter: Record<string, unknown>; onevent: (e: unknown) => void; onclose?: () => void };
  const subs: Sub[] = [];
  const bad = (urls: string[]) => urls.find((u) => !/^wss?:\/\/[a-z0-9.-]+/.test(u));
  return {
    publish(urls: string[], event: { id: string }) {
      if (bad(urls)) throw new Error(`Invalid URL: ${bad(urls)}`);
      sent.push(event);
      return urls.map(() => Promise.resolve('ok'));
    },
    subscribeMany(
      urls: string[],
      filter: Record<string, unknown>,
      params: { onevent: (e: unknown) => void; oneose?: () => void; onclose?: () => void }
    ) {
      if (bad(urls)) throw new Error(`Invalid URL: ${bad(urls)}`);
      const sub: Sub = { urls, filter, onevent: params.onevent, onclose: params.onclose };
      subs.push(sub);
      queueMicrotask(() => {
        if (subs.includes(sub)) params.oneose?.();
      });
      return {
        close() {
          const i = subs.indexOf(sub);
          if (i >= 0) subs.splice(i, 1);
        }
      };
    },
    close() {},
    /** Every connection goes: each open subscription is told, and hears nothing more. */
    dropAll() {
      for (const sub of subs.splice(0)) sub.onclose?.();
    },
    /** An acknowledgement, delivered once to whatever is listening at that moment and kept nowhere. */
    deliverAckFor(attempt: number) {
      const target = sent[attempt - 1];
      if (!target) return;
      const ack = humanAck(target.id);
      for (const sub of [...subs]) {
        const want = sub.filter['#e'] as string[] | undefined;
        if (want && !want.includes(target.id)) continue;
        sub.onevent(ack);
      }
    },
    get attempts() {
      return sent.length;
    }
  };
}

async function runOn(pool: ReturnType<typeof droppingPool>, relays: string[], onSleep: (p: ReturnType<typeof droppingPool>) => void | Promise<void>) {
  const controller = new AbortController();
  const phases: string[] = [];
  let clock = 0;
  await sendDistressUntilAcknowledged(
    pool as never,
    relays,
    OPERATOR,
    OUR_PUBKEY,
    { pubkey: WATCH_PUBKEY, holders: [WATCH_PUBKEY] } as never,
    { area: 'Downtown' } as never,
    {
      ackWindowMs: 1,
      backoffMs: 1_000,
      clock: () => clock,
      sleep: async (ms: number) => {
        await onSleep(pool);
        clock += ms;
        if (clock > 30_000) controller.abort();
      },
      signal: controller.signal,
      onPhase: (p: { phase: string }) => phases.push(p.phase)
    } as never
  ).catch(() => {});
  return phases;
}

describe('the listener between attempts, when the connection drops [audit: relay paths]', () => {
  it('opens again by itself, so an acknowledgement after the drop still ends the Distress', async () => {
    let step = 0;
    const phases = await runOn(droppingPool(), ['wss://r'], async (p) => {
      step += 1;
      if (step === 1) {
        // Every socket goes in the first gap. The listener comes back a second later, by itself.
        p.dropAll();
        await new Promise((r) => setTimeout(r, 1_200));
        // Answered in the gap, where only the Distress-long listener could hear it.
        p.deliverAckFor(1);
      }
    });
    expect(phases, 'a human answered after the connection came back, and the operator was not told').toContain('acknowledged');
  });

  it('is not stopped by one address the pool cannot parse', async () => {
    const phases = await runOn(droppingPool(), ['wss://', 'wss://r'], (p) => {
      if (p.attempts === 1) p.deliverAckFor(1);
    });
    expect(phases).toContain('sent');
    expect(phases).not.toContain('unreachable');
    expect(phases).toContain('acknowledged');
  });
});

/**
 * A pool where one relay is slow to say OK, and the watch answers through the other first
 * [audit: relay paths, D2 review].
 *
 * The answer is delivered while the publish is still settling — once, to whatever is listening
 * at that moment, and kept nowhere, as on a relay that keeps no ephemeral event. The loop used to
 * learn an attempt's id only when every relay had settled, so this answer named a signal it had
 * never sent, and was dropped. The watch's re-sent acknowledgement goes out the moment a new
 * attempt lands, which made this its ordinary case.
 */
function slowOkPool(reply: (signalId: string) => unknown) {
  const sent: { id: string }[] = [];
  type Sub = { filter: Record<string, unknown>; onevent: (e: unknown) => void };
  const subs: Sub[] = [];
  return {
    publish(urls: string[], event: { id: string }) {
      if (!sent.some((e) => e.id === event.id)) sent.push(event);
      // The fast relay has it, and the watch answers through it at once.
      if (urls.some((u) => u.includes('fast'))) {
        const answer = reply(event.id);
        for (const sub of [...subs]) {
          const want = sub.filter['#e'] as string[] | undefined;
          if (want && !want.includes(event.id)) continue;
          sub.onevent(answer);
        }
      }
      return urls.map((u) => (u.includes('slow') ? new Promise((r) => setTimeout(() => r('ok'), 150)) : Promise.resolve('ok')));
    },
    subscribeMany(_urls: string[], filter: Record<string, unknown>, params: { onevent: (e: unknown) => void; oneose?: () => void }) {
      const sub: Sub = { filter, onevent: params.onevent };
      subs.push(sub);
      queueMicrotask(() => params.oneose?.());
      return {
        close() {
          const i = subs.indexOf(sub);
          if (i >= 0) subs.splice(i, 1);
        }
      };
    },
    close() {},
    get attempts() {
      return sent.length;
    }
  };
}

function responseFrom(responder: { kind: string; callsign: string }, signalId: string, ladder?: string) {
  return finalizeEvent(
    {
      kind: KIND_RESPONSE,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', OUR_PUBKEY],
        ['e', signalId]
      ],
      content: seal(WATCH, OUR_PUBKEY, { type: 'ack', responder, text: null, provenance: null, ...(ladder ? { ladder } : {}) })
    },
    WATCH
  );
}

async function racing(reply: (signalId: string) => unknown) {
  const pool = slowOkPool(reply);
  const phases: string[] = [];
  const controller = new AbortController();
  let clock = 0;
  await sendDistressUntilAcknowledged(
    pool as never,
    ['wss://fast', 'wss://slow'],
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
        clock += ms;
        if (clock > 5_000) controller.abort();
      },
      signal: controller.signal,
      onPhase: (p: { phase: string }) => phases.push(p.phase)
    } as never
  ).catch(() => {});
  return { phases, attempts: pool.attempts };
}

describe('an answer that comes back before a slow relay has said OK [audit: relay paths, D2 review]', () => {
  it('ends the Distress when it is a person, on the attempt it answered', async () => {
    const { phases, attempts } = await racing((id) => responseFrom({ kind: 'human', callsign: 'Wren' }, id));
    expect(phases, 'a person answered while the attempt was still going out, and it was dropped').toContain('acknowledged');
    expect(attempts).toBe(1);
    expect(phases).not.toContain('no-answer');
  });

  it('says nobody can be reached when the watch says so', async () => {
    const { phases } = await racing((id) => responseFrom({ kind: 'node', callsign: 'escalation' }, id, 'exhausted'));
    expect(phases.slice(0, phases.indexOf('watch-exhausted') + 1)).toEqual(['sending', 'sent', 'watch-exhausted']);
  });

  it('says an agent is holding, rather than that nobody answered', async () => {
    const { phases } = await racing((id) => responseFrom({ kind: 'agent', callsign: 'watchtower' }, id));
    expect(phases.slice(0, 3)).toEqual(['sending', 'sent', 'agent-holding']);
    // An agent closes nothing [invariant 4]: the loop goes on asking for a person.
    expect(phases).not.toContain('acknowledged');
  });
});

/* -------------------------------------------------------------------------------------------- */

type Phase = { phase: string; attempt?: number; response?: { text?: string | null; responder?: { callsign?: string } } };

/** A response signed by the watch, naming every id given, with whatever it says. */
function responseNaming(ids: string[], body: Record<string, unknown>) {
  return finalizeEvent(
    {
      kind: KIND_RESPONSE,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', OUR_PUBKEY], ...ids.map((id) => ['e', id])],
      content: seal(WATCH, OUR_PUBKEY, { text: null, provenance: null, ...body })
    },
    WATCH
  );
}
const human = (callsign = 'Wren', text: string | null = null) => ({ type: 'ack', responder: { kind: 'human', callsign }, text });
const agent = () => ({ type: 'ack', responder: { kind: 'agent', callsign: 'watchtower' } });
const node = (text: string, ladder = 'paging') => ({ type: 'escalation-status', responder: { kind: 'node', callsign: 'escalation' }, text, ladder });

/**
 * A pool that can hand over its relays, as `SimplePool` does — and whose `subscribeMany` wrapper
 * behaves as nostr-tools' does with a close reason that is not a string: it calls
 * `reason.startsWith`, throws, and the caller's `onclose` never runs. The throw is swallowed, as
 * nostr-tools' message handler swallows it.
 *
 * `reply` decides what the watch says to each attempt, as events delivered to every open
 * subscription right after the publish. `hang` holds a publish open for that many ms first, as a
 * relay slow to say OK does.
 */
function ownRelayPool(opts: { reply?: (id: string, attempt: number) => unknown[]; hang?: number; ensureRelay?: boolean } = {}) {
  const sent: { id: string }[] = [];
  type Sub = { onevent: (e: unknown) => void; onclose: (reason: unknown) => void; open: boolean };
  const subs: Sub[] = [];
  let subscribes = 0;
  let refuse = false;
  const track = (onevent: (e: unknown) => void, onclose: (reason: unknown) => void, oneose?: () => void) => {
    subscribes++;
    const sub: Sub = { onevent, onclose, open: true };
    subs.push(sub);
    // The relay's end of stored events, unless it has closed the subscription first.
    queueMicrotask(() => {
      if (sub.open) oneose?.();
    });
    return {
      close() {
        if (!sub.open) return;
        sub.open = false;
        onclose('closed by caller');
      }
    };
  };
  const deliver = (event: unknown) => {
    for (const sub of subs.filter((s) => s.open)) sub.onevent(event);
  };
  const pool = {
    allowConnectingToRelay: () => !refuse,
    publish(urls: string[], event: { id: string }) {
      // Published once per relay; the watch hears it, and answers it, once.
      if (!sent.some((e) => e.id === event.id)) {
        sent.push(event);
        for (const answer of opts.reply?.(event.id, sent.length) ?? []) queueMicrotask(() => deliver(answer));
      }
      return urls.map(() =>
        opts.hang ? new Promise((r) => setTimeout(() => r('ok'), opts.hang)) : Promise.resolve('ok')
      );
    },
    subscribeMany(
      _urls: string[],
      _filter: unknown,
      params: { onevent: (e: unknown) => void; oneose?: () => void; onclose?: (r: unknown) => void }
    ) {
      return track(
        params.onevent,
        (reason) => {
          // nostr-tools' wrapper, verbatim in effect.
          if ((reason as string).startsWith('auth-required: ')) return;
          params.onclose?.([{ reason }]);
        },
        params.oneose
      );
    },
    close() {},
    deliver,
    /** The relay closes every open subscription with this reason, of whatever type. */
    closeAll(reason: unknown) {
      for (const sub of subs.filter((s) => s.open)) {
        sub.open = false;
        try {
          sub.onclose(reason);
        } catch {
          // nostr-tools: "error processing message", and nothing else.
        }
      }
    },
    /** What a destroyed pool does to a subscription it closes, and then refusing any new connection. */
    burn() {
      refuse = true;
      this.closeAll('relay connection closed by us');
    },
    /** A close the pool fires late, after this was already closed — it must reopen nothing. */
    lateClose() {
      for (const sub of subs) sub.onclose('relay connection closed by us');
    },
    get subscribes() { return subscribes; },
    get openSubs() { return subs.filter((s) => s.open).length; },
    get attempts() { return sent.length; },
    sentIds: () => sent.map((e) => e.id)
  };
  if (opts.ensureRelay !== false) {
    Object.assign(pool, {
      ensureRelay: async () => ({
        connected: true,
        subscribe: (_f: unknown[], params: { onevent: (e: unknown) => void; oneose?: () => void; onclose?: (r: unknown) => void }) =>
          track(params.onevent, (reason) => params.onclose?.(reason), params.oneose)
      })
    });
  }
  return pool;
}

async function drive(
  pool: ReturnType<typeof ownRelayPool>,
  opts: {
    ackWindowMs?: number;
    backoffMs?: number;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    onPhase?: (p: Phase, controller: AbortController) => void;
    stopAfterMs?: number;
  } = {}
) {
  const controller = new AbortController();
  const phases: Phase[] = [];
  let clock = 0;
  const started = Date.now();
  const result = await sendDistressUntilAcknowledged(
    pool as never,
    ['wss://a', 'wss://b'],
    OPERATOR,
    OUR_PUBKEY,
    { pubkey: WATCH_PUBKEY, holders: [WATCH_PUBKEY] } as never,
    { area: 'Downtown' } as never,
    {
      ackWindowMs: opts.ackWindowMs ?? 5,
      backoffMs: opts.backoffMs ?? 1_000,
      localExhaustedAfterMs: 600_000,
      clock: () => clock,
      sleep:
        opts.sleep ??
        (async (ms: number) => {
          clock += ms;
          if (clock > (opts.stopAfterMs ?? 10_000)) controller.abort();
        }),
      signal: controller.signal,
      onPhase: (p: Phase) => {
        phases.push(p);
        opts.onPhase?.(p, controller);
      }
    } as never
  ).catch((e: Error) => e);
  return { phases, result, ms: Date.now() - started, names: phases.map((p) => p.phase) };
}

describe('an acknowledgement of an earlier Distress, held by the watch [#0]', () => {
  it('is said by name, and does not end this one: only a person answering it does', async () => {
    // The watch holds Wren's answer to a Distress this run never sent — the app was reopened, or
    // this is a new emergency — and answers each attempt with it, naming both ids.
    const earlier = 'e'.repeat(64);
    const pool = ownRelayPool({
      reply: (id, attempt) =>
        attempt < 3
          ? [responseNaming([id, earlier], human('Wren', 'Acknowledged 20 min ago.'))]
          : [responseNaming([id], human('Raven', 'on my way'))]
    });
    const { names, phases, result } = await drive(pool);

    expect(names.filter((n) => n === 'acknowledged-earlier'), 'once per attempt it reached').toHaveLength(2);
    const said = phases.find((p) => p.phase === 'acknowledged-earlier')!;
    expect(said.response?.responder?.callsign).toBe('Wren');
    expect(said.response?.text).toMatch(/20 min ago/);
    expect(pool.attempts, 'it stopped sending on an answer to somebody else\'s Distress').toBe(3);
    expect(names).not.toContain('no-answer');
    expect((result as { responder: { callsign: string } }).responder.callsign).toBe('Raven');
    expect(names.indexOf('acknowledged')).toBeGreaterThan(names.lastIndexOf('acknowledged-earlier'));
  });

  it('ends this one when every id it names is one this run sent: the phone missed the first answer', async () => {
    // The case the hold was built for. Attempt one's answer was lost; attempt two is answered with
    // it, naming both attempts — both this run's.
    const pool = ownRelayPool({
      reply: (id, attempt) => (attempt === 2 ? [responseNaming([id, pool.sentIds()[0]!], human('Wren'))] : [])
    });
    const { names } = await drive(pool);
    expect(names).toContain('acknowledged');
    expect(names).not.toContain('acknowledged-earlier');
    expect(pool.attempts).toBe(2);
  });

  it('is not read as a ladder this run joined when the watch repeats it in its own name', async () => {
    // Only a ladder's report says which ladder an attempt is in. One claiming `acknowledged`
    // repeats an answer; were it read as joining, the next repeat would close this run on an
    // answer to a Distress it never sent.
    const earlier = 'e'.repeat(64);
    const pool = ownRelayPool({
      reply: (id, attempt) =>
        attempt === 1
          ? [responseNaming([id, earlier], { type: 'ack', responder: { kind: 'node', callsign: 'escalation' }, text: 'Acknowledged.', ladder: 'acknowledged' })]
          : attempt === 2
            ? [responseNaming([id, earlier], human('Wren', 'Acknowledged 20 min ago.'))]
            : []
    });
    const { names } = await drive(pool, { stopAfterMs: 3_000 });
    expect(names).toContain('acknowledged-earlier');
    expect(names).not.toContain('acknowledged');
  });
});

describe('a Distress started again while the first one was still paging [review: relay paths, R1]', () => {
  /*
   * The app reopened, evicted or wiped mid-ladder, and the Distress sent again. The watch joins the
   * new run's attempts to the ladder already paging and tells each one so, naming the attempt and
   * the ladder's own id. The person paged answers the id their page carried — one this run never
   * sent. Read against what this run sent alone, that answer was dropped, the hold's repeat of it
   * read as an earlier Distress, and the phone went on sending for half an hour while Wren was on
   * her way, until the roster was paged again for the same emergency.
   */
  const first = 'a'.repeat(64);

  it('ends when the person paged answers the ladder it joined, though their answer names only that one', async () => {
    const pool = ownRelayPool({
      reply: (id, attempt) =>
        attempt === 1
          ? [responseNaming([id, first], node('Paging Wren.'))]
          : attempt === 2
            ? [responseNaming([first], human('Wren', 'Wren is responding.'))]
            : []
    });
    const { names, phases, result } = await drive(pool);
    expect(names, 'Wren answered the ladder this run joined, and it went on sending').toContain('acknowledged');
    expect(names).not.toContain('acknowledged-earlier');
    expect(pool.attempts).toBe(2);
    expect((result as { text: string }).text).toBe('Wren is responding.');
    expect(phases.find((p) => p.phase === 'watch-status')?.response?.text).toBe('Paging Wren.');
  });

  it("ends on the hold's repeat of that answer, which names the ladder it joined", async () => {
    const pool = ownRelayPool({
      reply: (id, attempt) =>
        attempt === 1
          ? [responseNaming([id, first], node('Paging Wren.'))]
          : attempt === 2
            ? [responseNaming([id, first], human('Wren', 'Acknowledged less than a minute ago.'))]
            : []
    });
    const { names } = await drive(pool);
    expect(names).toContain('acknowledged');
    expect(names, 'told a person answered an earlier Distress, about the one it is part of').not.toContain('acknowledged-earlier');
    expect(pool.attempts).toBe(2);
  });

  it('hears that ladder say nobody can be reached, though the report names only the ladder', async () => {
    const pool = ownRelayPool({
      reply: (id, attempt) =>
        attempt === 1
          ? [responseNaming([id, first], node('Paging Wren.'))]
          : attempt === 2
            ? [responseNaming([first], node("Couldn't reach anyone. Nobody is coming.", 'exhausted'))]
            : []
    });
    const { phases } = await drive(pool, { stopAfterMs: 3_000 });
    const exhausted = phases.find((p) => p.phase === 'watch-exhausted');
    expect(exhausted, "the ladder this run is part of said nobody is coming, and the phone didn't hear").toBeDefined();
    expect(exhausted?.attempt).toBe(2);
  });

  it("ends on a repeat of the answer to its own ladder, sent to another of this operator's attempts", async () => {
    // A second phone, or a second tab, sending for the same operator while Wren's answer to this
    // run's own ladder was missed here. The hold answers the other attempt naming this run's ladder.
    const other = 'b'.repeat(64);
    const pool = ownRelayPool({
      reply: (id, attempt) =>
        attempt === 1
          ? [responseNaming([id], node('Paging Wren.'))]
          : attempt === 2
            ? [responseNaming([other, pool.sentIds()[0]!], human('Wren', 'Acknowledged less than a minute ago.'))]
            : []
    });
    const { names } = await drive(pool);
    expect(names).toContain('acknowledged');
    expect(names, 'told Wren answered an earlier Distress, about the one she answered').not.toContain('acknowledged-earlier');
  });
});

describe('everything the watch says reaches the operator, not only the first answer [#31, #32]', () => {
  it('says each report in turn, the second one too, and each once however many relays carry it', async () => {
    // A box: the daemon's agent acknowledgement first, then the ladder's opening report, then — a
    // round trip later — the note that nobody could be woken. Each arrives on both relays.
    const pool = ownRelayPool({
      reply: (id, attempt) => {
        if (attempt === 2) return [responseNaming([id], human())];
        const said = [
          responseNaming([id], agent()),
          responseNaming([id], node('Paging Wren.')),
          responseNaming([id], node('No page could be sent -- every channel failed. Nobody has been woken.'))
        ];
        return [...said, ...said];
      }
    });
    const { names, phases } = await drive(pool);

    const first = phases.filter((p) => p.attempt === 1);
    expect(first.filter((p) => p.phase === 'agent-holding'), 'an agent, said once').toHaveLength(1);
    const statuses = first.filter((p) => p.phase === 'watch-status').map((p) => p.response?.text);
    expect(statuses, 'the note that nobody was woken was dropped').toEqual([
      'Paging Wren.',
      'No page could be sent -- every channel failed. Nobody has been woken.'
    ]);
    expect(first.map((p) => p.phase), 'answered, so not "no answer"').not.toContain('no-answer');
    expect(names).toContain('acknowledged');
  });

  it('says the agent, and ends the wait at once for a person heard after it', async () => {
    // A box: the daemon's acknowledgement at once, a person's answer a moment later. The agent is
    // said, and the person is not then waited on — the backoff here is ten seconds, in real time.
    // What this does not cover is whether the agent's answer ends the attempt's window: the next
    // test does. (#34 itself, the held answer losing to the daemon's on real relays, is
    // box-distress.test.ts's.)
    const pool = ownRelayPool({
      reply: (id) => {
        setTimeout(() => pool.deliver(responseNaming([id], human())), 5);
        return [responseNaming([id], agent())];
      }
    });
    const { names, ms } = await drive(pool, {
      ackWindowMs: 2_000,
      backoffMs: 10_000,
      sleep: (ms, signal) =>
        new Promise((r) => {
          const t = setTimeout(r, ms);
          signal?.addEventListener('abort', () => { clearTimeout(t); r(undefined); }, { once: true });
        })
    });
    // Where the attempt went is said too, once every relay has answered [G3 phase 1]; the order of
    // everything else is the point here.
    expect(names.filter((n) => n !== 'accounted')).toEqual(['sending', 'sent', 'agent-holding', 'acknowledged']);
    expect(names.indexOf('accounted'), 'accounted for before it left').toBeGreaterThan(names.indexOf('sent'));
    expect(ms, 'the person was heard and then waited on').toBeLessThan(1_000);
  }, 15_000);

  it("does not let an agent's answer end the attempt's window: a box answering every attempt is not a faster phone", async () => {
    // The window is when the watch's reports and a person's answer are heard for this attempt. An
    // agent's answer, the daemon's at once on every attempt, used to end it — so on a box the
    // phone sent at the backoff's pace and nothing after the agent was waited for [#32].
    const pool = ownRelayPool({ reply: (id) => [responseNaming([id], agent())] });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 1_000);
    const phases: string[] = [];
    await sendDistressUntilAcknowledged(
      pool as never, ['wss://a'], OPERATOR, OUR_PUBKEY,
      { pubkey: WATCH_PUBKEY, holders: [WATCH_PUBKEY] } as never, { area: 'Downtown' } as never,
      { ackWindowMs: 300, backoffMs: 1, maxBackoffMs: 1, signal: controller.signal, onPhase: (p) => phases.push(p.phase) }
    ).catch(() => {});
    expect(pool.attempts, 'each attempt was cut short by the agent').toBeLessThanOrEqual(4);
    expect(phases.filter((p) => p === 'agent-holding'), 'the agent, once per attempt').toHaveLength(pool.attempts);
    expect(phases).not.toContain('no-answer');
  });
});

describe('a person answering between attempts is told at once [#15, #33]', () => {
  it('ends the backoff the moment they are heard, rather than when it runs out', async () => {
    const pool = ownRelayPool();
    const { names, ms } = await drive(pool, {
      backoffMs: 10_000,
      onPhase: (p) => {
        if (p.phase === 'no-answer') setTimeout(() => pool.deliver(responseNaming(pool.sentIds(), human())), 50);
      },
      sleep: (ms, signal) =>
        new Promise((r) => {
          const t = setTimeout(r, ms);
          signal?.addEventListener('abort', () => { clearTimeout(t); r(undefined); }, { once: true });
        })
    });
    expect(names.at(-1)).toBe('acknowledged');
    expect(pool.attempts).toBe(1);
    expect(ms, 'answered fifty milliseconds in, and shown ten seconds later').toBeLessThan(1_500);
  }, 15_000);

  it('reports a person heard a moment before a stand-down, rather than calling it unanswered', async () => {
    // Answered while the attempt was still going out to a slow relay, and stood down before that
    // relay said OK. The loop looked at the stop first, and the screen said "Nobody acknowledged
    // this" about a Distress Wren had answered.
    const pool = ownRelayPool({ hang: 300, reply: (id) => [responseNaming([id], human())] });
    const { names, result } = await drive(pool, {
      onPhase: (p, controller) => {
        if (p.phase === 'sending') setTimeout(() => controller.abort(), 100);
      }
    });
    expect(result).not.toBeInstanceOf(Error);
    expect(names.at(-1)).toBe('acknowledged');
  });

  it('does not send faster than its window when the watch answers every attempt with exhausted', async () => {
    // An empty roster exhausts every ladder at once. "Exhausted" cuts a backoff short; it must not
    // cut the window short too, or the phone would send as fast as the round trip allows.
    const pool = ownRelayPool({ reply: (id) => [responseNaming([id], node("Couldn't reach anyone. Nobody is coming.", 'exhausted'))] });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 1_000);
    const phases: string[] = [];
    await sendDistressUntilAcknowledged(
      pool as never, ['wss://a'], OPERATOR, OUR_PUBKEY,
      { pubkey: WATCH_PUBKEY, holders: [WATCH_PUBKEY] } as never, { area: 'Downtown' } as never,
      { ackWindowMs: 200, backoffMs: 1, maxBackoffMs: 1, signal: controller.signal, onPhase: (p) => phases.push(p.phase) }
    ).catch(() => {});
    expect(pool.attempts).toBeLessThanOrEqual(6);
    expect(phases.filter((p) => p === 'watch-exhausted')).toHaveLength(pool.attempts);
  });
});

describe('the listener, on a pool that can hand over its relays [#1, #3]', () => {
  it('opens again when a relay closes it with a reason that is not a string', async () => {
    // nostr-tools' pool wrapper calls `reason.startsWith(...)`, so a null reason threw and the
    // listener never heard its own close. Subscribed on the relay itself, it does.
    const pool = ownRelayPool();
    let step = 0;
    const { names } = await drive(pool, {
      sleep: async () => {
        step += 1;
        if (step !== 1) return;
        pool.closeAll(null);
        await new Promise((r) => setTimeout(r, 1_200));
        pool.deliver(responseNaming([pool.sentIds()[0]!], human()));
      }
    });
    expect(names, 'a person answered after a relay closed the listener, and nobody heard').toContain('acknowledged');
  });

  it('never opens again once the operator has stopped it — a burn mid-send leaves nothing talking', async () => {
    // The burn: the Distress is stopped while an attempt is still going out to a slow relay, and
    // the pool is torn down. The listener came back through the destroyed pool a second later and
    // put this operator's key and their watch's on the wire again.
    const pool = ownRelayPool({ hang: 60_000 });
    const controller = new AbortController();
    const run = sendDistressUntilAcknowledged(
      pool as never, ['wss://a', 'wss://b'], OPERATOR, OUR_PUBKEY,
      { pubkey: WATCH_PUBKEY, holders: [WATCH_PUBKEY] } as never, { area: 'Downtown' } as never,
      { ackWindowMs: 5, signal: controller.signal }
    ).catch(() => {});
    await new Promise((r) => setTimeout(r, 50));
    const before = pool.subscribes;
    expect(before).toBe(2);

    controller.abort();
    pool.burn();
    pool.lateClose();
    await new Promise((r) => setTimeout(r, 1_500));
    expect(pool.subscribes, 'a listener was opened after the burn').toBe(before);
    expect(pool.openSubs).toBe(0);
    void run;
  });

  it('opens nothing again once a person has answered', async () => {
    const pool = ownRelayPool({ reply: (id) => [responseNaming([id], human())] });
    const { names } = await drive(pool);
    expect(names.at(-1)).toBe('acknowledged');
    const after = pool.subscribes;
    pool.lateClose();
    await new Promise((r) => setTimeout(r, 1_300));
    expect(pool.subscribes).toBe(after);
    expect(pool.openSubs).toBe(0);
  });
});
