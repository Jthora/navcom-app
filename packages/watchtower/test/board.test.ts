import { describe, it, expect, vi } from "vitest";
import { Board } from "../src/daemon/board.js";

const OP_A = "a".repeat(64);
const OP_B = "b".repeat(64);

describe("Board", () => {
  it("on-station adds an active entry with expected fields", () => {
    const board = new Board();
    const now = 1_000_000;
    board.onStation({
      operator: OP_A,
      callsign: "OP-1",
      area: "district-7",
      expectedDurationSeconds: 7200,
      routineIntervalSeconds: 3600,
      position: null,
      now,
      signalId: "e".repeat(64),
    });

    const entry = board.get(OP_A);
    expect(entry).toBeDefined();
    expect(entry?.callsign).toBe("OP-1");
    expect(entry?.area).toBe("district-7");
    expect(entry?.signedOn).toBe(now);
    expect(entry?.expectedUntil).toBe(now + 7200);
    expect(entry?.routineDue).toBe(now + 3600);
    expect(entry?.lastContact).toBe(now);
    expect(entry?.status).toBe("active");
    expect(board.size).toBe(1);
  });

  it("routine_interval: null means no routine_due at all", () => {
    const board = new Board();
    board.onStation({
      operator: OP_A, callsign: "OP-1", area: "d", expectedDurationSeconds: 7200,
      routineIntervalSeconds: null, position: null, now: 0,
      signalId: "e".repeat(64),
    });
    expect(board.get(OP_A)?.routineDue).toBeNull();
  });

  it("stood-down removes the entry entirely, not marks it", () => {
    const board = new Board();
    board.onStation({
      operator: OP_A, callsign: "OP-1", area: "d", expectedDurationSeconds: 7200,
      routineIntervalSeconds: null, position: null, now: 0,
      signalId: "e".repeat(64),
    });
    const removed = board.standDown(OP_A);
    expect(removed).toBe(true);
    expect(board.get(OP_A)).toBeUndefined();
    expect(board.size).toBe(0);
  });

  it("stood-down for an unknown operator returns false, does not throw", () => {
    const board = new Board();
    expect(board.standDown(OP_A)).toBe(false);
  });

  it("stood-down refuses to remove an entry currently in distress (found in robustness audit)", () => {
    // Mirrors onStation()'s own guard: distress is always a deliberate act to ENTER, and
    // clearing it -- silently or otherwise -- deserves the same deliberateness. Before this,
    // a stood-down signal (self-sent, mis-tapped, or coerced) erased the board's only
    // visible record of the distress while the real ladder, gated separately by
    // distress-ack, kept paging in the background.
    const board = new Board();
    board.onStation({
      operator: OP_A, callsign: "OP-1", area: "d", expectedDurationSeconds: 7200,
      routineIntervalSeconds: null, position: null, now: 0,
      signalId: "e".repeat(64),
    });
    board.distress(OP_A, 10);
    const removed = board.standDown(OP_A);
    expect(removed).toBe(false);
    expect(board.get(OP_A)?.status).toBe("distress");
    expect(board.size).toBe(1);
  });

  it("routine check-in refreshes last_contact and advances routine_due using the entry's own cadence", () => {
    const board = new Board();
    board.onStation({
      operator: OP_A, callsign: "OP-1", area: "d", expectedDurationSeconds: 7200,
      routineIntervalSeconds: 1800, position: null, now: 0,
      signalId: "e".repeat(64),
    });
    board.routine(OP_A, 1800, 1800);
    const entry = board.get(OP_A);
    expect(entry?.lastContact).toBe(1800);
    expect(entry?.routineDue).toBe(1800 + 1800);
  });

  it("routine check-in clears an overdue status caused by a missed routine ping", () => {
    const board = new Board();
    // A long patrol with a short check-in cadence, so only the routine clock -- never the
    // expected-duration clock -- can be why this entry goes overdue.
    board.onStation({
      operator: OP_A, callsign: "OP-1", area: "d", expectedDurationSeconds: 100_000,
      routineIntervalSeconds: 500, position: null, now: 0,
      signalId: "e".repeat(64),
    });
    board.sweep(500 + 1800 + 1, 1800, 14400); // past routine grace, nowhere near duration
    expect(board.get(OP_A)?.status).toBe("overdue");

    board.routine(OP_A, 500 + 1800 + 1, 1800);
    expect(board.get(OP_A)?.status).toBe("active");
  });

  it("routine check-in does NOT clear an overdue status still caused by the expected duration having passed (found in robustness audit)", () => {
    // The bug: a routine ping resets the check-in clock but not expectedUntil. Clearing
    // "overdue" unconditionally here meant the very next sweep saw the same still-true
    // pastExpectedGrace condition and re-flagged it as a fresh transition -- the same
    // continuing lateness logged as a new marked-overdue entry every sweep tick.
    const board = new Board();
    board.onStation({
      operator: OP_A, callsign: "OP-1", area: "d", expectedDurationSeconds: 100,
      routineIntervalSeconds: null, position: null, now: 0,
      signalId: "e".repeat(64),
    });
    board.sweep(100 + 1800 + 1, 1800, 14400); // past overdue grace on duration alone
    expect(board.get(OP_A)?.status).toBe("overdue");

    board.routine(OP_A, 100 + 1800 + 1, 1800);
    // Still overdue: expectedUntil (100) + grace (1800) has not caught up with now.
    expect(board.get(OP_A)?.status).toBe("overdue");
  });

  it("touch() refreshes contact and clears overdue without touching routine_due", () => {
    const board = new Board();
    // A long patrol with a short check-in cadence, so only the routine clock can be why
    // this entry goes overdue -- see the equivalent routine() tests above for why that
    // matters to this assertion.
    board.onStation({
      operator: OP_A, callsign: "OP-1", area: "d", expectedDurationSeconds: 100_000,
      routineIntervalSeconds: 500, position: null, now: 0,
      signalId: "e".repeat(64),
    });
    board.sweep(500 + 1800 + 1, 1800, 14400);
    expect(board.get(OP_A)?.status).toBe("overdue");

    board.touch(OP_A, 500 + 1800 + 1, 1800);
    const entry = board.get(OP_A);
    expect(entry?.status).toBe("active");
    expect(entry?.routineDue).toBe(500); // unchanged by touch()
  });

  it("touch() does NOT clear an overdue status still caused by the expected duration having passed", () => {
    const board = new Board();
    board.onStation({
      operator: OP_A, callsign: "OP-1", area: "d", expectedDurationSeconds: 100,
      routineIntervalSeconds: null, position: null, now: 0,
      signalId: "e".repeat(64),
    });
    board.sweep(100 + 1800 + 1, 1800, 14400);
    expect(board.get(OP_A)?.status).toBe("overdue");

    board.touch(OP_A, 100 + 1800 + 1, 1800);
    expect(board.get(OP_A)?.status).toBe("overdue");
  });

  it("touch() on an unknown operator returns null, does not create an entry", () => {
    const board = new Board();
    expect(board.touch(OP_A, 0, 1800)).toBeNull();
    expect(board.size).toBe(0);
  });

  describe("sweep", () => {
    it("marks an entry overdue once past expected_until + overdue_grace, not before", () => {
      const board = new Board();
      board.onStation({
        operator: OP_A, callsign: "OP-1", area: "d", expectedDurationSeconds: 100,
        routineIntervalSeconds: null, position: null, now: 0,
      signalId: "e".repeat(64),
    });

      board.sweep(100 + 1800 - 1, 1800, 14400); // one second before grace expires
      expect(board.get(OP_A)?.status).toBe("active");

      board.sweep(100 + 1800 + 1, 1800, 14400); // one second past grace
      expect(board.get(OP_A)?.status).toBe("overdue");
    });

    it("marks overdue from a missed routine check-in even if expected_until is far off", () => {
      const board = new Board();
      board.onStation({
        operator: OP_A, callsign: "OP-1", area: "d", expectedDurationSeconds: 100_000,
        routineIntervalSeconds: 3600, position: null, now: 0,
      signalId: "e".repeat(64),
    });
      board.sweep(3600 + 1800 + 1, 1800, 14400);
      expect(board.get(OP_A)?.status).toBe("overdue");
    });

    it("drops an entry past hard_expiry", () => {
      const board = new Board();
      board.onStation({
        operator: OP_A, callsign: "OP-1", area: "d", expectedDurationSeconds: 100,
        routineIntervalSeconds: null, position: null, now: 0,
      signalId: "e".repeat(64),
    });
      board.sweep(100 + 14400 + 1, 1800, 14400);
      expect(board.get(OP_A)).toBeUndefined();
    });

    it("never drops a distress entry, even long past hard_expiry", () => {
      const board = new Board();
      board.onStation({
        operator: OP_A, callsign: "OP-1", area: "d", expectedDurationSeconds: 100,
        routineIntervalSeconds: null, position: null, now: 0,
      signalId: "e".repeat(64),
    });
      board.distress(OP_A, 50);
      board.sweep(100 + 14400 + 999_999, 1800, 14400);
      expect(board.get(OP_A)?.status).toBe("distress");
    });

    it("sweep only affects entries actually past their own thresholds, leaving others untouched", () => {
      const board = new Board();
      board.onStation({
        operator: OP_A, callsign: "OP-1", area: "d", expectedDurationSeconds: 100,
        routineIntervalSeconds: null, position: null, now: 0,
      signalId: "e".repeat(64),
    });
      board.onStation({
        operator: OP_B, callsign: "OP-2", area: "d", expectedDurationSeconds: 100_000,
        routineIntervalSeconds: null, position: null, now: 0,
      signalId: "e".repeat(64),
    });
      board.sweep(100 + 1800 + 1, 1800, 14400);
      expect(board.get(OP_A)?.status).toBe("overdue");
      expect(board.get(OP_B)?.status).toBe("active");
    });
  });

  it("position is only stored when share_position semantics are honored by the caller", () => {
    // Board itself just stores whatever position it's given -- the
    // share_position=false-means-null decision is the daemon's
    // responsibility (watchtower.ts), not the board's. This test pins
    // that the board layer is a dumb store, not a policy layer.
    const board = new Board();
    board.onStation({
      operator: OP_A, callsign: "OP-1", area: "d", expectedDurationSeconds: 100,
      routineIntervalSeconds: null, position: { lat: 1, lon: 2, precision_m: 500 }, now: 0,
      signalId: "e".repeat(64),
    });
    expect(board.get(OP_A)?.position).toEqual({ lat: 1, lon: 2, precision_m: 500 });
  });

  describe("distress", () => {
    it("creates a minimal entry for an operator who never sent on-station", () => {
      // Found in review: this used to be a silent no-op for an unknown
      // operator -- handleDistressEvent still sent them an ack, so
      // nothing looked wrong to the sender, but the distress was
      // completely invisible to anyone watching the board.
      const board = new Board();
      const entry = board.distress(OP_A, 1000);
      expect(entry.status).toBe("distress");
      expect(entry.operator).toBe(OP_A);
      expect(board.get(OP_A)?.status).toBe("distress");
      expect(board.size).toBe(1);
    });

    it("marks an existing entry distress without losing it", () => {
      const board = new Board();
      board.onStation({
        operator: OP_A, callsign: "OP-1", area: "district-7", expectedDurationSeconds: 7200,
        routineIntervalSeconds: null, position: null, now: 0,
      signalId: "e".repeat(64),
    });
      board.distress(OP_A, 500);
      const entry = board.get(OP_A);
      expect(entry?.status).toBe("distress");
      expect(entry?.callsign).toBe("OP-1"); // real on-station data preserved
      expect(entry?.area).toBe("district-7");
    });
  });

  describe("distress is not silently cleared", () => {
    it("a later on-station signal does not clear an existing distress status", () => {
      // Found in review: distress is "always a deliberate act" to
      // enter (spec's own words) -- clearing it deserves the same
      // deliberateness, not an incidental side effect of a routine
      // re-sign-on (accidental client retry, confused operator, etc.).
      const board = new Board();
      board.onStation({
        operator: OP_A, callsign: "OP-1", area: "district-7", expectedDurationSeconds: 7200,
        routineIntervalSeconds: null, position: null, now: 0,
      signalId: "e".repeat(64),
    });
      board.distress(OP_A, 100);
      expect(board.get(OP_A)?.status).toBe("distress");

      board.onStation({
        operator: OP_A, callsign: "OP-1", area: "district-9", expectedDurationSeconds: 3600,
        routineIntervalSeconds: null, position: null, now: 200,
      signalId: "e".repeat(64),
    });

      expect(board.get(OP_A)?.status).toBe("distress");
      expect(board.get(OP_A)?.area).toBe("district-9"); // other fields still refresh normally
    });

    it("a fresh on-station for a non-distressed operator is still active as before", () => {
      const board = new Board();
      board.onStation({
        operator: OP_A, callsign: "OP-1", area: "d", expectedDurationSeconds: 100,
        routineIntervalSeconds: null, position: null, now: 0,
      signalId: "e".repeat(64),
    });
      expect(board.get(OP_A)?.status).toBe("active");
    });

    it("routine() does not clear an existing distress status", () => {
      const board = new Board();
      board.onStation({
        operator: OP_A, callsign: "OP-1", area: "d", expectedDurationSeconds: 100,
        routineIntervalSeconds: 50, position: null, now: 0,
      signalId: "e".repeat(64),
    });
      board.distress(OP_A, 10);
      board.routine(OP_A, 20, 1800);
      expect(board.get(OP_A)?.status).toBe("distress");
    });

    it("touch() does not clear an existing distress status", () => {
      const board = new Board();
      board.onStation({
        operator: OP_A, callsign: "OP-1", area: "d", expectedDurationSeconds: 100,
        routineIntervalSeconds: null, position: null, now: 0,
      signalId: "e".repeat(64),
    });
      board.distress(OP_A, 10);
      board.touch(OP_A, 20, 1800);
      expect(board.get(OP_A)?.status).toBe("distress");
    });
  });

  describe("sweep onOverdue hook (escalation seam)", () => {
    // A no-op seam for a future escalation ladder, not escalation itself
    // -- these tests pin that the callback fires at exactly the right
    // moment and exactly once, without adding any ladder behavior.
    it("is not called when nothing goes overdue", () => {
      const board = new Board();
      board.onStation({
        operator: OP_A, callsign: "OP-1", area: "d", expectedDurationSeconds: 100_000,
        routineIntervalSeconds: null, position: null, now: 0,
      signalId: "e".repeat(64),
    });
      const onOverdue = vi.fn();
      board.sweep(100, 1800, 14400, onOverdue);
      expect(onOverdue).not.toHaveBeenCalled();
    });

    it("is called exactly once, with the entry, at the moment of the overdue transition", () => {
      const board = new Board();
      board.onStation({
        operator: OP_A, callsign: "OP-1", area: "d", expectedDurationSeconds: 100,
        routineIntervalSeconds: null, position: null, now: 0,
      signalId: "e".repeat(64),
    });
      const onOverdue = vi.fn();
      board.sweep(100 + 1800 + 1, 1800, 14400, onOverdue);
      expect(onOverdue).toHaveBeenCalledTimes(1);
      expect(onOverdue).toHaveBeenCalledWith(expect.objectContaining({ operator: OP_A, status: "overdue" }));
    });

    it("does not fire again on a later sweep of an already-overdue entry", () => {
      const board = new Board();
      board.onStation({
        operator: OP_A, callsign: "OP-1", area: "d", expectedDurationSeconds: 100,
        routineIntervalSeconds: null, position: null, now: 0,
      signalId: "e".repeat(64),
    });
      const onOverdue = vi.fn();
      board.sweep(100 + 1800 + 1, 1800, 14400, onOverdue);
      board.sweep(100 + 1800 + 2, 1800, 14400, onOverdue);
      expect(onOverdue).toHaveBeenCalledTimes(1);
    });

    it("is entirely optional -- sweep behaves identically when omitted", () => {
      const board = new Board();
      board.onStation({
        operator: OP_A, callsign: "OP-1", area: "d", expectedDurationSeconds: 100,
        routineIntervalSeconds: null, position: null, now: 0,
      signalId: "e".repeat(64),
    });
      expect(() => board.sweep(100 + 1800 + 1, 1800, 14400)).not.toThrow();
      expect(board.get(OP_A)?.status).toBe("overdue");
    });
  });

  describe("overdueCount (local only -- nothing about an overdue operator is published)", () => {
    it("is zero on an empty board", () => {
      expect(new Board().overdueCount).toBe(0);
    });

    it("counts only overdue entries, not active/distress ones", () => {
      const board = new Board();
      board.onStation({
        operator: OP_A, callsign: "OP-1", area: "d", expectedDurationSeconds: 100,
        routineIntervalSeconds: null, position: null, now: 0,
      signalId: "e".repeat(64),
    });
      board.onStation({
        operator: OP_B, callsign: "OP-2", area: "d", expectedDurationSeconds: 100_000,
        routineIntervalSeconds: null, position: null, now: 0,
      signalId: "e".repeat(64),
    });
      board.sweep(100 + 1800 + 1, 1800, 14400); // only OP_A goes overdue
      expect(board.overdueCount).toBe(1);

      board.distress(OP_B, 100 + 1800 + 1); // distress, not overdue
      expect(board.overdueCount).toBe(1); // unchanged
    });

    it("drops back to zero once the overdue entry checks back in", () => {
      const board = new Board();
      // Routine-caused, not duration-caused -- see the board.touch() tests above for why
      // that distinction matters to whether checking in can actually clear it.
      board.onStation({
        operator: OP_A, callsign: "OP-1", area: "d", expectedDurationSeconds: 100_000,
        routineIntervalSeconds: 500, position: null, now: 0,
      signalId: "e".repeat(64),
    });
      board.sweep(500 + 1800 + 1, 1800, 14400);
      expect(board.overdueCount).toBe(1);

      board.touch(OP_A, 500 + 1800 + 2, 1800);
      expect(board.overdueCount).toBe(0);
    });
  });
});
