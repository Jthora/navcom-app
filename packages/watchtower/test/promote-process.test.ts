/**
 * `navcom-promote`, run as the command it is, against relays on 127.0.0.1.
 *
 * It said "Nothing waiting" whether or not any relay had answered [F23] -- a refused connection
 * settles a nostr-tools subscription the same way an empty answer does, so a reviewer on a
 * plane read "nothing to review" and closed the laptop. And on Node 20 it could not open a
 * socket at all [F07], which is the same sentence for a different reason.
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSecretKey } from "nostr-tools/pure";
import { buildCorrection, buildPlace, placeId } from "@navcom/core";
import { collect } from "../src/promote/index.js";
import { nodePool } from "../src/shared/nostr-node.js";
import { startRelay, freePort, type LocalRelay } from "./helpers/local-relay.js";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const PROMOTE = join(PACKAGE, "src/promote/index.ts");

const relays: LocalRelay[] = [];
afterEach(async () => {
  await Promise.all(relays.splice(0).map((r) => r.close()));
});

async function promote(urls: string[], opts: { node20?: boolean } = {}) {
  const args = [
    ...(opts.node20 ? ["--no-experimental-websocket"] : []),
    "--import", "tsx", PROMOTE, "--relays", urls.join(","), "--since", "7",
  ];
  const started = Date.now();
  const child = spawn(process.execPath, args, { cwd: PACKAGE, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
  child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  const killer = setTimeout(() => child.kill("SIGKILL"), 40_000);
  const code = await new Promise<number | null>((resolve) => child.on("exit", (c) => resolve(c)));
  clearTimeout(killer);
  return { code, stdout, stderr, ms: Date.now() - started };
}

const today = new Date().toISOString().slice(0, 10);
const nowS = () => Math.floor(Date.now() / 1000);

function seeded(relay: LocalRelay) {
  const secret = generateSecretKey();
  relay.deliver(
    buildCorrection(
      secret,
      { record: "nashville-room-in-the-inn", verified_by: "Wren", method: "in_person", last_verified: today, fields: { pets: "no" } },
      nowS(),
    ),
  );
  const name = "Corner Warming Room";
  const address = "100 Example Ave";
  relay.deliver(
    buildPlace(
      secret,
      {
        id: placeId(name, address), region: "nashville", name, type: "warming", address,
        verified_by: "Wren", method: "in_person", last_verified: today,
      },
      nowS(),
    ),
  );
}

describe("navcom-promote [F23]", () => {
  it("says which relays it read, and shows corrections and added places from the one that answered", async () => {
    const up = await startRelay();
    relays.push(up);
    seeded(up);
    const dead = `ws://127.0.0.1:${await freePort()}`;

    // On a runtime with no global WebSocket, too [F07].
    const run = await promote([up.url, dead], { node20: true });

    expect(run.code, run.stdout + run.stderr).toBe(0);
    expect(run.stdout.split("\n")[0]).toMatch(/^Read 1 of 2 relays; not reached: ws:\/\/127\.0\.0\.1:\d+ \(/);
    expect(run.stdout).toContain("nashville-room-in-the-inn");
    expect(run.stdout).toMatch(/Places added/);
    expect(run.stdout).toContain("Corner Warming Room");
    expect(run.stdout).toMatch(/Nothing here has been written anywhere/);
    // Its fifteen-second guard used to stay armed after the answer, holding the process open.
    expect(run.ms, "the guard timer kept the process alive").toBeLessThan(10_000);
  }, 45_000);

  it("says nothing was checked when no relay answered, and exits non-zero", async () => {
    const dead = [`ws://127.0.0.1:${await freePort()}`, `ws://127.0.0.1:${await freePort()}`];
    const run = await promote(dead);

    expect(run.code).toBe(1);
    const said = run.stdout + run.stderr;
    expect(said).toMatch(/No relay answered \(ws:\/\/127\.0\.0\.1:\d+: .+\)\. Nothing was checked\./);
    expect(said).not.toMatch(/Nothing waiting/);
  }, 45_000);

  it("does not count a relay that refused the subscription as having answered", async () => {
    const refusing = await startRelay();
    relays.push(refusing);
    refusing.refuseReq = () => "restricted: members only";
    const run = await promote([refusing.url]);

    expect(run.code).toBe(1);
    expect(run.stdout + run.stderr).toMatch(/No relay answered \(ws:\/\/127\.0\.0\.1:\d+: restricted: members only\)/);
  }, 45_000);

  it("says nothing is waiting only when a relay answered with nothing", async () => {
    const empty = await startRelay();
    relays.push(empty);
    const run = await promote([empty.url]);

    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/Nothing waiting from the last 7 days/);
    expect(run.stdout).not.toMatch(/not reached/);
  }, 45_000);
});

describe("collect, against a relay that takes the REQ and never answers [F23]", () => {
  it("does not count it as read, though nostr-tools stands in an EOSE of its own after 4.4s", async () => {
    // Its `maxWait` is what keeps that stand-in past the guard. Without it the silent relay
    // counted as having answered and the tool said "Nothing waiting".
    const silent = await startRelay();
    relays.push(silent);
    silent.answerReqs = false;
    const pool = nodePool();
    try {
      const read = await collect({ pool, relays: [silent.url], since: nowS() - 86_400, timeoutMs: 6_000 });
      expect(read.answered).toEqual([]);
      expect(read.missed).toEqual([{ url: silent.url, reason: "no answer within 6s" }]);
    } finally {
      pool.destroy();
    }
  }, 20_000);
});
