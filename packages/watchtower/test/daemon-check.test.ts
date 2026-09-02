import { describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { SimplePool } from "nostr-tools/pool";
import { buildWatchStateEvent } from "@navcom/core";
import { checkWatch, remedy, report } from "../src/daemon/check.js";

/**
 * `watchtower-daemon --check`, which answers the one question a Stationkeeper could not.
 *
 * The escalation half has had `--check` and `--drill` since it shipped. The daemon half had
 * no flags at all, so somebody standing up a box could prove they were able to wake a person
 * and had no way to prove an operator could **see** their watch. The first thing that would
 * notice a box publishing nothing readable was an operator at sign-on, being told Dark.
 *
 * Every reason is exercised because the reason is the whole value: "Dark" is what an operator
 * needs and is useless to the person who has to fix it, and the four causes have four
 * different fixes.
 */

const WATCH = generateSecretKey();
const PUBKEY = getPublicKey(WATCH);
const NOW = 1_800_000_000;

function watchState(at: number, over: Record<string, unknown> = {}) {
  return finalizeEvent(
    buildWatchStateEvent(
      {
        state: "station",
        since: at - 600,
        holder: "Vale",
        holder_kind: "human",
        oncall: [],
        agent_health: "ok",
        last_drill: null,
        now: at,
        ...over,
      } as never,
      at,
    ),
    WATCH,
  );
}

/** A pool that serves what it is given, and fails the relays it is told to fail. */
function fakePool(opts: { events?: unknown[]; unreachable?: string[] } = {}) {
  return {
    ensureRelay: async (url: string) => {
      if (opts.unreachable?.includes(url)) throw new Error("connection refused");
      return {} as never;
    },
    subscribeMany: (_urls: string[], _filter: unknown, params: { onevent: (e: never) => void; oneose?: () => void }) => {
      for (const e of opts.events ?? []) params.onevent(e as never);
      params.oneose?.();
      return { close() {} };
    },
  } as unknown as SimplePool;
}

const check = (opts: Parameters<typeof fakePool>[0] & { now?: number } = {}) =>
  checkWatch({
    pubkey: PUBKEY,
    relays: ["wss://a", "wss://b"],
    pool: fakePool(opts),
    now: () => opts.now ?? NOW,
    timeoutMs: 50,
  });

describe("what an operator would see, told to the person who can fix it", () => {
  it("says the watch is visible when it is", async () => {
    const out = await check({ events: [watchState(NOW - 30)] });
    expect(out.visible).toBe(true);
    expect(remedy(out.read)).toMatch(/would see this watch/i);
  });

  it("names an absent watch as the daemon or the relay list, not as Dark", async () => {
    // What a freshly stood-up box looks like when the daemon is not running, or is publishing
    // somewhere this config does not list. Both are what actually goes wrong first.
    const out = await check({ events: [] });
    expect(out.visible).toBe(false);
    expect(out.read.reason).toBe("absent");
    expect(out.found).toBeNull();
    expect(remedy(out.read)).toMatch(/daemon is not running/i);
    expect(remedy(out.read)).toMatch(/relays this config does not list/i);
  });

  it("names a stale watch with the threshold operators actually apply", async () => {
    /*
     * The quietest failure of the four: the daemon is running, the relays are reachable, the
     * key is right, and it has simply stopped republishing. Everything looks fine from the
     * box and every operator reads Dark.
     */
    const out = await check({ events: [watchState(NOW - 900)] });
    expect(out.read.reason).toBe("stale");
    expect(out.visible).toBe(false);
    expect(remedy(out.read)).toMatch(/stopped republishing/i);
    expect(remedy(out.read)).toMatch(/300s/);
  });

  it("names a corrupt watch state as something else publishing on this key", async () => {
    const garbled = finalizeEvent(
      { kind: 10910, created_at: NOW - 10, tags: [], content: "not json at all" },
      WATCH,
    );
    const out = await check({ events: [garbled] });
    expect(out.read.reason).toBe("corrupt");
    expect(remedy(out.read)).toMatch(/cannot be parsed/i);
  });

  it("names a clock problem as the box's clock, and says to fix that first", async () => {
    // Stamped in this machine's future by more than the tolerance. Every age computed here is
    // then arithmetic on a number that means nothing, so it is worth saying before anything
    // else on the page.
    const out = await check({ events: [watchState(NOW + 3_600)] });
    expect(out.read.reason).toBe("clock");
    expect(remedy(out.read)).toMatch(/clock has moved backwards|fix the clock/i);
  });

  it("takes the newest when relays disagree, because a dead daemon leaves a fresh-looking copy", async () => {
    // The case relay.ts documents: a relay serving a preserved copy long after the daemon
    // died. The age has to come from the event, not from having received one.
    const out = await check({ events: [watchState(NOW - 900), watchState(NOW - 20)] });
    expect(out.found?.ageSeconds).toBe(20);
    expect(out.visible).toBe(true);
  });
});

describe("the relays themselves", () => {
  it("reports each one, because up on one of three is real and otherwise invisible", async () => {
    const out = await check({ events: [watchState(NOW - 30)], unreachable: ["wss://b"] });
    expect(out.relays).toHaveLength(2);
    expect(out.relays.find((r) => r.url === "wss://a")?.reached).toBe(true);
    expect(out.relays.find((r) => r.url === "wss://b")?.reached).toBe(false);
    expect(out.relays.find((r) => r.url === "wss://b")?.error).toMatch(/refused/i);
  });

  it("refuses to blame the daemon when no relay was reachable at all", async () => {
    /*
     * The distinction that keeps this command honest. With nothing reachable the answer is
     * "absent" and it means nothing about the box — telling a Stationkeeper their daemon is
     * down when their network is down would send them to rebuild a working thing.
     */
    const out = await check({ events: [], unreachable: ["wss://a", "wss://b"] });
    expect(out.visible).toBe(false);
    const printed = report(out).join("\n");
    expect(printed).toMatch(/says nothing about the daemon/i);
    // And it must not then blame the daemon two lines later, which is what the first version
    // did -- found by running the command, not by testing it.
    expect(printed).not.toMatch(/daemon is not running/i);
    expect(printed).toMatch(/fix the network or the relay list/i);
  });
});
