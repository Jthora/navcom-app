/**
 * Your own record of your own nights.
 *
 * Not the watch's record of you — that is `/terminal/log/`, and it belongs to the watch.
 * **This one is yours**, it works with no watch and no signal, and publishing it is your
 * decision to make.
 *
 * **Stored entirely on this device, by default and by design.** Nothing here is transmitted
 * to a watch, a relay, a peer or a server. It is for the operator first: their own logbook,
 * their own proof of what they have done, on their own phone.
 *
 * That is also what makes a *track* permissible here when it is forbidden on the wire.
 * Position sharing transmits **live only, never a history** — where somebody was is the most
 * dangerous thing this system could publish. But an operator keeping their own movements on
 * their own device is a GPS watch, not a surveillance surface, and it is theirs. The
 * distinction is where it goes, not whether it exists:
 *
 *   transmitted -> live position only, to the watch and paired peers
 *   local       -> whatever the operator chooses to keep, going nowhere
 *   exported    -> no coordinates at all, at any precision
 *
 * Lots of RLSH stream their patrols and post the footage. Their own activity is not a
 * secret, and withholding a safe export does not stop anybody sharing — it only guarantees
 * the sharing is done badly. So there is an export, and it is built so that using it cannot
 * expose somebody who did not agree to anything.
 *
 * Three lines it does not cross:
 *
 *  - **Nobody but you is in it.** Your movements are yours to publish. Raven's are not
 *  - **Nothing about anyone served.** No query text — *"bed tonight, fleeing partner"* is a
 *    person's situation, and it is never recorded anywhere [invariant 1]
 *  - **No coordinates, ever.** The area you typed at sign-on is coarse by construction; a
 *    position is not, and a stream that showed a street corner should not become an export
 *    carrying a GPS fix
 */

import { get, set } from './storage';
import type { Tier } from './storage';

export interface Patrol {
  /** Unix seconds. */
  started: number;
  ended: number;
  /** Coarse — whatever the operator typed at sign-on. */
  area: string;
  /** Their own words. Nothing else writes here. */
  note?: string;
  /** Who confirmed the stand-down, when there was a watch to confirm it. */
  closedBy?: string;
}

const FIELD = 'patrols';
const KEEP = 'keep_patrol_history';

/**
 * Whether the history survives a panic wipe.
 *
 * **Off by default**, and the trade is priced where the operator makes it: kept, a year of
 * patrols survives a bad night — and a seized phone shows a year of patrols. The Protest
 * Medic wants it off; the Public Face wants it on; both are right about their own situation.
 *
 * The setting itself lives in the accruing tier, so answering the question once is enough.
 */
export function keepsHistory(): boolean {
  return get<boolean>('accruing', KEEP) === true;
}

const tier = (): Tier => (keepsHistory() ? 'accruing' : 'wipeable');

/**
 * The patrol record, or an empty one.
 *
 * Guarded against not being a list. Storage returns whatever is there — a restored backup
 * from another version, or a blob edited by hand — and an object here threw out of
 * `recordPatrol`, which surfaces as a sign-off button that does nothing and says nothing.
 * Reading it as empty is the same call the corrupt-storage path already makes, for the same
 * reason: a terminal that will not start is worse than one that has lost something.
 */
export function patrols(): Patrol[] {
  const stored = get<Patrol[]>(tier(), FIELD);
  return Array.isArray(stored) ? stored : [];
}

/**
 * Moves what already exists, so changing the answer is not a way to lose a year by accident.
 *
 * **The source is cleared only once the copy has landed.** Written as three unchecked writes,
 * a full phone failed the copy and then went on to clear the original — so the one operation
 * whose entire purpose is *not* losing the history was the thing that lost it, on the device
 * least able to afford it. Returns false if the move did not happen; nothing is destroyed in
 * that case and the setting stays where it was.
 */
export function setKeepHistory(keep: boolean): boolean {
  const existing = patrols();
  const from = tier();
  if (!set('accruing', KEEP, keep)) return false;

  const to = tier();
  if (from === to) return true;
  if (!set(to, FIELD, existing)) {
    // Put the answer back, so the record is still where the operator's setting says it is.
    set('accruing', KEEP, !keep);
    return false;
  }
  set(from, FIELD, []);
  return true;
}

/** Returns whether it was actually stored, so the caller is able to say so. */
export function recordPatrol(patrol: Patrol): boolean {
  return set(tier(), FIELD, [...patrols(), patrol]);
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export interface ExportOptions {
  callsign: string | null;
  /** Areas are coarse already, and some operators would still rather not publish them. */
  includeAreas?: boolean;
  includeNotes?: boolean;
}

/**
 * The nights, one line each, with no header and no total.
 *
 * Extracted so the contribution record can carry the same lines without reimplementing the
 * midnight arithmetic below — which was got wrong once, and which is the kind of thing that
 * gets got wrong again the moment there are two copies of it.
 */
export function patrolLines(list: Patrol[], opts: ExportOptions): { lines: string[]; total: number } {
  const lines: string[] = [];
  let total = 0;
  for (const p of [...list].sort((a, b) => a.started - b.started)) {
    const start = new Date(p.started * 1000);
    const end = new Date(p.ended * 1000);
    total += p.ended - p.started;

    const time = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    /*
     * Patrols happen at night, so crossing midnight is the ordinary case here rather than
     * the edge one — and the line read `Dec 31 · 10:00 PM–02:00 AM`, which says a patrol
     * ended four hours before it began. This is the artifact designed to leave the app and
     * be pasted into a grant application, where a reader who cannot tell whether the log is
     * wrong has no way to ask.
     */
    const nights = Math.round(
      (Date.parse(`${end.toDateString()} 00:00:00`) - Date.parse(`${start.toDateString()} 00:00:00`)) / 86_400_000
    );
    const span =
      nights === 0 ? `${time(start)}–${time(end)}`
      : nights === 1 ? `${time(start)}–${time(end)} (next day)`
      : `${time(start)}–${time(end)} (+${nights} days)`;

    const parts = [
      start.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }),
      ...(opts.includeAreas !== false && p.area ? [p.area] : []),
      span,
      formatDuration(p.ended - p.started)
    ];
    lines.push(parts.join(' · '));
    if (opts.includeNotes !== false && p.note) lines.push(`  ${p.note}`);
  }

  return { lines, total };
}

/**
 * The thing designed to leave the app.
 *
 * Plain text, because it has to survive being pasted anywhere — a post, a message, a
 * grant application. Nothing in here came from anybody but the operator.
 */
export function exportPatrols(list: Patrol[], opts: ExportOptions): string {
  const { lines, total } = patrolLines(list, opts);
  return [
    opts.callsign ? `Patrol log — ${opts.callsign}` : 'Patrol log',
    '',
    ...lines,
    '',
    `${list.length} patrol${list.length === 1 ? '' : 's'} · ${formatDuration(total)}`
  ].join('\n');
}
