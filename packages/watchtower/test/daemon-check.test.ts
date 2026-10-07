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

/**
 * A pool that serves what it is given, and fails the relays it is told to fail. Each relay it hands
 * over answers the box's own subscription, unless told to refuse it or to say nothing.
 */
function fakePool(opts: { events?: unknown[]; unreachable?: string[]; refuses?: string[]; silent?: string[] } = {}) {
  return {
    ensureRelay: async (url: string) => {
      if (opts.unreachable?.includes(url)) throw new Error("connection refused");
      return {
        subscribe: (_f: unknown, params: { oneose?: () => void; onclose?: (r: string) => void }) => {
          if (opts.refuses?.includes(url)) queueMicrotask(() => params.onclose?.("auth-required: members only"));
          else if (!opts.silent?.includes(url)) queueMicrotask(() => params.oneose?.());
          return { close() {} };
        },
      } as never;
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

describe("whether the box can hear what an operator sends it [#38]", () => {
  it("names a relay that refuses the box's own subscription, though it serves the watch", async () => {
    // An inbox that wants AUTH serves the watch state to anybody and refuses the box's #p REQ. This
    // command read only the watch state, reported the box as seen and exited zero.
    const out = await check({ events: [watchState(NOW - 30)], refuses: ["wss://b"] });
    expect(out.relays.find((r) => r.url === "wss://a")?.hears).toBe(true);
    const b = out.relays.find((r) => r.url === "wss://b")!;
    expect(b.hears).toBe(false);
    expect(b.deaf).toMatch(/refused the box's subscription: auth-required: members only/);
    expect(out.hearing).toBe(true);
    const printed = report(out).join("\n");
    expect(printed).toMatch(/wss:\/\/b: reached, but it refused the box's subscription/);
    expect(printed).toMatch(/a Distress sent only there is not heard/);
  });

  it("says no signal reaches the box when no relay answers its subscription, though the watch reads as up", async () => {
    const out = await check({ events: [watchState(NOW - 30)], refuses: ["wss://a"], silent: ["wss://b"] });
    expect(out.visible).toBe(true);
    expect(out.hearing, "an operator can see this watch and cannot reach it").toBe(false);
    expect(out.relays.find((r) => r.url === "wss://b")?.deaf).toMatch(/did not answer in 50ms/);
    expect(report(out).join("\n")).toMatch(/NO RELAY ANSWERS THE BOX'S SUBSCRIPTION/);
  });

  it("does not send anybody to restart a running daemon that is withholding the watch for that reason", async () => {
    // The daemon publishes the watch state only where its subscription is answered, so on a box no
    // relay answers, a running daemon publishes nothing. "Absent" then said only "the daemon is not
    // running, or publishing to relays this config does not list" -- both false.
    const out = await check({ events: [], refuses: ["wss://a", "wss://b"] });
    expect(out.read.reason).toBe("absent");
    const printed = report(out);
    const remedyLine = printed.findIndex((l) => /No relay served anything/.test(l));
    const cause = printed.findIndex((l) => /NO RELAY ANSWERS THE BOX'S SUBSCRIPTION/.test(l));
    expect(cause, "the cause is not printed").toBeGreaterThanOrEqual(0);
    expect(cause, "the cause comes after the remedy that depends on it").toBeLessThan(remedyLine);
    expect(printed[remedyLine]).toMatch(/running daemon is withholding it/);
    expect(printed[remedyLine]).not.toMatch(/^\[check\] No relay served anything for this key\. Either the daemon is not running/);
  });

  it("says the same of a watch state that went stale once no relay answered", async () => {
    const out = await check({ events: [watchState(NOW - 900)], refuses: ["wss://a"], silent: ["wss://b"] });
    expect(out.read.reason).toBe("stale");
    expect(remedy(out.read, 300, out.hearing)).toMatch(/running daemon is withholding it .* still stale after that, the daemon has stopped republishing/);
    // And where some relay does answer, the two causes it always had.
    expect(remedy(out.read, 300, true)).toMatch(/^The last watch state is 900s old .* The daemon has stopped republishing/);
  });

  it("says nothing of the kind when every relay answers", async () => {
    const out = await check({ events: [watchState(NOW - 30)] });
    expect(out.hearing).toBe(true);
    expect(report(out).join("\n")).not.toMatch(/NO RELAY ANSWERS|not heard/);
  });
});

describe("a relay that takes the connection and never answers the upgrade [#11]", () => {
  it("is named unreachable within seconds, beside the relay that answered, instead of hanging for ever", async () => {
    // `ws` has no handshake timeout of its own, and nothing bounded the connect: the command printed
    // nothing and never exited, so the cron line recommended for it never failed.
    const { createServer } = await import("node:net");
    const { startRelay } = await import("./helpers/local-relay.js");
    const healthy = await startRelay();
    const held: import("node:net").Socket[] = [];
    const wedged = createServer((socket) => held.push(socket));
    await new Promise<void>((resolve) => wedged.listen(0, "127.0.0.1", () => resolve()));
    const address = wedged.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const wedgedUrl = `ws://127.0.0.1:${port}`;
    try {
      const started = Date.now();
      const out = await checkWatch({ pubkey: PUBKEY, relays: [healthy.url, wedgedUrl], timeoutMs: 2_000 });
      expect(Date.now() - started).toBeLessThan(8_000);
      expect(out.relays.find((r) => r.url === healthy.url)?.reached).toBe(true);
      expect(out.relays.find((r) => r.url === wedgedUrl)?.reached).toBe(false);
      expect(out.relays.find((r) => r.url === healthy.url)?.hears, "the healthy relay answers the box").toBe(true);
    } finally {
      for (const s of held) s.destroy();
      wedged.close();
      await healthy.close();
    }
  }, 15_000);
});
