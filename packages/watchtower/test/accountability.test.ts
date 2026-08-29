/**
 * The accountability log, against a real filesystem.
 *
 * Against real files rather than a mocked fs on purpose: every failure this module has to
 * survive -- a half-written line, a lost tail, a rotation interrupted -- is a filesystem
 * behaviour, and a mock would agree with whatever this code already does.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountabilityLog } from "../src/shared/accountability.js";
import type { LogOutcome } from "@navcom/core";

const DAY = 86_400;
let dir: string;
let path: string;

const wren = "a".repeat(64);
const raven = "b".repeat(64);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "navcom-log-"));
  path = join(dir, "accountability.jsonl");
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

describe("persistence", () => {
  it("survives a restart with its chain intact", () => {
    const first = open();
    first.log.record(entry(1000, wren));
    first.log.record(entry(1001, raven));
    first.log.close();

    // A new process, reading what the last one wrote.
    const second = open();
    expect(second.check.intact).toBe(true);
    expect(second.log.status().entries).toBe(2);
  });

  it("keeps appending to the same chain across restarts", () => {
    const a = open();
    a.log.record(entry(1000, wren));
    a.log.close();

    const b = open();
    b.log.record(entry(1001, wren));
    b.log.close();

    const c = open();
    expect(c.check.intact).toBe(true);
    expect(c.log.status().entries).toBe(2);
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("starts clean when there is no file yet", () => {
    const { log, check } = open();
    expect(check.intact).toBe(true);
    expect(log.status().entries).toBe(0);
  });
});

describe("a log that has been edited", () => {
  it("is detected, recorded permanently, and does not stop the watch", () => {
    const a = open();
    a.log.record(entry(1000, wren, "acknowledged"));
    a.log.record(entry(1001, wren, "contact-made"));
    a.log.close();

    // Someone rewrites history to look better.
    const [first, second] = readFileSync(path, "utf8").trim().split("\n");
    const tampered = JSON.parse(first!) as Record<string, unknown>;
    tampered.outcome = "contact-made";
    writeFileSync(path, [JSON.stringify(tampered), second!].join("\n") + "\n");

    const b = open();
    expect(b.check.intact).toBe(false);
    // The daemon still has a working log object -- availability is not the thing to lose.
    expect(b.log.status().entries).toBe(2);
    expect(b.log.status().breaks).toHaveLength(1);

    // And the break is not forgotten on the next boot, even though nothing changed since.
    b.log.close();
    const c = open();
    expect(c.log.status().breaks.length).toBeGreaterThanOrEqual(1);
  });

  it("detects a truncated tail rather than accepting it", () => {
    const a = open();
    a.log.record(entry(1000, wren));
    a.log.record(entry(1001, wren));
    a.log.record(entry(1002, wren));
    a.log.close();

    // Drop the middle entry: the classic "that never happened" edit.
    const lines = readFileSync(path, "utf8").trim().split("\n");
    writeFileSync(path, [lines[0]!, lines[2]!].join("\n") + "\n");

    expect(open().check.intact).toBe(false);
  });

  it("treats a torn last line as a truncated tail rather than crashing open() (found in robustness audit)", () => {
    // The one write failure fsync-per-entry actually guards against: a crash mid-writeSync
    // for the *last* line. A raw JSON.parse over every line used to throw straight out of
    // open() here, which meant the log never opened at all -- on every restart, forever --
    // instead of degrading like every other corruption case in this file does.
    const a = open();
    a.log.record(entry(1000, wren));
    a.log.record(entry(1001, wren));
    a.log.close();
    appendFileSync(path, '{"at":1002,"actor":{"kind":"agent"');

    expect(() => open()).not.toThrow();
    const { log, check } = open();
    expect(check.intact).toBe(false);
    expect(check.reason).toMatch(/could not be parsed/);
    // The two entries that did land are still readable -- availability is not the thing
    // to lose, same as every other corruption case here.
    expect(log.status().entries).toBe(2);
  });
});

describe("retention", () => {
  it("drops what is past the window and still verifies afterwards", () => {
    const now = 100 * DAY;
    const a = open(90);
    a.log.record(entry(now - 95 * DAY, wren));
    a.log.record(entry(now - 91 * DAY, wren));
    a.log.record(entry(now - 10 * DAY, wren));
    a.log.record(entry(now - 1 * DAY, wren));

    expect(a.log.rotate(now)).toBe(2);
    expect(a.log.status().entries).toBe(2);
    // This is the part that would otherwise make the log accuse itself every 90 days: the
    // oldest surviving entry points at a hash that is gone, and only a declared start
    // distinguishes that from tampering.
    expect(a.log.status().startsAt).not.toBeNull();
    a.log.close();

    const b = open(90);
    expect(b.check.intact).toBe(true);
    expect(b.log.status().entries).toBe(2);
  });

  it("still catches tampering after a rotation", () => {
    // The declared start must not become a laundering tool.
    const now = 100 * DAY;
    const a = open(90);
    a.log.record(entry(now - 95 * DAY, wren));
    a.log.record(entry(now - 10 * DAY, wren, "acknowledged"));
    a.log.record(entry(now - 1 * DAY, wren));
    a.log.rotate(now);
    a.log.close();

    const [first, second] = readFileSync(path, "utf8").trim().split("\n");
    const tampered = JSON.parse(first!) as Record<string, unknown>;
    tampered.outcome = "contact-made";
    writeFileSync(path, [JSON.stringify(tampered), second!].join("\n") + "\n");

    expect(open(90).check.intact).toBe(false);
  });

  it("does nothing when everything is inside the window", () => {
    const now = 100 * DAY;
    const a = open(90);
    a.log.record(entry(now - 2 * DAY, wren));
    expect(a.log.rotate(now)).toBe(0);
    expect(a.log.status().startsAt).toBeNull();
  });

  it("leaves the log readable if a rotation is interrupted", () => {
    // Rewrite-then-rename: a crash before the rename leaves the original untouched, and
    // the stray temp file is not part of the log.
    const now = 100 * DAY;
    const a = open(90);
    a.log.record(entry(now - 95 * DAY, wren));
    a.log.record(entry(now - 1 * DAY, wren));
    a.log.close();

    appendFileSync(`${path}.rotating`, "{ half written");
    const b = open(90);
    expect(b.check.intact).toBe(true);
    expect(b.log.status().entries).toBe(2);
  });
});

describe("what an operator may review", () => {
  it("shows only entries where they are the subject, matched on pubkey", () => {
    const { log } = open();
    log.record(entry(1000, wren));
    log.record(entry(1001, raven));
    log.record(entry(1002, wren));

    expect(log.about(wren)).toHaveLength(2);
    expect(log.about(raven)).toHaveLength(1);
    expect(log.about("d".repeat(64))).toHaveLength(0);
  });

  it("records no position, area or query text -- there is no field that could carry one", () => {
    const { log } = open();
    log.record(entry(1000, wren));
    const written = JSON.parse(readFileSync(path, "utf8").trim()) as Record<string, unknown>;
    // The full set of keys, so a field added later has to be considered here.
    expect(Object.keys(written).sort()).toEqual(
      ["action", "actor", "at", "hash", "outcome", "prev", "subject"].sort(),
    );
  });
});
