/**
 * What this watch did tonight, on the phone that did it.
 *
 * A watch held on phones keeps no accountability log: the node's is a box's, anchored and
 * reviewable, and a squad has no box. So after a night nobody could say when the watch was taken,
 * how long a `Distress` waited for an answer, or who was asked to check in. This is that, and only
 * that — **actions, not positions** [CLAUDE.md, the board row]:
 *
 * - What the watch did and when, and how long after the signal it answered arrived
 * - Callsigns, the names operators chose to be known by [invariant 6]
 * - **Never** what anybody wrote, where anybody was, or who was out when: no text, no area, no fix.
 *   A sign-on is the board's, and the board expires; it is not written here
 *
 * Tonight's, in the wipeable tier: a panic wipe destroys it [invariant 5]. Bounded, oldest out. It
 * is evidence nobody else can check, and the screen does not pretend otherwise: it is the holder's
 * own note of the night, to copy out for whoever reviews it.
 */
import { get, set, clearField } from './storage';

const FIELD = 'watch_night';
const HELD = 400;

export interface NightEntry {
  at: number;
  what: string;
}

/**
 * Read when the module loads, never from a getter: a screen reads `entries` while it renders, and
 * writing state there is refused [Svelte, `state_unsafe_mutation`] — it took the Watch screen down.
 */
let entries = $state<NightEntry[]>(get<NightEntry[]>('wipeable', FIELD) ?? []);

export const night = {
  get entries(): NightEntry[] {
    return entries;
  },

  /** One thing the watch did, now. */
  note(what: string, at = Math.floor(Date.now() / 1000)): void {
    entries = [...entries, { at, what }].slice(-HELD);
    set('wipeable', FIELD, entries);
  },

  /** As text, one line each, for copying out. */
  text(): string {
    return entries
      .map((e) => `${new Date(e.at * 1000).toISOString().replace('T', ' ').slice(0, 16)}Z  ${e.what}`)
      .join('\n');
  },

  clear(): void {
    entries = [];
    clearField('wipeable', FIELD);
  },

  /** Read again from storage, after a wipe. Never from a screen's render. */
  reload(): void {
    entries = get<NightEntry[]>('wipeable', FIELD) ?? [];
  }
};

/** "after 40s", "after 3 min": how long a signal waited for the watch. */
export function waited(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s < 120 ? `after ${s}s` : `after ${Math.round(s / 60)} min`;
}
