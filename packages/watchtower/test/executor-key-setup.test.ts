/**
 * Setting up the executor's own key, and what the box says about it (decided 2026-10-07, G3).
 *
 * The key is only as separate as the file it lives in: one the daemon's user can read is one the
 * agent beside the daemon can sign "a person has it" with. And a relay that takes the watch key and
 * refuses a key with no history leaves phones handed the executor key unable to close a Distress
 * there, while the box looks healthy. So the config names the key and the daemon's user, startup says
 * what is missing and what that costs every time, and `--check` refuses what it can see is wrong.
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey, verifyEvent } from "nostr-tools/pure";
import { KIND_WATCH_CODE_SIGNATURE, parseWatchCode, type ResponsePayload } from "@navcom/core";
import { loadEscalationConfig } from "../src/escalation/config.js";
import { loadDaemonConfig } from "../src/daemon/config.js";
import {
  boxKeysOnRoster,
  checkKeyFile,
  earlierExecutorKeys,
  keyFileProblems,
  loadExecutorKey,
  loadWatchKey,
  relaysTakeBoth,
  watchCode,
  whyNotMake,
} from "../src/escalation/keys.js";
import { AccountabilityLog } from "../src/shared/accountability.js";
import { openResponse } from "../src/shared/crypto.js";
import { KIND_WATCH_STATE } from "../src/shared/kinds.js";
import { nodePool } from "../src/shared/nostr-node.js";
import { loadOrCreateKeypair } from "../src/shared/identity.js";
import { startRelay, eventually, type LocalRelay } from "./helpers/local-relay.js";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const ESCALATION = join(PACKAGE, "src/escalation/index.ts");

const dirs: string[] = [];
const relays: LocalRelay[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const c of children.splice(0)) c.kill("SIGKILL");
  await Promise.all(relays.splice(0).map((r) => r.close()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "navcom-exkey-"));
  dirs.push(dir);
  return dir;
}

function escalationToml(
  dir: string,
  opts: {
    relay?: string;
    identity?: string[];
    watchKey?: boolean;
    escalation?: string[];
    oncallPubkey?: string;
    /** Leave `hearing_state_path` out, for the default. Otherwise it is in `dir`, so no test executor writes /var/lib/navcom. */
    noHearingPath?: boolean;
  } = {},
): string {
  const path = join(dir, "escalation.toml");
  // The watch key, as the daemon's first start leaves it. Neither `--check` nor the executor makes one.
  if (opts.watchKey !== false) loadOrCreateKeypair(join(dir, "watchtower.key"));
  writeFileSync(
    path,
    [
      "[identity]",
      `privkey_path = "${join(dir, "watchtower.key")}"`,
      ...(opts.identity ?? []),
      "[relays]",
      `urls = ["${opts.relay ?? "ws://127.0.0.1:1"}"]`,
      "[log]",
      `path = "${join(dir, "escalation-log.jsonl")}"`,
      "[escalation]",
      `drill_state_path = "${join(dir, "drill.json")}"`,
      ...(opts.noHearingPath ? [] : [`hearing_state_path = "${join(dir, "hearing.json")}"`]),
      ...(opts.escalation ?? []),
      "[[escalation.oncall]]",
      'callsign = "Wren"',
      `pubkey = "${opts.oncallPubkey ?? getPublicKey(generateSecretKey())}"`,
      'channel = "sms"',
      'command = ["true"]',
      "",
    ].join("\n"),
  );
  return path;
}

/** A user id that is neither this process's nor root's: the daemon's user, on a box set up as documented. */
const otherUid = () => String(myUid() + 1);

const myUid = () => (typeof process.getuid === "function" ? process.getuid() : 0);

describe("the config", () => {
  it("names the executor's own key and the daemon's user, and leaves both out of a box that has neither", () => {
    const dir = tempDir();
    const without = loadEscalationConfig(escalationToml(dir));
    expect(without.identity.executorKeyPath).toBeUndefined();
    expect(without.identity.daemonUser).toBeUndefined();

    const withKey = loadEscalationConfig(
      escalationToml(dir, { identity: [`executor_key_path = "${join(dir, "executor.key")}"`, 'daemon_user = "navcom"'] }),
    );
    expect(withKey.identity.executorKeyPath).toBe(join(dir, "executor.key"));
    expect(withKey.identity.daemonUser).toBe("navcom");
    expect(loadEscalationConfig(escalationToml(dir, { identity: ["daemon_user = 1001"] })).identity.daemonUser).toBe("1001");
  });

  it("refuses the watch key's own file as the executor's key", () => {
    // A phone reads an executor key equal to the watch key as none, so the box would believe the two
    // separated while every phone kept the old rule.
    const dir = tempDir();
    expect(() =>
      loadEscalationConfig(escalationToml(dir, { identity: [`executor_key_path = "${join(dir, ".", "watchtower.key")}"`] })),
    ).toThrow(/executor_key_path is the watch key's own file/);
  });

  it("refuses a relative key path: one resolved against wherever the executor starts is a key made anew", () => {
    const dir = tempDir();
    expect(() => loadEscalationConfig(escalationToml(dir, { identity: ['executor_key_path = "executor.key"'] }))).toThrow(
      /executor_key_path must be an absolute path/,
    );
  });

  it("refuses an empty or non-text key path rather than reading it as none", () => {
    const dir = tempDir();
    expect(() => loadEscalationConfig(escalationToml(dir, { identity: ['executor_key_path = ""'] }))).toThrow(/executor_key_path/);
    expect(() => loadEscalationConfig(escalationToml(dir, { identity: ["executor_key_path = 7"] }))).toThrow(/executor_key_path/);
  });

  it("names where the executor writes where it hears: beside the drill file unless set, and never an empty path", () => {
    const dir = tempDir();
    expect(loadEscalationConfig(escalationToml(dir, { noHearingPath: true })).escalation.hearingStatePath).toBe("/var/lib/navcom/hearing.json");
    expect(loadEscalationConfig(escalationToml(dir)).escalation.hearingStatePath).toBe(join(dir, "hearing.json"));
    expect(() =>
      loadEscalationConfig(escalationToml(dir, { noHearingPath: true, escalation: ['hearing_state_path = ""'] })),
    ).toThrow(/\[escalation\] hearing_state_path must be a non-empty string/);
    expect(() =>
      loadEscalationConfig(escalationToml(dir, { noHearingPath: true, escalation: ["hearing_state_path = 30"] })),
    ).toThrow(/\[escalation\] hearing_state_path must be a non-empty string/);
  });

  it("refuses a hearing file that is any other file the executor keeps, which a rewrite every thirty seconds would replace", () => {
    const dir = tempDir();
    // The drill file: the slip the README invites, both in one directory. No scheduled drill would fire again.
    expect(() =>
      loadEscalationConfig(escalationToml(dir, { noHearingPath: true, escalation: [`hearing_state_path = "${join(dir, "drill.json")}"`] })),
    ).toThrow(/hearing_state_path is the same file as \[escalation\] drill_state_path/);
    expect(() =>
      loadEscalationConfig(escalationToml(dir, { noHearingPath: true, escalation: [`hearing_state_path = "${join(dir, "escalation-log.jsonl")}"`] })),
    ).toThrow(/same file as \[log\] path/);
    expect(() =>
      loadEscalationConfig(escalationToml(dir, { noHearingPath: true, escalation: [`hearing_state_path = "${join(dir, "watchtower.key")}"`] })),
    ).toThrow(/same file as \[identity\] privkey_path/);
    expect(() =>
      loadEscalationConfig(
        escalationToml(dir, {
          noHearingPath: true,
          identity: [`executor_key_path = "${join(dir, "executor.key")}"`],
          escalation: [`hearing_state_path = "${join(dir, "executor.key")}"`],
        }),
      ),
    ).toThrow(/same file as \[identity\] executor_key_path/);
    // Spelled differently, still one file.
    expect(() =>
      loadEscalationConfig(escalationToml(dir, { noHearingPath: true, escalation: [`hearing_state_path = "${dir}/./drill.json"`] })),
    ).toThrow(/same file as \[escalation\] drill_state_path/);
  });
});

describe("escalation.example.toml, which is where a Stationkeeper starts", () => {
  const example = join(PACKAGE, "escalation.example.toml");

  it("still loads, and names no executor key until somebody sets one", () => {
    const config = loadEscalationConfig(example);
    expect(config.identity.executorKeyPath).toBeUndefined();
    expect(config.escalation.maxPagesPerWindow).toBe(20);
  });

  it("names the same hearing file the daemon's example reads, so a new box publishes only where both hear", () => {
    const executor = loadEscalationConfig(example).escalation.hearingStatePath;
    const daemon = loadDaemonConfig(join(PACKAGE, "watchtower.example.toml")).log.hearingStatePath;
    expect(executor).toBeTruthy();
    expect(readFileSync(example, "utf8")).toMatch(/^hearing_state_path = "\/var\/lib\/navcom\/hearing\.json"$/m);
    expect(daemon, "the two example configs name different hearing files").toBe(executor);
  });

  it("documents the executor's own key, the daemon's user, and a navcom-push template that says all three kinds", () => {
    const text = readFileSync(example, "utf8");
    expect(text).toMatch(/^# executor_key_path = /m);
    expect(text).toMatch(/^# daemon_user = /m);
    expect(text).toContain('"--kind", "{{kind}}", "--distress", "{{distress}}", "--attempt", "{{attempt}}"');
    // The budget counts first pages only now; the old warning that re-pages spend it would be false.
    expect(text).not.toMatch(/come out of this too/);
    expect(text).toMatch(/counts FIRST pages only/);
  });
});

describe("the key, made on first start by the user the executor runs as", () => {
  it("is made once, readable only by its owner, and the same key after", () => {
    const dir = tempDir();
    const path = join(dir, "escalation", "executor.key");
    const first = loadExecutorKey(path);
    expect(first.created).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "escalation")).mode & 0o077).toBe(0);
    const again = loadExecutorKey(path);
    expect(again.created).toBe(false);
    expect(again.pubkey).toBe(first.pubkey);
  });
});

describe("who can read it", () => {
  const facts = { mode: 0o100600, uid: 501 };
  const own = { executorUid: 501, daemonUser: "navcom", daemonUid: 502 };

  it("is nobody else on a box set up as documented", () => {
    expect(keyFileProblems("/k", facts, own)).toEqual([]);
  });

  it("refuses a file other users can read, or one another user owns", () => {
    expect(keyFileProblems("/k", { ...facts, mode: 0o100644 }, own).join(" ")).toMatch(/other users can read or change it \(mode 644\) -- run: chmod 600 \/k/);
    expect(keyFileProblems("/k", { ...facts, mode: 0o100640 }, own)).toHaveLength(1);
    expect(keyFileProblems("/k", { ...facts, uid: 900 }, own).join(" ")).toMatch(/owned by uid 900, not by the user this executor runs as/);
  });

  it("refuses a key the daemon's user owns, or an executor running as the daemon's user", () => {
    expect(keyFileProblems("/k", { ...facts, uid: 502 }, { ...own, executorUid: 502 }).join("\n")).toMatch(
      /owned by the daemon's user \(navcom\)[\s\S]*runs as the daemon's user \(navcom\)/,
    );
  });

  it("refuses a daemon that runs as root, which can read every file, and never says root cannot", () => {
    expect(keyFileProblems("/k", facts, { ...own, daemonUser: "root", daemonUid: 0 }).join(" ")).toMatch(
      /the daemon runs as root \(root\), which can read every file on this machine, this one included/,
    );
  });

  it("cannot pass without knowing the daemon's user, and says so", () => {
    expect(keyFileProblems("/k", facts, { ...own, daemonUser: null, daemonUid: null }).join(" ")).toMatch(/daemon_user is not set/);
    expect(keyFileProblems("/k", facts, { ...own, daemonUser: "nobody-here", daemonUid: null }).join(" ")).toMatch(
      /"nobody-here" is not a user on this machine/,
    );
  });

  it("reads the real file system: a 0644 key, and the daemon's user being this one, are both refused", () => {
    const dir = tempDir();
    const path = join(dir, "executor.key");
    loadExecutorKey(path);
    expect(checkKeyFile(path, String(myUid() + 1))).toEqual([]);
    chmodSync(path, 0o644);
    expect(checkKeyFile(path, String(myUid() + 1)).join(" ")).toMatch(/mode 644/);
    chmodSync(path, 0o600);
    expect(checkKeyFile(path, userInfo().username).join(" ")).toMatch(/daemon's user/);
    expect(checkKeyFile(path, undefined).join(" ")).toMatch(/daemon_user is not set/);
  });
});

describe("when the executor may make its key", () => {
  const own = { executorUid: 501, daemonUser: "navcom", daemonUid: 502 };

  it("only as a user of its own: daemon_user set, a user here, not root, and not this process's user", () => {
    expect(whyNotMake(own)).toBeNull();
    expect(whyNotMake({ ...own, daemonUser: null, daemonUid: null })).toMatch(/daemon_user is not set/);
    expect(whyNotMake({ ...own, daemonUser: "ghost", daemonUid: null })).toMatch(/"ghost" is not a user on this machine/);
    expect(whyNotMake({ ...own, daemonUser: "root", daemonUid: 0 })).toMatch(/root/);
    expect(whyNotMake({ ...own, executorUid: 502 })).toMatch(/runs as the daemon's user/);
  });

  it("finds an earlier executor key in its own log, which outlives a key file that was lost", () => {
    const dir = tempDir();
    const logPath = join(dir, "escalation-log.jsonl");
    const watch = getPublicKey(generateSecretKey());
    const lost = getPublicKey(generateSecretKey());
    const { log } = AccountabilityLog.open(logPath, 90);
    log.record({ at: 1, actor: { kind: "node", callsign: "escalation", pubkey: lost }, action: "escalated", subject: null, outcome: "escalation-reached-nobody" });
    log.record({ at: 2, actor: { kind: "node", callsign: "escalation", pubkey: watch }, action: "escalated", subject: null, outcome: "escalation-reached-nobody" });
    log.close();
    expect(earlierExecutorKeys(logPath, [watch])).toEqual([lost]);
    expect(earlierExecutorKeys(logPath, [watch, lost])).toEqual([]);
    expect(earlierExecutorKeys(join(dir, "nothing.jsonl"), [])).toEqual([]);
  });

  it("never makes the watch key", () => {
    const dir = tempDir();
    expect(() => loadWatchKey(join(dir, "watchtower.key"))).toThrow(/never makes one/);
    expect(existsSync(join(dir, "watchtower.key"))).toBe(false);
  });

  it("names roster entries that use the watch key or the executor's", () => {
    const watch = getPublicKey(generateSecretKey());
    const entry = (callsign: string, pubkey?: string) => ({
      declaration: { author: { kind: "node" as const, callsign, ...(pubkey ? { pubkey } : {}) }, channel: "sms" as const, expires: 4_102_444_800 },
    });
    expect(boxKeysOnRoster([entry("Wren", getPublicKey(generateSecretKey())), entry("Console", watch), entry("Phone")], [watch])).toEqual(["Console"]);
  });
});

type ReadCode = { pubkey: string; relays: string[]; holders: string[]; executor?: string; issuedAt: number };

/**
 * A watch code read back: by the parser the Field Terminal uses (`@navcom/core`'s `parseWatchCode`), and
 * by the signature rule rebuilt here by hand from the spec's words -- a code the phone cannot read leaves
 * the executor's key no way onto a phone.
 */
async function readCode(code: string): Promise<ReadCode> {
  const params = new URLSearchParams(code.slice(code.indexOf("#") + 1));
  const relays = params.getAll("r");
  const fields = { pubkey: params.get("w")!, relays, holders: params.getAll("h"), ...(params.get("x") ? { executor: params.get("x")! } : {}) };
  const issuedAt = Number(params.get("t"));
  const event = {
    kind: KIND_WATCH_CODE_SIGNATURE,
    pubkey: fields.pubkey,
    created_at: issuedAt,
    tags: [] as string[][],
    content: JSON.stringify(["navcom-watch-code-v1", fields.pubkey, [...relays].sort(), [], fields.executor ?? null]),
  };
  expect(verifyEvent({ ...event, id: getEventHash(event), sig: params.get("s")! }), "the code is not signed by the watch it names").toBe(true);
  const read = parseWatchCode(code);
  expect([read.pubkey, read.relays, read.executor, read.issuedAt]).toEqual([fields.pubkey, relays, fields.executor, issuedAt]);
  return { ...fields, issuedAt };
}

/** The watch code a run printed after `label`. */
const printedCode = (out: string, label: string) => out.match(new RegExp(`${label}(https://navcom\\.app/terminal/setup/#\\S+)`))?.[1] ?? "";

describe("the watch code the box hands out", () => {
  it("carries the watch, its relays and the executor's key, signed by the watch key, in the form the Field Terminal reads", async () => {
    const secret = generateSecretKey();
    const watch = { secretKey: secret, pubkey: getPublicKey(secret) };
    const executor = getPublicKey(generateSecretKey());
    const code = watchCode(watch, ["wss://b.example/x?y=1", "wss://a.example", "wss://a.example"], executor, 1_800_000_000);
    expect(code.startsWith("https://navcom.app/terminal/setup/#watch=1&")).toBe(true);
    const read = await readCode(code);
    expect([read.pubkey, read.relays, read.executor, read.issuedAt]).toEqual([
      watch.pubkey,
      ["wss://b.example/x?y=1", "wss://a.example"],
      executor,
      1_800_000_000,
    ]);
    expect(watchCode(watch, ["wss://a.example"])).not.toMatch(/[&#]x=/);
  });

  it("is refused once changed: another key in place of the executor's does not verify", async () => {
    // What a stranger with the watch's public address would try: the phone must fill in nothing.
    const secret = generateSecretKey();
    const code = watchCode({ secretKey: secret, pubkey: getPublicKey(secret) }, ["wss://a.example"], getPublicKey(generateSecretKey()));
    const swapped = code.replace(/x=[0-9a-f]{64}/, `x=${getPublicKey(generateSecretKey())}`);
    await expect(readCode(swapped)).rejects.toThrow();
  });
});

describe("every relay must take both keys", () => {
  it("names a relay that takes the watch key and refuses the executor's", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const watch = (() => { const s = generateSecretKey(); return { secretKey: s, pubkey: getPublicKey(s) }; })();
    const executor = (() => { const s = generateSecretKey(); return { secretKey: s, pubkey: getPublicKey(s) }; })();
    // A relay that limits new keys: the executor's key has no history there.
    relay.refuseEvent = (e) => (e.pubkey === executor.pubkey ? "restricted: unknown key" : null);
    const pool = nodePool();
    try {
      const [r] = await relaysTakeBoth(pool, [relay.url], watch, executor);
      expect(r!.watch).toBeNull();
      expect(r!.executor).toMatch(/restricted: unknown key/);
      // Sent as the executor sends: its own first, then the watch key's copy naming it -- so a relay that
      // refuses the second of a pair refuses here what it would refuse in production. Each an ephemeral
      // response, addressed to and sealed for the key that signed it.
      expect(relay.published.map((e) => [e.kind, e.pubkey, e.tags])).toEqual([
        [20912, executor.pubkey, [["p", executor.pubkey]]],
        [20912, watch.pubkey, [["p", watch.pubkey]]],
      ]);
      const copy = openResponse<ResponsePayload>(watch.secretKey, watch.pubkey, relay.published[1]!.content);
      expect(copy.copy_of).toBe(relay.published[0]!.id);
    } finally {
      pool.destroy();
    }
  });

  it("names a relay that takes the executor's and refuses the watch key's copy", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const watch = (() => { const s = generateSecretKey(); return { secretKey: s, pubkey: getPublicKey(s) }; })();
    const executor = (() => { const s = generateSecretKey(); return { secretKey: s, pubkey: getPublicKey(s) }; })();
    relay.refuseEvent = (e) => (e.pubkey === watch.pubkey ? "rate-limited: slow down" : null);
    const pool = nodePool();
    try {
      const [r] = await relaysTakeBoth(pool, [relay.url], watch, executor);
      expect(r!.executor).toBeNull();
      expect(r!.watch).toMatch(/rate-limited/);
    } finally {
      pool.destroy();
    }
  });
});

/** Runs navcom-escalation with these arguments, collecting everything it says. */
function run(args: string[]) {
  const child = spawn(process.execPath, ["--import", "tsx", ESCALATION, ...args], {
    cwd: PACKAGE,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let out = "";
  child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (out += d.toString()));
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return { out: () => out, exited };
}

describe("what the executor says", () => {
  it("says at start, every start, that it has no key of its own and what that costs", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const dir = tempDir();
    const p = run([escalationToml(dir, { relay: relay.url })]);
    await eventually(() => expect(p.out()).toMatch(/subscribing for 20911/), 15_000);
    expect(p.out()).toMatch(/NO EXECUTOR KEY\. Every answer that ends a Distress is signed with the watch key/);
    expect(p.out()).toMatch(/the agent beside it/);
  }, 20_000);

  it("makes its own key on first start as a user of its own, says its public half, and prints the watch code that carries it", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const dir = tempDir();
    const keyPath = join(dir, "executor", "executor.key");
    const p = run([escalationToml(dir, { relay: relay.url, identity: [`executor_key_path = "${keyPath}"`, `daemon_user = "${otherUid()}"`] })]);
    await eventually(() => expect(p.out()).toMatch(/subscribing for 20911/), 15_000);
    const key = loadExecutorKey(keyPath);
    expect(key.created).toBe(false);
    expect(statSync(keyPath).mode & 0o777).toBe(0o600);
    expect(p.out()).toMatch(/made the executor's own key at .*executor\.key, readable only by this user/);
    expect(p.out()).toContain(`executor key: ${key.pubkey}`);
    const watch = loadWatchKey(join(dir, "watchtower.key"));
    const read = await readCode(printedCode(p.out(), "watch code: "));
    expect([read.pubkey, read.relays, read.executor]).toEqual([watch.pubkey, [relay.url], key.pubkey]);
    expect(p.out()).not.toMatch(/NO EXECUTOR KEY|NOT ITS OWN|NEW EXECUTOR KEY/);
  }, 20_000);

  it("makes no key where nothing confirms the daemon could not read it, says why, and runs without one", async () => {
    // A key born readable by the daemon's user looks clean after a chown, and nothing records it was exposed.
    const relay = await startRelay();
    relays.push(relay);
    const dir = tempDir();
    for (const [i, identity] of [[], [`daemon_user = "${userInfo().username}"`], ['daemon_user = "0"']].entries()) {
      const keyPath = join(dir, `executor-${i}.key`);
      const p = run([escalationToml(dir, { relay: relay.url, identity: [`executor_key_path = "${keyPath}"`, ...identity] })]);
      await eventually(() => expect(p.out()).toMatch(/subscribing for 20911/), 15_000);
      expect(existsSync(keyPath), `made a key with ${identity.join("") || "no daemon_user"}`).toBe(false);
      expect(p.out()).toMatch(/NO EXECUTOR KEY at .*, and not making one: (daemon_user is not set|this executor runs as the daemon's user|daemon_user is root)/);
      expect(p.out()).toMatch(/The ladder runs, and pages, regardless/);
      expect(p.out()).not.toMatch(/watch code:/);
    }
  }, 45_000);

  it("still signs with an existing key that fails its check -- but never offers it for handing out", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const dir = tempDir();
    const keyPath = join(dir, "executor.key");
    loadExecutorKey(keyPath);
    const p = run([escalationToml(dir, { relay: relay.url, identity: [`executor_key_path = "${keyPath}"`] })]);
    await eventually(() => expect(p.out()).toMatch(/subscribing for 20911/), 15_000);
    expect(p.out()).toMatch(/THE EXECUTOR'S KEY IS NOT ITS OWN[\s\S]*daemon_user is not set[\s\S]*Do not hand it to operators/);
    expect(p.out()).not.toMatch(/watch code:|Hand operators/);
  }, 20_000);

  it("does not start without the watch key, and never makes one -- a new key would be a watch no phone knows", async () => {
    const dir = tempDir();
    const p = run([escalationToml(dir, { watchKey: false })]);
    expect(await p.exited).toBe(1);
    expect(p.out()).toMatch(/NO WATCH KEY: there is nothing at .*watchtower\.key[\s\S]*Not starting/);
    expect(existsSync(join(dir, "watchtower.key")), "the executor made a watch key").toBe(false);
  }, 20_000);

  it("--drill never makes the executor's key", async () => {
    const dir = tempDir();
    const keyPath = join(dir, "executor.key");
    const p = run(["--drill", escalationToml(dir, { identity: [`executor_key_path = "${keyPath}"`, `daemon_user = "${otherUid()}"`], escalation: ["drill_ack_window_seconds = 1"] })]);
    await p.exited;
    expect(p.out()).toMatch(/--drill never makes it/);
    expect(existsSync(keyPath), "--drill made the executor's key").toBe(false);
  }, 20_000);

  it("says loudly, at every start and in --check, that a key it made replaces one its log names, until a person says otherwise", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const dir = tempDir();
    const keyPath = join(dir, "executor.key");
    const lost = getPublicKey(generateSecretKey());
    const { log } = AccountabilityLog.open(join(dir, "escalation-log.jsonl"), 90);
    log.record({ at: 1, actor: { kind: "node", callsign: "escalation", pubkey: lost }, action: "escalated", subject: null, outcome: "escalation-reached-human" });
    log.close();
    const toml = escalationToml(dir, { relay: relay.url, identity: [`executor_key_path = "${keyPath}"`, `daemon_user = "${otherUid()}"`] });

    const p = run([toml]);
    await eventually(() => expect(p.out()).toMatch(/subscribing for 20911/), 15_000);
    expect(existsSync(keyPath)).toBe(true);
    expect(p.out()).toMatch(new RegExp(`THIS IS A NEW EXECUTOR KEY[\\s\\S]*signed as ${lost.slice(0, 8)} before[\\s\\S]*remove .*executor\\.key\\.replaced`));
    for (const c of children.splice(0)) c.kill("SIGKILL");

    const failing = run(["--check", toml]);
    expect(await failing.exited).toBe(1);
    expect(failing.out()).toMatch(/REFUSED: THIS IS A NEW EXECUTOR KEY/);

    rmSync(`${keyPath}.replaced`);
    const passing = run(["--check", toml]);
    expect(await passing.exited).toBe(0);
    expect(passing.out()).not.toMatch(/NEW EXECUTOR KEY/);
  }, 45_000);

  it("still starts, and says what it costs, when its key file cannot be read -- paging nobody is the worse failure", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const dir = tempDir();
    const keyPath = join(dir, "executor.key");
    writeFileSync(keyPath, "not a key\n", { mode: 0o600 });
    const p = run([escalationToml(dir, { relay: relay.url, identity: [`executor_key_path = "${keyPath}"`] })]);
    await eventually(() => expect(p.out()).toMatch(/subscribing for 20911/), 15_000);
    expect(p.out()).toMatch(/COULD NOT LOAD THE EXECUTOR'S KEY[\s\S]*ends no Distress on any of them[\s\S]*pages, regardless/);
  }, 20_000);

  it("--check: says what a box without the key costs, and still passes on its roster", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const dir = tempDir();
    const p = run(["--check", escalationToml(dir, { relay: relay.url })]);
    expect(await p.exited).toBe(0);
    expect(p.out()).toMatch(/\[check\] NO EXECUTOR KEY/);
    expect(p.out()).toMatch(/every command ran/);
  }, 20_000);

  it("--check: refuses a relay that takes the watch key and not the executor's, and fails", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const dir = tempDir();
    const keyPath = join(dir, "executor.key");
    const executor = loadExecutorKey(keyPath);
    relay.refuseEvent = (e) => (e.pubkey === executor.pubkey ? "restricted: not on the list" : null);
    const p = run([
      "--check",
      escalationToml(dir, { relay: relay.url, identity: [`executor_key_path = "${keyPath}"`, `daemon_user = "${myUid() + 1}"`] }),
    ]);
    expect(await p.exited).toBe(1);
    expect(p.out()).toContain(`executor key: ${executor.pubkey}`);
    expect(p.out()).toMatch(/only this user can read it/);
    expect(p.out()).toMatch(/REFUSED -- takes the watch key and refuses the executor's \(restricted: not on the list\)/);
    expect(p.out()).toMatch(/every command ran/);
  }, 20_000);

  it("--check: passes a box whose key only it can read, on relays that take both, and prints the watch code", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const dir = tempDir();
    const keyPath = join(dir, "executor.key");
    const key = loadExecutorKey(keyPath);
    const toml = escalationToml(dir, { relay: relay.url, identity: [`executor_key_path = "${keyPath}"`, `daemon_user = "${otherUid()}"`] });
    const watch = loadWatchKey(join(dir, "watchtower.key"));
    const p = run(["--check", toml]);
    expect(await p.exited).toBe(0);
    expect(p.out()).toMatch(/takes both keys/);
    const read = await readCode(printedCode(p.out(), "watch code, carrying the executor's key -- hand it to operators: "));
    expect([read.pubkey, read.relays, read.executor]).toEqual([watch.pubkey, [relay.url], key.pubkey]);
  }, 20_000);

  it("--check: says the watch key, and whether the daemon is publishing with it -- a wrong copy leaves the executor deaf", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const dir = tempDir();
    const toml = escalationToml(dir, { relay: relay.url });
    const watch = loadWatchKey(join(dir, "watchtower.key"));
    const unseen = run(["--check", toml]);
    expect(await unseen.exited, "a daemon not yet running fails the executor's check").toBe(0);
    expect(unseen.out()).toContain(`watch key: ${watch.pubkey}`);
    expect(unseen.out()).toMatch(/no relay holds a watch state signed by this key\. If the daemon is running, privkey_path is not its key/);

    // The daemon's watch state, on the relay.
    relay.deliver(finalizeEvent({ kind: KIND_WATCH_STATE, tags: [], content: "{}", created_at: Math.floor(Date.now() / 1000) }, watch.secretKey));
    const seen = run(["--check", toml]);
    expect(await seen.exited).toBe(0);
    expect(seen.out()).toMatch(/a relay holds a watch state signed by it -- the daemon is publishing with this key/);
  }, 30_000);

  it("--check: refuses a relay that takes the executor's key and refuses the watch key's copy, and fails", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const dir = tempDir();
    const keyPath = join(dir, "executor.key");
    loadExecutorKey(keyPath);
    const toml = escalationToml(dir, { relay: relay.url, identity: [`executor_key_path = "${keyPath}"`, `daemon_user = "${otherUid()}"`] });
    const watch = loadWatchKey(join(dir, "watchtower.key"));
    relay.refuseEvent = (e) => (e.kind === 20912 && e.pubkey === watch.pubkey ? "rate-limited: one at a time" : null);
    const p = run(["--check", toml]);
    expect(await p.exited).toBe(1);
    expect(p.out()).toMatch(/REFUSED -- takes the executor's key and refuses the watch key's copy \(rate-limited: one at a time\)/);
    expect(p.out()).not.toMatch(/watch code, carrying/);
  }, 20_000);

  it("--check: fails on an on-call entry that uses the watch's own key", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const dir = tempDir();
    const watch = loadOrCreateKeypair(join(dir, "watchtower.key"));
    const p = run(["--check", escalationToml(dir, { relay: relay.url, oncallPubkey: watch.pubkey })]);
    expect(await p.exited).toBe(1);
    expect(p.out()).toMatch(/REFUSED: Wren is on call with the watch's own key/);
  }, 20_000);

  it("--check: never makes a watch key either -- one made there would be a new watch nobody's phone knows", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const dir = tempDir();
    const keyPath = join(dir, "executor.key");
    loadExecutorKey(keyPath);
    const p = run([
      "--check",
      escalationToml(dir, { relay: relay.url, watchKey: false, identity: [`executor_key_path = "${keyPath}"`, `daemon_user = "${myUid() + 1}"`] }),
    ]);
    expect(await p.exited).toBe(1);
    expect(p.out()).toMatch(/WATCH KEY: there is nothing at .*watchtower\.key/);
    expect(existsSync(join(dir, "watchtower.key")), "--check made a watch key").toBe(false);
  }, 20_000);

  it("--check: refuses a key the daemon's user can read, and never makes one it was not given", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const dir = tempDir();
    const keyPath = join(dir, "executor.key");
    const missing = run(["--check", escalationToml(dir, { relay: relay.url, identity: [`executor_key_path = "${keyPath}"`] })]);
    expect(await missing.exited).toBe(1);
    expect(missing.out()).toMatch(/EXECUTOR KEY: there is nothing at .*executor\.key/);
    expect(existsSync(keyPath), "--check made the executor's key").toBe(false);

    loadExecutorKey(keyPath);
    chmodSync(keyPath, 0o644);
    const exposed = run([
      "--check",
      escalationToml(dir, { relay: relay.url, identity: [`executor_key_path = "${keyPath}"`, `daemon_user = "${userInfo().username}"`] }),
    ]);
    expect(await exposed.exited).toBe(1);
    expect(exposed.out()).toMatch(/REFUSED: other users can read or change it/);
    expect(exposed.out()).toMatch(/REFUSED: this executor runs as the daemon's user/);
  }, 30_000);
});
