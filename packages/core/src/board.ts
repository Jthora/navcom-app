/**
 * The board.
 *
 * Held in memory. **Live tier — never written to durable storage** [C27]. There is no
 * queryable history of who was out where, because there is nothing to query.
 *
 * Normative source: docs/spec/watch-state.spec.md
 */

import type { Position } from './events/signal.js';
import { CALLSIGN_MAX } from './limits.js';

/** `stood-down` is absent on purpose: standing down removes the entry, it is not a state. */
export type EntryStatus = 'active' | 'overdue' | 'distress';

export interface BoardEntry {
  operator: string;
  callsign: string;
  /** The team they gave at sign-on, read by {@link teamOf}. Absent: none given. */
  team?: string;
  /** Coarse. */
  area: string;
  signed_on: number;
  expected_until: number;
  /** The cadence they chose at sign-on, kept so a check-in can set the next one. Null: none. */
  routine_interval: number | null;
  routine_due: number | null;
  last_contact: number;
  position: Position | null;
  /** When the watch heard that position. Null with it. */
  position_at: number | null;
  status: EntryStatus;
}

/** Configurable; defaults per spec. All seconds. */
export interface Lifetimes {
  routineInterval: number;
  overdueGrace: number;
  hardExpiry: number;
}

export const DEFAULT_LIFETIMES: Lifetimes = {
  routineInterval: 3600,
  overdueGrace: 1800,
  hardExpiry: 14400
};

/**
 * Whether an entry has crossed into overdue.
 *
 * Overdue **nudges**: mark it, tell whoever holds watch, try to make contact. It never
 * escalates, pages, or triggers any part of the ladder [C4, invariant 3] — people are late
 * for ordinary reasons far more often than dangerous ones, and false alarms train everyone
 * to ignore the real one.
 */
export function isOverdue(entry: BoardEntry, now: number, l: Lifetimes = DEFAULT_LIFETIMES): boolean {
  if (entry.status === 'distress') return false;
  if (now > entry.expected_until + l.overdueGrace) return true;
  if (entry.routine_due !== null && now > entry.routine_due + l.overdueGrace) return true;
  return false;
}

/**
 * Whether an entry should be dropped.
 *
 * Hard expiry stops a forgotten sign-on lingering forever. It is not a stand-down — the log
 * records expiry, not a completed op.
 *
 * **A distress entry is never dropped.** It holds until a human closes it, and no timer may
 * remove it, which is the difference between a board that expires and a board that loses
 * someone.
 */
export function isExpired(entry: BoardEntry, now: number, l: Lifetimes = DEFAULT_LIFETIMES): boolean {
  if (entry.status === 'distress') return false;
  return now > entry.expected_until + l.hardExpiry;
}

/** One pass over the board. Pure: no storage, no side effects, no clock of its own. */
export function tick(
  entries: BoardEntry[],
  now: number,
  l: Lifetimes = DEFAULT_LIFETIMES
): { board: BoardEntry[]; newlyOverdue: BoardEntry[]; expired: BoardEntry[] } {
  const board: BoardEntry[] = [];
  const newlyOverdue: BoardEntry[] = [];
  const expired: BoardEntry[] = [];

  for (const entry of entries) {
    if (isExpired(entry, now, l)) {
      expired.push(entry);
      continue;
    }
    if (entry.status === 'active' && isOverdue(entry, now, l)) {
      const marked = { ...entry, status: 'overdue' as const };
      newlyOverdue.push(marked);
      board.push(marked);
      continue;
    }
    board.push(entry);
  }

  return { board, newlyOverdue, expired };
}

/**
 * A routine check-in: heard from them, and the next one is due a full interval from now.
 *
 * Moving `routine_due` is the whole point of checking in. A board that only refreshed
 * `last_contact` marked an operator overdue one interval and a grace after signing on however
 * often they checked in, which is the false alarm the overdue rule exists to avoid.
 * Overdue on the time they gave is untouched: checking in does not extend a patrol.
 */
export function checkedIn(entry: BoardEntry, at: number): BoardEntry {
  return {
    ...entry,
    last_contact: Math.max(entry.last_contact, at),
    // Never earlier than it is: relays deliver out of order, and an older check-in arriving after
    // a newer one must not pull the next one forward.
    routine_due: entry.routine_interval !== null ? Math.max(entry.routine_due ?? 0, at + entry.routine_interval) : null
  };
}

/** The next time this entry is due for something: a check-in or coming back, whichever is first. */
export function nextDue(entry: BoardEntry): number {
  return entry.routine_due !== null ? Math.min(entry.routine_due, entry.expected_until) : entry.expected_until;
}

/**
 * The order a watch reads the board in: Distress, then anybody past their time, then whoever is
 * due soonest. Somebody crossing their window rises past the others, so the movement is the event.
 * Names break ties, so the order is stable between two reads of the same board.
 */
export function boardOrder(a: BoardEntry, b: BoardEntry): number {
  const rank = (e: BoardEntry) => (e.status === 'distress' ? 0 : e.status === 'overdue' ? 1 : 2);
  return rank(a) - rank(b) || nextDue(a) - nextDue(b) || a.callsign.localeCompare(b.callsign);
}

/**
 * A team name off the wire, as a board shows it: trimmed, its runs of space made one, with no
 * control characters and no longer than a callsign. Null for anything else, so a board shows no
 * team rather than an empty one.
 */
export function teamOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CALLSIGN_MAX).trim();
  return name || null;
}

/**
 * Whether two team names are the same team. Typed on twenty phones in the cold, *Team B* and
 * *team b* are one team, so case is not a difference.
 */
export function sameTeam(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLocaleLowerCase() === b.toLocaleLowerCase();
}

/** Standing down removes the entry. The board holds who is out; someone home is not out. */
export function standDown(entries: BoardEntry[], operator: string): BoardEntry[] {
  return entries.filter((e) => e.operator !== operator);
}
