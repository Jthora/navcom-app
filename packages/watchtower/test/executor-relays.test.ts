/**
 * An executor that booted into an outage.
 *
 * The pool gives up for good on a relay that fails its first connection. Nothing logged it and
 * nothing subscribed again, so an executor started while the network was still coming up --
 * which is what a box does after a power cut -- looked healthy and could not hear a Distress.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { SimplePool } from "nostr-tools/pool";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { normalizeURL } from "nostr-tools/utils";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EscalationExecutor, RELISTEN_SECONDS } from "../src/escalation/executor.js";
import type { EscalationConfig } from "../src/escalation/config.js";

const A = "wss://a.relay";
const B = "wss://b.relay";

const dirs: string[] = [];
const executors: EscalationExecutor[] = [];

function harness() {
  const dir = mkdtempSync(join(tmpdir(), "navcom-relays-"));
  dirs.push(dir);
  const config: EscalationConfig = {
    identity: { privkeyPath: "/dev/null" },
    relays: { urls: [A, B] },
    escalation: {
      pagingWindowSeconds: 300, contactWindowSeconds: 300, drillWindowDays: 7,
      drillAckWindowSeconds: 600, drillStatePath: join(dir, "drill.json"),
      maxPagesPerWindow: 20, pageBudgetWindowSeconds: 3_600, ladderRetentionSeconds: 3_600,
      oncall: [],
    },
    log: { path: join(dir, "escalation-log.jsonl"), retentionDays: 90 },
  };

  const status = new Map<string, boolean>();
  const subscriptions: { closed: string | null; onclose: () => void }[] = [];
  const pool = {
    publish: () => [Promise.resolve("ok")],
    subscribeMany: (_u: string[], _f: unknown, params: { onclose: () => void }) => {
      const sub = { closed: null as string | null, onclose: params.onclose };
      subscriptions.push(sub);
      return { close: (reason?: string) => { sub.closed = reason ?? ""; } };
    },
    listConnectionStatus: () => status,
    destroy: () => {},
  } as unknown as SimplePool;

  const secretKey = generateSecretKey();
  const ex = new EscalationExecutor({ config, secretKey, pubkey: getPublicKey(secretKey), pool });
  executors.push(ex);
  const up = (url: string, is: boolean) => status.set(normalizeURL(url), is);
  return { ex, subscriptions, up };
}

const tick = () => vi.advanceTimersByTime(RELISTEN_SECONDS * 1000);

afterEach(async () => {
  await Promise.all(executors.splice(0).map((e) => e.stop()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a relay that was down when the executor started", () => {
  it("is tried again, and the executor says it could not reach it", () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ex, subscriptions, up } = harness();
    ex.start();
    up(A, true); // B refused at boot, so the pool dropped it and will never retry it

    tick();

    expect(subscriptions).toHaveLength(2);
    expect(error.mock.calls.flat().join("\n")).toMatch(/b\.relay unreachable/);
    expect(error.mock.calls.flat().join("\n")).not.toMatch(/a\.relay/);
  });

  it("opens the new subscription before closing the old, so a healthy relay is never left bare", () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { ex, subscriptions, up } = harness();
    ex.start();
    up(A, true);

    tick();

    expect(subscriptions[0]?.closed).toBe("relisten");
    expect(subscriptions[1]?.closed).toBeNull();
  });

  it("says so once, not on every retry, and says when it comes back", () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { ex, up } = harness();
    ex.start();
    up(A, true);

    tick();
    tick();
    tick();
    expect(error.mock.calls.filter((c) => String(c[0]).includes("b.relay unreachable"))).toHaveLength(1);

    up(B, true);
    tick();
    expect(log.mock.calls.flat().join("\n")).toMatch(/b\.relay reachable again/);
  });

  it("stops churning once every relay is connected", () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { ex, subscriptions, up } = harness();
    ex.start();
    up(A, true);
    up(B, true);

    tick();
    tick();

    expect(subscriptions).toHaveLength(1);
  });
});

describe("a subscription every relay has closed", () => {
  it("is opened again even though the relays still read as connected", () => {
    // A relay can stay connected and still refuse the REQ -- rate limits, auth. Connection
    // status alone would call that healthy while nothing was listening.
    vi.useFakeTimers();
    const { ex, subscriptions, up } = harness();
    ex.start();
    up(A, true);
    up(B, true);

    subscriptions[0]?.onclose();
    tick();

    expect(subscriptions).toHaveLength(2);
  });

  it("is not mistaken for dead because the executor itself closed the previous one", () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { ex, subscriptions, up } = harness();
    ex.start();
    up(A, true);

    tick(); // B down: re-subscribes, closing #0 on purpose
    subscriptions[0]?.onclose(); // the old one reporting its own close
    up(B, true);
    tick();

    expect(subscriptions).toHaveLength(2);
  });
});

describe("stopping", () => {
  it("stops retrying", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { ex, subscriptions } = harness();
    ex.start();
    await ex.stop();

    tick();
    tick();

    expect(subscriptions).toHaveLength(1);
  });
});
