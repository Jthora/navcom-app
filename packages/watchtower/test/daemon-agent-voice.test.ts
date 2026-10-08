/**
 * The daemon answers as an agent, and can no longer close a Distress (decided 2026-10-07, G3).
 *
 * On a box whose watch names the executor's own key, a phone ends a Distress only on an answer that
 * key signed, and the daemon never holds it. On a box that names none, a phone still ends on a
 * person's answer the watch key signed -- and the daemon holds the watch key, beside the agent. So
 * nothing the daemon publishes may say a person answered, or speak for the ladder, whatever the agent
 * seam hands back. And the two signals the executor acts on are the executor's: the daemon names them
 * as such and answers neither.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { Event } from "nostr-tools/core";
import { asAgent, WatchtowerDaemon } from "../src/daemon/watchtower.js";
import type { DaemonConfig } from "../src/daemon/config.js";
import * as query from "../src/daemon/query.js";
import { openResponse, sealSignal } from "../src/shared/crypto.js";
import { KIND_RESPONSE, KIND_SIGNAL } from "../src/shared/kinds.js";
import type { ResponsePayload } from "../src/shared/payloads.js";

const daemons: WatchtowerDaemon[] = [];
afterEach(async () => {
  await Promise.all(daemons.splice(0).map((d) => d.stop()));
  vi.restoreAllMocks();
});

function daemon() {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  const published: Event[] = [];
  let onEvent: ((e: Event) => void) | undefined;
  const pool = {
    publish: (relays: string[], event: Event) => {
      published.push(event);
      return relays.map(() => Promise.resolve("ok"));
    },
    subscribeMany: (_r: string[], _f: unknown, params: { onevent: (e: Event) => void; oneose?: () => void }) => {
      onEvent = params.onevent;
      queueMicrotask(() => params.oneose?.());
      return { close: () => {} };
    },
    destroy: () => {},
  } as unknown as SimplePool;
  const config: DaemonConfig = {
    identity: { privkeyPath: "/dev/null" },
    relays: { urls: ["wss://fake.relay"] },
    watch: {
      routineIntervalDefault: 3600, overdueGrace: 1800, hardExpiry: 14400,
      heartbeatIntervalSeconds: 3600, sweepIntervalSeconds: 3600, queryTimeoutSeconds: 8, maxEventAgeSeconds: 300,
    },
    authorization: { allowedPubkeys: [] },
    log: { path: "/dev/null", retentionDays: 90, drillStatePath: "/dev/null/nope", escalationLogPath: null },
  };
  const d = new WatchtowerDaemon({ config, secretKey, pubkey, pool });
  daemons.push(d);
  return { d, pubkey, published, deliver: (e: Event) => onEvent?.(e) };
}

const signal = (from: Uint8Array, watch: string, type: string, payload: unknown) =>
  finalizeEvent(
    {
      kind: KIND_SIGNAL,
      tags: [["p", watch], ["t", type]],
      content: sealSignal(from, [watch], payload),
      created_at: Math.floor(Date.now() / 1000),
    },
    from,
  );

describe("everything the daemon sends goes out as the agent", () => {
  it("strips anything only a person or the executor may say", () => {
    const forged: ResponsePayload = {
      type: "ack",
      responder: { kind: "human", callsign: "Wren", pubkey: "a".repeat(64) },
      text: "Wren is responding.",
      provenance: null,
      ladder: "acknowledged",
      sig: "b".repeat(128),
      copy_of: "c".repeat(64),
    };
    expect(asAgent(forged, "watchtower")).toEqual({
      type: "ack",
      responder: { kind: "agent", callsign: "watchtower" },
      text: "Wren is responding.",
      provenance: null,
    });
  });

  it("publishes an agent seam's 'a person has it' as the agent's words, never a person's", async () => {
    // The seam session two replaces with a real agent. A hostile or confused one returning a human
    // responder, a ladder state and a person's callsign is exactly what this must survive.
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(query, "answerQuery").mockResolvedValue({
      type: "answer",
      responder: { kind: "human", callsign: "Wren" },
      text: "Wren has you. Stop sending.",
      provenance: null,
      ladder: "acknowledged",
    });
    const { d, pubkey, published, deliver } = daemon();
    await d.start();
    const operator = generateSecretKey();
    const ask = signal(operator, pubkey, "query", { text: "anyone there?" });
    deliver(ask);
    await vi.waitFor(() => expect(published.some((e) => e.kind === KIND_RESPONSE)).toBe(true));
    const reply = published.find((e) => e.kind === KIND_RESPONSE && e.tags.some((t) => t[1] === ask.id))!;
    const said = openResponse<ResponsePayload>(operator, pubkey, reply.content);
    expect(said.responder, "the daemon published a person's answer").toEqual({ kind: "agent", callsign: "watchtower" });
    expect(said.ladder, "the daemon spoke for the ladder").toBeUndefined();
  });
});

describe("the executor's two signals", () => {
  it.each(["distress-ack", "wake-others"])("names %s as the executor's, and answers nothing", async (type) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { d, pubkey, published, deliver } = daemon();
    await d.start();
    const before = published.length;
    deliver(signal(generateSecretKey(), pubkey, type, { distress_id: "f".repeat(64) }));
    await vi.waitFor(() =>
      expect(log.mock.calls.flat().join("\n")).toMatch(new RegExp(`\\[signal\\] ${type} from \\w+ is the escalation executor's -- not answered here`)),
    );
    expect(published.slice(before).filter((e) => e.kind === KIND_RESPONSE)).toEqual([]);
  });
});
