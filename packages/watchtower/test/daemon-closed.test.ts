/**
 * The box is closed by default (SC7, 2026-11-04), tested on the process a box actually runs.
 *
 * A daemon whose config lists nobody used to come up open to anyone who knew the watch's key. Now
 * it refuses to start and says the two ways forward, rather than coming up, publishing a watch
 * state and dropping every sign-on -- a box that looks up and hears nobody. With a list, or with
 * `open = true` said in as many words, it starts and says which it is.
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { startRelay, eventually, type LocalRelay } from "./helpers/local-relay.js";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const DAEMON = join(PACKAGE, "src/daemon/index.ts");

const relays: LocalRelay[] = [];
const dirs: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const c of children.splice(0)) c.kill("SIGKILL");
  await Promise.all(relays.splice(0).map((r) => r.close()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function run(args: string[]) {
  const child = spawn(process.execPath, ["--import", "tsx", DAEMON, ...args], { cwd: PACKAGE, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let out = "";
  child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (out += d.toString()));
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return { out: () => out, exited };
}

/** A watchtower.toml with the given [authorization] lines, or none. */
function toml(relay: string, authorization: string[] | null): string {
  const dir = mkdtempSync(join(tmpdir(), "navcom-closed-"));
  dirs.push(dir);
  const path = join(dir, "watchtower.toml");
  writeFileSync(
    path,
    [
      "[identity]",
      `privkey_path = "${join(dir, "watchtower.key")}"`,
      "[relays]",
      `urls = ["${relay}"]`,
      "[log]",
      `path = "${join(dir, "log.jsonl")}"`,
      ...(authorization ? ["[authorization]", ...authorization] : []),
      "",
    ].join("\n"),
  );
  return path;
}

describe("a box closed by default", () => {
  it("refuses to start with no [authorization] at all, and says both ways forward", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const daemon = run([toml(relay.url, null)]);
    expect(await daemon.exited).toBe(1);
    expect(daemon.out()).toContain("[daemon] not starting: this watch would hear nobody");
    expect(daemon.out()).toContain("allowed_pubkeys");
    expect(daemon.out()).toContain("open = true");
    // It said no before it published anything that would make it look up.
    expect(relay.published.length).toBe(0);
  }, 20_000);

  it("refuses to start with an empty list, as the example config ships", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const daemon = run([toml(relay.url, ["allowed_pubkeys = []"])]);
    expect(await daemon.exited).toBe(1);
    expect(daemon.out()).toContain("this watch would hear nobody");
  }, 20_000);

  it("starts with a list, and says how many it hears", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const code = getPublicKey(generateSecretKey());
    const daemon = run([toml(relay.url, [`allowed_pubkeys = ["https://navcom.app/terminal/peers/#${code}"]`])]);
    await eventually(() => expect(daemon.out()).toContain("[daemon] hears 1 operator(s) on [authorization] allowed_pubkeys"), 15_000);
    expect(daemon.out()).not.toContain("not starting");
  }, 20_000);

  it("starts open only where open = true says so, and says it loudly", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const daemon = run([toml(relay.url, ["open = true"])]);
    await eventually(() => expect(daemon.out()).toContain("[daemon] OPEN BOARD: anyone who knows this watch's key may sign on"), 15_000);
  }, 20_000);
});
