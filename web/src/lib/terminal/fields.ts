/**
 * Every field the two storage tiers hold, and which of them cross to another phone in a backup.
 *
 * **Declared, not excepted.** A backup carried every accruing field but `relays_own`, and restore
 * wrote every field but that one and the watch's. So every key a new feature added crossed by
 * default unless somebody remembered a line here — and a kit somebody handed over could plant any
 * field at all: a crew roster where a panic wipe cannot reach it, or a key bundle that stops the
 * real holder reading this operator's Distress until a genuine one arrives [audit: relay paths,
 * F02, again]. Now a field crosses only if it is listed as crossing, and one nobody listed never
 * does, in either direction.
 *
 * `fields.test.ts` reads the source and fails on any field it finds that is not here, so the list
 * cannot quietly fall behind what the app writes.
 *
 * Never imported by `storage.ts`, which is on the root page's first paint: only what makes and
 * restores a backup reads this.
 */

/**
 * - `kit`: sealed into a backup and written back by a restore. The decade.
 * - `watch`: sealed with the watch it names and, on restore, **offered, never written**. These
 *   decide where a Distress goes and whose answer ends it, so they wait for the operator to add the
 *   watch (`backup.ts`, `offerWatch`).
 * - `device`: this phone's own. Never sealed, and refused from a kit.
 */
export type Carry = 'kit' | 'watch' | 'device';

export const ACCRUING_FIELDS = {
  // Who you are.
  secret: 'kit',
  callsign: 'kit',
  signature: 'kit',
  // Who you know, and who you would call.
  peers: 'kit',
  emergency_contact: 'kit',
  // Your card, under its own contact key.
  contact_secret: 'kit',
  card: 'kit',
  card_listed: 'kit',
  card_sent: 'kit',
  // What you built: standing, contributions, and the record you chose to keep.
  endorsements: 'kit',
  endorsements_written: 'kit',
  revocations: 'kit',
  corrections: 'kit',
  corrections_unsent: 'kit',
  places: 'kit',
  places_unsent: 'kit',
  patrols: 'kit',
  keep_patrol_history: 'kit',
  position_precision: 'kit',
  lightning: 'kit',
  lightning_squad: 'kit',
  // What the watch claimed, worth more the longer it goes back [roots.ts].
  seen_roots: 'kit',
  root_alarms: 'kit',
  backup_made: 'kit',
  // The watch you are configured against [audit: relay paths, F02; G3]. `watch_executor` is the
  // older build's bare escalation key: held back on restore and never read.
  watchtower: 'watch',
  relays: 'watch',
  watch_holders: 'watch',
  watch_escalation: 'watch',
  watch_executor: 'watch',
  // The relays this phone talks to: a kit choosing them routes everything somebody else's way.
  relays_own: 'device',
  // Other people's key bundles, learned from relays and learned again. A planted one for a watch
  // or holder is trusted until a real bundle arrives (`pq.svelte.ts`), and until then that holder
  // cannot open this operator's Distress.
  kem_keys: 'device',
  // The watch's own key. A copy of it is the key, so a backup carrying it makes whoever holds the
  // file the watch; and since founding and joining both refuse to replace a key already held, a
  // planted one kept this phone off its real watch. Holders hand it over in person.
  watch_secret: 'device',
  // That this phone founded the watch it holds. Without the key it holds none.
  watch_founded: 'device'
} as const satisfies Record<string, Carry>;

/** Tonight's fields. None of them is ever in a backup: carrying one would undo a wipe somebody meant. */
export const WIPEABLE_FIELDS = [
  'signon',
  'record_notes',
  // The patrol record lives here unless the operator keeps its history (`patrol.ts`).
  'patrols',
  'watch_offered',
  'missions',
  'mission_claims',
  'mission_history',
  'mission_releases',
  'mission_reports'
] as const;

export type AccruingField = keyof typeof ACCRUING_FIELDS;
export type WipeableField = (typeof WIPEABLE_FIELDS)[number];

/**
 * How an accruing field crosses to another phone, or null for one nobody declared — which never
 * does. An own-property check, because a kit is JSON somebody handed over and `__proto__` is a key
 * JSON can carry.
 */
export const carryOf = (field: string): Carry | null =>
  Object.hasOwn(ACCRUING_FIELDS, field) ? ACCRUING_FIELDS[field as AccruingField] : null;
