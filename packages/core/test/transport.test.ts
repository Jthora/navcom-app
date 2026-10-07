/**
 * Transport behaviour, every case found by review of the daemon's CLI.
 *
 * These moved here with the code. They were written against a second implementation of
 * send-and-wait that has since been deleted — the findings are what survived, and they are
 * only meaningful in the package that now owns the behaviour.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { SimplePool } from "nostr-tools/pool";
import type { Event } from "nostr-tools/core";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { sendSignal, sendDistress, waitForResponse, PublishError, type PublishResult } from "../src/transport.js";
import { MISSION_RELAYS, THE_RECORD } from "../src/missions/package.js";
import { watchtowerAt } from "../src/crypto/group.js";
import { seal } from "../src/crypto/envelope.js";
import { KIND_RESPONSE } from "../src/events/kinds.js";
import type { ResponsePayload } from "../src/events/response.js";

const RELAYS = ["wss://relay.example"];

function fakePool(overrides: Partial<SimplePool>): SimplePool {
  return overrides as unknown as SimplePool;
}

describe("sendSignal / sendDistress publish-failure reporting (found in review)", () => {
  // Both used to Promise.allSettled the publish and ignore the results
  // entirely -- if every relay rejected, the function still returned as
  // if the event had gone out, and the caller would sit through a full
  // waitForResponse timeout with a misleading "no response" diagnosis
  // instead of the real "never actually sent" one.

  it("sendSignal throws a clear error when every relay rejects the publish", async () => {
    const secretKey = generateSecretKey();
    const watchtower = watchtowerAt(getPublicKey(generateSecretKey()));
    const pool = fakePool({
      publish: () => [Promise.reject(new Error("connection refused"))],
    });

    await expect(sendSignal(pool, RELAYS, secretKey, watchtower, "routine", {})).rejects.toThrow(
      /Failed to publish to any relay/,
    );
  });

  it("sendSignal succeeds when at least one relay accepts, even if others reject", async () => {
    const secretKey = generateSecretKey();
    const watchtower = watchtowerAt(getPublicKey(generateSecretKey()));
    const pool = fakePool({
      publish: () => [Promise.resolve("ok"), Promise.reject(new Error("timeout"))],
    });

    await expect(
      sendSignal(pool, ["wss://a", "wss://b"], secretKey, watchtower, "routine", {}),
    ).resolves.toBeDefined();
  });

  it("sendDistress throws when every relay rejects", async () => {
    const secretKey = generateSecretKey();
    const watchtower = watchtowerAt(getPublicKey(generateSecretKey()));
    const pool = fakePool({
      publish: () => [Promise.reject(new Error("dns failure"))],
    });

    await expect(sendDistress(pool, RELAYS, secretKey, watchtower, { position: null, area: "north side" })).rejects.toThrow(
      /Failed to publish to any relay/,
    );
  });

  it("the thrown error includes the underlying rejection reasons", async () => {
    const secretKey = generateSecretKey();
    const watchtower = watchtowerAt(getPublicKey(generateSecretKey()));
    const pool = fakePool({
      publish: () => [Promise.reject(new Error("connection refused"))],
    });

    await expect(sendSignal(pool, RELAYS, secretKey, watchtower, "routine", {})).rejects.toThrow(
      /connection refused/,
    );
  });
});

describe("sendSignal / sendDistress payload limits (found in robustness audit)", () => {
  // limits.ts exists because a relay, a fork, or a restored backup can hand a client any
  // payload it likes — but buildSignal/buildDistress, the functions that actually call
  // checkedText, are not on the real send path. The terminal and the CLI both call
  // sendSignal/sendDistress directly, so the cap only ever ran in the tests that exercise
  // the unused builders.

  it("sendDistress refuses text over the cap rather than publishing it unbounded", async () => {
    const secretKey = generateSecretKey();
    const watchtower = watchtowerAt(getPublicKey(generateSecretKey()));
    const pool = fakePool({ publish: () => [Promise.resolve("ok")] });

    await expect(
      sendDistress(pool, RELAYS, secretKey, watchtower, { position: null, area: null, text: "x".repeat(2001) }),
    ).rejects.toThrow(/Keep it to 2000 characters/);
  });

  it("sendSignal refuses an oversized area the same way", async () => {
    const secretKey = generateSecretKey();
    const watchtower = watchtowerAt(getPublicKey(generateSecretKey()));
    const pool = fakePool({ publish: () => [Promise.resolve("ok")] });

    await expect(
      sendSignal(pool, RELAYS, secretKey, watchtower, "query", { text: "shelter?", area: "x".repeat(121) }),
    ).rejects.toThrow(/An area is 120 characters or fewer/);
  });
});

describe("waitForResponse (found in review)", () => {
  it("resolves with the decrypted response payload on a matching event", async () => {
    const clientSecretKey = generateSecretKey();
    const clientPubkey = getPublicKey(clientSecretKey);
    const watchtowerSecretKey = generateSecretKey();
    const watchtowerPubkey = getPublicKey(watchtowerSecretKey);
    const watchtower = watchtowerAt(watchtowerPubkey);

    const responsePayload: ResponsePayload = {
      type: "ack",
      responder: { kind: "agent", callsign: "Mecha Jono" },
      text: null,
      provenance: null,
    };
    const content = seal(watchtowerSecretKey, clientPubkey, responsePayload);

    let capturedOnEvent: ((event: Event) => void) | undefined;
    const pool = fakePool({
      subscribeMany: (_relays, _filter, params) => {
        capturedOnEvent = params.onevent;
        return { close: () => {} };
      },
    });

    const sentEvent = { id: "abc123", created_at: 1000 } as unknown as Parameters<typeof waitForResponse>[5];
    const promise = waitForResponse(pool, RELAYS, clientSecretKey, clientPubkey, watchtower.pubkey, sentEvent, 5000);

    // Simulate the relay delivering a real, validly-signed response event.
    const { finalizeEvent } = await import("nostr-tools/pure");
    const fakeEvent = finalizeEvent(
      { kind: KIND_RESPONSE, tags: [["p", clientPubkey], ["e", "abc123"]], content, created_at: 1001 },
      watchtowerSecretKey,
    );
    capturedOnEvent?.(fakeEvent);

    await expect(promise).resolves.toEqual(responsePayload);
  });

  it("a fast client clock does not cause a real, on-time response to be filtered out (found in robustness audit)", async () => {
    // `since` used to be derived from the client's own possibly-skewed created_at. A relay
    // enforces `since` against real time, so a fast client clock made the relay drop a
    // real, correctly-signed, on-time response before the client's subscription ever saw
    // it -- a false "nobody answered" when somebody did, seconds later. The other tests in
    // this file never exercise real filter enforcement (their mocks call onevent
    // unconditionally); this one does, so a regression here would fail loudly again.
    const clientSecretKey = generateSecretKey();
    const clientPubkey = getPublicKey(clientSecretKey);
    const watchtowerSecretKey = generateSecretKey();
    const watchtowerPubkey = getPublicKey(watchtowerSecretKey);
    const watchtower = watchtowerAt(watchtowerPubkey);

    const responsePayload: ResponsePayload = {
      type: "ack",
      responder: { kind: "agent", callsign: "Mecha Jono" },
      text: null,
      provenance: null,
    };
    const content = seal(watchtowerSecretKey, clientPubkey, responsePayload);

    const trueNow = Math.floor(Date.now() / 1000);
    // This client's clock is 10 minutes fast.
    const sentEvent = {
      id: "abc123",
      created_at: trueNow + 600,
    } as unknown as Parameters<typeof waitForResponse>[5];

    let deliver: ((event: Event) => void) | undefined;
    const pool = fakePool({
      subscribeMany: (_relays, filter, params) => {
        const since = (filter as { since?: number }).since;
        // A relay honestly enforcing its own filter, unlike this file's other mocks.
        deliver = (event: Event) => {
          if (since !== undefined && event.created_at < since) return;
          params.onevent?.(event);
        };
        return { close: () => {} };
      },
    });

    const promise = waitForResponse(pool, RELAYS, clientSecretKey, clientPubkey, watchtower.pubkey, sentEvent, 5000);

    // The real watchtower, with a correct clock, answers two real seconds later -- well
    // before this client's own (skewed) sent.created_at.
    const { finalizeEvent } = await import("nostr-tools/pure");
    const fakeEvent = finalizeEvent(
      { kind: KIND_RESPONSE, tags: [["p", clientPubkey], ["e", "abc123"]], content, created_at: trueNow + 2 },
      watchtowerSecretKey,
    );
    deliver?.(fakeEvent);

    await expect(promise).resolves.toEqual(responsePayload);
  });

  it("rejects with a clear timeout error when nothing arrives", async () => {
    const clientSecretKey = generateSecretKey();
    const clientPubkey = getPublicKey(clientSecretKey);
    const watchtower = watchtowerAt(getPublicKey(generateSecretKey()));

    const pool = fakePool({
      subscribeMany: () => ({ close: () => {} }),
    });
    const sentEvent = { id: "abc", created_at: 1000 } as unknown as Parameters<typeof waitForResponse>[5];

    await expect(
      waitForResponse(pool, RELAYS, clientSecretKey, clientPubkey, watchtower.pubkey, sentEvent, 20),
    ).rejects.toThrow(/No response from Watchtower within/);
  });

  it("does not throw an unhandled error when subscribeMany fails synchronously (timer/closer ordering fix)", async () => {
    // Found in review: `closer` used to be referenced inside the timeout
    // callback before `const closer = pool.subscribeMany(...)` had even
    // run. If subscribeMany threw synchronously, the promise correctly
    // rejected via the throw, but the already-armed setTimeout was never
    // cleared -- it would fire later and reference `closer` before
    // initialization, an unhandled exception in a bare timer callback
    // completely disconnected from the original, already-reported error.
    const clientSecretKey = generateSecretKey();
    const clientPubkey = getPublicKey(clientSecretKey);
    const watchtower = watchtowerAt(getPublicKey(generateSecretKey()));

    const pool = fakePool({
      subscribeMany: () => {
        throw new Error("invalid relay URL");
      },
    });
    const sentEvent = { id: "abc", created_at: 1000 } as unknown as Parameters<typeof waitForResponse>[5];

    vi.useFakeTimers();
    const unhandled = vi.fn();
    process.once("unhandledRejection", unhandled);

    await expect(
      waitForResponse(pool, RELAYS, clientSecretKey, clientPubkey, watchtower.pubkey, sentEvent, 5000),
    ).rejects.toThrow(/invalid relay URL/);

    // Advance past where the leaked timer would have fired, if it still existed.
    await vi.advanceTimersByTimeAsync(6000);
    vi.useRealTimers();

    expect(unhandled).not.toHaveBeenCalled();
  });

  it("ignores an event that fails signature verification", async () => {
    const clientSecretKey = generateSecretKey();
    const clientPubkey = getPublicKey(clientSecretKey);
    const watchtowerSecretKey = generateSecretKey();
    const watchtowerPubkey = getPublicKey(watchtowerSecretKey);
    const watchtower = watchtowerAt(watchtowerPubkey);

    let capturedOnEvent: ((event: Event) => void) | undefined;
    const pool = fakePool({
      subscribeMany: (_relays, _filter, params) => {
        capturedOnEvent = params.onevent;
        return { close: () => {} };
      },
    });
    const sentEvent = { id: "abc", created_at: 1000 } as unknown as Parameters<typeof waitForResponse>[5];

    const promise = waitForResponse(pool, RELAYS, clientSecretKey, clientPubkey, watchtower.pubkey, sentEvent, 20);

    // A structurally-event-shaped object with a bogus signature.
    // Event-shaped with a bogus signature: exactly what a forgery looks like on the wire,
    // so it is cast in deliberately rather than constructed by finalizeEvent.
    capturedOnEvent?.({
      kind: KIND_RESPONSE, tags: [], content: "garbage", created_at: 1001,
      pubkey: watchtowerPubkey, id: "x".repeat(64), sig: "0".repeat(128),
    } as unknown as Event);

    await expect(promise).rejects.toThrow(/No response from Watchtower within/);
  });
});

describe("where a signal went, relay by relay [G3 phase 1]", () => {
  // publishOrThrow threw only when every relay refused, and said nothing at all when any one took
  // it: a caller could not tell "every relay has it" from "one did, and the others refused".

  // A test that fails while the clock is faked must not leave it faked for the next one.
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A pool where each relay says what `answers` gives it, and every publish is recorded. */
  function answering(answers: Record<string, () => Promise<string>>) {
    const published: string[] = [];
    const pool = fakePool({
      publish: ((urls: string[]) => {
        published.push(...urls);
        return urls.map((u) => (answers[u] ?? (() => Promise.resolve("")))());
      }) as unknown as SimplePool["publish"],
    });
    return { pool, published };
  }
  const secretKey = generateSecretKey();
  const watchtower = watchtowerAt(getPublicKey(generateSecretKey()));
  const area = { position: null, area: "north side" };

  it("sendSignal tells its caller what each relay said", async () => {
    const { pool } = answering({
      "wss://a": () => Promise.resolve(""),
      "wss://b": () => Promise.reject(new Error("rate-limited: slow down")),
      "wss://c": () => Promise.reject("connection failure: connection failed"),
    });
    let told: PublishResult | undefined;
    await sendSignal(pool, ["wss://a", "wss://b", "wss://c"], secretKey, watchtower, "routine", {}, (r) => (told = r));
    expect(told).toEqual({
      answers: [
        { url: "wss://a", ok: true, reason: "" },
        // It answered, and said no.
        { url: "wss://b", ok: false, failure: "refused", reason: "rate-limited: slow down" },
        // It was never reached: nostr-tools says so in a string of its own.
        { url: "wss://c", ok: false, failure: "unreached", reason: "connection failure: connection failed" },
      ],
      withheld: [],
    });
  });

  it("sendDistress tells its caller too, and a callback that throws does not unsend it", async () => {
    const { pool } = answering({ "wss://a": () => Promise.resolve("") });
    let told: PublishResult | undefined;
    await expect(
      sendDistress(pool, ["wss://a"], secretKey, watchtower, area, undefined, (r) => {
        told = r;
        throw new Error("the caller's own bug");
      }),
    ).resolves.toBeDefined();
    expect(told?.answers).toEqual([{ url: "wss://a", ok: true, reason: "" }]);
  });

  it("a signal no relay took throws, carrying each relay's answer", async () => {
    const { pool } = answering({
      "wss://a": () => Promise.reject(new Error("blocked: not here")),
      "wss://b": () => Promise.reject(new Error("publish timed out")),
    });
    const thrown = await sendSignal(pool, ["wss://a", "wss://b"], secretKey, watchtower, "routine", {}).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(PublishError);
    expect((thrown as PublishError).result?.answers).toEqual([
      { url: "wss://a", ok: false, failure: "refused", reason: "blocked: not here" },
      // nostr-tools stopped waiting; the relay may still have it, and it did not say no.
      { url: "wss://b", ok: false, failure: "unconfirmed", reason: "publish timed out" },
    ]);
    expect((thrown as PublishError).message).toMatch(/wss:\/\/a: blocked: not here; wss:\/\/b: publish timed out/);
  });

  it("never hands a signal or a Distress to a mission relay, however it is spelled", async () => {
    const { pool, published } = answering({});
    const given = [THE_RECORD, "https://record.cosmiccodex.app/", MISSION_RELAYS[1]!, "wss://a"];
    let told: PublishResult | undefined;
    await sendSignal(pool, given, secretKey, watchtower, "routine", {}, (r) => (told = r));
    await sendDistress(pool, given, secretKey, watchtower, area);
    expect(published).toEqual(["wss://a", "wss://a"]);
    expect(told?.withheld.map((w) => w.url)).toEqual([THE_RECORD, MISSION_RELAYS[1]]);
    expect(told?.withheld.every((w) => /mission relay/.test(w.reason))).toBe(true);
  });

  it("a signal given only mission relays never leaves, and says why", async () => {
    const { pool, published } = answering({});
    const thrown = await sendDistress(pool, [THE_RECORD], secretKey, watchtower, area).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(PublishError);
    expect((thrown as Error).message).toMatch(/Failed to publish to any relay \(0 tried\).*mission relay/);
    expect(published).toEqual([]);
  });

  it("sends to one relay once, however many ways it is spelled", async () => {
    // nostr-tools keys a publish by event id on each connection, so a second spelling's publish
    // took the first's place and the first never settled.
    const { pool, published } = answering({});
    await sendSignal(pool, ["wss://a", "wss://a/", "WSS://A"], secretKey, watchtower, "routine", {});
    expect(published).toEqual(["wss://a"]);
  });

  it("accounts for a relay that never answers, rather than waiting for it for ever", async () => {
    vi.useFakeTimers();
    const { pool } = answering({ "wss://a": () => Promise.resolve(""), "wss://hung": () => new Promise<string>(() => {}) });
    let told: PublishResult | undefined;
    let settled = false;
    void sendSignal(pool, ["wss://a", "wss://hung"], secretKey, watchtower, "routine", {}, (r) => (told = r))
      .catch(() => {})
      .finally(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(10_001);
    expect(settled, "still waiting on a relay that will never answer").toBe(true);
    expect(told?.answers[1]).toEqual({
      url: "wss://hung", ok: false, failure: "unconfirmed", reason: "no answer from the relay in 10s",
    });
  });

  it("tells a relay that said no from one that may have it and one it never reached [review: G3 phase 1]", async () => {
    // What nostr-tools 2.24 rejects with, path by path. A timeout or a dropped connection was
    // accounted as a refusal, of a Distress the relay may have been carrying.
    const closedEarly = Object.assign(new Error(`Tried to send message '["EVENT",{"id":"abc"}] on a closed connection to wss://e/`), {
      name: "SendingOnClosedConnection",
    });
    const { pool } = answering({
      "wss://a": () => Promise.reject(new Error("blocked: no distress here")),
      "wss://b": () => Promise.reject(new Error("")),
      "wss://c": () => Promise.reject(new Error("publish timed out")),
      "wss://d": () => Promise.reject(new Error("relay connection closed")),
      "wss://e": () => Promise.reject(closedEarly),
      "wss://f": () => Promise.reject("connection failure: connection timed out"),
      "wss://g": () => Promise.reject("connection skipped by allowConnectingToRelay"),
      "wss://h": () => Promise.reject(undefined),
    });
    const thrown = await sendDistress(
      pool, ["wss://a", "wss://b", "wss://c", "wss://d", "wss://e", "wss://f", "wss://g", "wss://h"], secretKey, watchtower, area,
    ).catch((e: unknown) => e);
    expect((thrown as PublishError).result?.answers).toEqual([
      { url: "wss://a", ok: false, failure: "refused", reason: "blocked: no distress here" },
      { url: "wss://b", ok: false, failure: "refused", reason: "refused, with no reason given" },
      { url: "wss://c", ok: false, failure: "unconfirmed", reason: "publish timed out" },
      { url: "wss://d", ok: false, failure: "unconfirmed", reason: "relay connection closed" },
      // Its own words quote the event back; only what happened is kept.
      { url: "wss://e", ok: false, failure: "unreached", reason: "the connection closed before it was sent" },
      { url: "wss://f", ok: false, failure: "unreached", reason: "connection failure: connection timed out" },
      { url: "wss://g", ok: false, failure: "unreached", reason: "connection skipped by allowConnectingToRelay" },
      // Nothing says it answered no, or that it was never handed the event.
      { url: "wss://h", ok: false, failure: "unconfirmed", reason: "no answer" },
    ]);
  });

  it("an address the pool throws on, or a pool that sends nothing, is a relay it never reached", async () => {
    const pool = fakePool({
      publish: ((urls: string[]) => {
        if (urls[0] === "wss://throws") throw new Error("Invalid URL");
        if (urls[0] === "wss://nothing") return [];
        return urls.map(() => Promise.resolve(""));
      }) as unknown as SimplePool["publish"],
    });
    let told: PublishResult | undefined;
    await sendSignal(pool, ["wss://throws", "wss://nothing", "wss://ok"], secretKey, watchtower, "routine", {}, (r) => (told = r));
    expect(told?.answers).toEqual([
      { url: "wss://throws", ok: false, failure: "unreached", reason: "Invalid URL" },
      { url: "wss://nothing", ok: false, failure: "unreached", reason: "the pool did not send it" },
      { url: "wss://ok", ok: true, reason: "" },
    ]);
  });

  it("waitForResponse asks no mission relay for an answer", async () => {
    const asked: string[] = [];
    const pool = fakePool({
      subscribeMany: (relays) => {
        asked.push(...relays);
        return { close: () => {} };
      },
    });
    const clientSecretKey = generateSecretKey();
    const sentEvent = { id: "abc", created_at: 1000 } as unknown as Parameters<typeof waitForResponse>[5];
    await waitForResponse(
      pool, [THE_RECORD, "wss://a", MISSION_RELAYS[1]!], clientSecretKey, getPublicKey(clientSecretKey), watchtower.pubkey, sentEvent, 10,
    ).catch(() => {});
    expect(asked).toEqual(["wss://a"]);
  });
});
