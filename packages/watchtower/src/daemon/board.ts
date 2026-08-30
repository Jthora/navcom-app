import type { Position } from "../shared/payloads.js";
import { sanitizeForLog } from "../shared/validate.js";

export type BoardStatus = "active" | "overdue" | "distress";

export interface BoardEntry {
  operator: string; // pubkey
  callsign: string;
  area: string; // coarse -- district, never an address
  signedOn: number;
  expectedUntil: number;
  routineDue: number | null;
  routineIntervalSeconds: number | null; // the operator's chosen cadence, reused on each routine tick
  lastContact: number;
  position: Position | null;
  status: BoardStatus;
  /**
   * The `on-station` event id, so an overdue contact can name what it is about.
   *
   * **Null for an entry a `Distress` created**, which happens when somebody raises one
   * without ever having signed on — there is no sign-on to reference, and inventing an id
   * would put a reference to nothing on the wire. Such an entry cannot go overdue anyway
   * (`sweep` only touches `active`), so the null is a fact rather than a case to handle
   * twice.
   */
  signalId: string | null;
}

export interface OnStationParams {
  operator: string;
  callsign: string;
  area: string;
  expectedDurationSeconds: number;
  routineIntervalSeconds: number | null;
  position: Position | null;
  now: number;
  /**
   * The `on-station` event this entry came from.
   *
   * Kept for one reason: `signals.spec.md` shapes a `20912` as
   * `[["p", operator], ["e", signal-event-id]]`, so the overdue contact the spec requires
   * has to name the signal it concerns — and the only signal an overdue is *about* is the
   * sign-on that declared the window now passed.
   *
   * It is an event id and nothing else. It says no more about the operator than the board
   * entry beside it already does, and it dies with the board.
   */
  signalId: string;
}

/**
 * The watch board. Held ONLY in memory -- never written to disk, not as
 * a cache, not as a crash-recovery file, not as a debug dump. Check 07
 * ("restart the daemon, the board is empty") exists specifically to
 * catch a regression here, so this class must never import fs.
 *
 * There is no web server and no remote query API for this board (per
 * the brief: "No web server, no UI"). Changes are logged to stdout only
 * -- non-durable, for a human running the seven checks by hand to
 * observe -- which is how checks 02/03/05 get verified without any
 * persistence or API surface. Position is deliberately never printed,
 * even though the brief only bans DURABLE position logging: an
 * unnecessary risk to take with the most sensitive field for zero
 * benefit, since console visibility of position was never a
 * requirement.
 */
export class Board {
  private entries = new Map<string, BoardEntry>();

  private log(line: string): void {
    console.log(`[board] ${line}`);
  }

  private shortId(pubkey: string): string {
    return pubkey.slice(0, 8);
  }

  onStation(params: OnStationParams): BoardEntry {
    // Found in review: re-signing-on while already in distress would
    // silently overwrite status back to "active" -- distress is always
    // a deliberate act to ENTER, and clearing it deserves the same
    // deliberateness, not an incidental side effect of an unrelated
    // signal. A fresh on-station still refreshes every other field
    // (area/duration/etc. may genuinely have changed), it just can't
    // silently un-distress the entry.
    const wasDistress = this.entries.get(params.operator)?.status === "distress";
    const entry: BoardEntry = {
      operator: params.operator,
      callsign: params.callsign,
      area: params.area,
      signedOn: params.now,
      expectedUntil: params.now + params.expectedDurationSeconds,
      routineDue:
        params.routineIntervalSeconds !== null
          ? params.now + params.routineIntervalSeconds
          : null,
      routineIntervalSeconds: params.routineIntervalSeconds,
      lastContact: params.now,
      position: params.position,
      status: wasDistress ? "distress" : "active",
      signalId: params.signalId,
    };
    this.entries.set(params.operator, entry);
    this.log(
      `+ ${this.shortId(params.operator)} callsign=${sanitizeForLog(entry.callsign)} area=${sanitizeForLog(entry.area)} ` +
        `expected_until=${new Date(entry.expectedUntil * 1000).toISOString()} ` +
        `last_contact=${new Date(entry.lastContact * 1000).toISOString()} status=${entry.status}`,
    );
    return entry;
  }

  /**
   * routine check-in: refresh last_contact, advance routine_due using the entry's own
   * stored cadence, clear overdue if it was routine-caused. Does not clear distress -- see
   * onStation()'s comment.
   *
   * `overdueGraceSeconds` is required, not optional, since 2026-08-29: this used to clear
   * "overdue" unconditionally on any contact, without checking *why* the entry was overdue.
   * An operator overdue on total expected duration (not a missed routine check-in) who kept
   * sending routine pings had the flag cleared every time and re-set on the very next sweep
   * -- the same continuing condition logged as a fresh transition, over and over, in the
   * accountability log a human reviews on a cadence.
   */
  routine(operator: string, now: number, overdueGraceSeconds: number): BoardEntry | null {
    const entry = this.entries.get(operator);
    if (!entry) return null;
    entry.lastContact = now;
    entry.routineDue =
      entry.routineIntervalSeconds !== null ? now + entry.routineIntervalSeconds : null;
    if (entry.status === "overdue" && now <= entry.expectedUntil + overdueGraceSeconds) {
      entry.status = "active";
    }
    this.log(`~ ${this.shortId(operator)} routine last_contact=${new Date(now * 1000).toISOString()}`);
    return entry;
  }

  /**
   * any non-routine signal from a known operator (query, assist) still counts as contact.
   * Does not clear distress. Same `overdueGraceSeconds` guard as routine() and for the same
   * reason -- see its comment.
   */
  touch(operator: string, now: number, overdueGraceSeconds: number): BoardEntry | null {
    const entry = this.entries.get(operator);
    if (!entry) return null;
    entry.lastContact = now;
    if (entry.status === "overdue" && now <= entry.expectedUntil + overdueGraceSeconds) {
      entry.status = "active";
    }
    return entry;
  }

  /**
   * Found in review: an operator who sends distress WITHOUT ever having
   * sent on-station first used to be a silent no-op here (no entry to
   * mark) -- they'd still get an ack (handleDistressEvent always sends
   * one), so the sender wouldn't know anything was wrong, but the
   * distress would be completely invisible to anyone watching the
   * board. Distress is the one signal that must never depend on prior
   * on-station bookkeeping, so this now creates a minimal entry when
   * the operator is unknown rather than requiring one to already exist.
   */
  distress(operator: string, now: number): BoardEntry {
    let entry = this.entries.get(operator);
    if (!entry) {
      entry = {
        operator,
        callsign: `OP-${operator.slice(0, 6)}`,
        area: "unknown",
        signedOn: now,
        expectedUntil: now,
        routineDue: null,
        routineIntervalSeconds: null,
        lastContact: now,
        position: null,
        status: "active",
        // No sign-on happened, so there is no signal for an overdue contact to reference.
        signalId: null,
      };
      this.entries.set(operator, entry);
    }
    entry.lastContact = now;
    entry.status = "distress";
    this.log(`! ${this.shortId(operator)} DISTRESS`);
    return entry;
  }

  /**
   * Stand-down: acknowledged, entry REMOVED -- not a status it rests in.
   *
   * Except out of distress. Found by robustness audit: this used to delete unconditionally,
   * the one mutating path here with no such guard -- onStation() already refuses to let an
   * unrelated signal silently clear distress, and sweep()'s hard-expiry protects it from
   * being dropped by age, but a stood-down signal (self-sent, mis-tapped, or coerced) could
   * erase the board's only visible record of it while the real ladder, gated separately by
   * `distress-ack`, kept paging in the background. A human in Watched mode reading the board
   * would see nothing wrong.
   */
  standDown(operator: string): boolean {
    const entry = this.entries.get(operator);
    if (!entry) return false;
    if (entry.status === "distress") {
      this.log(`x ${this.shortId(operator)} stood-down refused -- in distress`);
      return false;
    }
    this.entries.delete(operator);
    this.log(`- ${this.shortId(operator)} stood-down`);
    return true;
  }

  get(operator: string): BoardEntry | undefined {
    return this.entries.get(operator);
  }

  has(operator: string): boolean {
    return this.entries.has(operator);
  }

  all(): BoardEntry[] {
    return [...this.entries.values()];
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * How many entries on this board are overdue. **Local only.**
   *
   * This used to feed an aggregate `overdue_count` on kind 10910, which was how "notify
   * whoever holds watch" happened without a new outbound channel. That field is gone as of
   * watch-state v4: it was an unencrypted announcement that *somebody* was overdue, to
   * anybody subscribed, and whoever holds watch now reads this board directly.
   *
   * Nothing about an overdue operator leaves this process.
   */
  get overdueCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.status === "overdue") count++;
    }
    return count;
  }

  /**
   * Periodic sweep: mark entries overdue past grace, drop entries past
   * hard expiry (except distress). "Overdue nudges. It never escalates,
   * pages, or triggers any ladder" -- this method only ever mutates
   * `status` or removes an entry; it never calls out anywhere BY ITSELF.
   *
   * RENAMED 2026-08-18 from "onOverdue" being described as an
   * "escalation seam" -- external review correctly caught that this
   * framing was the hazard, not just imprecise: "notify whoever holds
   * watch" on the overdue transition is a real, already-specified
   * requirement (watch-state spec), not a deferred nice-to-have. Calling
   * it escalation invited exactly the scope creep it was trying to
   * avoid -- the next person to touch it would reasonably go looking for
   * where the heavier ladder plugs in. It doesn't. The callback fires exactly once per
   * entry, at the moment it transitions into "overdue," not on every sweep of an
   * already-overdue entry.
   *
   * What it does now is write the transition to the accountability log. It used to also
   * republish watch state, because the published count was the only way to tell whoever
   * held watch; the watch is now a mode of the app and reads this board itself.
   *
   * The actual escalation ladder -- paging, a contact chain -- is a genuinely different,
   * heavier thing, still out of scope until it has its own spec and seven failure-mode
   * tests.
   */
  sweep(
    now: number,
    overdueGraceSeconds: number,
    hardExpirySeconds: number,
    onOverdue?: (entry: BoardEntry) => void,
  ): void {
    for (const entry of this.entries.values()) {
      const pastExpectedGrace = now > entry.expectedUntil + overdueGraceSeconds;
      const pastRoutineGrace =
        entry.routineDue !== null && now > entry.routineDue + overdueGraceSeconds;

      if (entry.status === "active" && (pastExpectedGrace || pastRoutineGrace)) {
        entry.status = "overdue";
        this.log(`* ${this.shortId(entry.operator)} overdue`);
        onOverdue?.(entry);
      }

      const pastHardExpiry = now > entry.expectedUntil + hardExpirySeconds;
      if (pastHardExpiry && entry.status !== "distress") {
        this.entries.delete(entry.operator);
        this.log(`- ${this.shortId(entry.operator)} hard-expired`);
      }
    }
  }
}
