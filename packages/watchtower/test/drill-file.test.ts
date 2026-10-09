/**
 * The drill file, once the executor runs as a user of its own (`ops/systemd/README.md`, 4b).
 *
 * The executor writes it and the daemon reads it to publish the last drill in `10910`. Written `0600`
 * by the executor's user, the daemon's user could not read it, `lastDrill()` swallowed the error, and
 * the watch was demoted from automated-oncall to automated with nothing said anywhere [review: box
 * safety]. So the file is written group-readable -- nothing in it is private -- and the daemon says
 * when a drill file it can see cannot be read.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { SimplePool } from "nostr-tools/pool";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDrillState, writeDrillState } from "../src/escalation/drills.js";
import { WatchtowerDaemon } from "../src/daemon/watchtower.js";
import type { DaemonConfig } from "../src/daemon/config.js";

const dirs: string[] = [];
const daemons: WatchtowerDaemon[] = [];
afterEach(async () => {
  await Promise.all(daemons.splice(0).map((d) => d.stop()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "navcom-drill-"));
  dirs.push(dir);
  return dir;
}

const state = { last: { at: 1_800_000_000, result: "pass" as const, paged: ["Wren"], acknowledged: [], firstAckMs: 1_000 }, nextAt: 1_800_600_000 };

describe("the executor writes it so the daemon's group can read it", () => {
  it("makes it 0640, and puts an older 0600 file right on its next write", () => {
    const dir = tempDir();
    const path = join(dir, "drill", "drill.json");
    writeDrillState(path, state);
    expect(statSync(path).mode & 0o777).toBe(0o640);

    chmodSync(path, 0o600);
    writeDrillState(path, state);
    expect(statSync(path).mode & 0o777, "a file the daemon's user could not read stayed that way").toBe(0o640);
  });
});

describe("whatever is left where it writes", () => {
  it("replaces a link at the path, and never writes through it to a file of the executor's", () => {
    // The daemon's user can write the default drill directory; the executor may run as a user of its own.
    const dir = tempDir();
    const own = join(dir, "navcom-escalation");
    mkdirSync(own, { mode: 0o700 });
    const key = join(own, "watchtower.key");
    writeFileSync(key, "SECRET-EXECUTOR-KEY-HEX\n", { mode: 0o600 });
    chmodSync(key, 0o600);
    const path = join(dir, "drill.json");
    symlinkSync(key, path);
    writeDrillState(path, state);
    expect(readFileSync(key, "utf8"), "the next drill overwrote the executor's key").toBe("SECRET-EXECUTOR-KEY-HEX\n");
    expect(statSync(key).mode & 0o777).toBe(0o600);
    expect(lstatSync(path).isSymbolicLink()).toBe(false);
    expect(readDrillState(path)).toEqual(state);
  });
});

describe("reading it back", () => {
  it("is not a drill file unless it says when the next drill is due", () => {
    // The hearing file at the same path, by a slip: `due()` compared the clock with undefined, and no
    // scheduled drill ever fired again. Read as no file, a fresh schedule is made.
    const path = join(tempDir(), "drill.json");
    writeFileSync(path, JSON.stringify({ v: 1, at: 1_800_000_000, watch: "a".repeat(64), relays: [] }));
    expect(readDrillState(path)).toBeNull();
    writeFileSync(path, JSON.stringify({ last: null, nextAt: "soon" }));
    expect(readDrillState(path)).toBeNull();
    writeFileSync(path, JSON.stringify([1, 2]));
    expect(readDrillState(path)).toBeNull();
    writeFileSync(path, JSON.stringify(state));
    expect(readDrillState(path)).toEqual(state);
  });
});

describe("the daemon says when a drill file it can see cannot be read", () => {
  function daemon(drillStatePath: string) {
    const secretKey = generateSecretKey();
    const pool = {
      publish: (relays: string[]) => relays.map(() => Promise.resolve("ok")),
      subscribeMany: (_r: string[], _f: unknown, params: { oneose?: () => void }) => {
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
      log: { path: "/dev/null", retentionDays: 90, drillStatePath, escalationLogPath: null },
    };
    const d = new WatchtowerDaemon({ config, secretKey, pubkey: getPublicKey(secretKey), pool });
    daemons.push(d);
    return d as unknown as { lastDrill(): unknown };
  }

  it("once, until it reads again -- and says nothing for a file that is simply not there", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = tempDir();
    const path = join(dir, "drill.json");
    const d = daemon(path);

    // Not there: no drill has run, which is not a fault.
    expect(d.lastDrill()).toBeNull();
    expect(error).not.toHaveBeenCalled();

    // There and unreadable -- a directory stands in for a file another user owns at 0600.
    mkdirSync(path);
    expect(d.lastDrill()).toBeNull();
    expect(d.lastDrill()).toBeNull();
    const said = error.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("[drill]"));
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/the drill file at .*drill\.json exists and cannot be read: .*reads as automated rather than automated-oncall/);

    // Readable again, then not: said again.
    rmSync(path, { recursive: true });
    writeFileSync(path, JSON.stringify(state));
    expect(d.lastDrill()).toMatchObject({ result: "pass" });
    rmSync(path);
    mkdirSync(path);
    expect(d.lastDrill()).toBeNull();
    expect(error.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("[drill]"))).toHaveLength(2);
  });
});
