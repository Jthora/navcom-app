/**
 * The keyless pager, run as the process it is, against a relay on 127.0.0.1.
 *
 * Run rather than imported, because every defect here was in what the process did and said:
 * it printed that it was watching while it could not open a socket on Node 20 [F07], and one
 * relay drop removed it for good while it went on saying so [F06]. `--no-experimental-websocket`
 * is Node 22 without a global WebSocket, which is Node 20's default.
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { KIND_DISTRESS } from "../src/shared/kinds.js";
import { startRelay, freePort, eventually, type LocalRelay } from "./helpers/local-relay.js";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const PAGER = join(PACKAGE, "src/pager/index.ts");

interface Running {
  child: ChildProcess;
  out: () => string;
}

const children: ChildProcess[] = [];
const relays: LocalRelay[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const c of children.splice(0)) c.kill("SIGKILL");
  await Promise.all(relays.splice(0).map((r) => r.close()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function pager(urls: string[], watchtower: string, opts: { node20?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "navcom-pager-"));
  dirs.push(dir);
  const flag = join(dir, "paged.flag");
  const config = join(dir, "pager.toml");
  writeFileSync(
    config,
    [
      "[watchtower]",
      `pubkey = "${watchtower}"`,
      "[relays]",
      `urls = [${urls.map((u) => `"${u}"`).join(", ")}]`,
      "[page]",
      `command = ["touch", "${flag}"]`,
      "",
    ].join("\n"),
  );
  const args = [...(opts.node20 ? ["--no-experimental-websocket"] : []), "--import", "tsx", PAGER, config];
  const child = spawn(process.execPath, args, { cwd: PACKAGE, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let out = "";
  child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (out += d.toString()));
  const running: Running = { child, out: () => out };
  return { ...running, paged: () => existsSync(flag) };
}

const distressTo = (watchtower: string) =>
  finalizeEvent(
    { kind: KIND_DISTRESS, tags: [["p", watchtower]], content: "opaque", created_at: Math.floor(Date.now() / 1000) },
    generateSecretKey(),
  );

const watchtower = () => getPublicKey(generateSecretKey());

describe("the keyless pager on a runtime with no global WebSocket [F07]", () => {
  it("connects and pages", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const w = watchtower();
    const p = pager([relay.url], w, { node20: true });

    await eventually(() => expect(relay.openSubs()).toBe(1), 15_000).catch(() => {});
    relay.deliver(distressTo(w));
    await eventually(() => expect(p.paged(), p.out()).toBe(true), 5_000);
  }, 30_000);
});

describe("the keyless pager when its relay goes [F06]", () => {
  it("subscribes again after the connection drops, and pages for a Distress sent then", async () => {
    const relay = await startRelay();
    relays.push(relay);
    const w = watchtower();
    const p = pager([relay.url], w);
    await eventually(() => expect(relay.openSubs()).toBe(1), 15_000);
    await eventually(() => expect(p.out()).toMatch(/\[pager\] watching on 1\/1 relay/));

    // Every connection dropped at once, with no close frame. The pager's side sees the TCP
    // connection close straight away, so this is a drop it notices, not a silent one: a router
    // that reboots and leaves a half-open socket is noticed only by the ping, and nothing here
    // tests that (nostr-tools' ping waits 29s and then 20s, and neither can be set from outside).
    const before = relay.reqs.length;
    relay.dropAll();
    await eventually(() => expect(relay.openSubs()).toBe(0));
    // Said, not merely survived: F06 was a pager that went on saying nothing.
    await eventually(() => expect(p.out(), "said nothing when its only relay went").toMatch(/\[pager\] NOT WATCHING/), 5_000);
    await eventually(() => expect(relay.reqs.length, "the pager never came back").toBeGreaterThan(before), 10_000);
    await eventually(() => expect(relay.openSubs()).toBe(1));
    await eventually(() =>
      expect(p.out().match(/\[pager\] watching on 1\/1 relay/g), "never said it was watching again").toHaveLength(2),
    );

    relay.deliver(distressTo(w));
    await eventually(() => expect(p.paged(), p.out()).toBe(true), 5_000);
  }, 40_000);

  it("does not say it is watching until a relay is listening, and says so when one is", async () => {
    const port = await freePort();
    const w = watchtower();
    const p = pager([`ws://127.0.0.1:${port}`], w);

    await eventually(() => expect(p.out()).toMatch(/\[pager\] starting/), 15_000);
    await new Promise((r) => setTimeout(r, 1_500));
    expect(p.out(), "claimed to be watching with nothing reachable").not.toMatch(/\[pager\] watching/);
    expect(p.out()).toMatch(/unreachable/);

    // The relay comes up after the pager did -- booting into an outage.
    const relay = await startRelay({ port });
    relays.push(relay);
    await eventually(() => expect(p.out()).toMatch(/\[pager\] watching on 1\/1 relay/), 20_000);

    relay.deliver(distressTo(w));
    await eventually(() => expect(p.paged(), p.out()).toBe(true), 5_000);
  }, 45_000);

  it("does not say it is watching on a relay that took the subscription and never answered", async () => {
    // nostr-tools stands in an EOSE of its own 4.4s after a REQ with no answer, and this
    // printed `watching on 1/1` on a hung relay. It says it is waiting on it instead.
    const relay = await startRelay();
    relays.push(relay);
    relay.answerReqs = false;
    const p = pager([relay.url], watchtower());

    await eventually(() => expect(relay.reqs.length).toBe(1), 15_000);
    await eventually(() => expect(p.out()).toMatch(/has not answered in 10s/), 15_000);
    expect(p.out(), "claimed to be watching on a relay that never answered").not.toMatch(/\[pager\] watching/);
    // It never fell from watching, so only the boot check can say it [review: relay paths].
    await eventually(
      () => expect(p.out(), "booted into a dead relay and never said it was not watching").toMatch(/NOT WATCHING -- no relay has answered since this started/),
      10_000,
    );
  }, 45_000);
});
