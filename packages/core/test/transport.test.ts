/**
 * Transport behaviour, every case found by review of the daemon's CLI.
 *
 * These moved here with the code. They were written against a second implementation of
 * send-and-wait that has since been deleted — the findings are what survived, and they are
 * only meaningful in the package that now owns the behaviour.
 */

import { describe, it, expect, vi } from "vitest";
import type { SimplePool } from "nostr-tools/pool";
import type { Event } from "nostr-tools/core";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { sendSignal, sendDistress, waitForResponse } from "../src/transport.js";
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
