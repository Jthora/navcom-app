/**
 * What the `Distress` loop can and cannot hear, and where each attempt went [G3 phase 1].
 *
 * The loop said "no answer" after every attempt, and "nobody is answering" ten minutes on, whether
 * or not anything was listening: a relay that wants AUTH closed the listener at once, it reopened
 * for ever, and the screen reported silence from a watch the phone could not have heard. These run
 * the loop on a real `SimplePool` against relays on 127.0.0.1 (`helpers/distress.ts`), because what a
 * listener counts as "answered" is how nostr-tools behaves on a socket, and a fake models only what
 * somebody believed about that.
 *
 * Nothing leaves this machine: every pool here dials through a socket that refuses any address but
 * loopback, so even a loop that tried to reach The Record reaches nothing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SimplePool } from 'nostr-tools/pool';
import { KIND_DISTRESS } from '../src/events/kinds';
import { MISSION_RELAYS, THE_RECORD } from '../src/missions/package';
import { watchtowerAt } from '../src/crypto/group';
import { sendDistressUntilAcknowledged } from '../src/transport';
import {
  AREA,
  OPERATOR,
  OUR_PUBKEY,
  WATCH_PUBKEY,
  answer,
  briefly,
  cleanup,
  distress,
  distresses,
  droppingRelay,
  eventually,
  guardedPool,
  manyPool,
  relay,
  slowRelay
} from './helpers/distress';

afterEach(cleanup);

describe('a phone that cannot hear says so, and says when it can again', () => {
  it('refused by a relay that wants AUTH and dropped by another: "could not hear", never "no answer", until a relay sends EOSE', async () => {
    const auth = await relay();
    auth.refuseReq = () => 'auth-required: sign in to read';
    const dropping = await droppingRelay();
    const { pool } = guardedPool();
    const run = distress(pool, [auth.url, dropping.url], { localExhaustedAfterMs: 1 });

    await eventually(() => expect(run.said('could-not-hear').length).toBeGreaterThanOrEqual(2), 8_000);
    // The attempts did leave: the relay that will not be read takes events.
    expect(run.said('sent').length).toBeGreaterThanOrEqual(2);
    expect(run.names(), 'said "no answer" about a phone that could not have heard one').not.toContain('no-answer');

    const nowhere = run.said('listening-nowhere');
    expect(nowhere, 'said once, not once per retry').toHaveLength(1);
    expect(nowhere[0]!.relays.map((r) => r.url)).toEqual([auth.url, dropping.url]);
    expect(nowhere[0]!.relays[0]!.reason).toMatch(/auth-required: sign in to read/);

    const nobody = run.said('nobody-answering');
    expect(nobody).toHaveLength(1);
    expect(nobody[0]!.couldNotHear, '"nobody is answering", unqualified, of a phone that could not hear').toEqual({
      attempts: 1,
      of: 1
    });

    // The relay stops asking for AUTH. The next attempt reopens the listener, and it answers.
    auth.refuseReq = null;
    await eventually(() => expect(run.said('listening-again')).toHaveLength(1), 8_000);
    expect(run.said('listening-again')[0]!.relays).toEqual([auth.url]);
    const back = run.names().indexOf('listening-again');
    await eventually(() => expect(run.names().slice(back)).toContain('no-answer'), 8_000);
    const heardFrom = back + run.names().slice(back).indexOf('no-answer');
    await eventually(() => expect(run.said('no-answer').length).toBeGreaterThanOrEqual(3), 8_000);
    expect(run.names().slice(heardFrom), 'could not hear, while a listener was open and answered').not.toContain('could-not-hear');
    expect(run.said('listening-nowhere'), 'and nothing went quiet again').toHaveLength(1);
  }, 30_000);

  it('a relay that takes the subscription and never ends it counts as not listening, and nostr-tools\' stand-in EOSE does not count', async () => {
    // A hung relay, or one that dropped the request without a word. nostr-tools fires its own EOSE
    // 4.4 seconds after a REQ nobody answered; counted, it would read as listening.
    const mute = await relay();
    mute.answerReqs = false;
    const { pool } = guardedPool();
    const run = distress(pool, [mute.url]);

    await eventually(() => expect(run.said('could-not-hear').length).toBeGreaterThanOrEqual(1), 5_000);
    await eventually(() => expect(run.said('listening-nowhere')).toHaveLength(1), 13_000);
    const nowhere = run.said('listening-nowhere')[0]!;
    expect(nowhere.at, 'said before the relay had had its ten seconds').toBeGreaterThanOrEqual(9_500);
    expect(nowhere.relays).toEqual([{ url: mute.url, reason: 'took the subscription and has not answered in 10s' }]);
    // Well past nostr-tools' 4.4 seconds, and not once "no answer".
    expect(run.names()).not.toContain('no-answer');
    expect(run.said('could-not-hear').length).toBeGreaterThanOrEqual(5);
  }, 20_000);

  it('a listener that drops during the window could not hear that window, though it heard before and after', async () => {
    const r = await relay();
    const { pool } = guardedPool();
    const run = distress(pool, [r.url], { ackWindowMs: 1_500, backoffMs: 200, maxBackoffMs: 200 });

    // Before: the first window is heard whole.
    await eventually(() => expect(run.said('no-answer')).toHaveLength(1), 4_000);
    expect(run.said('no-answer')[0]!.attempt).toBe(1);
    await eventually(() => expect(run.said('sent')).toHaveLength(2), 2_000);
    expect(run.names(), 'went quiet before the relay dropped anything').not.toContain('listening-nowhere');
    await new Promise((resolve) => setTimeout(resolve, 300));

    r.closeSubs('error: restarting');
    // Back within the window: a second later, as a closed listener is.
    await eventually(() => expect(r.openSubs()).toBe(1), 2_000);
    await eventually(() => expect(run.said('could-not-hear')).toHaveLength(1), 4_000);
    expect(run.said('could-not-hear')[0]!.attempt, 'a gap in the listening, called silence from the watch').toBe(2);

    const names = run.names();
    expect(names.indexOf('listening-nowhere')).toBeGreaterThan(names.lastIndexOf('sent'));
    expect(names.indexOf('listening-again')).toBeGreaterThan(names.indexOf('listening-nowhere'));
    expect(run.said('listening-nowhere')[0]!.relays[0]!.reason).toBe('error: restarting');

    // After: the next window is heard whole again.
    await eventually(() => expect(run.said('no-answer').map((p) => p.attempt)).toContain(3), 4_000);
  }, 15_000);
});

describe('where each attempt went', () => {
  it('names only the relay that took it, and which of those the watch was heard on', async () => {
    const refusing = await relay();
    const good = await relay();
    refusing.refuseEvent = (e) => (e.kind === KIND_DISTRESS ? 'blocked: no distress here' : null);
    const { pool } = guardedPool();
    const run = distress(pool, [refusing.url, good.url], {
      // A fresh watch state on both: heard is counted among the relays that took it, and only those.
      watchStateAgeMs: () => 30_000
    });

    await eventually(() => expect(run.said('accounted').length).toBeGreaterThanOrEqual(1), 5_000);
    const first = run.said('accounted')[0]!;
    expect(first.attempt).toBe(1);
    expect(first.took).toEqual([good.url]);
    expect(first.refused).toEqual([{ url: refusing.url, reason: 'blocked: no distress here' }]);
    expect(first.unconfirmed).toEqual([]);
    expect(first.unreached).toEqual([]);
    expect(first.heard, 'heard on a relay that refused the attempt').toEqual([good.url]);
    expect(first.withheld).toEqual([]);
    expect(run.names().indexOf('accounted')).toBeGreaterThan(run.names().indexOf('sent'));
    expect(distresses(refusing).length, 'never tried the relay that refused').toBeGreaterThanOrEqual(1);
  }, 10_000);

  it('a relay that takes seven seconds holds up the account, not the attempt leaving, and is never called a refusal', async () => {
    // It says OK after nostr-tools has stopped waiting, and it has the attempt: "refused" would tell
    // the operator a relay turned away a Distress it is carrying [review: G3 phase 1].
    const good = await relay();
    const slow = await slowRelay(7_000);
    const refusing = await relay();
    refusing.refuseEvent = () => 'blocked: not here';
    const unreachable = 'wss://relay.unreachable.example';
    const { pool } = guardedPool();
    const run = distress(pool, [good.url, slow.url, refusing.url, unreachable], { ackWindowMs: 9_000 });

    await eventually(() => expect(run.said('sent')).toHaveLength(1), 3_000);
    expect(run.said('sent')[0]!.at, 'held until the slow relay gave up').toBeLessThan(1_500);
    expect(run.said('accounted'), 'accounted for before the slow relay had answered').toHaveLength(0);

    await eventually(() => expect(run.said('accounted')).toHaveLength(1), 9_000);
    const account = run.said('accounted')[0]!;
    // nostr-tools waits 4.4 seconds for an OK, and then gives up.
    expect(account.at).toBeGreaterThanOrEqual(4_000);
    expect(account.took).toEqual([good.url]);
    expect(account.unconfirmed, 'a relay that may have it').toEqual([{ url: slow.url, reason: 'publish timed out' }]);
    expect(account.refused, 'a relay that said no').toEqual([{ url: refusing.url, reason: 'blocked: not here' }]);
    expect(account.unreached.map((u) => u.url), 'a relay it never reached').toEqual([unreachable]);
    expect(account.unreached[0]!.reason).toMatch(/^connection failure/);
  }, 15_000);

  it('one relay spelled two ways is sent each attempt once, and the attempt still leaves', async () => {
    // nostr-tools keys a publish by event id on each connection: the second spelling's publish took
    // the first's place, the first never settled, and the loop sat at "sending" -- past a stand-down.
    const r = await relay();
    const { pool } = guardedPool();
    const run = distress(pool, [r.url, `${r.url}/`]);

    await eventually(() => expect(run.said('accounted').length).toBeGreaterThanOrEqual(2), 5_000);
    expect(run.said('accounted')[0]!.took).toEqual([r.url]);
    const ids = distresses(r).map((e) => e.id);
    expect(new Set(ids).size, 'an attempt sent twice').toBe(ids.length);

    run.controller.abort();
    expect(await run.done, 'still running after the operator stood down').toBeInstanceOf(Error);
  }, 10_000);
});

describe('the relays it goes to, read again before every attempt', () => {
  it('a relay added mid-Distress is listened on before it is sent to, a person answering only there ends it, and none is dropped', async () => {
    const a = await relay();
    const b = await relay();
    const order: string[] = [];
    b.refuseReq = () => {
      order.push('REQ');
      return null;
    };
    b.refuseEvent = (e) => {
      order.push(e.kind === KIND_DISTRESS ? 'DISTRESS' : `EVENT ${e.kind}`);
      return null;
    };
    let reads = 0;
    // The second read names B and leaves A out.
    const given = () => (++reads === 1 ? [a.url] : [b.url]);
    const { pool } = guardedPool();
    const run = distress(pool, given);

    await eventually(() => expect(run.said('also-sending')).toHaveLength(1), 5_000);
    expect(run.said('also-sending')[0]).toMatchObject({ attempt: 2, relays: [b.url] });
    expect(run.names().indexOf('also-sending'), 'said before the attempt that first goes there').toBe(
      run.phases.findIndex((p) => p.phase === 'sending' && 'attempt' in p && p.attempt === 2) - 1
    );
    await eventually(() => expect(distresses(b).length).toBeGreaterThanOrEqual(1), 5_000);
    expect(order.indexOf('REQ'), 'sent to a relay before anything listened there').toBeGreaterThanOrEqual(0);
    expect(order.indexOf('REQ')).toBeLessThan(order.indexOf('DISTRESS'));

    // It never narrows: A still gets the attempt the second read left it out of.
    const second = distresses(b)[0]!;
    await eventually(() => expect(distresses(a).map((e) => e.id)).toContain(second.id), 3_000);
    await eventually(() => expect(run.said('accounted').some((p) => p.attempt === 2)).toBe(true), 3_000);
    expect(run.said('accounted').find((p) => p.attempt === 2)!.took).toEqual([a.url, b.url]);

    // Wren answers, on B alone.
    b.deliver(answer([second.id]));
    await eventually(() => expect(run.names()).toContain('acknowledged'), 5_000);
    expect(reads).toBeGreaterThanOrEqual(2);
  }, 15_000);

  it('a read that throws, or returns nothing usable, keeps every relay it already had', async () => {
    const a = await relay();
    let reads = 0;
    const given = () => {
      reads++;
      if (reads === 1) return [a.url];
      if (reads === 2) throw new Error('storage went away');
      return 'not a list' as unknown as string[];
    };
    const { pool } = guardedPool();
    const run = distress(pool, given);
    await eventually(() => expect(run.said('accounted').length).toBeGreaterThanOrEqual(3), 6_000);
    for (const account of run.said('accounted')) expect(account.took).toEqual([a.url]);
    expect(run.names()).not.toContain('also-sending');
    expect(run.names()).not.toContain('unreachable');
  }, 10_000);
});

describe('the mission relays', () => {
  it('are never dialled, however a config spells them, and every account says why nothing went there', async () => {
    const local = await relay();
    const { pool, dialled } = guardedPool();
    const run = distress(pool, [
      THE_RECORD,
      'https://RECORD.cosmiccodex.app/',
      MISSION_RELAYS[1]!,
      'wss://blackpi.cosmiccodex.app.:443',
      local.url
    ]);

    await eventually(() => expect(run.said('accounted').length).toBeGreaterThanOrEqual(2), 5_000);
    expect(dialled.filter((u) => /cosmiccodex/i.test(u)), 'a mission relay was dialled').toEqual([]);
    for (const account of run.said('accounted')) {
      expect(account.took).toEqual([local.url]);
      // One line for each relay however it is spelled; a trailing dot is a spelling the pool would
      // dial separately, so it is named separately.
      expect(account.withheld.map((w) => w.url)).toEqual([THE_RECORD, MISSION_RELAYS[1], 'wss://blackpi.cosmiccodex.app.:443']);
      for (const w of account.withheld) expect(w.reason).toMatch(/mission relay/);
    }
  }, 10_000);

  it('given only The Record, never leaves, says why, and dials nothing', async () => {
    const { pool, dialled } = guardedPool();
    const run = distress(pool, [THE_RECORD]);
    await eventually(() => expect(run.said('unreachable').length).toBeGreaterThanOrEqual(2), 5_000);
    expect(run.said('unreachable')[0]!.error).toMatch(/mission relay/);
    expect(run.said('listening-nowhere')).toHaveLength(1);
    expect(run.names()).not.toContain('sent');
    expect(dialled).toEqual([]);
  }, 10_000);
});

/* -------------------------------------------------------------------------------------------- */

describe('a pool that cannot hand over its relays', () => {
  it('that never ends a subscription\'s stored events: the phone could not hear', async () => {
    const phases = await briefly(manyPool({ eose: false }), ['wss://r'], 3);
    expect(phases.filter((p) => p.phase === 'could-not-hear')).toHaveLength(3);
    expect(phases.map((p) => p.phase)).not.toContain('no-answer');
  });

  it('that does: "no answer", as before', async () => {
    const phases = await briefly(manyPool({ eose: true }), ['wss://r'], 3);
    expect(phases.filter((p) => p.phase === 'no-answer')).toHaveLength(3);
    expect(phases.map((p) => p.phase)).not.toContain('could-not-hear');
  });

  it('"nobody is answering" stays unqualified when every window was heard', async () => {
    const phases = await briefly(manyPool({ eose: true }), ['wss://r'], 2, { localExhaustedAfterMs: 1 });
    const nobody = phases.find((p) => p.phase === 'nobody-answering');
    expect(nobody).toBeDefined();
    expect(nobody && 'couldNotHear' in nobody ? nobody.couldNotHear : undefined).toBeUndefined();
  });

  it('counts a relay as heard on only with a state under five minutes old, from a clock it can trust', async () => {
    const ages: Record<string, unknown> = {
      'wss://fresh': 299_000,
      // Both bounds count: five minutes exactly, and the clock tolerance exactly.
      'wss://five-minutes': 300_000,
      'wss://ahead-a-little': -60_000,
      'wss://ahead-by-the-tolerance': -120_000,
      'wss://stale': 300_001,
      'wss://ahead-too-far': -120_001,
      'wss://nan': Number.NaN,
      'wss://none': null
    };
    const urls = [...Object.keys(ages), 'wss://throws'];
    const phases = await briefly(manyPool({ eose: true }), urls, 1, {
      watchStateAgeMs: (url) => {
        if (url === 'wss://throws') throw new Error('reader broke');
        return ages[url] as number | null;
      }
    });
    const account = phases.find((p) => p.phase === 'accounted');
    expect(account && account.phase === 'accounted' ? account.took : null).toEqual(urls);
    expect(account && account.phase === 'accounted' ? account.heard : null).toEqual([
      'wss://fresh',
      'wss://five-minutes',
      'wss://ahead-a-little',
      'wss://ahead-by-the-tolerance'
    ]);
  });

  it('without the age function, the account says only which relays took it', async () => {
    const phases = await briefly(manyPool({ eose: true }), ['wss://a', 'wss://b'], 1);
    const account = phases.find((p) => p.phase === 'accounted');
    expect(account).toBeDefined();
    expect(account && 'heard' in account).toBe(false);
  });

  it('says why each relay refused, in its own words, and never more than one line of them', async () => {
    const phases = await briefly(
      manyPool({
        eose: true,
        publish: (url) =>
          url === 'wss://loud'
            ? // The line break and the direction override come early, inside what is kept.
              Promise.reject(new Error(`blocked: no\nWren is coming‮ ${'x'.repeat(500)}`))
            : Promise.resolve('')
      }),
      ['wss://loud', 'wss://quiet'],
      1
    );
    const account = phases.find((p) => p.phase === 'accounted');
    const reason = account && account.phase === 'accounted' ? account.refused[0]!.reason : '';
    expect(reason.startsWith('blocked: no Wren is coming')).toBe(true);
    expect(reason.length).toBeLessThanOrEqual(200);
    expect(reason).not.toMatch(/[\n‮]/);
  });

  it('names an address it will not send to without the characters that could mislead whoever reads it', async () => {
    // Wire data or a pasted config: the account quotes it back, so it is cleaned as a reason is.
    const phases = await briefly(manyPool({ eose: true }), ['wss://r', 'wss://bad host‮evil\u0007'], 1);
    const account = phases.find((p) => p.phase === 'accounted');
    const withheld = account && account.phase === 'accounted' ? account.withheld : [];
    expect(withheld).toHaveLength(1);
    expect(withheld[0]!.url).toBe('wss://bad host evil');
    expect(withheld[0]!.reason).toMatch(/not a relay address/);
  });
});

describe('a relay added mid-Distress, on a pool slow to connect', () => {
  it('is subscribed on before the attempt is handed to it', async () => {
    // A pool that hands over its relays, each connection taking 150ms. Without waiting for the
    // listener, the attempt reached the new relay first, and an answer only there went past.
    const order: string[] = [];
    const pool = {
      publish(urls: string[]) {
        order.push(`publish ${urls[0]}`);
        return urls.map(() => Promise.resolve(''));
      },
      ensureRelay: (url: string) =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                connected: true,
                subscribe: (_f: unknown, params: { oneose?: () => void }) => {
                  order.push(`subscribe ${url}`);
                  queueMicrotask(() => params.oneose?.());
                  return { close() {} };
                }
              }),
            150
          )
        ),
      subscribeMany() {
        throw new Error('not this path');
      },
      close() {}
    };
    let reads = 0;
    await briefly(pool, () => (++reads === 1 ? ['wss://a'] : ['wss://a', 'wss://b']), 2, {}, 300);
    const b = order.filter((o) => o.endsWith('wss://b/') || o.endsWith('wss://b'));
    expect(b[0], `order was ${order.join(', ')}`).toMatch(/^subscribe/);
    expect(b.some((o) => o.startsWith('publish'))).toBe(true);
  });
});

describe('a stand-down while an attempt is still going out', () => {
  it('ends the Distress at once, though a relay has not answered and never will', async () => {
    // The loop waited for every relay to settle before it looked at the stop. A relay that never
    // answers -- or one spelled twice, which nostr-tools never settles -- kept a stood-down Distress
    // running, and its button locked, for as long as the page was open.
    const pool = {
      publish: (urls: string[]) => urls.map(() => new Promise<string>(() => {})),
      subscribeMany: (_u: string[], _f: unknown, params: { oneose?: () => void }) => {
        queueMicrotask(() => params.oneose?.());
        return { close() {} };
      },
      close() {}
    };
    const controller = new AbortController();
    const phases: string[] = [];
    const run = sendDistressUntilAcknowledged(
      pool as unknown as SimplePool,
      ['wss://r'],
      OPERATOR,
      OUR_PUBKEY,
      watchtowerAt(WATCH_PUBKEY),
      AREA,
      { signal: controller.signal, onPhase: (p) => phases.push(p.phase) }
    ).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 50));
    expect(phases).toEqual(['sending']);
    const stoodDown = Date.now();
    controller.abort();
    const result = await Promise.race([run, new Promise((r) => setTimeout(() => r('still running'), 1_000))]);
    expect(result, 'still sending a second after the operator stood down').toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/cancelled by the operator/);
    expect(Date.now() - stoodDown).toBeLessThan(500);
    expect(phases, 'nothing said after the stand-down').toEqual(['sending']);
  });
});
