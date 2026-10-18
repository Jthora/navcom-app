/**
 * Com's screens: what each one is, which entry's code draws it, and how high the sheet opens for it
 * [docs/design/com.md §6; groups.md §13].
 *
 * **The landing page knows none of this.** It keeps a stack of screens in the browser's history and
 * hands the top one to `ComScreen`, which reads it here. A new screen is a member of `Screen` and a
 * line in `SCREENS`; a new entry is a line in `ENTRIES` and one in `COM_ENTRIES`
 * (`scripts/lib/budget.mjs`). Neither touches the landing page's first paint. When the page itself
 * imported each entry, every import site put that entry's preload list into first paint, and the
 * page grew a branch per screen.
 *
 * Loaded as the page mounts, beside the map and the mission feed [budget.mjs ROOT_MOUNT], so the
 * first tap waits on one round trip, the entry's, and not on this module first.
 *
 * Only `e2e/com-distress.spec.ts` reads the `Screen` union below as text, to tap for `Distress` over
 * every screen Com declares. Keep it a union of object literals with a `kind` each.
 */

import type { Component } from 'svelte';
import type { Mission } from '@navcom/core';
import type { Feed } from '$lib/missions/live';
import { entryLoader } from './entries.svelte';

/**
 * Every screen Com can show. History holds these, so each is plain data, and history survives
 * panic wipe and burn [declined.md]: nothing here may name a person.
 */
export type Screen =
  | { kind: 'missions'; province: string | null }
  | { kind: 'mission'; address: string }
  | { kind: 'yours' }
  | { kind: 'report'; address: string }
  | { kind: 'reports'; address: string }
  | {
      kind: 'place';
      code: string | null;
      region: string | null;
      name: string;
      at: string | null;
      record: string | null;
      within: string | null;
      unmapped: string | null;
    };
/**
 * A place opened from the map [map.md §6: every shape is a door]. `code` is the jurisdiction a
 * tapped province or country is filed under (`us-ca`, `ke`), so the screen lists what is filed
 * there; `region` is a directory region's slug, for its ring or one of its records; `at` is where
 * the tap landed, `lat,lon` to what the view resolves, so the screen can say what is near by
 * distance and never by which outline holds it [map.md §3]; `within` is how far from `at` the tap
 * may have meant, in km, a thumb's width at that zoom, so a tap at the whole-Earth view is not
 * measured to the kilometre; `record` is a record's place in its region's list, which the screen
 * reads back and checks against `at`; and `unmapped` is how many of a region's places the map does
 * not draw, when the map knew.
 */
export type Place = Extract<Screen, { kind: 'place' }>;
export type Kind = Screen['kind'];
/** How high the sheet opens for a screen. Never lower than it already is. */
export type Height = 'half' | 'full';

/** The one way any screen moves to another: no destination needs a callback of its own. */
export interface Nav {
  open(screen: Screen): void;
  back(): void;
}

/** What every entry's host is handed: its screen, the way out of it, and what the page already holds. */
export interface HostProps {
  screen: Screen;
  nav: Nav;
  /** The page's clock, ticking each minute. */
  now: number;
  /** The live mission feed the map already reads, shared rather than subscribed to twice. */
  feed: Feed;
  /** The feed's missions still open at `now`: what the map lights. */
  active: Mission[];
  /** Whether the feed's own code failed to arrive, which is not the same as no missions. */
  feedUnloaded: boolean;
}

/**
 * Each entry is one chunk, loaded the first time one of its screens opens, exporting one `Host`
 * that draws every screen of that entry. The only import sites of Com's entries are here.
 */
export const ENTRIES = {
  missions: () => import('$lib/components/missions')
} satisfies Record<string, () => Promise<{ Host: Component<HostProps> }>>;
export type Entry = keyof typeof ENTRIES;

/**
 * What each field of a screen holds, as history gives it back: every field is text, and some may
 * be `null`. Derived from `Screen`, so a field added there and not declared here, or declared as
 * the wrong one, does not compile.
 */
type FieldsOf<S> = { [F in Exclude<keyof S, 'kind'>]-?: null extends S[F] ? 'string|null' : 'string' };

/**
 * Which entry draws each kind, the sheet's height when it opens, and every field it is read back
 * with. A mission is about a place, so its screens open at half and the map stays in view
 * [com.md §7].
 */
export const SCREENS: { [K in Kind]: { entry: Entry; height: Height; fields: FieldsOf<Extract<Screen, { kind: K }>> } } = {
  missions: { entry: 'missions', height: 'half', fields: { province: 'string|null' } },
  mission: { entry: 'missions', height: 'half', fields: { address: 'string' } },
  yours: { entry: 'missions', height: 'half', fields: {} },
  report: { entry: 'missions', height: 'half', fields: { address: 'string' } },
  reports: { entry: 'missions', height: 'half', fields: { address: 'string' } },
  place: {
    entry: 'missions',
    height: 'half',
    fields: {
      code: 'string|null',
      region: 'string|null',
      name: 'string',
      at: 'string|null',
      record: 'string|null',
      within: 'string|null',
      unmapped: 'string|null'
    }
  }
};

/**
 * A screen read back from history, if it is one this version can show.
 *
 * History outlives a build: Back after an update walks into entries another version wrote, with
 * kinds this one may not have, or the same kind with its fields missing or of another type. Those
 * come back `null`, and `ComScreen` says *Not in this version*. Let through, a mistyped field
 * reached a host and threw there, and *Try again* threw again.
 */
export function readScreen(raw: unknown): Screen | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const kind = (raw as { kind?: unknown }).kind;
  // Own keys only: `toString` and `__proto__` are not screens.
  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(SCREENS, kind)) return null;
  const held = raw as Record<string, unknown>;
  for (const [field, type] of Object.entries(SCREENS[kind as Kind].fields)) {
    const value = held[field];
    if (typeof value !== 'string' && !(value === null && type === 'string|null')) return null;
  }
  return raw as Screen;
}

/** Each entry's code, held per entry: one that fails is that entry's failure alone. */
export const entries = entryLoader(ENTRIES);

/** Starts the code for `kind` arriving, once, and settles when it has or has failed. Never rejects. */
export function load(kind: Kind): Promise<void> {
  return entries.load(SCREENS[kind].entry);
}
