/**
 * The executor's relay paths.
 *
 * An executor that booted into an outage was deaf for the rest of its life; the fix for that
 * decided liveness from the pool's connection status, which is the wrong question [F08]. A relay
 * can stay connected and refuse the REQ -- rate limits, `auth-required`, `restricted` -- and a
 * heartbeat publish makes a relay read connected for twenty seconds with no subscription on it.
 * Liveness is now each relay's own subscription, and most of what follows runs the real
 * `SimplePool` against a relay on 127.0.0.1, because what broke was nostr-tools' bookkeeping on
 * a real socket.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { Event } from "nostr-tools/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EscalationExecutor } from "../src/escalation/executor.js";
import type { EscalationConfig } from "../src/escalation/config.js";
import { sealSignal } from "../src/shared/crypto.js";
import { KIND_DISTRESS, KIND_RESPONSE } from "../src/shared/kinds.js";
import { startRelay, freePort, eventually, type LocalRelay } from "./helpers/local-relay.js";

const A = "wss://a.relay";
const B = "wss://b.relay";
const nowS = () => Math.floor(Date.now() / 1000);

const dirs: string[] = [];
const executors: EscalationExecutor[] = [];
const relays: LocalRelay[] = [];

function config(urls: string[]): EscalationConfig {
  const dir = mkdtempSync(join(tmpdir(), "navcom-relays-"));
  dirs.push(dir);
  return {
    identity: { privkeyPath: "/dev/null" },
    relays: { urls },
    escalation: {
      pagingWindowSeconds: 300, contactWindowSeconds: 300, drillWindowDays: 7,
      drillAckWindowSeconds: 600, drillStatePath: join(dir, "drill.json"),
      maxPagesPerWindow: 20, pageBudgetWindowSeconds: 3_600, ladderRetentionSeconds: 3_600,
      ackHoldsSeconds: 1_800,
      oncall: [],
    },
    log: { path: join(dir, "escalation-log.jsonl"), retentionDays: 90 },
  };
}

function distress(operator: Uint8Array, watchtower: string, at = nowS()): Event {
  return finalizeEvent(
    {
      kind: KIND_DISTRESS,
      tags: [["p", watchtower]],
      content: sealSignal(operator, [watchtower], { position: null, area: "north side" }),
      created_at: at,
    },
    operator,
  );
}

const reported = (published: Event[], id: string) =>
  published.some((e) => e.kind === KIND_RESPONSE && e.tags.some((t) => t[0] === "e" && t[1] === id));

function onRelays(urls: string[]) {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  // No `page` needed: an empty roster reports EXHAUSTED at once, which is a 20912 to look for.
  const ex = new EscalationExecutor({ config: config(urls), secretKey, pubkey, page: async () => [] });
  executors.push(ex);
  return { ex, pubkey };
}

afterEach(async () => {
  await Promise.all(executors.splice(0).map((e) => e.stop()));
  await Promise.all(relays.splice(0).map((r) => r.close()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a relay that was down when the executor started", () => {
  it("is subscribed once it answers, and a Distress sent only there is reported", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const port = await freePort();
    const { ex, pubkey } = onRelays([`ws://127.0.0.1:${port}`]);
    ex.start();
    await new Promise((r) => setTimeout(r, 500));

    const relay = await startRelay({ port });
    relays.push(relay);
    await eventually(() => expect(relay.openSubs()).toBe(1), 20_000);

    const d = distress(generateSecretKey(), pubkey);
    relay.deliver(d);
    await eventually(() => expect(reported(relay.published, d.id)).toBe(true));
  }, 30_000);
});

describe("a relay that stays connected and closes the subscription [F08]", () => {
  it("is subscribed again promptly, and the log names the refusal rather than an outage", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const relay = await startRelay();
    relays.push(relay);
    let refused = 0;
    relay.refuseReq = () => (refused++ === 0 ? "rate-limited: slow down" : null);

    const { ex, pubkey } = onRelays([relay.url]);
    ex.start();

    // Not after the pool's twenty-second idle reaper happens to close the socket.
    await eventually(() => expect(relay.openSubs(), "the refused subscription was not reopened").toBe(1), 6_000);
    expect(error.mock.calls.flat().join("\n")).toMatch(/refused the subscription: rate-limited: slow down/);
    expect(error.mock.calls.flat().join("\n")).not.toMatch(/unreachable/);

    const d = distress(generateSecretKey(), pubkey);
    relay.deliver(d);
    await eventually(() => expect(reported(relay.published, d.id)).toBe(true));
  }, 15_000);

  it("says plainly that it does not do NIP-42 AUTH, once rather than on every retry", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const relay = await startRelay();
    relays.push(relay);
    relay.refuseReq = () => "auth-required: this relay wants to know you";

    const { ex } = onRelays([relay.url]);
    ex.start();
    await eventually(() => expect(relay.reqs.length).toBeGreaterThanOrEqual(3), 8_000);

    const lines = error.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("NIP-42"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/does not do NIP-42 AUTH/);
  }, 15_000);

  it("is re-subscribed even when another relay was down at boot [the double-close sequence]", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const downPort = await freePort();
    const refusing = await startRelay();
    relays.push(refusing);
    let refused = 0;
    refusing.refuseReq = () => (refused++ === 0 ? "restricted: not now" : null);

    const { ex, pubkey } = onRelays([`ws://127.0.0.1:${downPort}`, refusing.url]);
    ex.start();
    // Generous on purpose: the old executor got here too, on its fifteen-second tick. What it
    // could not do comes at the end.
    await eventually(() => expect(refusing.openSubs()).toBe(1), 20_000);

    const d = distress(generateSecretKey(), pubkey);
    refusing.deliver(d);
    await eventually(() => expect(reported(refusing.published, d.id)).toBe(true));

    // And the one that was down is picked up when it answers.
    const late = await startRelay({ port: downPort });
    relays.push(late);
    await eventually(() => expect(late.openSubs()).toBe(1), 20_000);

    // The deafness itself. Every relay now reads connected, so the old executor's fifteen-second
    // connection-status relisten found nothing to do -- and a later CLOSED on a live subscription
    // was never answered by anything. Waited past that tick first, so this is not passed by it.
    await new Promise((r) => setTimeout(r, 16_000));
    const before = refusing.reqs.length;
    refusing.closeSubs("rate-limited: slow down");
    await eventually(() => expect(refusing.reqs.length, "never re-subscribed after the second CLOSED").toBeGreaterThan(before), 5_000);
    await eventually(() => expect(refusing.openSubs()).toBe(1));

    const again = distress(generateSecretKey(), pubkey);
    refusing.deliver(again);
    await eventually(() => expect(reported(refusing.published, again.id)).toBe(true));
  }, 90_000);
});

describe("a relay that sent something stamped in the future, then dropped [F04]", () => {
  it("does not push since past the present, and the next Distress is reported", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const relay = await startRelay();
    relays.push(relay);
    const { ex, pubkey } = onRelays([relay.url]);
    ex.start();
    await eventually(() => expect(relay.openSubs()).toBe(1));

    relay.push(distress(generateSecretKey(), pubkey, nowS() + 3600));
    await new Promise((r) => setTimeout(r, 200));
    const before = relay.reqs.length;
    relay.dropAll();

    await eventually(() => expect(relay.reqs.length).toBeGreaterThan(before), 15_000);
    const since = relay.reqs.at(-1)?.filters[0]?.since;
    expect(since === undefined || since <= nowS(), `since was rewritten to ${since}`).toBe(true);

    const d = distress(generateSecretKey(), pubkey);
    relay.deliver(d);
    await eventually(() => expect(reported(relay.published, d.id)).toBe(true));
  }, 30_000);
});

/** Per-relay subscriptions a test can close and answer by hand. */
function fakePool() {
  type Params = { onclose?: (r: { url: string; reason: string }[]) => void; oneose?: () => void };
  const subs: { url: string; params: Params; closedByCaller: string | null }[] = [];
  const pool = {
    publish: () => [Promise.resolve("ok")],
    subscribeMany: (urls: string[], _f: unknown, params: Params) => {
      const sub = { url: urls[0] ?? "", params, closedByCaller: null as string | null };
      subs.push(sub);
      return { close: (reason?: string) => { sub.closedByCaller = reason ?? ""; } };
    },
    destroy: () => {},
  } as unknown as SimplePool;
  const closeFrom = (i: number, reason = "relay connection failed") =>
    subs[i]?.params.onclose?.([{ url: subs[i]!.url, reason }]);
  return { pool, subs, closeFrom };
}

function withFake(urls: string[]) {
  const fake = fakePool();
  const secretKey = generateSecretKey();
  const ex = new EscalationExecutor({
    config: config(urls), secretKey, pubkey: getPublicKey(secretKey), pool: fake.pool, page: async () => [],
  });
  executors.push(ex);
  return { ex, ...fake };
}

const settle = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
};

describe("bookkeeping the real pool depends on", () => {
  it("never closes a subscription whose own onclose already fired [F08]", async () => {
    // nostr-tools decrements its count of operations on the relay inside close(), so closing one
    // the relay already CLOSED counts it twice; the socket is then never reaped and the relay is
    // never subscribed again. It took this executor going deaf in a probe to see it.
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { ex, subs, closeFrom } = withFake([A]);
    ex.start();
    closeFrom(0, "rate-limited: slow down");
    await settle(16_000);

    expect(subs.length, "the closed subscription was not reopened").toBeGreaterThanOrEqual(2);
    expect(subs[0]?.closedByCaller, "a subscription the relay closed was closed again").toBeNull();
  });

  it("keeps one subscription per relay, so one relay closing never takes another's down", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { ex, subs, closeFrom } = withFake([A, B]);
    ex.start();
    expect(subs.map((s) => s.url)).toEqual([A, B]);

    closeFrom(1);
    await settle(16_000);
    expect(subs.filter((s) => s.url === A)).toHaveLength(1);
    expect(subs.filter((s) => s.url === B).length).toBeGreaterThanOrEqual(2);
  });

  it("says a relay went once, not on every retry, and says when it comes back", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { ex, subs, closeFrom } = withFake([A, B]);
    ex.start();
    subs[0]?.params.oneose?.();
    await settle(0);

    // B refuses the connection on every attempt.
    closeFrom(1);
    for (let i = 0; i < 5; i++) {
      await settle(16_000);
      closeFrom(subs.length - 1);
    }
    expect(error.mock.calls.filter((c) => String(c[0]).includes("b.relay unreachable"))).toHaveLength(1);
    expect(error.mock.calls.flat().join("\n")).toMatch(/A Distress sent only there is not heard/i);
    expect(error.mock.calls.flat().join("\n")).not.toMatch(/a\.relay/);

    await settle(16_000);
    subs.at(-1)?.params.oneose?.();
    await settle(0);
    expect(log.mock.calls.flat().join("\n")).toMatch(/b\.relay reachable again/);
  });

  it("stops retrying when stopped", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { ex, subs, closeFrom } = withFake([A]);
    ex.start();
    closeFrom(0);
    await ex.stop();
    await settle(60_000);

    expect(subs).toHaveLength(1);
  });
});
