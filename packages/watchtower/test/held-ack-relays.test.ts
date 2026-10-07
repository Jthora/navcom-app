/**
 * The held acknowledgement, heard by the phone's own retry loop.
 *
 * The hold exists for a phone that missed the acknowledgement and keeps sending (decided
 * 2026-10-07). Whether it works is not whether the executor publishes the right thing; it is
 * whether core's `sendDistressUntilAcknowledged` hears it. That loop only listens for answers to
 * ids it has recorded, and it records an attempt only after the publish has settled on every
 * relay -- up to 4.4 seconds when one of them is slow to say OK. A re-sent acknowledgement naming
 * only the new attempt arrives in that gap and is thrown away, on every attempt, for the whole
 * hold [review: D2]. Before the hold, the new attempt re-paged the roster and the human's second
 * answer came at human speed, after the gap.
 *
 * So these run the real loop from `@navcom/core`, on a real `SimplePool`, against relays on
 * 127.0.0.1: one that answers, and one that takes everything and answers nothing.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { Event } from "nostr-tools/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sendDistressUntilAcknowledged, watchtowerAt, type ResponsePayload } from "@navcom/core";
import { EscalationExecutor } from "../src/escalation/executor.js";
import type { EscalationConfig } from "../src/escalation/config.js";
import type { pageAll } from "../src/escalation/pager.js";
import { nodePool } from "../src/shared/nostr-node.js";
import { sealSignal } from "../src/shared/crypto.js";
import { KIND_DISTRESS, KIND_SIGNAL } from "../src/shared/kinds.js";
import { startRelay, eventually, type LocalRelay } from "./helpers/local-relay.js";

const STANDING = 4_102_444_800;
const nowS = () => Math.floor(Date.now() / 1000);

const dirs: string[] = [];
const relays: LocalRelay[] = [];
const executors: EscalationExecutor[] = [];
const pools: SimplePool[] = [];
const aborts: AbortController[] = [];

afterEach(async () => {
  for (const a of aborts.splice(0)) a.abort();
  await Promise.all(executors.splice(0).map((e) => e.stop()));
  for (const p of pools.splice(0)) p.destroy();
  await Promise.all(relays.splice(0).map((r) => r.close()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function config(url: string, wren: string): EscalationConfig {
  const dir = mkdtempSync(join(tmpdir(), "navcom-held-"));
  dirs.push(dir);
  return {
    identity: { privkeyPath: "/dev/null" },
    relays: { urls: [url] },
    escalation: {
      pagingWindowSeconds: 300, contactWindowSeconds: 300, drillWindowDays: 7,
      drillAckWindowSeconds: 600, drillStatePath: join(dir, "drill.json"),
      maxPagesPerWindow: 20, pageBudgetWindowSeconds: 3_600, ladderRetentionSeconds: 3_600,
      ackHoldsSeconds: 1_800,
      oncall: [
        {
          declaration: { author: { kind: "node", callsign: "Wren", pubkey: wren }, channel: "sms", expires: STANDING },
          command: ["true"],
        },
      ],
    },
    log: { path: join(dir, "escalation-log.jsonl"), retentionDays: 90 },
  };
}

function ackFrom(responder: Uint8Array, watchtower: string, distressId: string): Event {
  return finalizeEvent(
    {
      kind: KIND_SIGNAL,
      tags: [["p", watchtower], ["t", "distress-ack"]],
      content: sealSignal(responder, [watchtower], { distress_id: distressId }),
      created_at: nowS(),
    },
    responder,
  );
}

/**
 * A watch on relay `fast`, whose one on-call person answers every page a moment after it lands
 * -- straight onto the relay, as her phone would.
 */
async function watch() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const fast = await startRelay();
  const hung = await startRelay();
  hung.hang = true;
  relays.push(fast, hung);

  const wren = generateSecretKey();
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  const page = vi.fn<typeof pageAll>(async (_roster, _message, _url, distressId) => {
    setTimeout(() => fast.deliver(ackFrom(wren, pubkey, distressId!)), 300);
    return [{ callsign: "Wren", channel: "sms", dispatched: true }];
  });
  const executor = new EscalationExecutor({ config: config(fast.url, getPublicKey(wren)), secretKey, pubkey, page });
  executors.push(executor);
  executor.start();
  await eventually(() => expect(fast.openSubs()).toBe(1));
  return { fast, hung, executor, pubkey, page };
}

/** The phone's own loop, on both relays. Resolves with the answer, or null at the deadline. */
async function phone(operator: Uint8Array, relaysFor: string[], watchtower: string, deadlineMs: number) {
  const pool = nodePool();
  pools.push(pool);
  const abort = new AbortController();
  aborts.push(abort);
  let attempts = 0;
  const loop = sendDistressUntilAcknowledged(
    pool,
    relaysFor,
    operator,
    getPublicKey(operator),
    watchtowerAt(watchtower),
    { position: null, area: "north side" },
    {
      ackWindowMs: 2_000,
      backoffMs: 500,
      maxBackoffMs: 500,
      signal: abort.signal,
      onPhase: (p) => {
        if (p.phase === "sending") attempts++;
      },
    },
  ).catch(() => null);
  const deadline = new Promise<null>((r) => setTimeout(() => r(null), deadlineMs));
  const answer: ResponsePayload | null = await Promise.race([loop, deadline]);
  abort.abort();
  return { answer, attempts: () => attempts };
}

describe("a phone that missed the acknowledgement, with one relay slow to say OK [D2]", () => {
  it("hears the acknowledgement re-sent to its next attempt, and nobody is paged again", async () => {
    const { fast, hung, pubkey, page } = await watch();
    const operator = generateSecretKey();

    // Attempt one reaches the watch at once and Wren answers in 300ms, while the phone is still
    // waiting 4.4s on the hung relay's OK: it has not recorded the attempt, so it throws her
    // answer away. Every later attempt is answered from the hold.
    const { answer, attempts } = await phone(operator, [fast.url, hung.url], pubkey, 25_000);

    expect(answer, `not acknowledged after ${attempts()} attempts`).not.toBeNull();
    expect(answer!.responder.kind).toBe("human");
    expect(answer!.responder.callsign).toBe("Wren");
    expect(page, "the roster was woken again for a Distress Wren already has").toHaveBeenCalledTimes(1);
  }, 40_000);
});

describe("a phone that started its Distress again after the acknowledgement [D2]", () => {
  it("hears it, though it has recorded none of the ids the watch acknowledged", async () => {
    const { fast, hung, executor, pubkey, page } = await watch();
    const operator = generateSecretKey();

    // The first Distress, acknowledged, from a loop that is gone -- the app was restarted.
    const first = finalizeEvent(
      {
        kind: KIND_DISTRESS,
        tags: [["p", pubkey]],
        content: sealSignal(operator, [pubkey], { position: null, area: "north side" }),
        created_at: nowS(),
      },
      operator,
    );
    fast.deliver(first);
    await eventually(() => expect(executor.ladders.get(first.id)?.state).toBe("acknowledged"));

    // A new loop knows only its own ids, and records each 4.4s after the watch has answered it.
    const { answer, attempts } = await phone(operator, [fast.url, hung.url], pubkey, 25_000);

    expect(answer, `not acknowledged after ${attempts()} attempts`).not.toBeNull();
    expect(answer!.responder.callsign).toBe("Wren");
    expect(page).toHaveBeenCalledTimes(1);
  }, 40_000);
});
