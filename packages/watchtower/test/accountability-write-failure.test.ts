/**
 * The one case accountability.test.ts deliberately does not cover: a transient failure on
 * the durable write itself (a full disk, say). There is no way to provoke that from a real
 * filesystem portably in a test, so this file, unlike its sibling, mocks `node:fs` -- only
 * `writeSync`, and only when a test asks for a failure, so every other call still touches a
 * real temp file and every other assertion still means what it says.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { AccountabilityLog } from "../src/shared/accountability.js";
import type { LogOutcome } from "@navcom/core";
import { answering, build, cleanup, distressFrom, heard, logged, onCallEntry, quiet } from "./helpers/executor.js";

let failNextWrite = false;
/** Every write fails, until a test says otherwise: a disk that filled and stayed full. */
let failWrites = false;

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    writeSync: (...args: Parameters<typeof actual.writeSync>) => {
      if (failNextWrite || failWrites) {
        failNextWrite = false;
        throw new Error("ENOSPC: no space left on device");
      }
      return actual.writeSync(...args);
    },
  };
});

let dir: string;
let path: string;
const wren = "a".repeat(64);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "navcom-log-write-"));
  path = join(dir, "accountability.jsonl");
  failNextWrite = false;
  failWrites = false;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function open(retentionDays = 90) {
  return AccountabilityLog.open(path, retentionDays);
}

function entry(at: number, subject: string, outcome: LogOutcome = "acknowledged") {
  return {
    at,
    actor: { kind: "agent" as const, callsign: "watchtower", pubkey: "c".repeat(64) },
    action: "acked" as const,
    subject: { kind: "human" as const, pubkey: subject },
    outcome,
  };
}

describe("write robustness (found in robustness audit)", () => {
  it("does not let the in-memory chain run ahead of what actually reached disk", () => {
    const { log } = open();
    log.record(entry(1000, wren));

    failNextWrite = true;
    expect(() => log.record(entry(1001, wren))).toThrow(/ENOSPC/);

    // The failed record must not have been committed to memory. This used to run first, so
    // the next successful record() chained from a hash that was never written -- a real gap
    // in the on-disk file that reads as tampering on the next restart, forever.
    log.record(entry(1002, wren));
    log.close();

    const reopened = open();
    expect(reopened.check.intact).toBe(true);
    expect(reopened.log.status().entries).toBe(2);
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(2);
  });
});

describe("the executor, with a log it cannot write", () => {
  afterEach(async () => {
    failWrites = false;
    await cleanup();
  });

  it("still reports and pages when one key is refused, and says it could not record that", async () => {
    // An accountability problem must never become an availability one: the record of a relay refusing
    // the executor's key is the reviewer's, and the operator still has to hear the ladder.
    const { error } = quiet();
    const operator = generateSecretKey();
    const box = build({ ownKey: true, oncall: [onCallEntry("Wren", getPublicKey(generateSecretKey()))] });
    box.relay.refuses = (e) => e.pubkey === box.executorPubkey;
    failWrites = true;
    const distress = distressFrom(operator, box.pubkey);
    box.deliver(distress);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(answering(box.published, distress.id)).toHaveLength(2));
    expect(heard(box.published, operator, distress.id).at(-1)!.payload.text).toBe("Paging Wren.");
    await vi.waitFor(() =>
      expect(error.mock.calls.flat().join("\n")).toMatch(
        /\[escalation-log\] FAILED TO RECORD that no relay took the executor's own key for [0-9a-f]{8}: Error: ENOSPC/,
      ),
    );
  });

  it("tries a one-key record again once the disk has room, and then records it once", async () => {
    // Marked only once written: marked first, a disk that filled for a moment lost, for good, the only
    // record that a relay refused one of the box's keys for that ladder.
    const { error } = quiet();
    const operator = generateSecretKey();
    const box = build({ ownKey: true, oncall: [onCallEntry("Wren", getPublicKey(generateSecretKey()))] });
    box.relay.refuses = (e) => e.pubkey === box.executorPubkey;
    failWrites = true;
    const distress = distressFrom(operator, box.pubkey);
    box.deliver(distress);
    await vi.waitFor(() => expect(error.mock.calls.flat().join("\n")).toMatch(/FAILED TO RECORD that no relay took the executor's own key/));
    const refusals = () =>
      (existsSync(box.logPath) ? logged(box.logPath) : []).filter(
        (e) => e.action === "answered" && e.outcome === "executor-key-refused" && e.subject?.pubkey === getPublicKey(operator),
      );
    expect(refusals()).toHaveLength(0);

    failWrites = false;
    const retry = distressFrom(operator, box.pubkey);
    box.deliver(retry);
    await vi.waitFor(() => expect(answering(box.published, retry.id).length).toBeGreaterThan(0));
    await vi.waitFor(() => expect(refusals()).toHaveLength(1));
    // And once per ladder after that, however often the phone sends.
    const again = distressFrom(operator, box.pubkey);
    box.deliver(again);
    await vi.waitFor(() => expect(answering(box.published, again.id).length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 30));
    expect(refusals()).toHaveLength(1);

    // Forgotten once nothing about that ladder can send again, so a box up for months does not keep them all.
    box.relay.refuses = () => false;
    expect(box.executor["oneKey"].size).toBe(1);
    const real = Date.now.bind(Date);
    vi.spyOn(Date, "now").mockImplementation(() => real() + (1_800 + 3_600 + 5) * 1000);
    await vi.waitFor(() => expect(box.executor["oneKey"].size).toBe(0), { timeout: 3_000 });
  });

  it("starts, and pages, when its start cannot be recorded", async () => {
    // A full disk at start: the `took-watch` record throws inside start(). Uncaught, that is the
    // executor's process exiting on every start -- the safety-critical process in a crash loop.
    const { error } = quiet();
    failWrites = true;
    const operator = generateSecretKey();
    const box = build({ ownKey: true, tookWatch: { keyProblems: [] }, oncall: [onCallEntry("Wren", getPublicKey(generateSecretKey()))] });
    expect(error.mock.calls.flat().join("\n")).toMatch(/\[escalation-log\] FAILED TO RECORD this start: Error: ENOSPC/);
    const distress = distressFrom(operator, box.pubkey);
    box.deliver(distress);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(heard(box.published, operator, distress.id).at(-1)?.payload.text).toBe("Paging Wren."));
  });

  it("records no start, and says nothing about one, where the executor has no key of its own", async () => {
    // A keyless executor signs with the watch key, which the log already names; there is no key of its own to
    // record. Unguarded, every such start said it had FAILED TO RECORD this start.
    const { error } = quiet();
    const box = build({ tookWatch: { keyProblems: [] }, oncall: [onCallEntry("Wren", getPublicKey(generateSecretKey()))] });
    const keyed = build({ ownKey: true, tookWatch: { keyProblems: ["readable by the daemon's user"] } });
    await vi.waitFor(() => expect(existsSync(keyed.logPath)).toBe(true));
    expect(logged(keyed.logPath).map((e) => [e.action, e.outcome, e.actor.pubkey])).toEqual([
      ["took-watch", "key-not-its-own", keyed.executorPubkey],
    ]);
    expect(existsSync(box.logPath) ? logged(box.logPath).filter((e) => e.action === "took-watch") : []).toEqual([]);
    expect(error.mock.calls.flat().join("\n")).not.toMatch(/FAILED TO RECORD this start/);
  });
});
