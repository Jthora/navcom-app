/**
 * Com's layers entry: the map's layer picker and what a layer opens [docs/design/map.md, Layers].
 *
 * Loaded the first time one of its screens opens, never at first paint or mount, and charged to its
 * own line in `scripts/lib/budget.mjs` [MAP_LINES `layers`]. Each layer's own code and data arrive
 * later again, when somebody chooses that layer or asks it something.
 */
export { default as Host } from './LayersHost.svelte';
