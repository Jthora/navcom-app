/**
 * The daemon's relay paths: what it hears, what it says it published, and what it acts on twice.
 *
 * The first half runs the real `SimplePool` against a relay on 127.0.0.1, because the defects
 * there [F04, F05] are in what nostr-tools does on a real socket and a fake pool only models
 * what somebody believed about that. The second half [F12, F13] is about the daemon's own
 * bookkeeping and uses a fake pool that answers per relay.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { Event } from "nostr-tools/core";
import { WatchtowerDaemon } from "../src/daemon/watchtower.js";
import type { DaemonConfig } from "../src/daemon/config.js";
import { sealSignal } from "../src/shared/crypto.js";
import { KIND_SIGNAL, KIND_DISTRESS, KIND_RESPONSE } from "../src/shared/kinds.js";
import { startRelay, freePort, eventually, type LocalRelay } from "./helpers/local-relay.js";

const nowS = () => Math.floor(Date.now() / 1000);

function config(urls: string[], over: Partial<DaemonConfig["watch"]> = {}): DaemonConfig {
  return {
    identity: { privkeyPath: "/dev/null" },
    relays: { urls },
    watch: {
      routineIntervalDefault: 3600,
      overdueGrace: 1800,
      hardExpiry: 14400,
      // Long, so neither fires mid-test and nothing but the listener can reconnect a relay.
      heartbeatIntervalSeconds: 3600,
      sweepIntervalSeconds: 3600,
      queryTimeoutSeconds: 8,
      maxEventAgeSeconds: 300,
      ...over,
    },
    authorization: { allowedPubkeys: [] },
    log: { path: "/dev/null", retentionDays: 90, drillStatePath: "/dev/null/nope", escalationLogPath: null },
  };
}

function signal(operator: Uint8Array, watchtower: string, type: string, payload: unknown, at = nowS()): Event {
  return finalizeEvent(
    {
      kind: KIND_SIGNAL,
      tags: [["p", watchtower], ["t", type]],
      content: sealSignal(operator, [watchtower], payload),
      created_at: at,
    },
    operator,
  );
}

function distress(operator: Uint8Array, watchtower: string, at = nowS()): Event {
  return finalizeEvent(
    { kind: KIND_DISTRESS, tags: [["p", watchtower]], content: sealSignal(operator, [watchtower], { text: null }), created_at: at },
    operator,
  );
}

const answered = (published: Event[], id: string) =>
  published.some((e) => e.kind === KIND_RESPONSE && e.tags.some((t) => t[0] === "e" && t[1] === id));

const daemons: WatchtowerDaemon[] = [];
const relays: LocalRelay[] = [];

afterEach(async () => {
  await Promise.all(daemons.splice(0).map((d) => d.stop()));
  await Promise.all(relays.splice(0).map((r) => r.close()));
  vi.restoreAllMocks();
});

function daemonOn(urls: string[], over: Partial<DaemonConfig["watch"]> = {}) {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  const daemon = new WatchtowerDaemon({ config: config(urls, over), secretKey, pubkey });
  daemons.push(daemon);
  return { daemon, pubkey };
}

describe("a relay that was down when the daemon started [F05]", () => {
  it("is subscribed once it answers, and a signal sent only there is heard", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const port = await freePort();
    const { daemon, pubkey } = daemonOn([`ws://127.0.0.1:${port}`]);
    await daemon.start();

    // The power-cut case: the box is up before the network is.
    const relay = await startRelay({ port });
    relays.push(relay);
    await eventually(() => expect(relay.openSubs(), "never subscribed to the relay that came back").toBe(1), 10_000);

    const routine = signal(generateSecretKey(), pubkey, "routine", {});
    relay.deliver(routine);
    await eventually(() => expect(answered(relay.published, routine.id)).toBe(true));
  }, 20_000);

  it("says it could not reach it, once, naming what is lost", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const port = await freePort();
    const { daemon } = daemonOn([`ws://127.0.0.1:${port}`]);
    await daemon.start();

    // Long enough for several retries.
    await new Promise((r) => setTimeout(r, 4_000));
    const lines = error.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[relay]"));
    expect(lines.filter((l) => l.includes("unreachable"))).toHaveLength(1);
    expect(lines[0]).toMatch(/signals sent only there are not heard/);
  }, 10_000);
});

describe("a relay that sent something stamped in the future, then dropped [F04]", () => {
  it("does not push the subscription's since past the present, and the next signal is answered", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const relay = await startRelay();
    relays.push(relay);
    const { daemon, pubkey } = daemonOn([relay.url]);
    await daemon.start();
    await eventually(() => expect(relay.openSubs()).toBe(1));

    // Anybody can address the watch. An hour ahead, and it does not even need to be valid.
    relay.push(
      finalizeEvent(
        { kind: KIND_SIGNAL, tags: [["p", pubkey], ["t", "routine"]], content: "x", created_at: nowS() + 3600 },
        generateSecretKey(),
      ),
    );
    await new Promise((r) => setTimeout(r, 200));
    const before = relay.reqs.length;
    relay.dropAll();

    await eventually(() => expect(relay.reqs.length).toBeGreaterThan(before), 15_000);
    const since = relay.reqs.at(-1)?.filters[0]?.since;
    expect(since === undefined || since <= nowS(), `since was rewritten to ${since}`).toBe(true);

    const routine = signal(generateSecretKey(), pubkey, "routine", {});
    relay.deliver(routine);
    await eventually(() => expect(answered(relay.published, routine.id)).toBe(true));
  }, 30_000);
});

/** One fake relay set where each relay accepts or refuses on its own, as real ones do. */
function perRelayPool(urls: string[]) {
  const published: Event[] = [];
  const refusing = new Map<string, string | null>(urls.map((u) => [u, null]));
  const onevents: ((e: Event) => void)[] = [];
  const pool = {
    publish: (relayUrls: string[], event: Event) => {
      published.push(event);
      return relayUrls.map((u) => {
        const reason = refusing.get(u) ?? null;
        return reason ? Promise.reject(new Error(reason)) : Promise.resolve("ok");
      });
    },
    subscribeMany: (_r: string[], _f: unknown, params: { onevent: (e: Event) => void }) => {
      onevents.push(params.onevent);
      return { close: () => {} };
    },
    destroy: () => {},
  } as unknown as SimplePool;
  // Delivered on the first relay's subscription only. Delivery is the relay's business; what is
  // under test is what the daemon does once it has an event.
  const deliver = (e: Event) => onevents[0]?.(e);
  return { pool, published, refusing, deliver };
}

function fakeDaemon(urls: string[], over: Partial<DaemonConfig["watch"]> = {}) {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  const fake = perRelayPool(urls);
  const daemon = new WatchtowerDaemon({ config: config(urls, over), secretKey, pubkey, pool: fake.pool });
  daemons.push(daemon);
  return { daemon, pubkey, ...fake };
}

describe("a Distress a relay serves again [F12]", () => {
  it("is not acted on when it is stamped outside the window", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { daemon, pubkey, published, deliver } = fakeDaemon(["wss://a.relay"]);
    await daemon.start();

    const captured = distress(generateSecretKey(), pubkey, nowS() - 301);
    deliver(captured);
    await new Promise((r) => setTimeout(r, 100));

    expect(answered(published, captured.id), "a captured Distress was acknowledged again").toBe(false);
    expect(daemon.board.size).toBe(0);
    expect([...log.mock.calls, ...vi.mocked(console.warn).mock.calls].flat().join("\n")).toMatch(/outside/);
  });

  it("is not acted on when it is stamped far ahead, either -- and the edge of the window is kept", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // The clock is held still. Stamped one second past the window on a running clock, a second
    // boundary passing while the event was built and verified made it read as 300 and be answered:
    // the test failed about once in thirty runs, against code that was right.
    const frozen = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(frozen);
    const at = Math.floor(frozen / 1000);
    const { daemon, pubkey, published, deliver } = fakeDaemon(["wss://a.relay"]);
    await daemon.start();

    const ahead = distress(generateSecretKey(), pubkey, at + 301);
    deliver(ahead);
    await new Promise((r) => setTimeout(r, 100));
    expect(answered(published, ahead.id)).toBe(false);

    const edge = distress(generateSecretKey(), pubkey, at + 300);
    deliver(edge);
    await eventually(() => expect(answered(published, edge.id), "the last second of the window was dropped").toBe(true));
  });

  it("is answered once when the same event arrives twice", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { daemon, pubkey, published, deliver } = fakeDaemon(["wss://a.relay"]);
    await daemon.start();

    const d = distress(generateSecretKey(), pubkey);
    deliver(d);
    await eventually(() => expect(answered(published, d.id)).toBe(true));
    deliver(d);
    await new Promise((r) => setTimeout(r, 100));

    const responses = published.filter(
      (e) => e.kind === KIND_RESPONSE && e.tags.some((t) => t[0] === "e" && t[1] === d.id),
    );
    expect(responses, "the same Distress was acted on twice").toHaveLength(1);
  });

  it("still answers one stamped inside the window", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { daemon, pubkey, published, deliver } = fakeDaemon(["wss://a.relay"]);
    await daemon.start();

    const slightlySlow = distress(generateSecretKey(), pubkey, nowS() - 120);
    deliver(slightlySlow);
    await eventually(() => expect(answered(published, slightlySlow.id)).toBe(true));
  });
});

describe("a heartbeat a relay refused [F13]", () => {
  it("says how many relays took the watch state", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { daemon, refusing } = fakeDaemon(["wss://a.relay", "wss://b.relay"]);
    refusing.set("wss://b.relay", "blocked: not on the list");

    expect(await daemon.start()).toBe(1);
  });

  it("names the relay and its reason, once per change rather than once per beat", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { daemon, refusing } = fakeDaemon(["wss://a.relay", "wss://b.relay"], { heartbeatIntervalSeconds: 60 });
      refusing.set("wss://b.relay", "blocked: not on the list");
      await daemon.start();
      await vi.advanceTimersByTimeAsync(60_000 * 3);

      const refusals = error.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("refused watch state"));
      expect(refusals).toHaveLength(1);
      expect(refusals[0]).toMatch(/b\.relay refused watch state: blocked: not on the list/);

      refusing.set("wss://b.relay", null);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(log.mock.calls.flat().join("\n")).toMatch(/b\.relay accepting watch state again/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is loud every time no relay at all accepted, because operators read Dark", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { daemon, refusing } = fakeDaemon(["wss://a.relay"], { heartbeatIntervalSeconds: 60 });
      refusing.set("wss://a.relay", "rate-limited: slow down");
      expect(await daemon.start()).toBe(0);
      await vi.advanceTimersByTimeAsync(60_000 * 2);

      const none = error.mock.calls.map((c) => String(c[0])).filter((l) => /operators read Dark/.test(l));
      expect(none).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
