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
import { sameTeam, type BoardEntry } from '@navcom/core';
import { ago } from './heard-copy';
import { fixAge, mapLink, within } from './fix';
import { metresApart } from '$lib/console/position-once';

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

/**
 * The teams on a board, each once and in name order, so the list the holder narrows by stays put.
 * Each is spelled as most of its members typed it, so one phone's *rescue rangers* does not name
 * the team for everybody; a tie goes to the spelling with capitals.
 */
export function teamsOn(entries: readonly BoardEntry[]): string[] {
  const spellings = new Map<string, Map<string, number>>();
  for (const e of entries) {
    if (!e.team) continue;
    const key = e.team.toLocaleLowerCase();
    const ways = spellings.get(key) ?? new Map<string, number>();
    ways.set(e.team, (ways.get(e.team) ?? 0) + 1);
    spellings.set(key, ways);
  }
  const capitals = (t: string) => [...t].filter((c) => c !== c.toLocaleLowerCase()).length;
  return [...spellings.values()]
    .map((ways) => [...ways].sort(([a, n], [b, m]) => m - n || capitals(b) - capitals(a) || a.localeCompare(b))[0]![0])
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Whether a row shows while the board is narrowed to some teams; none chosen is all of them. A
 * Distress, and anybody past their time, show whatever team they are with: narrowing a list is the
 * holder's convenience, and it never hides the rows a watch exists to see.
 */
export function shownFor(e: BoardEntry, teams: readonly string[]): boolean {
  return teams.length === 0 || e.status === 'distress' || e.status === 'overdue' || teams.some((t) => sameTeam(e.team, t));
}

/**
 * Whether a question or an Assist shows while the board is narrowed: two holders sharing one watch
 * split its teams between them (2026-11-02). One from somebody with no team, or not on the board,
 * shows to both, since neither can say whose it is. A `Distress` is never narrowed and never comes here.
 */
export function askShown(team: string | null | undefined, teams: readonly string[]): boolean {
  return teams.length === 0 || !team || teams.some((t) => sameTeam(team, t));
}

/** A name as a person reads it, for telling whether two rows carry the same one. */
export function nameKey(callsign: string): string {
  return callsign.trim().toLocaleLowerCase();
}

/** The names that more than one operator on this board carries: those rows show a key's print too. */
export function repeatedNames(entries: readonly { callsign: string }[]): Set<string> {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const e of entries) {
    const k = nameKey(e.callsign);
    if (seen.has(k)) twice.add(k);
    seen.add(k);
  }
  return twice;
}

/**
 * The nearest few of these to a fix, by where each last shared they were: who an Assist goes to when
 * somebody needs another body now (2026-11-02). Anybody sharing nothing is left out, not guessed at.
 */
export function nearestTo(fix: { lat: number; lon: number }, entries: readonly BoardEntry[], n = 3): BoardEntry[] {
  return entries
    .flatMap((e) => (e.position ? [{ e, m: metresApart(fix, e.position) }] : []))
    .sort((a, b) => a.m - b.m)
    .slice(0, n)
    .map((x) => x.e);
}
