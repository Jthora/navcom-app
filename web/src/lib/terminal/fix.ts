/**
 * A shared position, read by the watch.
 *
 * Only an operator who chose to share sends one, and it goes to the watch and their paired peers
 * and nowhere else [`position.svelte.ts`]. The watch was sent it and shown none of it, which is a
 * mechanism nobody could reach. This is how it reads.
 *
 * **Its age is part of it.** A browser cannot read location in the background, so a fix is where
 * they were when they last sent anything, not where they are [invariant 7].
 *
 * Street detail is somebody else's map, reached by handing off a pin [map.md §5], as a directory
 * record does. It opens beside the watch, never in place of it: leaving the Watch screen ends the
 * board, and a pin is opened at exactly the moment the board matters.
 */
import type { Position } from '@navcom/core';
import { ago } from './heard-copy';

/** The coordinates, to read out or paste: six places for an exact fix, four for a rounded one. */
export function coordinates(p: Position): string {
  const places = p.precision_m > 0 ? 4 : 6;
  return `${p.lat.toFixed(places)}, ${p.lon.toFixed(places)}`;
}

/** "exact", or "within 500 m". */
export function within(p: Position): string {
  return p.precision_m > 0 ? `within ${Math.round(p.precision_m)} m` : 'exact';
}

/** How old a fix is, said as an age. */
export function fixAge(at: number, now: number): string {
  return `${ago(now - at)} ago`;
}

/** The pin, on OpenStreetMap, zoomed to street level. */
export function mapLink(p: Position): string {
  return `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=17/${p.lat}/${p.lon}`;
}
