import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import type { SecretKey } from '../crypto/keys.js';
import { KIND_PLACE } from '../events/kinds.js';
import { CALLSIGN_MAX, VALUE_MAX, withinLimit } from '../limits.js';
import { RESOURCE_TYPES, type Method, type ResourceRecord, type ResourceType } from './types.js';

/**
 * A place the published directory does not have.
 *
 * ## The gap this closes
 *
 * Thirty-five of sixty-eight regions hold zero records. An operator in Nashville opened the
 * directory, read *"Nothing yet — no directory for this area on this phone"*, and had no path
 * forward inside the app: `corrections.ts` can amend a record, and there was no way to say
 * **"there is a place here you do not have."**
 *
 * So the directory could only ever be seeded downward, by a maintainer editing a CSV. That
 * makes every empty region wait on a person who has never been there, which is the
 * cold-start problem stated as an architecture. One operator adding the three places they
 * already know is a smaller act than a phone campaign and a much smaller one than finding a
 * squad, and it is the only one that scales without coordination.
 *
 * ## Why this is a separate kind rather than a correction
 *
 * A correction amends a claim. This asserts that a building exists, and the two have
 * different failure modes: **a wrong field sends somebody to the wrong hours; a wrong place
 * sends somebody to an address that is not there.** That is the Medic's kill trigger
 * standing somewhere new, and it earns its own validation, its own limits and its own
 * marking on the screen rather than inheriting a correction's.
 *
 * ## The one rule that answers that failure mode
 *
 * **`method` may only be `in_person`, `staff_confirmed` or `phone`.** You may add a place you
 * have stood at or spoken to. You may not add one you read about — `website` and
 * `secondhand` are refused here even though the confidence rules can rank them, because a
 * scraped place belongs in the maintainer's import path where a person reviews it, not on
 * somebody's screen at 11pm.
 *
 * Everything downstream is unchanged: a place becomes a `ResourceRecord`, corrections merge
 * over it by the existing rules, and its decisive fields start blank, which renders as
 * *unknown* [rule 5]. Nothing here invents a merge rule or a confidence.
 *
 * Normative source: docs/product/directory-schema.md
 */

/**
 * How somebody can come to know a place exists, ranked as everywhere else.
 *
 * Deliberately a subset of `Method`, and the omissions are the point — see above.
 */
export const PLACE_METHODS = ['in_person', 'staff_confirmed', 'phone'] as const;
export type PlaceMethod = (typeof PLACE_METHODS)[number];

/**
 * Extra fields a place may carry when it is created.
 *
 * Kept to what somebody standing outside can read off the building or was told on the phone.
 * The decisive fields — pets, ID, sobriety, curfew, intake hours, who they accept — are
 * **deliberately absent**: they are not knowable from a doorway, and a creation form that
 * invited them would collect guesses with an operator's name attached. They arrive later, as
 * corrections, from somebody who asked.
 */
export const PLACE_EXTRAS = ['phone', 'hours', 'notes'] as const;
export type PlaceExtra = (typeof PLACE_EXTRAS)[number];

export interface Place {
  /** Derived from name and address — see `placeId`. Never chosen by the author. */
  id: string;
  /** Region slug, so a device can ask one relay for one metro. */
  region: string;
  name: string;
  type: ResourceType;
  /** Enough to walk to. The one field that makes a place actionable rather than a rumour. */
  address: string;
  /** A callsign, or `anonymous`. **Never a legal name** [invariant 8]. */
  verified_by: string;
  method: PlaceMethod;
  /** ISO date, `YYYY-MM-DD`. */
  last_verified: string;
  fields?: Partial<Record<PlaceExtra, string>>;
}

export class PlaceError extends Error {}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const REGION = /^[a-z0-9-]+$/;
const NAME_MAX = 120;
const ADDRESS_MAX = 200;

/**
 * Identity, so two operators adding the same shelter produce one entry.
 *
 * Derived from the place rather than the author. If it were keyed by author, the same
 * building added by four people would be four rows on a screen somebody is reading in the
 * cold; keyed by the place, the second assertion becomes a competing claim about one row and
 * the existing confidence rules weigh it. Nothing new decides anything.
 *
 * ## What normalisation must not do
 *
 * Starcom derived a claim identifier by lowercasing and collapsing punctuation, and it
 * quietly merged 北京, Москва and 東京 into a single slot where each silently overwrote the
 * last. Their independent implementation caught it; their own tests structurally could not.
 *
 * So this normalises conservatively and **never strips a character class**: Unicode NFC so
 * the same string typed two ways hashes the same, case folding, and whitespace collapsed.
 * Nothing is removed. Two distinct names in any script stay two distinct places, which is
 * the safe direction — a duplicate row is untidy, a collision hides a building behind
 * another one.
 */
export function placeId(name: string, address: string): string {
  const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  // A NUL separator so `("ab", "c")` and `("a", "bc")` cannot hash alike — neither can occur
  // in either field, because both are refused below.
  const digest = sha256(utf8ToBytes(`${norm(name)}\u0000${norm(address)}`));
  return `place:${bytesToHex(digest).slice(0, 16)}`;
}

/** Control characters, including the separator the id relies on. */
const CONTROL = /[\u0000-\u001f\u007f]/;

function checkPlace(place: Place): void {
  if (!REGION.test(place.region)) throw new PlaceError('A place needs a region.');

  const name = place.name.trim();
  if (!name) throw new PlaceError('A place needs a name.');
  if (name.length > NAME_MAX) throw new PlaceError(`A name is ${NAME_MAX} characters or fewer.`);
  if (CONTROL.test(name)) throw new PlaceError('A name cannot contain control characters.');

  const address = place.address.trim();
  /*
   * Required, and this is the load-bearing check rather than a completeness one. A place
   * without an address is a rumour: it cannot be walked to, it cannot be told apart from
   * another place with the same name, and it gives the reader nothing to check. The whole
   * risk this kind introduces is somebody walking somewhere that is not there, and an
   * addressless entry is that risk with no way to even be wrong usefully.
   */
  if (!address) throw new PlaceError('A place needs an address somebody could walk to.');
  if (address.length > ADDRESS_MAX) {
    throw new PlaceError(`An address is ${ADDRESS_MAX} characters or fewer.`);
  }
  if (CONTROL.test(address)) throw new PlaceError('An address cannot contain control characters.');

  if (!RESOURCE_TYPES.includes(place.type)) throw new PlaceError('Unknown type.');
  if (!withinLimit(place.verified_by, CALLSIGN_MAX)) {
    throw new PlaceError(`A place needs a callsign of ${CALLSIGN_MAX} characters or fewer, or \`anonymous\`.`);
  }
  if (!PLACE_METHODS.includes(place.method)) {
    // Said in full, because the refusal is a design position and an operator who hits it
    // deserves the reason rather than "invalid".
    throw new PlaceError(
      'A place can only be added by somebody who went there, was told by staff, or phoned it. Something read on a website goes to the maintainers, not onto a screen at 11pm.'
    );
  }
  if (!ISO_DATE.test(place.last_verified)) throw new PlaceError('last_verified must be YYYY-MM-DD.');

  for (const [k, v] of Object.entries(place.fields ?? {})) {
    if (!(PLACE_EXTRAS as readonly string[]).includes(k)) {
      throw new PlaceError(`"${k}" is not something a new place carries. Add it as a correction once somebody has asked.`);
    }
    if (typeof v !== 'string' || v.length > VALUE_MAX) {
      throw new PlaceError(`"${k}" is longer than ${VALUE_MAX} characters.`);
    }
  }
}

/**
 * Builds a place, signed by the operator's **contact key**.
 *
 * The same key that signs a card and a correction, and for the same reason: contributing
 * publicly must cost no operational exposure. Addressable on the derived id, so an operator's
 * latest word about a place replaces their earlier word rather than accumulating — and
 * tagged by region so a device can subscribe to a metro it has never seen a record from,
 * which is the entire point in an empty region.
 */
export function buildPlace(contactSecret: SecretKey, place: Place, createdAt: number): Event {
  checkPlace(place);
  const id = placeId(place.name, place.address);
  if (place.id && place.id !== id) {
    // The id is derived, never asserted. A caller that disagrees has computed it from
    // different strings than the ones it is about to publish.
    throw new PlaceError('A place id is derived from its name and address, not chosen.');
  }

  const fields = Object.fromEntries(
    Object.entries(place.fields ?? {}).filter(([, v]) => typeof v === 'string' && v.trim() !== '')
  );

  return finalizeEvent(
    {
      kind: KIND_PLACE,
      created_at: createdAt,
      tags: [
        ['d', id],
        // Filterable, so `{ kinds: [KIND_PLACE], '#g': ['nashville'] }` finds places in a
        // region whose published directory is empty.
        ['g', place.region]
      ],
      content: JSON.stringify({
        id,
        region: place.region,
        name: place.name.trim(),
        type: place.type,
        address: place.address.trim(),
        verified_by: place.verified_by.trim(),
        method: place.method,
        last_verified: place.last_verified,
        ...(Object.keys(fields).length > 0 ? { fields } : {})
      })
    },
    contactSecret
  );
}

/** Reads a place, or returns null. A relay serves whatever it likes. */
export function readPlace(event: Event): (Place & { by: string }) | null {
  if (event.kind !== KIND_PLACE) return null;
  if (!verifyEvent(event)) return null;

  try {
    const p = JSON.parse(event.content) as Partial<Place>;
    if (typeof p.name !== 'string' || typeof p.address !== 'string') return null;
    if (typeof p.region !== 'string' || typeof p.verified_by !== 'string') return null;
    if (typeof p.method !== 'string' || typeof p.last_verified !== 'string') return null;
    if (typeof p.type !== 'string') return null;
    if (p.fields !== undefined && (p.fields === null || typeof p.fields !== 'object' || Array.isArray(p.fields))) {
      return null;
    }

    // The same checks the builder applies, applied on read. A hand-rolled client is the
    // ordinary case on an open protocol, not the hostile one.
    checkPlace(p as Place);

    const id = placeId(p.name, p.address);
    // The `d` tag is what a relay indexed and the id is what the merge keys on; if either
    // disagrees with the payload, one of them is lying and neither is worth guessing about.
    if (event.tags.find((t) => t[0] === 'd')?.[1] !== id) return null;
    if (p.id !== undefined && p.id !== id) return null;
    if (event.tags.find((t) => t[0] === 'g')?.[1] !== p.region) return null;

    for (const v of Object.values(p.fields ?? {})) {
      // Non-empty, for the reason `readCorrection` learned the hard way: an empty string is
      // still a string, and it becomes a merge candidate that can blank a field.
      if (typeof v !== 'string' || v.trim() === '') return null;
    }

    return { ...(p as Place), id, by: event.pubkey };
  } catch {
    return null;
  }
}

/**
 * A place, as a record the rest of the directory already knows how to handle.
 *
 * Everything downstream — confidence, staleness, display, `needsChecking`, corrections
 * merging over the top — takes a `ResourceRecord`. Converting here rather than teaching each
 * of them about a second shape is what keeps a created place from becoming a parallel
 * system with its own rules and its own bugs.
 *
 * The decisive fields are absent rather than empty, which renders as *unknown* — the honest
 * reading, and the one `needsChecking` turns into the questions worth asking.
 */
export function placeToRecord(place: Place & { by: string }): ResourceRecord {
  return {
    id: place.id,
    region: place.region,
    name: place.name,
    type: place.type,
    address: place.address,
    verified_by: place.verified_by,
    method: place.method as Method,
    last_verified: place.last_verified,
    flag: 'ok',
    ...(place.fields ?? {})
  } as ResourceRecord;
}

const METHOD_RANK: Record<PlaceMethod, number> = { in_person: 3, staff_confirmed: 3, phone: 2 };

/**
 * One row per place, when several operators added the same one.
 *
 * Keying on the derived id already collapses them; this decides which assertion's *name and
 * address* the row carries when two disagree slightly — "St Pat's" and "St Patrick Center"
 * at the same address are two ids, but the same operator republishing is one, and so is a
 * second operator who typed it identically.
 *
 * Strongest method first, then most recent, then the author's key. The last is an arbitrary
 * tie-break and deliberately so: there is no ground truth to prefer between two people who
 * both stood at the same door on the same day, and **two devices receiving the same events
 * in a different order must draw the same picture.** The same reasoning, and the same bug,
 * as `mergeCorrections`.
 */
export function dedupePlaces(places: readonly (Place & { by: string })[]): (Place & { by: string })[] {
  const best = new Map<string, Place & { by: string }>();
  for (const p of places) {
    const held = best.get(p.id);
    if (!held) {
      best.set(p.id, p);
      continue;
    }
    const better =
      METHOD_RANK[p.method] > METHOD_RANK[held.method] ||
      (METHOD_RANK[p.method] === METHOD_RANK[held.method] && p.last_verified > held.last_verified) ||
      (METHOD_RANK[p.method] === METHOD_RANK[held.method] &&
        p.last_verified === held.last_verified &&
        p.by < held.by);
    if (better) best.set(p.id, p);
  }
  // Sorted by id so the list itself does not depend on arrival order either.
  return [...best.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Everything this device can show for a region: what shipped, plus what operators added.
 *
 * Published records win on identity — if a place an operator added later appears in the
 * published directory under the same derived id, the curated row is the one a person stood
 * behind, and the operator's assertion becomes corrections-shaped evidence over it rather
 * than a second row.
 */
export function withPlaces(
  published: readonly ResourceRecord[],
  places: readonly (Place & { by: string })[]
): ResourceRecord[] {
  const have = new Set(published.map((r) => r.id));
  const added = dedupePlaces(places)
    .filter((p) => !have.has(p.id))
    .map(placeToRecord);
  return [...published, ...added];
}

/** Whether a record on screen came from an operator rather than from the published directory. */
export const isAddedPlace = (record: Pick<ResourceRecord, 'id'>): boolean =>
  record.id.startsWith('place:');
