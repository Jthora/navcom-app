/**
 * The daemon publishing the watch state only where it and the escalation executor both hear
 * (`watch-state.spec.md`, *On a box, "listening" means the daemon and the escalation executor both*).
 *
 * It withheld the state from a relay *it* could not hear on [#38] and asked nothing of the executor,
 * a different process with its own subscription. A relay that answered the daemon and refused the
 * executor showed a live watch while a `Distress` sent only there paged nobody. These run the real
 * daemon on real relays, and write the executor's hearing file by hand, so each way the file can be
 * unbelievable is one test -- every one of them must read Dark, and say why.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WatchtowerDaemon } from "../src/daemon/watchtower.js";
import type { DaemonConfig } from "../src/daemon/config.js";
import { writeHearing, type HearingRelay } from "../src/shared/hearing.js";
import { KIND_WATCH_STATE } from "../src/shared/kinds.js";
import { startRelay, eventually, type LocalRelay } from "./helpers/local-relay.js";
import { distressFrom } from "./helpers/executor.js";

const nowS = () => Math.floor(Date.now() / 1000);

const daemons: WatchtowerDaemon[] = [];
const relays: LocalRelay[] = [];
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(daemons.splice(0).map((d) => d.stop()));
  await Promise.all(relays.splice(0).map((r) => r.close()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function hearingPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "navcom-dhear-"));
  dirs.push(dir);
  return join(dir, "hearing.json");
}

function config(urls: string[], path: string | undefined, heartbeatIntervalSeconds = 1): DaemonConfig {
  return {
    identity: { privkeyPath: "/dev/null" },
    relays: { urls },
    watch: {
      routineIntervalDefault: 3600, overdueGrace: 1800, hardExpiry: 14400,
      heartbeatIntervalSeconds, sweepIntervalSeconds: 3600, queryTimeoutSeconds: 8, maxEventAgeSeconds: 300,
    },
    authorization: { allowedPubkeys: [] },
    log: {
      path: "/dev/null", retentionDays: 90, drillStatePath: "/dev/null/nope", escalationLogPath: null,
      ...(path ? { hearingStatePath: path } : {}),
    },
  };
}

function daemonOn(urls: string[], path: string | undefined, heartbeat = 1, secretKey = generateSecretKey()) {
  const pubkey = getPublicKey(secretKey);
  const daemon = new WatchtowerDaemon({ config: config(urls, path, heartbeat), secretKey, pubkey });
  daemons.push(daemon);
  return { daemon, pubkey, secretKey };
}

/** The file as the executor writes it. */
const hearing = (path: string, watch: string, entries: HearingRelay[], at = nowS()) =>
  writeHearing(path, { v: 1, at, watch, relays: entries });

const states = (relay: LocalRelay) => relay.published.filter((e) => e.kind === KIND_WATCH_STATE);

function spies() {
  return {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
}
const lines = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => String(c[0]));

async function twoRelays() {
  const a = await startRelay();
  const b = await startRelay();
  relays.push(a, b);
  return { a, b };
}

describe("a relay the executor does not hear on", () => {
  it("gets no watch state, though the daemon hears there, and the log names it with the executor's reason", async () => {
    const { error } = spies();
    const { a, b } = await twoRelays();
    const path = hearingPath();
    const secretKey = generateSecretKey();
    hearing(path, getPublicKey(secretKey), [
      { url: a.url, hears: true },
      { url: b.url, hears: false, why: "refused the subscription: auth-required: x" },
    ]);
    const { daemon } = daemonOn([a.url, b.url], path, 1, secretKey);
    await daemon.start();

    await eventually(() => expect(states(a).length, "not announced where both hear").toBeGreaterThan(1), 6_000);
    expect(daemon.listening(), "the daemon hears on both").toBe(2);
    expect(states(b), "announced where the executor does not hear").toHaveLength(0);
    const withheld = lines(error).filter((l) => l.startsWith(`[relays] ${b.url}: withheld`));
    expect(withheld).toHaveLength(1);
    expect(withheld[0]).toBe(
      `[relays] ${b.url}: withheld -- this daemon hears there and the escalation executor does not (refused the ` +
        "subscription: auth-required: x). Operators reading only that relay see Dark within 300s, which is the " +
        "truth: a Distress sent only there would page nobody",
    );
  }, 12_000);

  it("says so when a Distress arrives there, since unless it reached the executor on another relay, nobody is paged", async () => {
    // The daemon still answers it as an agent, and the phone reads "an agent answered"; a Stationkeeper
    // reading this log is the one person who can learn tonight that it may have paged nobody.
    const { error } = spies();
    const { a, b } = await twoRelays();
    const path = hearingPath();
    const secretKey = generateSecretKey();
    const watch = getPublicKey(secretKey);
    hearing(path, watch, [
      { url: a.url, hears: true },
      { url: b.url, hears: false, why: "refused the subscription: auth-required: x" },
    ]);
    const { daemon } = daemonOn([a.url, b.url], path, 3600, secretKey);
    await daemon.start();
    await eventually(() => expect(daemon.listening()).toBe(2), 6_000);

    b.deliver(distressFrom(generateSecretKey(), watch));
    const deaf = () => lines(error).filter((l) => l.startsWith("[distress] ") && l.includes(b.url));
    await eventually(() => expect(deaf()).toHaveLength(1), 5_000);
    expect(deaf()[0]).toMatch(
      /^\[distress\] from [0-9a-f]{8}\S* arrived on .* where the escalation executor does not hear \(refused the subscription: auth-required: x\)\. Unless it reached the executor on another relay, nobody is paged for it, and the agent's answer is all the operator gets$/,
    );

    // Arriving where both hear, there is nothing to say.
    a.deliver(distressFrom(generateSecretKey(), watch));
    await new Promise((r) => setTimeout(r, 1_000));
    expect(lines(error).filter((l) => l.startsWith("[distress] ") && l.includes(a.url))).toHaveLength(0);
  }, 15_000);

  it("is withheld when the executor's config does not name it at all", async () => {
    const { error } = spies();
    const { a, b } = await twoRelays();
    const path = hearingPath();
    const secretKey = generateSecretKey();
    hearing(path, getPublicKey(secretKey), [{ url: a.url, hears: true }]);
    const { daemon } = daemonOn([a.url, b.url], path, 1, secretKey);
    await daemon.start();

    await eventually(() => expect(states(a).length).toBeGreaterThan(1), 6_000);
    expect(states(b)).toHaveLength(0);
    expect(lines(error).join("\n")).toMatch(
      new RegExp(`\\[relays\\] ${b.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: withheld -- .*\\(it is not among the escalation executor's relays -- add it to escalation\\.toml\\)`),
    );
  }, 12_000);
});

describe("a hearing file that is not believed means the executor hears nowhere", () => {
  it("missing: nothing published anywhere, the reason said once, and the no-relay line on every beat", async () => {
    const { error } = spies();
    const { a, b } = await twoRelays();
    const path = hearingPath();
    const { daemon } = daemonOn([a.url, b.url], path, 1);
    await daemon.start();
    await eventually(() => expect(daemon.listening()).toBe(2), 5_000);
    await new Promise((r) => setTimeout(r, 3_500));

    expect(states(a)).toHaveLength(0);
    expect(states(b)).toHaveLength(0);
    const nowhere = lines(error).filter((l) => l.startsWith("[relays] THE EXECUTOR HEARS NOWHERE"));
    expect(nowhere, "said once per change, not once per read").toHaveLength(1);
    expect(nowhere[0]).toBe(
      `[relays] THE EXECUTOR HEARS NOWHERE, as far as this daemon can tell: there is no hearing file at ${path}. Is ` +
        "navcom-escalation running, with [escalation] hearing_state_path set to this path? The watch state goes " +
        "nowhere, and operators read Dark until it does",
    );
    const beats = lines(error).filter((l) => l.startsWith("[heartbeat] NO RELAY WHERE THIS DAEMON AND THE ESCALATION EXECUTOR BOTH HEAR (0/2)"));
    expect(beats.length, "not said on every beat").toBeGreaterThanOrEqual(3);
    expect(beats[0]).toMatch(/operators read Dark until the executor hears where this daemon does$/);
    expect(lines(error).join("\n"), "this daemon hears; that is not the cause").not.toMatch(/LISTENING ON NO RELAY/);
  }, 12_000);

  it("ninety-one seconds old: nothing published; written fresh, the state goes out within the poll, not the beat", async () => {
    const { error, log } = spies();
    const { a } = await twoRelays();
    const path = hearingPath();
    const secretKey = generateSecretKey();
    const watch = getPublicKey(secretKey);
    hearing(path, watch, [{ url: a.url, hears: true }], nowS() - 91);
    // An hour's beat: only the poll of the file can announce it.
    const { daemon } = daemonOn([a.url], path, 3_600, secretKey);
    await daemon.start();
    await eventually(() => expect(daemon.listening()).toBe(1), 5_000);
    await eventually(() => expect(lines(error).join("\n")).toMatch(/THE EXECUTOR HEARS NOWHERE, as far as this daemon can tell: the hearing file at .* is 9[1-9]s old/), 3_000);
    expect(states(a)).toHaveLength(0);

    const fresh = Date.now();
    hearing(path, watch, [{ url: a.url, hears: true }]);
    await eventually(() => expect(states(a)).toHaveLength(1), 7_000);
    expect(Date.now() - fresh).toBeLessThan(7_000);
    expect(lines(log)).toContain("[relays] the escalation executor's hearing file reads again: it hears on 1/1 relay(s)");
  }, 20_000);

  it("about another watch: nothing published, and the key mismatch named", async () => {
    const { error } = spies();
    const { a } = await twoRelays();
    const path = hearingPath();
    hearing(path, getPublicKey(generateSecretKey()), [{ url: a.url, hears: true }]);
    const { daemon } = daemonOn([a.url], path, 1);
    await daemon.start();
    await eventually(() => expect(daemon.listening()).toBe(1), 5_000);
    await new Promise((r) => setTimeout(r, 1_500));

    expect(states(a)).toHaveLength(0);
    expect(lines(error).join("\n")).toMatch(/THE EXECUTOR HEARS NOWHERE, as far as this daemon can tell: the hearing file at .* is for watch [0-9a-f]{8}, not this one \([0-9a-f]{8}\)/);
  }, 12_000);
});

describe("a daemon given no hearing file", () => {
  it("publishes where it hears, as before, and says at start what that costs", async () => {
    const { warn } = spies();
    const { a, b } = await twoRelays();
    const { daemon } = daemonOn([a.url, b.url], undefined, 1);
    await daemon.start();
    expect(lines(warn)).toContain(
      "[relays] NO HEARING FILE CONFIGURED ([log] hearing_state_path): the watch state is published wherever this " +
        "daemon hears, without asking where the escalation executor hears. A relay that refuses the executor still " +
        "shows a live watch, and a Distress sent only there pages nobody. Set it to the executor's [escalation] " +
        "hearing_state_path",
    );
    await eventually(() => {
      expect(states(a).length).toBeGreaterThan(0);
      expect(states(b).length).toBeGreaterThan(0);
    }, 6_000);
  }, 12_000);

  it("and a daemon given one says, at start, that it publishes only where both hear", async () => {
    const { log } = spies();
    const { a } = await twoRelays();
    const path = hearingPath();
    const { daemon } = daemonOn([a.url], path, 3_600);
    await daemon.start();
    expect(lines(log)).toContain(
      `[relays] the watch state is published only where this daemon and the escalation executor both hear, as ${path} says`,
    );
  });
});
