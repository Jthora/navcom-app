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
  /** For an answer: what it answered, and how long that waited for a person, in seconds. */
  answered?: { type: string; waited: number };
}

/** How long the watch's answers waited, by what they answered: a count, the middle and the longest. */
export interface Recap {
  type: string;
  count: number;
  median: number;
  longest: number;
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

  /** One thing the watch did, now; for an answer, what it answered and how long that waited. */
  note(what: string, at = Math.floor(Date.now() / 1000), answered?: NightEntry['answered']): void {
    entries = [...entries, { at, what, ...(answered ? { answered } : {}) }].slice(-HELD);
    set('wipeable', FIELD, entries);
  },

  /**
   * The night in a line per kind, for whoever reviews it (the joint night, 2026-11-04): how many of
   * each the watch answered, and how long the middle one and the longest waited for a person. A
   * Distress first. Counts of the watch's own acts, never of anybody out: nothing here sums a person.
   */
  recap(): Recap[] {
    const by = new Map<string, number[]>();
    for (const e of entries) if (e.answered) by.set(e.answered.type, [...(by.get(e.answered.type) ?? []), e.answered.waited]);
    const order = ['distress', 'assist', 'query', 'resupply'];
    return [...by.entries()]
      .map(([type, waits]) => {
        const sorted = [...waits].sort((a, b) => a - b);
        return { type, count: sorted.length, median: sorted[Math.floor((sorted.length - 1) / 2)]!, longest: sorted[sorted.length - 1]! };
      })
      .sort((a, b) => (order.indexOf(a.type) + 1 || 99) - (order.indexOf(b.type) + 1 || 99));
  },

  /** As text, one line each, for copying out, with the recap first. */
  text(): string {
    const recap = this.recap().map((r) => `${r.count} ${r.type}: middle ${span(r.median)}, longest ${span(r.longest)}`);
    const lines = entries.map((e) => `${new Date(e.at * 1000).toISOString().replace('T', ' ').slice(0, 16)}Z  ${e.what}`);
    return [...(recap.length > 0 ? [...recap, ''] : []), ...lines].join('\n');
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

/** "40s", "3 min": a wait, said plainly. */
export function span(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s < 120 ? `${s}s` : `${Math.round(s / 60)} min`;
}

/** "after 40s", "after 3 min": how long a signal waited for the watch. */
export function waited(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s < 120 ? `after ${s}s` : `after ${Math.round(s / 60)} min`;
}
