/**
 * Where mission packages live, apart from the reader of them [missions/package.ts], which re-exports
 * these.
 *
 * Every page that dials a relay asks which hosts these are [relays.ts], the public roster included,
 * and imported from the reader they took the whole reader with them: a page that reads no mission
 * carried every rule for reading one (boundaries.test.ts, measured 2026-10-10; moved 2026-10-27).
 * Outside `missions/`, whose modules the roster must not carry, because these are relay addresses.
 */

/** Where packages are published. Authoritative per Starcom's answer to Q8. */
export const THE_RECORD = 'wss://record.cosmiccodex.app';

/**
 * Where a device reads packages: The Record, and the mirrors that copy it [docs/design/grid.md].
 *
 * Read all at once, and the newest signed copy of each package wins, so a mirror can fall behind but
 * cannot forge one. The Record stays authoritative (Q8); a mirror is what still answers when it
 * cannot. A list written here until relay lists ship [build order G3], when the publisher's own
 * list says where its packages live.
 */
export const MISSION_RELAYS: readonly string[] = [THE_RECORD, 'wss://blackpi.cosmiccodex.app'];
