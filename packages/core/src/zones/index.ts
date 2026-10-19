/**
 * Starcom's Zone and Sector Protocol 2.0, read by NavCom's own code [docs/design/map.md, Zones].
 *
 * The ids, the partition and its checks, and the lookup that says which Sector a point is in, on the
 * phone. Written against the published format; Starcom's own reader is under another licence, and
 * none of it is here.
 */
export * from './ids.js';
export * from './geometry.js';
export * from './partition.js';
export * from './lookup.js';
