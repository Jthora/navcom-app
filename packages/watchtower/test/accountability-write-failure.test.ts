/**
 * The one case accountability.test.ts deliberately does not cover: a transient failure on
 * the durable write itself (a full disk, say). There is no way to provoke that from a real
 * filesystem portably in a test, so this file, unlike its sibling, mocks `node:fs` -- only
 * `writeSync`, and only when a test asks for a failure, so every other call still touches a
 * real temp file and every other assertion still means what it says.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountabilityLog } from "../src/shared/accountability.js";
import type { LogOutcome } from "@navcom/core";

let failNextWrite = false;

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    writeSync: (...args: Parameters<typeof actual.writeSync>) => {
      if (failNextWrite) {
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
