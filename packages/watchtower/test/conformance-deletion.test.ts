/**
 * What a deletion request actually does, which decides what we may promise an operator.
 *
 * A withdrawal is the one thing in the publishing path that cannot be made true by writing it
 * carefully: NIP-09 says relays *may* honour or ignore a request, there is no enforcement, and
 * removing an event from every relay and client is impossible. So the copy has to say what is true
 * of the relays this app actually ships, and that means measuring them.
 *
 * `checkRelay` builds its own pool and cannot be driven from a test, which is why the probe is its
 * own function. These are the three outcomes, each of which is easy to report as the wrong one.
 */

import { describe, it, expect, vi } from "vitest";
import { generateSecretKey } from "nostr-tools/pure";
import type { Event } from "nostr-tools/pure";
import { probeDeletion, type DeletionPool } from "../src/relay/conformance.js";

const secret = generateSecretKey();
const instant = async () => {};

/**
 * A relay that behaves however the test says.
 *
 * `stored` is what `querySync` returns, in order, one array per call — so a relay that honours a
 * deletion is "the event, then nothing", and one that ignores it is "the event, then the event".
 */
function fakeRelay(opts: {
  accept?: boolean;
  acceptDeletion?: boolean;
  stored: Event[][];
}): { pool: DeletionPool; published: Event[] } {
  const published: Event[] = [];
  let call = 0;
  const pool: DeletionPool = {
    publish: (_urls, event) => {
      published.push(event);
      const ok = event.kind === 5 ? opts.acceptDeletion !== false : opts.accept !== false;
      return [ok ? Promise.resolve("ok") : Promise.reject(new Error("blocked: no"))];
    },
    querySync: async () => opts.stored[call++] ?? []
  };
  return { pool, published };
}

describe("a relay that honours a deletion request", () => {
  it("reports it, and that is the only outcome that counts as honoured", async () => {
    const seen: Event[] = [];
    const pool: DeletionPool = {
      publish: (_u, e) => {
        seen.push(e);
        return [Promise.resolve("ok")];
      },
      querySync: async () => (seen.some((e) => e.kind === 5) ? [] : [seen[0]!])
    };
    const r = await probeDeletion(pool, "wss://x", secret, instant);
    expect(r.honoured).toBe(true);
    expect(seen.map((e) => e.kind)).toEqual([9979, 5]);
    expect(seen[1]?.tags).toEqual([["e", seen[0]!.id]]);
  });
});

describe("a relay that keeps it anyway", () => {
  it("is reported as kept rather than failed, because NIP-09 permits exactly that", async () => {
    /*
     * The assertion that protects the conformance run: a `fail` here would exit non-zero for
     * behaviour the specification allows, and a red result that means nothing is worse than none.
     */
    // Served both times: the relay took the request and kept the event.
    const mine: Event[] = [];
    const keeping: DeletionPool = {
      publish: (_u, e) => {
        mine.push(e);
        return [Promise.resolve("ok")];
      },
      querySync: async () => [mine[0]!]
    };
    const r = await probeDeletion(keeping, "wss://x", secret, instant);
    expect(r.honoured).toBe(false);
    expect(r.detail).toMatch(/NIP-09 permits/);
    expect(r.detail).toMatch(/removes nothing/);
  });
});

describe("when nothing can be told", () => {
  it("says so when the relay would not take the event at all", async () => {
    const { pool } = fakeRelay({ accept: false, stored: [] });
    const r = await probeDeletion(pool, "wss://x", secret, instant);
    expect(r.honoured).toBeNull();
    expect(r.detail).toMatch(/would not accept/);
  });

  it("says so when the relay stored nothing, which proves nothing about deletion", async () => {
    // A relay that stores nothing in this range cannot serve a withdrawn report either, which is
    // the question an operator actually has — so this is information, not a failure.
    const { pool } = fakeRelay({ stored: [[]] });
    const r = await probeDeletion(pool, "wss://x", secret, instant);
    expect(r.honoured).toBeNull();
    expect(r.detail).toMatch(/nothing to delete/);
  });

  it("says so when the relay refused the deletion request itself", async () => {
    const mine: Event[] = [];
    const pool: DeletionPool = {
      publish: (_u, e) => {
        mine.push(e);
        return [e.kind === 5 ? Promise.reject(new Error("blocked: kind 5 not accepted")) : Promise.resolve("ok")];
      },
      querySync: async () => [mine[0]!]
    };
    const r = await probeDeletion(pool, "wss://x", secret, instant);
    expect(r.honoured).toBeNull();
    expect(r.detail).toMatch(/refused the deletion request/);
  });

  it("never throws, whatever the pool does", async () => {
    const pool: DeletionPool = {
      publish: () => [Promise.reject(new Error("boom"))],
      querySync: async () => {
        throw new Error("boom");
      }
    };
    await expect(probeDeletion(pool, "wss://x", secret, instant)).resolves.toBeTruthy();
  });
});

describe("politeness", () => {
  it("writes two events and no more, both signed by a throwaway key", async () => {
    const mine: Event[] = [];
    const pool: DeletionPool = {
      publish: (_u, e) => {
        mine.push(e);
        return [Promise.resolve("ok")];
      },
      querySync: async () => (mine.some((e) => e.kind === 5) ? [] : [mine[0]!])
    };
    const settle = vi.fn(async () => {});
    await probeDeletion(pool, "wss://x", secret, settle);
    expect(mine).toHaveLength(2);
    // It waits rather than hammering: once after the write, once before looking again.
    expect(settle).toHaveBeenCalledTimes(2);
  });
});
