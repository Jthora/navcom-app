/**
 * The shared listener against the real `SimplePool` and a relay on 127.0.0.1.
 *
 * What it gets wrong it gets wrong in nostr-tools' bookkeeping on a real socket, so most of this
 * runs one. The daemon, the executor and the keyless pager all listen through it: a relay it
 * stops hearing is a relay all three stop hearing, and a relay it calls listening is one the
 * pager says it is watching on.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { installNodeWebSocket, nodePool } from "../src/shared/nostr-node.js";
import { RelayListener } from "../src/shared/relay-listener.js";
import { startRelay, eventually, type LocalRelay } from "./helpers/local-relay.js";

const relays: LocalRelay[] = [];
const listeners: RelayListener[] = [];
const pools: SimplePool[] = [];

afterEach(async () => {
  for (const l of listeners.splice(0)) l.stop();
  for (const p of pools.splice(0)) p.destroy();
  await Promise.all(relays.splice(0).map((r) => r.close()));
  vi.restoreAllMocks();
});

const nowS = () => Math.floor(Date.now() / 1000);

function note(at = nowS()) {
  return finalizeEvent({ kind: 1, tags: [], content: "x", created_at: at }, generateSecretKey());
}

function listen(relay: LocalRelay, opts: { pool?: SimplePool; since?: number } = {}) {
  const pool = opts.pool ?? nodePool();
  pools.push(pool);
  const heard: string[] = [];
  const listener = new RelayListener({
    pool,
    urls: [relay.url],
    filter: { kinds: [1] },
    ...(opts.since !== undefined ? { since: opts.since } : {}),
    label: "test",
    missing: "nothing sent there is heard",
    onevent: (event) => heard.push(event.id),
  });
  listeners.push(listener);
  listener.start();
  return { listener, heard };
}

function quiet() {
  return {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
  };
}

const said = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => String(c[0])).join("\n");

describe("a relay that sends CLOSED with a reason that is not a string", () => {
  /*
   * nostr-tools' pool wraps every subscription's `onclose` in `reason.startsWith(...)`. A `null`
   * reason -- or `{}`, which is what a JS relay serialising an Error sends -- throws there, the
   * relay swallows the TypeError as a warning, and the listener's own `onclose` never runs. The
   * subscription was gone and the listener still counted the relay as listening, until restart.
   */
  for (const [name, reason] of [["null", null], ["an object", {}]] as const) {
    it(`is subscribed again when the reason is ${name}`, async () => {
      quiet();
      const relay = await startRelay();
      relays.push(relay);
      const { listener, heard } = listen(relay);
      await eventually(() => expect(listener.listening()).toBe(1));

      relay.closeSubs(reason);
      await eventually(() => expect(relay.reqs.length, "never subscribed again").toBe(2), 6_000);
      await eventually(() => expect(relay.openSubs()).toBe(1));

      const e = note();
      relay.deliver(e);
      await eventually(() => expect(heard).toContain(e.id));
    }, 15_000);
  }
});

describe("a relay that takes the subscription and never answers it", () => {
  /*
   * nostr-tools fires `oneose` by itself 4.4 seconds after a REQ that had no EOSE, and the
   * listener could not tell that from a relay answering. A hung relay was logged `listening`,
   * and the keyless pager printed `watching on 1/1` while nothing sent there would be heard.
   */
  it("is not counted as listening, and says once that it has not answered", async () => {
    const { log, error } = quiet();
    const relay = await startRelay();
    relays.push(relay);
    relay.answerReqs = false;
    const { listener, heard } = listen(relay);

    await eventually(() => expect(relay.reqs.length).toBe(1));
    // Past nostr-tools' 4.4-second stand-in for an EOSE, and past the listener's own wait.
    await new Promise((r) => setTimeout(r, 11_000));
    expect(listener.listening(), "a relay that never answered was counted").toBe(0);
    expect(said(log)).not.toMatch(/listening/);
    const silent = error.mock.calls.map((c) => String(c[0])).filter((l) => /has not answered/.test(l));
    expect(silent).toHaveLength(1);
    expect(silent[0]).toContain(relay.url);

    // An event on the subscription is an answer, EOSE or not.
    const e = note();
    relay.deliver(e);
    await eventually(() => expect(heard).toContain(e.id));
    expect(listener.listening()).toBe(1);
    // Its first answer, so "listening": it was never reachable to be reachable again [#26].
    expect(said(log)).toMatch(/listening/);
    expect(said(log)).not.toMatch(/reachable again/);
  }, 20_000);

  it("is counted as listening once it does send EOSE", async () => {
    const { log } = quiet();
    const relay = await startRelay();
    relays.push(relay);
    const { listener } = listen(relay);
    await eventually(() => expect(listener.listening()).toBe(1), 3_000);
    expect(said(log)).toMatch(/listening/);
  });
});

describe("a pool that reconnects by itself, handed to the listener [F04]", () => {
  /*
   * `nodePool()` turns nostr-tools' reconnect off, and that is one defence. The listener's own
   * `since`, which discards nostr-tools' rewrite, is the other, and it is the only one that holds
   * for a pool built some other way. This hands it a pool that reconnects, so only the listener
   * stands between one future-dated frame and a relay that delivers nothing ever again.
   */
  it("keeps the original since across nostr-tools' reconnect", async () => {
    quiet();
    installNodeWebSocket();
    const pool = new SimplePool({ enableReconnect: true });
    const relay = await startRelay();
    relays.push(relay);
    const floor = nowS() - 60;
    const { listener } = listen(relay, { pool, since: floor });
    await eventually(() => expect(listener.listening()).toBe(1));

    relay.push(note(nowS() + 3_600));
    await new Promise((r) => setTimeout(r, 200));
    relay.dropAll();

    // nostr-tools' first reconnect waits ten seconds.
    await eventually(() => expect(relay.reqs.length).toBe(2), 15_000);
    expect(relay.reqs[1]!.filters[0]!.since, "since was rewritten by the reconnect").toBe(floor);
  }, 20_000);
});

describe("what the log says about a relay that went [#26]", () => {
  it("says a relay that is up and closes the subscription closed it, rather than that it is unreachable", async () => {
    // "unreachable" sent the Stationkeeper after a network that was fine, while the relay was up and
    // turning the box away with a reason that had no NIP-01 prefix.
    const { error } = quiet();
    const relay = await startRelay();
    relays.push(relay);
    const { listener } = listen(relay);
    await eventually(() => expect(listener.listening()).toBe(1), 3_000);

    relay.closeSubs("subscription limit exceeded, try again later");
    await eventually(() => expect(said(error)).toMatch(/closed the subscription \(subscription limit exceeded, try again later\) while connected/));
    expect(said(error)).not.toMatch(/unreachable/);
  });

  it("says no reason was given when the relay gave none, rather than blaming this side", async () => {
    // A CLOSED with no reason reaches nostr-tools' default, "closed by caller", which read as though
    // this process had closed it.
    const { error } = quiet();
    const relay = await startRelay();
    relays.push(relay);
    const { listener } = listen(relay);
    await eventually(() => expect(listener.listening()).toBe(1), 3_000);

    relay.closeSubs(undefined);
    await eventually(() => expect(said(error)).toMatch(/closed the subscription \(no reason given\) while connected/));
    expect(said(error)).not.toMatch(/closed by caller|unreachable/);
  });

  it("keeps 'unreachable' for a connection that went", async () => {
    const { error } = quiet();
    const relay = await startRelay();
    relays.push(relay);
    const { listener } = listen(relay);
    await eventually(() => expect(listener.listening()).toBe(1), 3_000);

    relay.dropAll();
    await eventually(() => expect(said(error)).toMatch(/unreachable \(relay connection closed\)/));
    expect(said(error)).not.toMatch(/closed the subscription/);
  });
});
