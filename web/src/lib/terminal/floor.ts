/**
 * What a row on the watch's board says, beside the name.
 *
 * Holding the board is watching the timers [`the-watch.md`, *Duty*], and the board showed none: a
 * row read *Raven · Midtown · active*, with nothing to say when they were due or when anybody last
 * heard from them. These are the times, as ages from now, so they read the same wherever the watch
 * is sitting: a clock time is in the watch's zone, and the patrol may be in another.
 *
 * Facts, never verdicts [invariant 3]: *check-in due 20 min ago* is what the board knows; *overdue*
 * and *missing* are readings of it, and nothing here makes them.
 */
import type { BoardEntry } from '@navcom/core';
import { ago } from './heard-copy';
import { fixAge, mapLink, within } from './fix';

/** When they are next due for something, or how long ago they were. */
export function floorNote(e: BoardEntry, now: number): string {
  if (e.status === 'distress') return 'Distress';
  if (now > e.expected_until) return `due back ${ago(now - e.expected_until)} ago`;
  if (e.routine_due !== null && now > e.routine_due) return `check-in due ${ago(now - e.routine_due)} ago`;
  if (e.routine_due !== null && e.routine_due < e.expected_until) return `check-in in ${ago(e.routine_due - now)}`;
  return `back in ${ago(e.expected_until - now)}`;
}

/** When this board last heard anything from them. */
export function floorDetail(e: BoardEntry, now: number): string {
  return `heard ${ago(now - e.last_contact)} ago`;
}

/** Where they last shared they were, as a pin to open beside the board. */
export function floorPin(e: BoardEntry, now: number): { href: string; label: string } | null {
  if (!e.position || e.position_at === null) return null;
  return { href: mapLink(e.position), label: `Map · ${within(e.position)} · ${fixAge(e.position_at, now)}` };
}
