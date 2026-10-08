/**
 * A box whose executor has its own key, and phones' own Distress loops, on a relay on 127.0.0.1.
 *
 * The property the key exists for is end to end: **the daemon -- and the agent beside it -- can tell
 * an operator anything but that a person has it** (decided 2026-10-07, G3). That is the executor
 * signing with its own key, and a phone handed that key ending a Distress on nothing else. Each half
 * is tested where it lives; this runs them together, with the daemon answering every attempt first
 * as it does on a real box.
 *
 * And a phone handed the watch before the box named its key has to keep working: it hears the watch
 * key's copy, and ends on it as it always did.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { Event } from "nostr-tools/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSignal, sendDistressUntilAcknowledged, watchtowerAt, type DistressPhase, type WatchtowerAddress } from "@navcom/core";
import { EscalationExecutor } from "../src/escalation/executor.js";
import type { EscalationConfig } from "../src/escalation/config.js";
import type { pageAll } from "../src/escalation/pager.js";
import { WatchtowerDaemon } from "../src/daemon/watchtower.js";
import type { DaemonConfig } from "../src/daemon/config.js";
import { nodePool } from "../src/shared/nostr-node.js";
import { sealResponse } from "../src/shared/crypto.js";
import { KIND_DISTRESS, KIND_RESPONSE } from "../src/shared/kinds.js";
import { startRelay, eventually, type LocalRelay } from "./helpers/local-relay.js";

const STANDING = 4_102_444_800;
const nowS = () => Math.floor(Date.now() / 1000);

const dirs: string[] = [];
const relays: LocalRelay[] = [];
const stops: (() => Promise<void> | void)[] = [];
const pools: SimplePool[] = [];
const aborts: AbortController[] = [];

afterEach(async () => {
  for (const a of aborts.splice(0)) a.abort();
  for (const stop of stops.splice(0)) await stop();
  for (const p of pools.splice(0)) p.destroy();
  await Promise.all(relays.splice(0).map((r) => r.close()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function quiet() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

/** The daemon on the watch key, and the executor on the watch key and its own, with Wren on call. */
async function box() {
  quiet();
  const relay = await startRelay();
  relays.push(relay);
  const watchSecret = generateSecretKey();
  const pubkey = getPublicKey(watchSecret);
  const executorSecret = generateSecretKey();
  const executorPubkey = getPublicKey(executorSecret);
  const wren = generateSecretKey();
  const dir = mkdtempSync(join(tmpdir(), "navcom-box-key-"));
  dirs.push(dir);
  const page = vi.fn<typeof pageAll>(async () => [{ callsign: "Wren", channel: "sms", dispatched: true }]);

  const escalation: EscalationConfig = {
    identity: { privkeyPath: "/dev/null" },
    relays: { urls: [relay.url] },
    escalation: {
      pagingWindowSeconds: 300, contactWindowSeconds: 300, drillWindowDays: 7,
      drillAckWindowSeconds: 600, drillStatePath: join(dir, "drill.json"),
      maxPagesPerWindow: 20, pageBudgetWindowSeconds: 3_600, ladderRetentionSeconds: 3_600,
      ackHoldsSeconds: 1_800,
      oncall: [
        {
          declaration: { author: { kind: "node", callsign: "Wren", pubkey: getPublicKey(wren) }, channel: "sms", expires: STANDING },
          command: ["true"],
        },
      ],
    },
    log: { path: join(dir, "escalation-log.jsonl"), retentionDays: 90 },
  };
  const daemonConfig: DaemonConfig = {
    identity: { privkeyPath: "/dev/null" },
    relays: { urls: [relay.url] },
    watch: {
      routineIntervalDefault: 3600, overdueGrace: 1800, hardExpiry: 14400,
      heartbeatIntervalSeconds: 3600, sweepIntervalSeconds: 3600, queryTimeoutSeconds: 8, maxEventAgeSeconds: 300,
    },
    authorization: { allowedPubkeys: [] },
    log: { path: "/dev/null", retentionDays: 90, drillStatePath: join(dir, "drill.json"), escalationLogPath: null },
  };

  // The daemon first, so its agent acknowledgement reaches a phone before anything the executor says.
  const daemon = new WatchtowerDaemon({ config: daemonConfig, secretKey: watchSecret, pubkey });
  await daemon.start();
  stops.push(() => daemon.stop());
  await eventually(() => expect(relay.openSubs()).toBe(1));
  const executor = new EscalationExecutor({
    config: escalation, secretKey: watchSecret, pubkey, page,
    executorKey: { secretKey: executorSecret, pubkey: executorPubkey },
  });
  executor.start();
  stops.push(() => executor.stop());
  await eventually(() => expect(relay.openSubs()).toBe(2));

  /** The watch as a phone holds it: naming the executor's key, or -- handed over earlier -- not. */
  const handed = (withKey: boolean): WatchtowerAddress => watchtowerAt(pubkey, undefined, undefined, withKey ? executorPubkey : null);
  return { relay, pubkey, watchSecret, executorPubkey, wren, page, executor, handed };
}

/** A phone's own Distress loop, as the web app runs it but with shorter waits. */
function phone(relay: string[], watch: WatchtowerAddress) {
  const operator = generateSecretKey();
  const pool = nodePool({ enablePing: true });
  pools.push(pool);
  const abort = new AbortController();
  aborts.push(abort);
  const phases: DistressPhase[] = [];
  void sendDistressUntilAcknowledged(pool, relay, operator, getPublicKey(operator), watch, { position: null, area: "north side" }, {
    ackWindowMs: 1_500,
    backoffMs: 2_000,
    maxBackoffMs: 4_000,
    signal: abort.signal,
    onPhase: (p) => phases.push(p),
  }).catch(() => null);
  const said = <P extends DistressPhase["phase"]>(phase: P) =>
    phases.filter((p): p is Extract<DistressPhase, { phase: P }> => p.phase === phase);
  return { operator, phases, said };
}

/** Wren's acknowledgement, built as Wren's phone builds one for this watch. */
function ackFrom(wren: Uint8Array, watch: WatchtowerAddress, distressId: string): Event {
  return finalizeEvent(buildSignal(wren, watch, "distress-ack", { distress_id: distressId }, nowS()), wren);
}

describe("a box whose executor has its own key", () => {
  it("ends a phone's Distress, given that key, on the person's answer the executor signed", async () => {
    const b = await box();
    const p = phone([b.relay.url], b.handed(true));
    await eventually(() => expect(b.page).toHaveBeenCalledTimes(1), 8_000);
    // The daemon's agent answer arrived, and closed nothing.
    await eventually(() => expect(p.said("agent-holding").length).toBeGreaterThan(0), 5_000);
    expect(p.said("acknowledged")).toEqual([]);

    const distress = b.relay.published.find((e) => e.kind === KIND_DISTRESS)!;
    b.relay.deliver(ackFrom(b.wren, b.handed(true), distress.id));
    await eventually(() => expect(p.said("acknowledged")).toHaveLength(1), 8_000);
    expect(p.said("acknowledged")[0]!.by, "closed on something other than the executor's own key").toBe("executor");
    expect(p.said("acknowledged")[0]!.response.responder.callsign).toBe("Wren");
  }, 30_000);

  it("never ends it on 'a person has it' signed with the watch key -- what the daemon, or the agent beside it, could send", async () => {
    const b = await box();
    const p = phone([b.relay.url], b.handed(true));
    await eventually(() => expect(b.page).toHaveBeenCalledTimes(1), 8_000);
    const distress = b.relay.published.find((e) => e.kind === KIND_DISTRESS)!;
    const operator = distress.pubkey;

    // Forged with the watch key the daemon holds: the right words, the right shape, nobody behind it.
    b.relay.deliver(
      finalizeEvent(
        {
          kind: KIND_RESPONSE,
          created_at: nowS(),
          tags: [["p", operator], ["e", distress.id]],
          content: sealResponse(b.watchSecret, operator, {
            type: "ack", responder: { kind: "human", callsign: "Wren" }, text: "Wren is responding.", provenance: null, ladder: "acknowledged",
          }),
        },
        b.watchSecret,
      ),
    );
    await eventually(() => expect(p.said("human-unconfirmed").length).toBeGreaterThan(0), 5_000);
    // It keeps sending: its next attempt goes out after the backoff, still not closed.
    await eventually(() => expect(p.said("sending").length, "the phone stopped sending").toBeGreaterThan(1), 10_000);
    expect(p.said("acknowledged"), "the watch key alone told the phone a person had it").toEqual([]);

    // The real answer still ends it.
    b.relay.deliver(ackFrom(b.wren, b.handed(true), distress.id));
    await eventually(() => expect(p.said("acknowledged")).toHaveLength(1), 8_000);
    expect(p.said("acknowledged")[0]!.by).toBe("executor");
  }, 30_000);

  it("still ends the Distress of a phone handed the watch before the box named its key, on the watch key's copy", async () => {
    const b = await box();
    const p = phone([b.relay.url], b.handed(false));
    await eventually(() => expect(b.page).toHaveBeenCalledTimes(1), 8_000);
    const distress = b.relay.published.find((e) => e.kind === KIND_DISTRESS)!;
    // Wren's phone may be the older one too: sealed to the watch key alone.
    b.relay.deliver(ackFrom(b.wren, b.handed(false), distress.id));
    await eventually(() => expect(p.said("acknowledged")).toHaveLength(1), 8_000);
    expect(p.said("acknowledged")[0]!.by).toBe("watch-key");
    // Both sends reached the relay: the executor's own, and the copy naming it.
    const answers = b.relay.published.filter((e) => e.kind === KIND_RESPONSE && e.tags.some((t) => t[0] === "e" && t[1] === distress.id));
    expect(answers.some((e) => e.pubkey === b.executorPubkey)).toBe(true);
  }, 30_000);
});
