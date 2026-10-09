/**
 * The escalation executor writing down where it hears, for the daemon (`shared/hearing.ts`).
 *
 * The daemon publishes the watch state only where both processes hear, so what this file says is the
 * difference between a relay that refuses the executor reading Dark -- the truth -- and reading live
 * while a `Distress` sent only there pages nobody. Escalation is safety-critical: most of what follows
 * is the failure paths. A write that fails must never stop the ladder; a drill beside the live executor
 * must never overwrite it; a stopped executor must say so; an executor that hears nowhere must say that.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { SimplePool } from "nostr-tools/pool";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { Event } from "nostr-tools/core";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EscalationExecutor } from "../src/escalation/executor.js";
import type { EscalationConfig } from "../src/escalation/config.js";
import { KIND_DISTRESS, KIND_RESPONSE } from "../src/shared/kinds.js";
import type { HearingFile } from "../src/shared/hearing.js";
import { startRelay, eventually, type LocalRelay } from "./helpers/local-relay.js";
import { distressFrom, onCallEntry, workingPager } from "./helpers/executor.js";
import { loadOrCreateKeypair } from "../src/shared/identity.js";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const ESCALATION = join(PACKAGE, "src/escalation/index.ts");
const children: ChildProcess[] = [];

const nowS = () => Math.floor(Date.now() / 1000);

const dirs: string[] = [];
const executors: EscalationExecutor[] = [];
const relays: LocalRelay[] = [];

afterEach(async () => {
  for (const c of children.splice(0)) c.kill("SIGKILL");
  await Promise.all(executors.splice(0).map((e) => e.stop()));
  await Promise.all(relays.splice(0).map((r) => r.close()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "navcom-exhear-"));
  dirs.push(dir);
  return dir;
}

function config(urls: string[], dir: string, oncall: EscalationConfig["escalation"]["oncall"] = []): EscalationConfig {
  return {
    identity: { privkeyPath: "/dev/null" },
    relays: { urls },
    escalation: {
      pagingWindowSeconds: 300, contactWindowSeconds: 300, drillWindowDays: 7,
      drillAckWindowSeconds: 1, drillStatePath: join(dir, "drill.json"),
      maxPagesPerWindow: 20, pageBudgetWindowSeconds: 3_600, ladderRetentionSeconds: 3_600,
      ackHoldsSeconds: 1_800,
      oncall,
    },
    log: { path: join(dir, "escalation-log.jsonl"), retentionDays: 90 },
  };
}

const readFile = (path: string) => JSON.parse(readFileSync(path, "utf8")) as HearingFile;
const entry = (file: HearingFile, url: string) => file.relays.find((r) => r.url === url);

/** Per-relay subscriptions a test answers by hand: `answer(i)` is that relay's EOSE. */
function handPool() {
  type Params = { onevent?: (e: Event) => void; oneose?: () => void; onclose?: (r: unknown) => void };
  const subs: { url: string; params: Params }[] = [];
  const published: Event[] = [];
  const pool = {
    publish: (urls: string[], event: Event) => {
      published.push(event);
      return urls.map(() => Promise.resolve("ok"));
    },
    subscribeMany: (urls: string[], _f: unknown, params: Params) => {
      subs.push({ url: urls[0] ?? "", params });
      return { close: () => {} };
    },
    destroy: () => {},
  } as unknown as SimplePool;
  return { pool, subs, published, answer: (i: number) => subs[i]?.params.oneose?.() };
}

function executorWith(opts: {
  urls: string[];
  hearingStatePath?: string;
  pool?: SimplePool;
  page?: ReturnType<typeof workingPager>;
  oncall?: EscalationConfig["escalation"]["oncall"];
  secretKey?: Uint8Array;
}) {
  const secretKey = opts.secretKey ?? generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  const ex = new EscalationExecutor({
    config: config(opts.urls, tempDir(), opts.oncall),
    secretKey,
    pubkey,
    page: opts.page ?? (async () => []),
    ...(opts.pool ? { pool: opts.pool } : {}),
    ...(opts.hearingStatePath ? { hearingStatePath: opts.hearingStatePath } : {}),
  });
  executors.push(ex);
  return { ex, pubkey, secretKey };
}

describe("on real relays", () => {
  it("writes each relay, whether its subscription answers, and why not -- for this watch, now", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const open = await startRelay();
    const inbox = await startRelay();
    relays.push(open, inbox);
    // An inbox that wants AUTH for the executor's #p REQ: it takes writes and refuses the subscription.
    inbox.refuseReq = (filters) => (filters.some((f) => "#p" in f) ? "auth-required: members only" : null);
    const path = join(tempDir(), "hearing.json");
    const { ex, pubkey } = executorWith({ urls: [open.url, inbox.url], hearingStatePath: path });
    ex.start();

    await eventually(() => {
      const file = readFile(path);
      expect(entry(file, open.url)).toEqual({ url: open.url, hears: true });
      expect(entry(file, inbox.url)?.hears).toBe(false);
      expect(entry(file, inbox.url)?.why).toMatch(/^refused the subscription: auth-required: members only/);
    }, 8_000);
    const file = readFile(path);
    expect(file.v).toBe(1);
    expect(file.watch).toBe(pubkey);
    expect(Math.abs(file.at - nowS())).toBeLessThanOrEqual(2);
    expect(statSync(path).mode & 0o777).toBe(0o640);
  }, 15_000);

  it("writes it again at once when a relay stops answering, not at the next thirty-second write", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const open = await startRelay();
    relays.push(open);
    const path = join(tempDir(), "hearing.json");
    const { ex } = executorWith({ urls: [open.url], hearingStatePath: path });
    ex.start();
    await eventually(() => expect(entry(readFile(path), open.url)?.hears).toBe(true), 8_000);

    // Kept down once it goes, so the line is not raced by the relay answering again a second later.
    open.refuseReq = () => "restricted: closed for maintenance";
    const dropped = Date.now();
    open.dropAll();
    await eventually(() => expect(entry(readFile(path), open.url)?.hears).toBe(false), 3_000);
    expect(Date.now() - dropped).toBeLessThan(3_000);
  }, 15_000);
});

describe("its age says it is alive", () => {
  it("is written again every thirty seconds with nothing changed", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const path = join(tempDir(), "hearing.json");
    const hand = handPool();
    const { ex } = executorWith({ urls: ["wss://a.relay"], hearingStatePath: path, pool: hand.pool });
    ex.start();
    hand.answer(0);
    await vi.advanceTimersByTimeAsync(0);
    const first = readFile(path).at;
    expect(entry(readFile(path), "wss://a.relay")?.hears).toBe(true);

    await vi.advanceTimersByTimeAsync(29_000);
    expect(readFile(path).at, "written again before thirty seconds with nothing changed").toBe(first);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(readFile(path).at - first).toBeGreaterThanOrEqual(30);
    expect(readFile(path).at - first).toBeLessThanOrEqual(31);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(readFile(path).at - first).toBeGreaterThanOrEqual(60);
  });

  it("is written again at once when the clock steps back past the last write, rather than left to age out", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const path = join(tempDir(), "hearing.json");
    const hand = handPool();
    const { ex } = executorWith({ urls: ["wss://a.relay"], hearingStatePath: path, pool: hand.pool });
    ex.start();
    hand.answer(0);
    await vi.advanceTimersByTimeAsync(0);
    const first = readFile(path).at;

    // NTP steps the clock back a minute. Waiting thirty seconds by the new clock from a write stamped
    // ahead of it would leave the file ninety seconds old to a daemon whose clock is right: Dark.
    vi.setSystemTime(Date.now() - 60_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(readFile(path).at, "not written again after the clock stepped back").not.toBe(first);
    expect(Math.abs(readFile(path).at - nowS())).toBeLessThanOrEqual(1);
  });
});

describe("a write that fails", () => {
  it("is said once, never stops the ladder, and is said again when writing works", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.mocked(console.log);
    const dir = tempDir();
    // A file where its directory should be: every write fails, ENOTDIR.
    const blocker = join(dir, "drill");
    writeFileSync(blocker, "");
    const path = join(blocker, "hearing.json");
    const hand = handPool();
    const page = workingPager();
    const { ex, pubkey } = executorWith({
      urls: ["wss://a.relay"],
      hearingStatePath: path,
      pool: hand.pool,
      page,
      oncall: [onCallEntry("Wren", getPublicKey(generateSecretKey()))],
    });
    ex.start();
    hand.answer(0);
    await vi.advanceTimersByTimeAsync(65_000);

    const said = error.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("COULD NOT WRITE WHERE IT HEARS"));
    expect(said, "said on every write, or never").toHaveLength(1);
    expect(said[0]).toMatch(
      new RegExp(`^\\[executor\\] COULD NOT WRITE WHERE IT HEARS to ${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: .*The ladder runs regardless\\. A daemon reading this file treats this executor as hearing nowhere once it is 90s old, and operators then read Dark$`),
    );

    // The ladder, regardless: a Distress pages, and the operator is told.
    const d = distressFrom(generateSecretKey(), pubkey);
    hand.subs[0]!.params.onevent?.(d);
    await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(hand.published.some((e) => e.kind === KIND_RESPONSE && e.tags.some((t) => t[0] === "e" && t[1] === d.id))).toBe(true),
    );
    expect(d.kind).toBe(KIND_DISTRESS);

    // And once it can write again, that is said, and the file is there.
    rmSync(blocker);
    mkdirSync(blocker);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(existsSync(path)).toBe(true);
    expect(log.mock.calls.map((c) => String(c[0]))).toContain(`[executor] writing where it hears to ${path} again`);
  });
});

describe("an executor that stops", () => {
  it("writes that it hears nowhere, so a daemon stops believing it at its next read", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const path = join(tempDir(), "hearing.json");
    const hand = handPool();
    const { ex } = executorWith({ urls: ["wss://a.relay", "wss://b.relay"], hearingStatePath: path, pool: hand.pool });
    ex.start();
    hand.answer(0);
    hand.answer(1);
    await eventually(() => expect(readFile(path).relays.every((r) => r.hears)).toBe(true));

    await ex.stop();
    expect(readFile(path).relays).toEqual([
      { url: "wss://a.relay", hears: false, why: "the executor stopped" },
      { url: "wss://b.relay", hears: false, why: "the executor stopped" },
    ]);
  });
});

describe("--drill, run beside the live executor", () => {
  it("never touches what the live one wrote, even handed the same path", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const path = join(tempDir(), "hearing.json");
    const watch = generateSecretKey();
    const live = handPool();
    const { ex } = executorWith({ urls: ["wss://a.relay"], hearingStatePath: path, pool: live.pool, secretKey: watch });
    ex.start();
    live.answer(0);
    await eventually(() => expect(entry(readFile(path), "wss://a.relay")?.hears).toBe(true));
    const bytes = readFileSync(path, "utf8");
    const mtime = statSync(path).mtimeMs;

    // A drill that wrote would overwrite what the live executor hears -- and, stopping, write that it hears nowhere.
    const drill = executorWith({ urls: ["wss://a.relay"], hearingStatePath: path, pool: handPool().pool, secretKey: watch });
    await drill.ex.drillOnce();

    expect(readFileSync(path, "utf8")).toBe(bytes);
    expect(statSync(path).mtimeMs).toBe(mtime);
  });
});

describe("an executor that hears nowhere", () => {
  it("says so fifteen seconds after it starts and with every thirty-second write, and says when it hears again", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.mocked(console.log);
    const path = join(tempDir(), "hearing.json");
    const hand = handPool();
    const { ex } = executorWith({ urls: ["wss://a.relay"], hearingStatePath: path, pool: hand.pool });
    ex.start();
    const nowhere = () => error.mock.calls.map((c) => String(c[0])).filter((l) => /HEARS ON NO RELAY \(0\/1\)/.test(l));

    await vi.advanceTimersByTimeAsync(14_000);
    expect(nowhere(), "said before every relay had its first try").toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(nowhere()).toHaveLength(1);
    expect(nowhere()[0]).toBe(
      "[executor] HEARS ON NO RELAY (0/1) -- a Distress sent now pages nobody from this executor, and a daemon " +
        "reading its hearing file publishes the watch state nowhere. Each relay's own line above says why; retrying",
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect(nowhere()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(nowhere()).toHaveLength(3);

    hand.answer(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(log.mock.calls.map((c) => String(c[0]))).toContain("[executor] hears on 1/1 relay(s) again");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(nowhere(), "said again while it hears").toHaveLength(3);
  });
});

describe("an executor that hears nowhere, with no hearing file configured", () => {
  it("still says so, on the same beat: failure mode 30 holds on any box", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const hand = handPool();
    const { ex } = executorWith({ urls: ["wss://a.relay"], pool: hand.pool });
    ex.start();
    const nowhere = () => error.mock.calls.map((c) => String(c[0])).filter((l) => /HEARS ON NO RELAY \(0\/1\)/.test(l));

    await vi.advanceTimersByTimeAsync(14_000);
    expect(nowhere()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(nowhere(), "said only where a hearing file is written").toHaveLength(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(nowhere()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(nowhere()).toHaveLength(3);
  });
});

describe("navcom-escalation, run as the process it is", () => {
  function run(args: string[]) {
    const child = spawn(process.execPath, ["--import", "tsx", ESCALATION, ...args], { cwd: PACKAGE, stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    let out = "";
    child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (out += d.toString()));
    const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
    return { out: () => out, exited };
  }

  function toml(dir: string, relay: string, extra: string[] = []): string {
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
        `hearing_state_path = "${join(dir, "hearing.json")}"`,
        ...extra,
        "",
      ].join("\n"),
    );
    return path;
  }

  it("writes where it hears from its own start, and says where", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const dir = tempDir();
    const p = run([toml(dir, relay.url)]);
    const path = join(dir, "hearing.json");
    await eventually(() => expect(p.out()).toContain(
      `[executor] where it hears -> ${path}, every 30s and on any change. The daemon publishes the watch state only ` +
        "where both hear, once its [log] hearing_state_path names this file",
    ), 15_000);
    const watch = loadOrCreateKeypair(join(dir, "watchtower.key")).pubkey;
    await eventually(() => {
      const file = readFile(path);
      expect(file.watch).toBe(watch);
      expect(entry(file, relay.url)?.hears).toBe(true);
    }, 10_000);
  }, 30_000);

  it("--drill, beside it, never touches what it wrote", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const dir = tempDir();
    const config = toml(dir, relay.url, ["drill_ack_window_seconds = 1"]);
    const path = join(dir, "hearing.json");
    const live = run([config]);
    await eventually(() => expect(entry(readFile(path), relay.url)?.hears).toBe(true), 15_000);
    // Killed rather than stopped, so it writes nothing more and anything that changes is the drill's.
    for (const c of children.splice(0)) c.kill("SIGKILL");
    await live.exited;
    const bytes = readFileSync(path, "utf8");
    const mtime = statSync(path).mtimeMs;

    const drill = run(["--drill", config]);
    await drill.exited;
    expect(drill.out()).toMatch(/"command": "drill"/);
    expect(readFileSync(path, "utf8"), "--drill wrote where it hears").toBe(bytes);
    expect(statSync(path).mtimeMs).toBe(mtime);
  }, 40_000);
});
