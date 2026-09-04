import type { ResourceField, ResourceRecord, ResourceType } from './types.js';

/**
 * The places whose address is the thing that keeps people alive, and must never be published.
 *
 * A domestic-violence refuge is not a shelter with a sensitive flag on it. Its location *is*
 * the protection: an abuser who learns the address has defeated the service for everyone
 * inside it, not only the person they came for. HUD suppresses these addresses in its own
 * national inventory for that reason, and a volunteer directory that publishes what the
 * federal one withholds is a directory that got somebody hurt.
 *
 * ## Why this is a module and not a validation line
 *
 * There are four ways an address reaches a reader, and a check in one of them is a check in
 * none. It can arrive in the seed CSV, be added from the field as a place, be asserted later
 * as a correction over a record that was clean when it shipped, or survive all three and be
 * printed by a component that reads the field directly. The rule therefore lives here and is
 * called from every one of them, the same way `checkPlace` is applied by both the builder and
 * the reader rather than written twice.
 *
 * ## The rule bans precision, not location
 *
 * A refuge with no region at all is unreachable, and unreachable is its own harm — somebody
 * at 11pm needs to know a service exists in this city even when they must phone to find it.
 * So the region a record already lives in is untouched, and what is refused is the two things
 * that turn "somewhere in Philadelphia" into a doorstep: a street address, and coordinates.
 *
 * Coordinates matter more than the address string and are the easier one to forget. An
 * address can be vague. A `lat`/`lon` pair never is, and it survives every UI that decides not
 * to print the address field.
 *
 * ## Why this existed as an accident before it existed as a rule
 *
 * There were zero `dv` records when this was written, and that was luck rather than design:
 * OSM and Overture do not tag refuges, so the importer never produced one. Nothing prevented
 * an operator adding a refuge from the field tomorrow, in good faith, with the address on it —
 * which is the shape of every accident this project has actually had. [invariant 1]
 *
 * Normative source: docs/product/directory-schema.md
 */

/**
 * Types whose precise location is withheld.
 *
 * Deliberately a list rather than a boolean on the record. A contributor cannot mark their own
 * entry non-confidential, because the protection does not belong to whoever typed the row.
 */
export const CONFIDENTIAL_TYPES = ['dv'] as const;
export type ConfidentialType = (typeof CONFIDENTIAL_TYPES)[number];

/**
 * Fields that turn a region into a doorstep.
 *
 * `address` and the coordinate pair are the whole set: everything else a record carries
 * describes what the place *does*, which is exactly what somebody needs in order to phone it.
 */
export const LOCATING_FIELDS = ['address', 'lat', 'lon'] as const satisfies readonly ResourceField[];
export type LocatingField = (typeof LOCATING_FIELDS)[number];

/** Whether a type's location is withheld. */
export const isConfidential = (type: string): type is ConfidentialType =>
  (CONFIDENTIAL_TYPES as readonly string[]).includes(type);

/** Whether a field is one that would locate a place precisely. */
export const isLocating = (field: string): field is LocatingField =>
  (LOCATING_FIELDS as readonly string[]).includes(field);

/**
 * The locating fields this record carries that it must not, in schema order.
 *
 * Empty for every record that is fine, which is nearly all of them — so a caller reads
 * `locatingLeaks(r).length > 0` as "this row is a problem" without knowing the rule.
 *
 * A blank string and a missing key are the same thing here. A CSV round-trip turns one into
 * the other and back, and a rule that treated `address=""` as a leak would fail every record
 * exported and re-imported.
 */
export function locatingLeaks(
  record: Pick<ResourceRecord, 'type'> & Partial<Record<LocatingField, unknown>>
): LocatingField[] {
  if (!isConfidential(record.type)) return [];
  return LOCATING_FIELDS.filter((f) => {
    const v = record[f];
    if (v === undefined || v === null) return false;
    if (typeof v === 'string') return v.trim() !== '';
    if (typeof v === 'number') return Number.isFinite(v);
    return true;
  });
}

/**
 * The sentence a contributor gets when they hit this.
 *
 * Phrased as the reason rather than "invalid", because somebody adding a refuge from the field
 * is doing the right thing and needs to know why the useful half of their entry was kept.
 */
export function confidentialRefusal(type: ResourceType, fields: readonly string[]): string {
  return (
    `A ${type} record must not carry ${fields.join(', ')}. ` +
    `The location of a refuge is the protection, not a detail about it — the region and the ` +
    `phone number are kept, and somebody who needs the address is given it by a person.`
  );
}
