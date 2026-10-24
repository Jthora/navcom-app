/**
 * Each mark a swatch draws, as the canvas draws it, in a 12 px box: the map's own key row and the whole
 * key on the layers screen draw from these, so the two never disagree [GridMap.svelte; MapKey.svelte].
 * Outline first, then what is inside it, hatching or a cross. Night's dots are a 6 px grid and its
 * tiles' middles, as day and night lays them.
 */

import type { Swatch } from './layer.svelte';

const TRIANGLE = 'M6 1L11 10H1Z';
const DIAMOND = 'M6 .5L11.5 6L6 11.5L.5 6Z';

export const SWATCH_PATHS: Record<Swatch['mark'], [string, string]> = {
  dots: [[[0, 0], [6, 0], [3, 3], [9, 3], [0, 6], [6, 6], [3, 9], [9, 9]].map(([x, y]) => `M${x! + 1} ${y! + 1}h1v1h-1z`).join(''), ''],
  asterisk: ['M1 6h10M3.5 1.67l5 8.66M8.5 1.67l-5 8.66', ''],
  triangle: [TRIANGLE, ''],
  'triangle-hatched': [TRIANGLE, 'M5.29 2.29L8.5 5.5M4.21 4.21L10 10M3.14 6.14L7 10M2.07 8.07L4 10'],
  hexagon: ['M6 1L10.33 3.5V8.5L6 11L1.67 8.5V3.5Z', ''],
  diamond: [DIAMOND, ''],
  'diamond-hatched': [DIAMOND, 'M4.75 1.75L10.25 7.25M3.25 3.25L8.75 8.75M1.75 4.75L7.25 10.25'],
  // The directory's: squares, since the circle is the missions', at the sizes the canvas draws them [layers/ages.ts mark].
  square: ['M1.5 1.5h9v9h-9z', ''],
  'square-small': ['M3 3h6v6h-6z', ''],
  'square-ring': ['M1.5 1.5h9v9h-9z', ''],
  'square-cross': ['M1.5 1.5h9v9h-9z', 'M1.5 1.5l9 9M10.5 1.5l-9 9'],
  // A patch of an area, wider than tall, as a lit province or country is: never a square, the directory's.
  lit: ['M.5 2.5h11v7H.5z', '']
};

/** Which marks are filled rather than outlined. */
export const FILLED: ReadonlySet<Swatch['mark']> = new Set(['square', 'square-small', 'dots', 'lit']);
