/**
 * What a `Distress` does as it ends, and what keeps it listening while it runs [review: G3 phase 1].
 *
 * Once the operator stands down, or a person answers, nothing more goes out and nothing more is
 * said. An attempt waiting on a new relay's listener went out after the stand-down, to a relay
 * dialled afresh, and an account held while an attempt was going out reached the screen after
 * "stopped". While it runs, a relay that dropped the request without a word was never asked again,
 * and one entry in the relays that could not be printed ended the whole `Distress`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SimplePool } from 'nostr-tools/pool';
import { watchtowerAt } from '../src/crypto/group';
import { KIND_DISTRESS } from '../src/events/kinds';
import { sendDistressUntilAcknowledged, type DistressPhase } from '../src/transport';
import {
  AREA,
  OPERATOR,
  OUR_PUBKEY,
  WATCH_PUBKEY,
  briefly,
  cleanup,
  distress,
  eventually,
  guardedPool,
  manyPool,
  relay,
  sleep,
  slowHandshakeRelay
} from './helpers/distress';

afterEach(async () => {
  vi.useRealTimers();
  await cleanup();
});

describe('a stand-down while a new relay is still connecting', () => {
  it('the attempt waiting on its listener is never handed over', async () => {
    const log: string[] = [];
    let stoodDown = false;
    const pool = {
      publish(urls: string[]) {
        log.push(`${stoodDown ? 'after the stand-down: ' : ''}publish ${urls[0]}`);
        return urls.map(() => Promise.resolve(''));
      },
      ensureRelay: (url: string) =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                connected: true,
                subscribe: (_f: unknown, params: { oneose?: () => void }) => {
                  log.push(`${stoodDown ? 'after the stand-down: ' : ''}subscribe ${url}`);
                  queueMicrotask(() => params.oneose?.());
                  return { close() {} };
                }
              }),
            url.includes('//b') ? 500 : 0
          )
        ),
      subscribeMany() {
        throw new Error('not this path');
      },
      close() {}
    };
    const controller = new AbortController();
    let reads = 0;
    const result = await sendDistressUntilAcknowledged(
      pool as unknown as SimplePool,
      () => (++reads === 1 ? ['wss://a'] : ['wss://a', 'wss://b']),
      OPERATOR,
      OUR_PUBKEY,
      watchtowerAt(WATCH_PUBKEY),
      AREA,
      {
        ackWindowMs: 200,
        backoffMs: 20,
        maxBackoffMs: 20,
        signal: controller.signal,
        onPhase: (p) => {
          // Attempt 2 left through A while B, first named for it, is still connecting.
          if (p.phase === 'sent' && p.attempt === 2) {
            setTimeout(() => {
              stoodDown = true;
              controller.abort();
            }, 100);
          }
        }
      }
    ).catch((e: unknown) => e);
    expect(result).toBeInstanceOf(Error);
    await sleep(900);
    expect(log.filter((l) => l.startsWith('after')), 'handed to the pool after the stand-down').toEqual([]);
    expect(log, 'B was sent the attempt it was waiting to be sent').not.toContain('publish wss://b');
  });

  it('on real sockets: no Distress reaches it, and it is not dialled again', async () => {
    // B's listener connects after the stand-down; C's gives up at three seconds, before C connects.
    const a = await relay();
    const b = await slowHandshakeRelay(2_500);
    const c = await slowHandshakeRelay(3_500);
    let reads = 0;
    const given = () => (++reads === 1 ? [a.url] : [a.url, b.url, c.url]);
    const { pool, dials } = guardedPool();
    const run = distress(pool, given, { ackWindowMs: 300, backoffMs: 100, maxBackoffMs: 100 });

    await eventually(() => expect(run.said('also-sending')).toHaveLength(1), 5_000);
    await eventually(() => expect(run.said('sent').length).toBeGreaterThanOrEqual(2), 5_000);
    run.controller.abort();
    await run.done;
    const ended = run.endedAt()!;

    await sleep(5_000);
    const later = dials.filter((d) => (d.url.startsWith(b.url) || d.url.startsWith(c.url)) && d.at > ended);
    expect(later, 'dialled after the operator stood down').toEqual([]);
    const reached = [...b.events, ...c.events].filter((e) => e.event.kind === KIND_DISTRESS);
    expect(reached, 'a Distress handed to a relay after the operator stood down').toEqual([]);
  }, 20_000);
});

describe('nothing is said after the stand-down', () => {
  it('including what was held while an attempt was going out', async () => {
    // Attempt 1: one relay says OK at once and one after 300ms, so its account arrives while
    // attempt 2, which nothing ever answers, is going out.
    let calls = 0;
    const pool = {
      publish(urls: string[]) {
        calls++;
        if (calls <= 2) {
          return urls.map((u) => (u.includes('slow') ? new Promise((r) => setTimeout(() => r(''), 300)) : Promise.resolve('')));
        }
        return urls.map(() => new Promise(() => {}));
      },
      subscribeMany: (_u: string[], _f: unknown, params: { oneose?: () => void }) => {
        queueMicrotask(() => params.oneose?.());
        return { close() {} };
      },
      close() {}
    };
    const controller = new AbortController();
    const said: string[] = [];
    let stoodDown = false;
    const result = await sendDistressUntilAcknowledged(
      pool as unknown as SimplePool,
      ['wss://fast', 'wss://slow'],
      OPERATOR,
      OUR_PUBKEY,
      watchtowerAt(WATCH_PUBKEY),
      AREA,
      {
        ackWindowMs: 5,
        backoffMs: 20,
        maxBackoffMs: 20,
        signal: controller.signal,
        onPhase: (p) => {
          said.push(`${stoodDown ? 'after the stand-down: ' : ''}${p.phase}${'attempt' in p ? ` ${p.attempt}` : ''}`);
          if (p.phase === 'sending' && p.attempt === 2) {
            setTimeout(() => {
              stoodDown = true;
              controller.abort();
            }, 500);
          }
        }
      }
    ).catch((e: unknown) => e);
    expect(result).toBeInstanceOf(Error);
    expect(said.filter((s) => s.startsWith('after')), 'said after the stand-down').toEqual([]);
    expect(said).toEqual(['sending 1', 'sent 1', 'no-answer 1', 'sending 2']);
  });
});

describe('listening while it runs', () => {
  it('a relay that took the subscription and said nothing is asked again with the next attempt, and heard once it answers', async () => {
    vi.useFakeTimers();
    let subscribes = 0;
    const pool = {
      publish: (urls: string[]) => urls.map(() => Promise.resolve('')),
      ensureRelay: async () => ({
        connected: true,
        subscribe: (_f: unknown, params: { oneose?: () => void }) => {
          subscribes++;
          // The first request is dropped without a word, as an older relay at its subscription
          // limit does; every one after it is answered.
          if (subscribes > 1) queueMicrotask(() => params.oneose?.());
          return { close() {} };
        }
      }),
      subscribeMany() {
        throw new Error('not this path');
      },
      close() {}
    };
    const controller = new AbortController();
    const phases: DistressPhase[] = [];
    const run = sendDistressUntilAcknowledged(
      pool as unknown as SimplePool,
      ['wss://quiet'],
      OPERATOR,
      OUR_PUBKEY,
      watchtowerAt(WATCH_PUBKEY),
      AREA,
      { ackWindowMs: 1_000, backoffMs: 1_000, maxBackoffMs: 1_000, signal: controller.signal, onPhase: (p) => phases.push(p) }
    ).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(30_000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(10);
    await run;

    const names = phases.map((p) => p.phase);
    expect(names).toContain('listening-nowhere');
    expect(subscribes, 'never asked the relay again').toBeGreaterThan(1);
    const again = names.indexOf('listening-again');
    expect(again, 'never heard again').toBeGreaterThan(names.indexOf('listening-nowhere'));
    expect(names.slice(again)).toContain('no-answer');
  });

  it('a listener its relay closed is opened again with the next attempt, not only after its wait', async () => {
    const opened: number[] = [];
    const pool = manyPool({
      eose: false,
      onSubscribe: (_url, params, n) => {
        opened.push(Date.now());
        queueMicrotask(() => params.oneose?.());
        // The relay closes the first subscription a moment after answering it.
        if (n === 1) setTimeout(() => params.onclose?.('error: restarting'), 5);
      }
    });
    await briefly(pool, ['wss://r'], 4);
    expect(opened.length, 'not opened again while the attempts went out').toBeGreaterThanOrEqual(2);
    expect(opened[1]! - opened[0]!, 'waited for its timer, not the next attempt').toBeLessThan(500);
  });
});

describe('an entry in the relays that is not an address', () => {
  /** An object with no prototype: `String()` of it throws. */
  const unprintable = () => Object.create(null) as unknown as string;

  it('in the list: withheld and named, and the Distress goes on', async () => {
    const phases = await briefly(manyPool({ eose: true }), ['wss://a', unprintable()], 2);
    expect(phases.filter((p) => p.phase === 'sent')).toHaveLength(2);
    const account = phases.find((p) => p.phase === 'accounted');
    expect(account && account.phase === 'accounted' ? account.withheld : null).toEqual([
      { url: '(an address that cannot be printed)', reason: 'not a relay address' }
    ]);
  });

  it('in a later read: the Distress keeps what it had', async () => {
    let reads = 0;
    const phases = await briefly(manyPool({ eose: true }), () => (++reads === 1 ? ['wss://a'] : ['wss://a', unprintable()]), 3);
    expect(phases.filter((p) => p.phase === 'sent')).toHaveLength(3);
    expect(phases.map((p) => p.phase)).not.toContain('unreachable');
  });

  it('a read that throws as it is looked at, entry by entry, adds nothing and ends nothing', async () => {
    let reads = 0;
    const hostile = () => {
      const list = ['wss://a', 'wss://b'];
      Object.defineProperty(list, 1, {
        get() {
          throw new Error('this entry cannot be read');
        }
      });
      return list;
    };
    const phases = await briefly(manyPool({ eose: true }), () => (++reads === 1 ? ['wss://a'] : hostile()), 3);
    expect(phases.filter((p) => p.phase === 'sent')).toHaveLength(3);
    expect(phases.map((p) => p.phase)).not.toContain('also-sending');
  });

  it('a number is never taken for the address it looks like', async () => {
    // `42` once shared a key with `wss://42`, and the real address behind it was dropped as a duplicate.
    const pool = manyPool({ eose: true });
    await briefly(pool, [42 as unknown as string, 'wss://42'], 1);
    expect(pool.published).toEqual(['wss://42']);
  });
});
