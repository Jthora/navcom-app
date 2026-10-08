/**
 * Where the watch this phone was given listens, read without its escalation key.
 *
 * `config.ts` reads the whole watch, and checking the escalation key means the watch-code parser
 * and its signature check. A page that only needs the relays — the public roster, which reads cards
 * from everywhere `relays()` names — should not carry that to learn them [budget: public roster].
 */

import { get } from './storage';
import { usable } from './relay-url';

/** A stored list as storage gives it back: anything that is not a string is dropped. */
export const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** The watch's address and its relay lines exactly as saved, or null when there is no watch. */
export function savedWatch(): { pubkey: string; lines: string[] } | null {
  const pubkey = get<unknown>('accruing', 'watchtower');
  if (typeof pubkey !== 'string' || !pubkey) return null;
  return { pubkey, lines: strings(get<unknown>('accruing', 'relays')) };
}

/** The watch's relays this page can reach, or null with no watch or none reachable: `loadConfig()?.relays`. */
export function watchRelayList(): string[] | null {
  const watch = savedWatch();
  if (!watch) return null;
  const reachable = usable(watch.lines);
  return reachable.length ? reachable : null;
}
