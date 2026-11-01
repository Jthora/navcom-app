/**
 * The second signature's check, loaded only when a package waits for it [live.ts, `checkSecond`].
 *
 * Its code is the ML-DSA-65 implementation, so it is a line of its own [scripts/lib/budget.mjs,
 * MAP_LINES] and never part of what the map loads as it mounts: a visit with nothing under a frozen
 * key to check never fetches it.
 */
export { manifestSignedBy as checkSecond } from '@navcom/core';
