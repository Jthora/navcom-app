/**
 * Relays refusing this phone for volume, and the routine beats held off them [refusing.svelte.ts].
 *
 * A relay that says `rate-limited:` and is sent to anyway escalates to a ban on the whole address,
 * reads included: relay.damus.io did exactly that on 2026-10-29. These hold the beats to stopping at
 * the first refusal, coming back once it cools, and leaving every other relay alone.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from 'nostr-tools/core';

/** What each relay answers a publish with: nothing is a take, a string is its refusal. */
const answers = vi.hoisted(() => ({ by: new Map<string, string>(), sent: [] as string[] }));

vi.mock('./pool', () => ({
  pool: () => ({
    publish: (urls: string[]) => {
      const url = urls[0]!;
      answers.sent.push(url);
      const said = answers.by.get(url);
      return [said === undefined ? Promise.resolve('') : Promise.reject(new Error(said))];
    }
  })
}));

const { COOL_MS, forgetRefusals, heardFrom, refusalOf, refusingNow, routineTo, sendEach, sendRoutine } = await import('./refusing.svelte');

const A = 'wss://relay.damus.io';
const B = 'wss://nos.lol';
const event = { id: 'e1', kind: 1, pubkey: 'p', created_at: 0, tags: [], content: '', sig: 's' } as Event;

beforeEach(() => {
  forgetRefusals();
  answers.by.clear();
  answers.sent.length = 0;
});

describe('what counts as a relay refusing this phone for volume', () => {
  it('is NIP-01’s rate-limited prefix, or a ban, and nothing else', () => {
    expect(refusalOf('rate-limited: you are noting too much')).toBe('rate-limited');
    expect(refusalOf('banned: too many rate-limit violations')).toBe('banned');
    expect(refusalOf('blocked: not on the allowlist')).toBeNull();
    expect(refusalOf('invalid: bad signature')).toBeNull();
    expect(refusalOf('connection failure: 503')).toBeNull();
    expect(refusalOf('publish timed out')).toBeNull();
  });
});

describe('the routine beats', () => {
  it('stop sending to a relay at its first rate limit, and go on to every other', async () => {
    answers.by.set(A, 'rate-limited: you are noting too much');
    expect(await sendRoutine([A, B], event)).toEqual([B]);
    answers.sent.length = 0;

    expect(await sendRoutine([A, B], event)).toEqual([B]);
    expect(answers.sent).toEqual([B]);
  });

  it('come back to it once it has cooled, and a ban holds them off longer', async () => {
    const t = 1_000_000;
    heardFrom(A, 'rate-limited: slow down', t);
    heardFrom(B, 'banned: too many rate-limit violations', t);
    expect(routineTo([A, B], t + COOL_MS['rate-limited'] - 1)).toEqual([]);
    expect(routineTo([A, B], t + COOL_MS['rate-limited'])).toEqual([A]);
    expect(routineTo([A, B], t + COOL_MS.banned)).toEqual([A, B]);
  });

  it('do not let a rate limit after a ban shorten it', () => {
    const t = 1_000_000;
    heardFrom(A, 'banned: too many rate-limit violations', t);
    heardFrom(A, 'rate-limited: slow down', t + 1000);
    expect(refusingNow(t + 2000)[0]?.why).toBe('banned');
    expect(routineTo([A], t + 1000 + COOL_MS['rate-limited'])).toEqual([]);
  });

  it('are not held off by any other refusal', async () => {
    answers.by.set(A, 'blocked: not on the allowlist');
    await sendRoutine([A, B], event);
    expect(routineTo([A, B])).toEqual([A, B]);
    expect(refusingNow()).toEqual([]);
  });
});

describe('what may not wait', () => {
  it('still goes to a relay that is refusing, and a take there ends the refusal', async () => {
    heardFrom(A, 'rate-limited: slow down');
    expect(await sendEach([A, B], event)).toEqual([A, B]);
    expect(answers.sent).toEqual([A, B]);
    expect(refusingNow()).toEqual([]);
  });
});

describe('what Status reads', () => {
  it('names each relay refusing now, what it said and until when', () => {
    const t = 1_000_000;
    heardFrom(A, 'rate-limited: you are noting too much', t);
    expect(refusingNow(t)).toEqual([{ url: A, why: 'rate-limited', said: 'rate-limited: you are noting too much', at: t, until: t + COOL_MS['rate-limited'] }]);
    expect(refusingNow(t + COOL_MS['rate-limited'])).toEqual([]);
  });
});
