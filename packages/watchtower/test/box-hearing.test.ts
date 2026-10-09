/**
 * relay-lists.md §11: "an executor deaf on one relay, and the state withheld there".
 *
 * The whole box, both processes as they run: a real escalation executor writing where it hears, and a
 * real daemon reading the same file, on real relays. One relay serves the daemon's subscription and
 * refuses the executor's -- an inbox that asks AUTH of one REQ and not the other. Before the hearing
 * file, the daemon announced a live watch there as soon as its own subscription answered, while a
 * `Distress` sent only there paged nobody: the operator's phone said "nobody is coming" from its own
 * timer, minutes in. Now that relay gets no watch state, reads Dark within `stale_after_seconds`, and
 * the daemon's log says why; and the moment the executor hears there, it gets it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { Filter } from "nostr-tools/filter";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EscalationExecutor } from "../src/escalation/executor.js";
import type { EscalationConfig } from "../src/escalation/config.js";
import { WatchtowerDaemon } from "../src/daemon/watchtower.js";
import type { DaemonConfig } from "../src/daemon/config.js";
import { KIND_DISTRESS, KIND_WATCH_STATE } from "../src/shared/kinds.js";
import { startRelay, eventually, type LocalRelay } from "./helpers/local-relay.js";

const relays: LocalRelay[] = [];
const stops: (() => Promise<void>)[] = [];
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(stops.splice(0).map((s) => s()));
  await Promise.all(relays.splice(0).map((r) => r.close()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("an executor deaf on one relay, and the state withheld there [relay-lists §11]", () => {
  it("withholds the watch state where the executor cannot hear, says why, and sends it there once it can", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = await startRelay();
    const b = await startRelay();
    relays.push(a, b);
    /*
     * B refuses the executor's REQ and serves the daemon's. Both ask for the same two kinds with the
     * same #p, in a different order: the executor's filter starts with 20911 (KIND_DISTRESS), the
     * daemon's with 20910 (KIND_SIGNAL). That order is the only way a relay here can tell them apart.
     */
    const refusesExecutor = (filters: Filter[]) => (filters.some((f) => f.kinds?.[0] === KIND_DISTRESS) ? "auth-required: members only" : null);
    b.refuseReq = refusesExecutor;

    const dir = mkdtempSync(join(tmpdir(), "navcom-boxhear-"));
    dirs.push(dir);
    const hearingStatePath = join(dir, "hearing.json");
    const secretKey = generateSecretKey();
    const pubkey = getPublicKey(secretKey);

    const escalation: EscalationConfig = {
      identity: { privkeyPath: "/dev/null" },
      relays: { urls: [a.url, b.url] },
      escalation: {
        pagingWindowSeconds: 300, contactWindowSeconds: 300, drillWindowDays: 7,
        drillAckWindowSeconds: 600, drillStatePath: join(dir, "drill.json"),
        maxPagesPerWindow: 20, pageBudgetWindowSeconds: 3_600, ladderRetentionSeconds: 3_600,
        ackHoldsSeconds: 1_800, oncall: [],
        hearingStatePath,
      },
      log: { path: join(dir, "escalation-log.jsonl"), retentionDays: 90 },
    };
    const executor = new EscalationExecutor({ config: escalation, secretKey, pubkey, page: async () => [], hearingStatePath });
    let executorStopped = false;
    stops.push(() => (executorStopped ? Promise.resolve() : executor.stop()));

    const watch: DaemonConfig = {
      identity: { privkeyPath: "/dev/null" },
      relays: { urls: [a.url, b.url] },
      watch: {
        routineIntervalDefault: 3600, overdueGrace: 1800, hardExpiry: 14400,
        heartbeatIntervalSeconds: 1, sweepIntervalSeconds: 3600, queryTimeoutSeconds: 8, maxEventAgeSeconds: 300,
      },
      authorization: { allowedPubkeys: [] },
      log: { path: "/dev/null", retentionDays: 90, drillStatePath: join(dir, "drill.json"), escalationLogPath: null, hearingStatePath },
    };
    const daemon = new WatchtowerDaemon({ config: watch, secretKey, pubkey });
    stops.push(() => daemon.stop());

    executor.start();
    await daemon.start();
    const states = (r: LocalRelay) => r.published.filter((e) => e.kind === KIND_WATCH_STATE);

    await new Promise((r) => setTimeout(r, 6_000));
    expect(daemon.listening(), "the daemon hears on both relays").toBe(2);
    expect(states(a).length, "not published where both hear").toBeGreaterThan(1);
    expect(states(b), "published where the executor cannot hear").toHaveLength(0);
    const withheld = error.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith(`[relays] ${b.url}: withheld`));
    expect(withheld.some((l) => /auth-required: members only/.test(l)), withheld.join("\n")).toBe(true);

    // The relay stops refusing the executor: within its next retry and the daemon's next read, B gets the state.
    b.refuseReq = null;
    await eventually(() => expect(states(b).length).toBeGreaterThan(0), 30_000);
    expect(log.mock.calls.map((c) => String(c[0]))).toContain(`[relays] ${b.url}: both hear there again -- the watch state goes there`);

    /*
     * And the direction a night goes wrong in: a relay the daemon has been announcing on starts
     * refusing the executor again. A daemon that kept announcing on a list it had already worked out
     * would go on showing a live watch there while a Distress sent only there paged nobody.
     */
    const withheldOnB = () =>
      error.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith(`[relays] ${b.url}: withheld`)).length;
    const saidBefore = withheldOnB();
    b.refuseReq = refusesExecutor;
    b.dropAll();
    await eventually(() => expect(withheldOnB()).toBeGreaterThan(saidBefore), 10_000);
    const onB = states(b).length;
    await new Promise((r) => setTimeout(r, 3_000));
    expect(states(b).length, "still announced where the executor stopped hearing").toBe(onB);
    expect(daemon.listening(), "the daemon hears on B again, so only the executor's file withholds it").toBe(2);

    // And the executor stops: it writes that it hears nowhere, and the daemon announces nowhere.
    await executor.stop();
    executorStopped = true;
    const nowhere = () =>
      error.mock.calls.map((c) => String(c[0])).some((l) => l.startsWith("[heartbeat] NO RELAY WHERE THIS DAEMON AND THE ESCALATION EXECUTOR BOTH HEAR (0/2)"));
    await eventually(() => expect(nowhere()).toBe(true), 8_000);
    const onA = states(a).length;
    await new Promise((r) => setTimeout(r, 3_000));
    expect(states(a).length, "still announced after the executor stopped").toBe(onA);
    expect(
      error.mock.calls.map((c) => String(c[0])).some((l) => l.startsWith(`[relays] ${a.url}: withheld`) && l.includes("(the executor stopped)")),
    ).toBe(true);
  }, 90_000);
});
