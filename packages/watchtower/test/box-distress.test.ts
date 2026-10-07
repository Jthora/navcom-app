/**
 * A box -- the daemon and the executor on one key, as `stationkeeper.md` runs them -- and a phone's
 * own Distress loop, on relays on 127.0.0.1.
 *
 * Nothing ran the two processes together against the phone's loop, and the defects lived exactly
 * there [review: relay paths, #31-#34]. The daemon answers every attempt at once as an agent; the
 * phone's loop used to take the first answer to each attempt and stop listening for it, so that
 * acknowledgement took the slot every time. "Nobody has been woken", a moment later, never reached
 * the screen, and a person's answer heard between attempts waited out the backoff.
 *
 * The last two run the phone's loop alone against a relay that misbehaves [#3, #1].
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { Event } from "nostr-tools/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sendDistressUntilAcknowledged, watchtowerAt, type DistressPhase } from "@navcom/core";
import { EscalationExecutor } from "../src/escalation/executor.js";
import type { EscalationConfig } from "../src/escalation/config.js";
import type { pageAll } from "../src/escalation/pager.js";
import { WatchtowerDaemon } from "../src/daemon/watchtower.js";
import type { DaemonConfig } from "../src/daemon/config.js";
import { nodePool } from "../src/shared/nostr-node.js";
import { sealResponse, sealSignal } from "../src/shared/crypto.js";
import { KIND_DISTRESS, KIND_RESPONSE, KIND_SIGNAL } from "../src/shared/kinds.js";
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

/** The daemon and the executor, on one key and one relay, with Wren on call. */
async function box(opts: {
  page: typeof pageAll;
  over?: Partial<EscalationConfig["escalation"]>;
}) {
  quiet();
  const relay = await startRelay();
  relays.push(relay);
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  const wren = generateSecretKey();
  const dir = mkdtempSync(join(tmpdir(), "navcom-box-"));
  dirs.push(dir);

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
      ...opts.over,
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

  // The daemon subscribes first, so its instant acknowledgement reaches the phone first: the
  // order the findings measured, and the one that lost the watch's reports.
  const daemon = new WatchtowerDaemon({ config: daemonConfig, secretKey, pubkey });
  await daemon.start();
  stops.push(() => daemon.stop());
  await eventually(() => expect(relay.openSubs()).toBe(1));
  const executor = new EscalationExecutor({ config: escalation, secretKey, pubkey, page: opts.page });
  executor.start();
  stops.push(() => executor.stop());
  await eventually(() => expect(relay.openSubs()).toBe(2));
  return { relay, pubkey, wren, executor };
}

/** The phone's own loop, as the web app runs it but with shorter waits. */
function phone(relay: string[], watchtower: string, opts: { ackWindowMs?: number; backoffMs?: number } = {}) {
  const operator = generateSecretKey();
  const pool = nodePool({ enablePing: true });
  pools.push(pool);
  const abort = new AbortController();
  aborts.push(abort);
  const phases: (DistressPhase & { at: number })[] = [];
  const started = Date.now();
  const done = sendDistressUntilAcknowledged(
    pool, relay, operator, getPublicKey(operator), watchtowerAt(watchtower), { position: null, area: "north side" },
    {
      ackWindowMs: opts.ackWindowMs ?? 3_000,
      backoffMs: opts.backoffMs ?? 20_000,
      maxBackoffMs: 60_000,
      signal: abort.signal,
      onPhase: (p) => phases.push({ ...p, at: Date.now() - started }),
    },
  ).catch(() => null);
  const said = (phase: string) => phases.filter((p) => p.phase === phase);
  const texts = (phase: string) => said(phase).map((p) => ("response" in p ? p.response.text : null));
  return { operator, pool, abort, phases, done, said, texts };
}

describe("a box whose daemon acknowledges every attempt at once [#31, #32]", () => {
  it("still gets the watch's 'nobody has been woken' onto the phone, a moment after 'Paging Wren.'", async () => {
    const failing = vi.fn<typeof pageAll>(async () => [
      { callsign: "Wren", channel: "sms", dispatched: false, error: "ENOENT" },
    ]);
    const { relay, pubkey } = await box({ page: failing });
    const p = phone([relay.url], pubkey);

    await eventually(
      () => expect(p.texts("watch-status").join(" | "), p.phases.map((x) => x.phase).join(",")).toMatch(/every channel failed\. Nobody has been woken/),
      5_000,
    );
    expect(p.said("agent-holding").length, "the daemon's answer, said too, and once").toBe(1);
    // The ladder's first word goes out as the pages are dispatched, before their outcome is known,
    // and the correction replaces it the moment they fail (escalation.spec.md, failure mode 9).
    expect(p.texts("watch-status")).toEqual([
      "Paging Wren.",
      "No page could be sent -- every channel failed. Nobody has been woken.",
    ]);
  }, 20_000);

  it("never tells the phone 'Paging Wren.' when the budget means nobody will be", async () => {
    const page = vi.fn<typeof pageAll>(async () => [{ callsign: "Wren", channel: "sms", dispatched: true }]);
    const { relay, pubkey } = await box({ page, over: { maxPagesPerWindow: 1 } });
    // A stranger's Distress spends the budget first.
    const stranger = generateSecretKey();
    relay.deliver(
      finalizeEvent(
        { kind: KIND_DISTRESS, tags: [["p", pubkey]], content: sealSignal(stranger, [pubkey], { position: null, area: "x" }), created_at: nowS() },
        stranger,
      ),
    );
    await eventually(() => expect(page).toHaveBeenCalledTimes(1));

    const p = phone([relay.url], pubkey);
    await eventually(() => expect(p.texts("watch-status").length).toBeGreaterThan(0), 5_000);
    await new Promise((r) => setTimeout(r, 300));
    expect(p.texts("watch-status")).toEqual([
      "The watch could not page anyone -- too many alerts at once. Nobody has been woken.",
    ]);
  }, 20_000);
});

describe("a person's answer, on a box [#33, #34]", () => {
  it("is shown when it lands in the backoff, not when the backoff runs out", async () => {
    const page = vi.fn<typeof pageAll>(async () => [{ callsign: "Wren", channel: "sms", dispatched: true }]);
    const { relay, pubkey, wren } = await box({ page });
    const p = phone([relay.url], pubkey, { ackWindowMs: 1_000, backoffMs: 30_000 });

    // Into the thirty-second backoff after the first attempt: past its one-second window.
    await eventually(() => expect(p.said("agent-holding")).toHaveLength(1), 5_000);
    await new Promise((r) => setTimeout(r, 1_500));
    const distressId = relay.published.find((e) => e.kind === KIND_DISTRESS)!.id;
    const answeredAt = Date.now();
    relay.deliver(ackFrom(wren, pubkey, distressId));

    await eventually(() => expect(p.said("acknowledged")).toHaveLength(1), 5_000);
    expect(Date.now() - answeredAt, "the answer waited out the backoff").toBeLessThan(2_000);
    expect(p.said("sending"), "and nothing was sent again").toHaveLength(1);
  }, 20_000);

  it("ends the Distress when the held answer races the daemon's agent acknowledgement", async () => {
    // Wren answers attempt one and the relay loses the report on its way to the phone. Attempt two
    // is answered at once by the daemon, as an agent, and by the executor's hold, as Wren. The
    // agent's took the slot and the person waited out a whole backoff behind it.
    const page = vi.fn<typeof pageAll>(async () => [{ callsign: "Wren", channel: "sms", dispatched: true }]);
    const { relay, pubkey, wren } = await box({ page });
    let dropping = false;
    relay.refuseEvent = (e) => {
      if (!dropping || e.kind !== KIND_RESPONSE) return null;
      dropping = false;
      return "blocked: lost on the way";
    };
    const p = phone([relay.url], pubkey, { ackWindowMs: 1_500, backoffMs: 2_000 });
    await eventually(() => expect(page).toHaveBeenCalledTimes(1), 5_000);
    const first = relay.published.find((e) => e.kind === KIND_DISTRESS)!;
    dropping = true;
    relay.deliver(ackFrom(wren, pubkey, first.id));

    await eventually(() => expect(p.said("sending").length).toBe(2), 10_000);
    const secondAt = p.said("sending")[1]!.at;
    await eventually(() => expect(p.said("acknowledged")).toHaveLength(1), 10_000);
    expect(p.said("acknowledged")[0]!.at - secondAt, "the held answer waited behind the agent's").toBeLessThan(1_500);
    expect(page).toHaveBeenCalledTimes(1);
  }, 25_000);
});

describe("the phone's listener against a relay that misbehaves [#3, #1]", () => {
  /** A watch's answer to `distressId`, signed and sealed as the executor would. */
  function answer(watchSecret: Uint8Array, operator: string, distressId: string): Event {
    return finalizeEvent(
      {
        kind: KIND_RESPONSE,
        created_at: nowS(),
        tags: [["p", operator], ["e", distressId]],
        content: sealResponse(watchSecret, operator, {
          type: "ack", responder: { kind: "human", callsign: "Wren" }, text: "Wren is responding.", provenance: null, ladder: "acknowledged",
        }),
      },
      watchSecret,
    );
  }

  it("opens again after the relay closes it with a reason that is not a string", async () => {
    // nostr-tools' pool wrapper threw on `null.startsWith`, the listener never heard its own close,
    // and an answer between attempts was lost for the rest of the Distress.
    quiet();
    const relay = await startRelay();
    relays.push(relay);
    const watchSecret = generateSecretKey();
    const watchPub = getPublicKey(watchSecret);
    const p = phone([relay.url], watchPub, { ackWindowMs: 500, backoffMs: 30_000 });
    await eventually(() => expect(p.said("no-answer")).toHaveLength(1), 5_000);

    relay.closeSubs(null);
    await eventually(() => expect(relay.openSubs(), "the listener never came back").toBe(1), 5_000);
    const distressId = relay.published.find((e) => e.kind === KIND_DISTRESS)!.id;
    relay.deliver(answer(watchSecret, getPublicKey(p.operator), distressId));
    await eventually(() => expect(p.said("acknowledged")).toHaveLength(1), 5_000);
  }, 20_000);

  it("leaves nothing talking after a burn lands while an attempt is still going out", async () => {
    // Stopped, then the pool destroyed, while a relay whose handshake never finishes holds the
    // attempt open for three seconds: the listener came back through the destroyed pool a second
    // later and named this operator and their watch on the wire again.
    quiet();
    const { createServer } = await import("node:net");
    const fast = await startRelay();
    relays.push(fast);
    const held: import("node:net").Socket[] = [];
    const wedged = createServer((socket) => {
      held.push(socket);
      socket.resume();
      socket.on("error", () => {});
    });
    await new Promise<void>((resolve) => wedged.listen(0, "127.0.0.1", () => resolve()));
    stops.push(() => {
      for (const s of held) s.destroy();
      wedged.close();
    });
    const address = wedged.address();
    const wedgedUrl = `ws://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

    const p = phone([fast.url, wedgedUrl], getPublicKey(generateSecretKey()), { ackWindowMs: 500 });
    await eventually(() => expect(fast.openSubs()).toBe(1), 5_000);
    await eventually(() => expect(p.said("sending")).toHaveLength(1));

    p.abort.abort();
    p.pool.destroy();
    const before = fast.reqs.length;
    await new Promise((r) => setTimeout(r, 2_500));
    expect(fast.reqs.length, "a subscription was opened after the burn").toBe(before);
    expect(fast.openSubs()).toBe(0);
  }, 20_000);
});
