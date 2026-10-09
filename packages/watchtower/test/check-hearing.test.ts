/**
 * Every `--check` asks each relay for its own process's subscription, and the daemon's reads where the
 * executor hears.
 *
 * Only the daemon's `--check` asked a relay for the box's REQ. A relay that refused the executor's, or
 * a keyless pager's, passed every check while a `Distress` sent only there paged nobody from that
 * process; and the daemon's check could not see the executor's subscription at all. A check that
 * passes a deaf box is worse than none: it is the thing a Stationkeeper believes.
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { SimplePool } from "nostr-tools/pool";
import type { Filter } from "nostr-tools/filter";
import { buildWatchStateEvent } from "@navcom/core";
import { probeRelays } from "../src/shared/subscription-check.js";
import { nodePool } from "../src/shared/nostr-node.js";
import { writeHearing } from "../src/shared/hearing.js";
import { loadOrCreateKeypair } from "../src/shared/identity.js";
import { checkPasses, checkWatch, report } from "../src/daemon/check.js";
import { KIND_DISTRESS, KIND_SIGNAL } from "../src/shared/kinds.js";
import { startRelay, freePort, type LocalRelay } from "./helpers/local-relay.js";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const ESCALATION = join(PACKAGE, "src/escalation/index.ts");
const PAGER = join(PACKAGE, "src/pager/index.ts");
const DAEMON = join(PACKAGE, "src/daemon/index.ts");

const relays: LocalRelay[] = [];
const dirs: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const c of children.splice(0)) c.kill("SIGKILL");
  await Promise.all(relays.splice(0).map((r) => r.close()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "navcom-chkhear-"));
  dirs.push(dir);
  return dir;
}

/**
 * Refuses the executor's REQ and the pager's -- each asks for `#p` and starts with 20911 -- and serves
 * the daemon's, which starts with 20910. A real inbox gates on `#p`, so a probe that dropped it would be
 * served here, as it would there.
 */
const refusesDistressReq = (filters: Filter[]) =>
  filters.some((f) => "#p" in f && f.kinds?.[0] === KIND_DISTRESS) ? "auth-required: members only" : null;

/**
 * Every REQ a relay was asked that could carry a Distress: each one, exactly. A probe that asked for
 * one kind, or dropped `#p`, would pass a relay that refuses the subscription the process depends on.
 */
const distressReqs = (relay: LocalRelay) =>
  relay.reqs.filter((r) => r.filters.some((f) => f.kinds?.includes(KIND_DISTRESS))).map((r) => r.filters);

function run(script: string, args: string[]) {
  const child = spawn(process.execPath, ["--import", "tsx", script, ...args], { cwd: PACKAGE, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let out = "";
  child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (out += d.toString()));
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return { out: () => out, exited };
}

describe("probing one subscription on each relay", () => {
  it("names a relay that refuses it, with its reason, and one that is not there as unreachable", async () => {
    const open = await startRelay();
    const inbox = await startRelay();
    relays.push(open, inbox);
    inbox.refuseReq = refusesDistressReq;
    const gone = `ws://127.0.0.1:${await freePort()}`;
    const pool = nodePool();
    try {
      const watch = getPublicKey(generateSecretKey());
      const reach = await probeRelays(
        pool,
        [open.url, inbox.url, gone],
        { kinds: [KIND_DISTRESS], "#p": [watch], limit: 0 },
        { timeoutMs: 3_000, connectMs: 2_000, noun: "the subscription" },
      );
      expect(reach[0]).toEqual({ url: open.url, reached: true, hears: true });
      expect(reach[1]).toEqual({ url: inbox.url, reached: true, hears: false, deaf: "refused the subscription: auth-required: members only" });
      expect(reach[2]?.reached).toBe(false);
      expect(reach[2]?.error).toBeTruthy();
      // Asked exactly as the process asks it, and nothing stored.
      expect(open.reqs.at(-1)?.filters).toEqual([{ kinds: [KIND_DISTRESS], "#p": [watch], limit: 0 }]);
    } finally {
      pool.destroy();
    }
  }, 15_000);
});

/** An escalation.toml in `dir`, its watch key made as the daemon's first start leaves it. */
function escalationToml(dir: string, relay: string, hearing: string): string {
  const path = join(dir, "escalation.toml");
  loadOrCreateKeypair(join(dir, "watchtower.key"));
  writeFileSync(
    path,
    [
      "[identity]",
      `privkey_path = "${join(dir, "watchtower.key")}"`,
      "[relays]",
      `urls = ["${relay}"]`,
      "[log]",
      `path = "${join(dir, "escalation-log.jsonl")}"`,
      "[escalation]",
      `drill_state_path = "${join(dir, "drill.json")}"`,
      `hearing_state_path = "${hearing}"`,
      "[[escalation.oncall]]",
      'callsign = "Wren"',
      `pubkey = "${getPublicKey(generateSecretKey())}"`,
      'channel = "sms"',
      'command = ["true"]',
      "",
    ].join("\n"),
  );
  return path;
}

describe("navcom-escalation --check", () => {
  it("fails, naming the relay, when no relay answers the executor's own subscription", async () => {
    const relay = await startRelay();
    relays.push(relay);
    relay.refuseReq = refusesDistressReq;
    const dir = tempDir();
    const p = run(ESCALATION, ["--check", escalationToml(dir, relay.url, join(dir, "hearing.json"))]);
    expect(await p.exited, p.out()).toBe(1);
    expect(p.out()).toContain("[check] asking each relay for the subscription this executor makes, as it makes it");
    expect(p.out()).toContain(
      `[check]   ${relay.url}: DOES NOT HEAR -- refused the subscription: auth-required: members only. A Distress sent ` +
        "only there pages nobody from this executor, and a daemon reading its hearing file withholds the watch state there",
    );
    expect(p.out()).toContain(
      "[check] THIS EXECUTOR HEARS ON NO RELAY IN THIS CONFIG, so a Distress pages nobody from here. Pick a relay that " +
        "serves it without NIP-42 AUTH, or fix the one that is not answering",
    );
    // The roster still pages: the failure is where a Distress reaches the executor, not who it wakes.
    expect(p.out()).toMatch(/every command ran/);
    // Asked exactly as the running executor asks it, and nothing stored.
    const watch = loadOrCreateKeypair(join(dir, "watchtower.key")).pubkey;
    expect(distressReqs(relay)).toEqual([[{ kinds: [KIND_DISTRESS, KIND_SIGNAL], "#p": [watch], limit: 0 }]]);
  }, 30_000);

  it("passes where a relay answers it, and reports what the running executor's file says", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const dir = tempDir();
    const hearing = join(dir, "hearing.json");
    const toml = escalationToml(dir, relay.url, hearing);

    const before = run(ESCALATION, ["--check", toml]);
    expect(await before.exited, before.out()).toBe(0);
    expect(before.out()).toContain(`[check]   ${relay.url}: answers it -- a Distress sent there reaches this executor`);
    expect(distressReqs(relay)).toEqual([
      [{ kinds: [KIND_DISTRESS, KIND_SIGNAL], "#p": [loadOrCreateKeypair(join(dir, "watchtower.key")).pubkey], limit: 0 }],
    ]);
    // Often run before the executor has started: said, and not a failure.
    expect(before.out()).toMatch(/\[check\] the running executor's hearing file: there is no hearing file at .* -- a daemon reading it treats this executor as hearing nowhere/);

    const watch = loadOrCreateKeypair(join(dir, "watchtower.key")).pubkey;
    writeHearing(hearing, {
      v: 1,
      at: Math.floor(Date.now() / 1000),
      watch,
      relays: [
        { url: relay.url, hears: true },
        { url: "wss://inbox.example", hears: false, why: "refused the subscription: auth-required: members only" },
      ],
    });
    const after = run(ESCALATION, ["--check", toml]);
    expect(await after.exited, after.out()).toBe(0);
    expect(after.out()).toMatch(/\[check\] the running executor's hearing file \(.*hearing\.json, \d+s old\) says it hears on 1\/2 relay\(s\)/);
    expect(after.out()).toContain(
      "[check]   wss://inbox.example: the running executor does not hear there -- refused the subscription: auth-required: members only",
    );
  }, 40_000);
});

const WATCH = generateSecretKey();
const PUBKEY = getPublicKey(WATCH);
const NOW = Math.floor(Date.now() / 1000);

/** A fresh watch state, and a pool whose relays each answer the box's subscription unless told to refuse it. */
function fakePool(opts: { refuses?: string[]; state?: boolean } = {}) {
  const event = finalizeEvent(
    buildWatchStateEvent(
      { state: "automated", since: NOW - 600, holder: null, holder_kind: "agent", oncall: [], agent_health: "ok", last_drill: null, now: NOW } as never,
      NOW - 20,
    ),
    WATCH,
  );
  return {
    ensureRelay: async (url: string) =>
      ({
        subscribe: (_f: unknown, params: { oneose?: () => void; onclose?: (r: string) => void }) => {
          if (opts.refuses?.includes(url)) queueMicrotask(() => params.onclose?.("auth-required: members only"));
          else queueMicrotask(() => params.oneose?.());
          return { close() {} };
        },
      }) as never,
    subscribeMany: (_u: string[], _f: unknown, params: { onevent: (e: never) => void; oneose?: () => void }) => {
      if (opts.state !== false) params.onevent(event as never);
      params.oneose?.();
      return { close() {} };
    },
  } as unknown as SimplePool;
}

describe("watchtower-daemon --check, reading where the executor hears", () => {
  const urls = ["wss://a", "wss://b"];
  const check = (hearingPath: string | undefined, opts: Parameters<typeof fakePool>[0] = {}) =>
    checkWatch({ pubkey: PUBKEY, relays: urls, pool: fakePool(opts), now: () => NOW, timeoutMs: 50, ...(hearingPath ? { hearingPath } : {}) });

  it("names each relay the executor does not hear on, and passes while one is heard by both", async () => {
    const path = join(tempDir(), "hearing.json");
    writeHearing(path, { v: 1, at: NOW - 4, watch: PUBKEY, relays: [{ url: "wss://a/", hears: true }, { url: "wss://b", hears: false, why: "refused the subscription: auth-required: x" }] });
    const out = await check(path);
    expect(out.bothHear).toBe(true);
    const printed = report(out);
    expect(printed).toContain(`[check] the escalation executor's hearing file (${path}, 4s old): it hears on 1/2 of this config's relays`);
    expect(printed).toContain(
      "[check]   wss://b: the escalation executor does not hear there (refused the subscription: auth-required: x) -- the daemon withholds the watch state there",
    );
    expect(checkPasses(out)).toBe(true);
  });

  it("fails, and says to fix the executor's relays first, when no relay is heard by both", async () => {
    const path = join(tempDir(), "hearing.json");
    writeHearing(path, { v: 1, at: NOW, watch: PUBKEY, relays: [{ url: "wss://a", hears: true }, { url: "wss://b", hears: false, why: "unreachable (x)" }] });
    // The daemon hears only on b, the executor only on a.
    const out = await check(path, { refuses: ["wss://a"], state: false });
    expect(out.hearing).toBe(true);
    expect(out.bothHear).toBe(false);
    const printed = report(out);
    const cause = printed.findIndex((l) => l.startsWith("[check] NO RELAY WHERE THE DAEMON AND THE ESCALATION EXECUTOR BOTH HEAR"));
    const fix = printed.findIndex((l) => /^\[check\] No relay served anything/.test(l));
    expect(cause, printed.join("\n")).toBeGreaterThanOrEqual(0);
    expect(cause, "the cause comes after the remedy that depends on it").toBeLessThan(fix);
    expect(printed[cause]).toBe(
      "[check] NO RELAY WHERE THE DAEMON AND THE ESCALATION EXECUTOR BOTH HEAR, so the daemon publishes the watch state " +
        "nowhere and operators read Dark. Fix the executor's relays first: navcom-escalation --check names them",
    );
    expect(printed[fix]).toContain(
      "No relay is heard on by both this daemon and the escalation executor, and the daemon publishes the watch state " +
        "only where both hear, so a running daemon is withholding it from all of them. Fix that first (above).",
    );
    expect(checkPasses(out), "passed a box whose daemon publishes nowhere").toBe(false);

    // Visible for now -- a copy under five minutes old -- and still a failure: the daemon has stopped renewing it.
    expect(checkPasses(await check(path, { refuses: ["wss://a"] }))).toBe(false);
  });

  it("names the box's own deafness first, and not the executor's, when no relay answers the box at all", async () => {
    // Then the executor's relays are not the first thing to change, and saying both sends a
    // Stationkeeper to fix the wrong process first.
    const path = join(tempDir(), "hearing.json");
    writeHearing(path, { v: 1, at: NOW, watch: PUBKEY, relays: [{ url: "wss://a", hears: true }, { url: "wss://b", hears: true }] });
    const out = await check(path, { refuses: ["wss://a", "wss://b"], state: false });
    expect(out.hearing).toBe(false);
    expect(out.bothHear).toBe(false);
    const printed = report(out);
    expect(printed.some((l) => l.startsWith("[check] NO RELAY ANSWERS THE BOX'S SUBSCRIPTION")), printed.join("\n")).toBe(true);
    expect(printed.some((l) => l.includes("NO RELAY WHERE THE DAEMON AND THE ESCALATION EXECUTOR BOTH HEAR")), printed.join("\n")).toBe(false);
    expect(checkPasses(out)).toBe(false);
  });

  it("fails, with the reason, when the file is not believed", async () => {
    const path = join(tempDir(), "hearing.json");
    const out = await check(path);
    expect(out.executor?.ok).toBe(false);
    expect(out.bothHear).toBe(false);
    expect(report(out)).toContain(
      `[check] THE ESCALATION EXECUTOR HEARS NOWHERE, as far as this daemon can tell: there is no hearing file at ${path}. ` +
        "Is navcom-escalation running, with [escalation] hearing_state_path set to this path?",
    );
    expect(checkPasses(out)).toBe(false);
  });

  it("fails with no hearing file configured, though the watch reads as up, and says what to set", async () => {
    // Every box upgraded to this version: the daemon publishes where the executor may be deaf, and says
    // so only in its journal at start. The cron line is what runs unattended, so it has to catch it.
    const out = await check(undefined);
    expect(out.visible).toBe(true);
    expect(out.hearing).toBe(true);
    expect(out.bothHear).toBeUndefined();
    expect(report(out)).toContain(
      "[check] NO [log] hearing_state_path: this daemon publishes wherever it hears, without asking where the " +
        "escalation executor hears, so a relay that refuses the executor shows a live watch while a Distress sent only " +
        "there pages nobody. This check fails until it is set to the executor's [escalation] hearing_state_path",
    );
    expect(checkPasses(out), "passed a box that publishes where the executor may be deaf").toBe(false);
  });
});

describe("watchtower-daemon --check, as the process it is", () => {
  it("reads the file its config names, and fails where no relay is heard by both, though the watch reads as up", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const dir = tempDir();
    const watch = loadOrCreateKeypair(join(dir, "watchtower.key"));
    const at = Math.floor(Date.now() / 1000);
    // A fresh watch state on the relay: an operator would see this watch right now.
    relay.deliver(
      finalizeEvent(
        buildWatchStateEvent(
          { state: "automated", since: at - 600, holder: null, holder_kind: "agent", oncall: [], agent_health: "ok", last_drill: null, now: at } as never,
          at,
        ),
        watch.secretKey,
      ),
    );
    const hearing = join(dir, "hearing.json");
    const toml = join(dir, "watchtower.toml");
    writeFileSync(
      toml,
      [
        "[identity]",
        `privkey_path = "${join(dir, "watchtower.key")}"`,
        "[relays]",
        `urls = ["${relay.url}"]`,
        "[log]",
        `path = "${join(dir, "accountability.jsonl")}"`,
        `hearing_state_path = "${hearing}"`,
        "",
      ].join("\n"),
    );

    writeHearing(hearing, { v: 1, at, watch: watch.pubkey, relays: [{ url: relay.url, hears: false, why: "refused the subscription: auth-required: x" }] });
    const deaf = run(DAEMON, ["--check", toml]);
    expect(await deaf.exited, deaf.out()).toBe(1);
    expect(deaf.out()).toContain(
      `[check]   ${relay.url}: the escalation executor does not hear there (refused the subscription: auth-required: x) -- the daemon withholds the watch state there`,
    );
    expect(deaf.out()).toContain("[check] NO RELAY WHERE THE DAEMON AND THE ESCALATION EXECUTOR BOTH HEAR");

    writeHearing(hearing, { v: 1, at: Math.floor(Date.now() / 1000), watch: watch.pubkey, relays: [{ url: relay.url, hears: true }] });
    const both = run(DAEMON, ["--check", toml]);
    expect(await both.exited, both.out()).toBe(0);
    expect(both.out()).toMatch(/\[check\] the escalation executor's hearing file \(.*hearing\.json, \d+s old\): it hears on 1\/1 of this config's relays/);

    // The same box with the line left out, as every box upgraded to this version is: a cron line that fails.
    writeFileSync(toml, readFileSync(toml, "utf8").replace(/^hearing_state_path = .*$/m, ""));
    const unset = run(DAEMON, ["--check", toml]);
    expect(await unset.exited, unset.out()).toBe(1);
    expect(unset.out()).toContain("[check] NO [log] hearing_state_path: this daemon publishes wherever it hears");
  }, 60_000);
});

function pagerToml(dir: string, relay: string, watchtower: string, flag: string): string {
  const path = join(dir, "pager.toml");
  writeFileSync(
    path,
    ["[watchtower]", `pubkey = "${watchtower}"`, "[relays]", `urls = ["${relay}"]`, "[page]", `command = ["touch", "${flag}"]`, ""].join("\n"),
  );
  return path;
}

describe("navcom-pager --check", () => {
  it("fails, naming the relay, when no relay answers the pager's subscription -- and pages nobody", async () => {
    const relay = await startRelay();
    relays.push(relay);
    relay.refuseReq = refusesDistressReq;
    const dir = tempDir();
    const flag = join(dir, "paged.flag");
    const watchtower = getPublicKey(generateSecretKey());
    const p = run(PAGER, ["--check", pagerToml(dir, relay.url, watchtower, flag)]);
    expect(await p.exited, p.out()).toBe(1);
    // Asked exactly as the running pager asks it.
    expect(distressReqs(relay)).toEqual([[{ kinds: [KIND_DISTRESS], "#p": [watchtower], limit: 0 }]]);
    expect(p.out()).toContain("[pager] --check: asking each relay for the subscription this pager makes. Nothing is paged");
    expect(p.out()).toContain(
      `[pager]   ${relay.url}: DOES NOT HEAR -- refused the subscription: auth-required: members only. A Distress sent only there pages nobody from here`,
    );
    expect(p.out()).toContain("[pager] hears on 0/1 relay(s)");
    expect(p.out()).toContain(
      "[pager] THIS PAGER HEARS ON NO RELAY IN THIS CONFIG, so it would page nobody. Pick a relay that serves it without " +
        "NIP-42 AUTH, or fix the one that is not answering",
    );
    expect(existsSync(flag), "--check paged somebody").toBe(false);
  }, 30_000);

  it("passes where a relay answers it, and still pages nobody", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const dir = tempDir();
    const flag = join(dir, "paged.flag");
    const watchtower = getPublicKey(generateSecretKey());
    const p = run(PAGER, ["--check", pagerToml(dir, relay.url, watchtower, flag)]);
    expect(await p.exited, p.out()).toBe(0);
    expect(distressReqs(relay)).toEqual([[{ kinds: [KIND_DISTRESS], "#p": [watchtower], limit: 0 }]]);
    expect(p.out()).toContain(`[pager]   ${relay.url}: answers it -- a Distress sent there pages from here`);
    expect(p.out()).toContain("[pager] hears on 1/1 relay(s)");
    expect(existsSync(flag)).toBe(false);
  }, 30_000);
});
