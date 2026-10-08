/**
 * An executor on a fake pool, and phones' signals built the way a phone builds them -- for the tests
 * of the executor's own key, the re-page limits, the page kind and `wake-others`.
 *
 * Signals go through core's `buildSignal`, so an acknowledgement is sealed to exactly the readers a
 * phone seals it to: the holders, and the executor's own key where the address names one.
 */
import { vi } from "vitest";
import type { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { Event } from "nostr-tools/core";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSignal, watchtowerAt, type ResponsePayload, type SignalType, type WatchtowerAddress } from "@navcom/core";
import { EscalationExecutor } from "../../src/escalation/executor.js";
import type { EscalationConfig, OnCallEntry } from "../../src/escalation/config.js";
import type { pageAll } from "../../src/escalation/pager.js";
import { openResponse, sealSignal } from "../../src/shared/crypto.js";
import { KIND_DISTRESS, KIND_RESPONSE } from "../../src/shared/kinds.js";

export const STANDING = 4_102_444_800;
export const nowS = () => Math.floor(Date.now() / 1000);

const dirs: string[] = [];
const executors: EscalationExecutor[] = [];

export async function cleanup(): Promise<void> {
  await Promise.all(executors.splice(0).map((e) => e.stop()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
  vi.restoreAllMocks();
}

/** Quiet output, where a test reads none of it. Returns the spies, for a test that does. */
export function quiet() {
  return {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
}

export function onCallEntry(callsign: string, pubkey?: string, channel: OnCallEntry["declaration"]["channel"] = "sms"): OnCallEntry {
  return {
    declaration: { author: { kind: "node", callsign, ...(pubkey ? { pubkey } : {}) }, channel, expires: STANDING },
    command: ["true"],
  };
}

export function fakeConfig(oncall: OnCallEntry[] = [], over: Partial<EscalationConfig["escalation"]> = {}): EscalationConfig {
  const dir = mkdtempSync(join(tmpdir(), "navcom-executor-"));
  dirs.push(dir);
  return {
    identity: { privkeyPath: "/dev/null" },
    relays: { urls: ["wss://fake.relay"] },
    escalation: {
      pagingWindowSeconds: 300, contactWindowSeconds: 300,
      drillWindowDays: 7, drillAckWindowSeconds: 1, drillStatePath: join(dir, "drill.json"),
      maxPagesPerWindow: 20, pageBudgetWindowSeconds: 3_600, ladderRetentionSeconds: 3_600,
      ackHoldsSeconds: 1_800,
      oncall,
      ...over,
    },
    log: { path: join(dir, "escalation-log.jsonl"), retentionDays: 90 },
  };
}

export function fakePool() {
  const published: Event[] = [];
  /** Every relay refuses an event this returns true for -- a write policy, a rate limit. */
  const relay = { refuses: (_e: Event): boolean => false };
  let onEvent: ((e: Event) => void) | undefined;
  const pool = {
    publish: (_relays: string[], event: Event) => {
      published.push(event);
      return [relay.refuses(event) ? Promise.reject(new Error("blocked: not today")) : Promise.resolve("ok")];
    },
    subscribeMany: (_r: string[], _f: unknown, params: { onevent: (e: Event) => void }) => {
      onEvent = params.onevent;
      return { close: () => {} };
    },
    destroy: () => {},
  } as unknown as SimplePool;
  return { pool, published, relay, deliver: (e: Event) => onEvent?.(e) };
}

/** A pager whose commands exit zero, as `pageAll` reports them; `fails` names callsigns whose exit non-zero. */
export const workingPager = (fails: string[] = []) =>
  vi.fn<typeof pageAll>(async (roster) =>
    roster
      .filter((e) => e.declaration.channel !== "console-open")
      .map((e) => {
        const callsign = e.declaration.author.callsign ?? "unnamed";
        return fails.includes(callsign)
          ? { callsign, channel: e.declaration.channel, dispatched: false, error: "exit 1" }
          : { callsign, channel: e.declaration.channel, dispatched: true };
      }),
  );

export interface BoxOptions {
  oncall?: OnCallEntry[];
  page?: ReturnType<typeof workingPager>;
  over?: Partial<EscalationConfig["escalation"]>;
  /** Give the executor a key of its own. */
  ownKey?: boolean;
  /** The watch key, where a test must know it before the roster is written. */
  watchSecret?: Uint8Array;
}

export function build(opts: BoxOptions = {}) {
  const watchSecret = opts.watchSecret ?? generateSecretKey();
  const pubkey = getPublicKey(watchSecret);
  const executorSecret = generateSecretKey();
  const executorPubkey = getPublicKey(executorSecret);
  const { pool, published, relay, deliver } = fakePool();
  const config = fakeConfig(opts.oncall ?? [], opts.over);
  const page = opts.page ?? workingPager();
  const executor = new EscalationExecutor({
    config,
    secretKey: watchSecret,
    pubkey,
    pool,
    page,
    ...(opts.ownKey ? { executorKey: { secretKey: executorSecret, pubkey: executorPubkey } } : {}),
  });
  executors.push(executor);
  executor.start();
  /** The address a phone holds: naming the executor's key only where the box has one. */
  const address: WatchtowerAddress = watchtowerAt(pubkey, undefined, undefined, opts.ownKey ? executorPubkey : null);
  return { executor, pubkey, watchSecret, executorPubkey, executorSecret, address, published, relay, deliver, page, logPath: config.log.path };
}

export type Box = ReturnType<typeof build>;

export function distressFrom(operator: Uint8Array, watchtower: string): Event {
  return finalizeEvent(
    {
      kind: KIND_DISTRESS,
      tags: [["p", watchtower]],
      content: sealSignal(operator, [watchtower], { position: null, area: "north side" }),
      created_at: nowS(),
    },
    operator,
  );
}

/** A signal as a phone holding `address` builds one -- sealed to the executor too, where it names one. */
export function signalFrom(sender: Uint8Array, address: WatchtowerAddress, type: SignalType, payload: { distress_id: string }): Event {
  return finalizeEvent(buildSignal(sender, address, type, payload, nowS()), sender);
}

/** Every 20912 published so far that names this id. */
export const answering = (published: Event[], id: string) =>
  published.filter((e) => e.kind === KIND_RESPONSE && e.tags.some((t) => t[0] === "e" && t[1] === id));

/** What each 20912 naming `id` says, opened as its recipient opens it: with the key that signed it. */
export function heard(published: Event[], recipient: Uint8Array, id: string) {
  const me = getPublicKey(recipient);
  return answering(published, id)
    .filter((e) => e.tags.find((t) => t[0] === "p")?.[1] === me)
    .map((event) => ({ event, signer: event.pubkey, payload: openResponse<ResponsePayload>(recipient, event.pubkey, event.content) }));
}

/** The accountability log's entries. */
export const logged = (logPath: string) =>
  readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean)
    .map((l) => JSON.parse(l) as { action: string; outcome: string; actor: { pubkey?: string }; subject: { pubkey?: string; callsign?: string } | null });

/**
 * A box where `responder` -- Wren, by default alone on the roster -- has acknowledged one Distress from
 * `operator`, so the operator's next attempt is answered from the hold.
 */
export async function acknowledgedBox(
  opts: BoxOptions & { roster?: (wren: string) => OnCallEntry[]; operator?: Uint8Array; responder?: Uint8Array } = {},
) {
  const operator = opts.operator ?? generateSecretKey();
  const responder = opts.responder ?? generateSecretKey();
  const page = opts.page ?? workingPager();
  const box = build({ ...opts, page, oncall: opts.roster?.(getPublicKey(responder)) ?? [onCallEntry("Wren", getPublicKey(responder))] });
  const first = distressFrom(operator, box.pubkey);
  const pagesBefore = page.mock.calls.length;
  box.deliver(first);
  await vi.waitFor(() => {
    if (page.mock.calls.length <= pagesBefore) throw new Error("not paged yet");
  });
  box.deliver(signalFrom(responder, box.address, "distress-ack", { distress_id: first.id }));
  await vi.waitFor(() => {
    if (box.executor.ladders.get(first.id)?.state !== "acknowledged") throw new Error("not acknowledged yet");
  });
  return { ...box, operator, responder, first };
}

/** Acknowledges a Distress from another operator on an existing box, by the same person. */
export async function holdAnother(box: Box, responder: Uint8Array, operator = generateSecretKey()) {
  const first = distressFrom(operator, box.pubkey);
  const pagesBefore = box.page.mock.calls.length;
  box.deliver(first);
  await vi.waitFor(() => {
    if (box.page.mock.calls.length <= pagesBefore) throw new Error("not paged yet");
  });
  box.deliver(signalFrom(responder, box.address, "distress-ack", { distress_id: first.id }));
  await vi.waitFor(() => {
    if (box.executor.ladders.get(first.id)?.state !== "acknowledged") throw new Error("not acknowledged yet");
  });
  return { operator, first };
}
