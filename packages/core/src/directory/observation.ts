/**
 * An observation — *"on 3 Sept at 23:10 I saw the door locked."*
 *
 * Normative source: [`docs/product/raw-intel.md`](../../../../docs/product/raw-intel.md).
 * Where this file and that page disagree, the page wins and this file is the bug.
 *
 * ## An observation is not a correction, and the distinction carries everything
 *
 * A correction says what **is** — *"St Pat's closes intake at 20:30"* — and it rots, which is
 * why `volatility.ts` decays it. An observation says what someone **saw** at a moment, and it
 * stays true forever. Conflating them produces a system that either forgets its evidence or
 * trusts stale claims. Two objects, two kinds, two lifetimes.
 *
 * ## Kind `1911` is regular on purpose
 *
 * Regular (1000–9999) means relays store it and it is never replaced. Not replaceable and not
 * addressable, because both let an author quietly overwrite what they previously published,
 * and an evidence record whose history can be rewritten is the thing the accountability log
 * exists to prevent. **An observation is superseded by a later observation, never edited.**
 *
 * Not ephemeral either, which is the deliberate opposite of `Distress`: a distress call must
 * leave no queryable history, and an observation is *for* the record.
 *
 * ## What is not built yet, stated here rather than discovered later
 *
 * - **The vocabulary is a placeholder** (§7). It needs local knowledge and is not agent work
 * - **The anchor object does not exist** (§5), so an observation can only name a directory
 *   record that already exists. That is a real limit, not a simplification
 * - **Nothing here makes an observation discoverable.** The spec pins one tag, `refines`, and
 *   pins no other; a consumer today finds observations by author or by fetching the kind. An
 *   anchor-shaped or region-shaped tag would fix that and would be **wire format**, so it is
 *   not invented here — it is the next thing the spec has to say
 */

import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import type { SecretKey } from '../crypto/keys.js';
import { KIND_OBSERVATION } from '../events/kinds.js';
import { CALLSIGN_MAX, withinLimit } from '../limits.js';
import { geohash } from './geohash.js';
import type { ResourceRecord } from './types.js';

/**
 * Exactly what an observation may carry.
 *
 * The enforcement mechanism for §6, and the reason it works: **free text cannot be policed,
 * so it is not published.** There is no field here for a physical descriptor, and none for a
 * sentence. An operator's own notes stay in the Wipeable tier on their device.
 *
 * Enforced refuse-not-trim on read, exactly like `CARD_FIELDS` — an observation carrying a
 * field this build does not know was written by something with a different idea of what an
 * observation is, and the field somebody will eventually try to add here is a description of
 * a person.
 */
export const OBSERVATION_FIELDS = [
  'anchor',
  'observed_at',
  'tags',
  'method',
  'callsign',
  'precision',
  'supersedes'
] as const;

/**
 * How the observer came to know. A **fact, not a judgment**, requiring no self-assessment.
 *
 * NavCom does not grade its own operators — scoring people is a reputation system by another
 * name. Grading is Starcom's, on the Admiralty two-axis code, and the axes fall either side
 * of this boundary by their own doctrine: source reliability comes from the provenance
 * attached here, information credibility from corroboration, which is Starcom's function.
 *
 * `F6` — untested source, unverifiable information — is a **valid grade and not a rejection**,
 * so there is no quality bar on submission, ever. A first-night operator is F6.
 */
export const OBSERVATION_METHODS = ['saw', 'told', 'inferred'] as const;
export type ObservationMethod = (typeof OBSERVATION_METHODS)[number];

/** Coarse now, exact later. See §4 and `AREA_GEOHASH_CHARS`. */
export const PRECISIONS = ['area', 'exact'] as const;
export type Precision = (typeof PRECISIONS)[number];

/**
 * A coarse area is a geohash of **exactly four characters**, ±20 km.
 *
 * Stated as a count rather than a distance, and normative as a count. An earlier draft of the
 * spec said "coarse (~20 km)" and gave a five-character example, which is ±2.4 km — an
 * eight-fold disagreement inside the one field whose entire job is preventing an operator
 * from being located. A consumer builds against the example, not the adjective.
 */
export const AREA_GEOHASH_CHARS = 4;

/** The geohash alphabet. No `a`, `i`, `l` or `o`. */
const GEOHASH = /^[0-9bcdefghjkmnpqrstuvwxyz]+$/;

/**
 * The closed vocabulary — **a placeholder, and it needs a person.**
 *
 * Extending this needs local knowledge and is explicitly not agent work. A wrong vocabulary
 * is worse than a thin one, because it shapes what operators think to look at.
 *
 * **Failure is safe by construction:** what this cannot express does not publish and stays on
 * the device. Nothing is lost and nobody is blocked waiting for a maintainer — which is why
 * shipping a placeholder is honest here and would not be somewhere the gap silently drops
 * data.
 */
export const OBSERVATION_VOCABULARY: Record<string, readonly string[]> = {
  access: ['fenced', 'locked', 'demolished', 'rebuilt', 'blocked'],
  service: ['closed', 'moved', 'hours_changed', 'capacity_full', 'reopened'],
  infra: ['light_out', 'camera_new', 'barrier_new', 'transit_changed'],
  artifact: ['flyer_posted', 'notice_posted', 'sticker_qr'],
  threat: ['scam_targeting_community', 'predatory_operation'],
  nil: ['nothing_observed']
};

/**
 * Every term, flat, for validation.
 *
 * The groups are not decoration and were not mine to drop: `/.well-known/navcom-intel.json`
 * publishes `vocabulary.tags` as `Record<string, string[]>`, so grouping is part of the
 * contract a consumer already receives. Shipping a flat list here made core disagree with its
 * own wire format, and made a picker that was twenty undifferentiated buttons tall.
 */
export const OBSERVATION_TAGS: readonly string[] = Object.values(OBSERVATION_VOCABULARY).flat();

const TAG_SET = new Set<string>(OBSERVATION_TAGS);

/** Whether this build knows this term. Unknown terms never publish and never render. */
export const isObservationTag = (t: string): boolean => TAG_SET.has(t);

/**
 * What each term is called on a screen.
 *
 * ## Why a table and not `id.replace(/_/g, ' ')`
 *
 * That is what three call sites did, and it is not a label — it is an algorithm, and an
 * algorithm cannot be translated. `light_out` comes out as *"light out"* in every language a
 * person might be reading, and `scam_targeting_community` comes out as itself with the
 * underscores knocked out. A table is a list of strings, which is the only shape a translation
 * catalogue can take hold of.
 *
 * It also puts the wording in one place. The three sites disagreed about capitalisation
 * already: the picker upper-cased the first letter and the record line did not, so the same
 * term read `Locked` in one half of the screen and `locked` in the other.
 *
 * ## What is deliberately not here
 *
 * No `means` gloss, of the kind `DOES` carries. Explaining when an operator should reach for
 * `predatory_operation` rather than `scam_targeting_community` is exactly the local knowledge
 * §7 reserves for a person, and a plausible-sounding guess would shape what operators think to
 * look at. These are the terms' names, not their definitions.
 *
 * The terms themselves are still the placeholder §7 describes. Naming a placeholder is not
 * authoring the vocabulary.
 */
export const OBSERVATION_LABELS: Record<string, string> = {
  fenced: 'Fenced',
  locked: 'Locked',
  demolished: 'Demolished',
  rebuilt: 'Rebuilt',
  blocked: 'Blocked',

  closed: 'Closed',
  moved: 'Moved',
  hours_changed: 'Hours changed',
  capacity_full: 'Capacity full',
  reopened: 'Reopened',

  light_out: 'Light out',
  camera_new: 'New camera',
  barrier_new: 'New barrier',
  transit_changed: 'Transit changed',

  flyer_posted: 'Flyer posted',
  notice_posted: 'Notice posted',
  sticker_qr: 'QR sticker',

  scam_targeting_community: 'Scam targeting community',
  predatory_operation: 'Predatory operation',

  nothing_observed: 'Nothing observed'
};

/**
 * The name for a term, or `null` where this build does not know it.
 *
 * Null rather than the raw id, for the reason `readCard` returns null on an unknown field: a
 * term this build has never heard of is not something to render a guess at. A relay serves
 * whatever anyone published, so an id here can be a newer vocabulary, a typo, or somebody
 * probing what the screen will echo back.
 */
export function observationLabel(id: string): string | null {
  return OBSERVATION_LABELS[id] ?? null;
}

/**
 * How somebody came to know, in words.
 *
 * §8: method is a fact about provenance and never a grade. These read as the plain report they
 * are -- *"Raven · was told"* -- because the moment one of them reads as better than another,
 * the screen has started grading sources, which is the thing NavCom does not do.
 *
 * ## Why there is no glyph here, and should not be
 *
 * A mark beside each of these was proposed as the highest-multiplier icon in the application:
 * three symbols instead of three words, repeated on every sighting on a record. It was
 * declined on §8.
 *
 * Any set of three legible at 12px differs in visual weight -- one solid, one open, one
 * dashed -- and weight reads as confidence. `saw` would look like the strong one and
 * `inferred` like the weak one, which is the Admiralty A-F axis drawn in shapes, on the side
 * of the boundary that is explicitly Starcom's. A set with no weight difference would not be
 * tellable apart on a cracked screen at night, so it would fail as an icon or succeed as a
 * grade.
 *
 * The problem an icon was reaching for was that these rendered as raw ids. That is fixed
 * above, by naming them.
 */
export const OBSERVATION_METHOD_LABELS: Record<ObservationMethod, string> = {
  saw: 'Saw it',
  told: 'Was told',
  inferred: 'Inferred'
};

/** The name for a method, or `null` for anything this build does not know. */
export function observationMethodLabel(m: string): string | null {
  return (OBSERVATION_METHOD_LABELS as Record<string, string>)[m] ?? null;
}

/**
 * The most terms one observation may carry.
 *
 * An observation is what somebody saw at a door, not a survey of it. Bounded for the same
 * reason every other list-shaped input here is.
 */
export const TAGS_MAX = 8;

/**
 * The literal value that means *no name attached*.
 *
 * **Anonymous means no name. It does not mean no history.** The event is still signed by the
 * contact key, so every observation an operator files under this value joins on one pubkey,
 * for anyone reading a relay. That is deliberate — key-level anonymity would forfeit
 * `supersedes` and, worse, would let one actor present as N independent sources, reopening
 * correlated fabrication across a grid whose analysis layer has been told it can trust source
 * independence.
 *
 * The name is the defect: it promises something the field does not deliver. Renaming changes
 * the wire format and therefore the contract version, so it is queued for `0.2.0` rather than
 * done here — and until then the sentence above is what an operator has to actually see.
 */
export const ANONYMOUS = 'anonymous';

/**
 * What `ANONYMOUS` is called on a screen.
 *
 * The wire value stays `anonymous` -- renaming it changes the contract version and is queued
 * for `0.2.0` above. This is only its name, and it needs one for the same reason every term
 * does: rendered straight, the sentinel put a lower-case English word in a row beside two
 * capitalised callsigns, and it stayed English in every language the phone might be set to.
 */
export const ANONYMOUS_LABEL = 'Anonymous';

/**
 * A callsign as it should be shown.
 *
 * Everything except the sentinel is a name somebody chose for themselves and passes through
 * untouched -- there is nothing to translate about `Raven`, and nothing that may be changed
 * about it either.
 */
export function callsignLabel(callsign: string): string {
  return callsign === ANONYMOUS ? ANONYMOUS_LABEL : callsign;
}

export interface Observation {
  /**
   * The thing observed — **a matter of public record.**
   *
   * Until the anchor object exists this is the id of a directory record that already exists,
   * and confirming it exists is the caller's job: this module has no index to check against,
   * and a validator that silently accepted anything would be worse than one that says so.
   */
  anchor: string;
  /** When it was seen. Distinct from the event's own timestamp, and often earlier. */
  observed_at: number;
  /** One or more from the closed vocabulary. May be exactly `nothing_observed`. */
  tags: string[];
  method: ObservationMethod;
  /** A callsign, or `ANONYMOUS`. **Never a legal name** [invariant 8]. */
  callsign: string;
  precision: Precision;
  /**
   * The event id of an observation this replaces **in the author's own account**.
   *
   * Supersession means the author changed their account. It is not `refines`, which means the
   * same account at a resolution deliberately withheld — a consumer conflating the two would
   * treat added precision as a correction and, worse, a correction as merely more precise.
   */
  supersedes?: string;
}

export class ObservationError extends Error {}

const EVENT_ID = /^[0-9a-f]{64}$/;

/** Where it was, at the precision this observation publishes at. */
export type Where =
  | { precision: 'area'; geohash: string }
  | { precision: 'exact'; lat: number; lon: number };

/**
 * Builds an observation, signed by the **contact key**.
 *
 * Never the operational key: the whole point of the split is that publishing costs no
 * operational exposure, and an observation is the most public thing an operator files.
 *
 * Throws rather than returning null, because this runs on what an operator just typed and
 * a refusal they can see is the point. `readObservation` is the one that must never throw.
 */
export function buildObservation(
  contactSecret: SecretKey,
  observation: Observation,
  where: Where,
  createdAt: number,
  /**
   * The anchor's region slug, so the observation can be asked for by metro.
   *
   * Optional only because the exact half of a pair is found through `refines` rather than by
   * region. Omitting it on a first publication makes an observation nobody can find.
   */
  region?: string
): Event {
  const content = checkObservation(observation, where);
  return finalizeEvent(
    {
      kind: KIND_OBSERVATION,
      created_at: createdAt,
      /*
       * §4: `g` for the metro, `d` for the place -- both borrowed from objects that already
       * settled this, and both buying a filter rather than a disclosure. The region is a
       * coarsening of a position the directory already publishes, and the anchor id is in
       * the content.
       */
      tags: [
        ...(region ? [['g', region]] : []),
        ['d', content['anchor'] as string]
      ],
      content: JSON.stringify(content)
    },
    contactSecret
  );
}

/**
 * The exact-position event, published **48 hours** after the coarse one.
 *
 * Real-time relay traffic naming a precise location says an operator is standing there *now*;
 * a delay defeats that completely. Forty-eight rather than twenty-four because a 24-hour delay
 * preserves the daily cycle — an operator patrolling nightly would have precise positions
 * surface at the same hour every day, and that rhythm is itself a signal.
 *
 * **It replaces the original's position. It never adds an observation.** A consumer MUST treat
 * the pair as one, and **the two never corroborate each other** — without that rule, one
 * operator reporting one thing once produces two observations ~20 km apart that confirm each
 * other, which is correlated fabrication arriving through a mechanism built for privacy.
 * Dedup on event id is correct and does not catch it: the two events are genuinely distinct.
 */
export function buildRefinement(
  contactSecret: SecretKey,
  observation: Observation,
  exact: { lat: number; lon: number },
  areaEventId: string,
  createdAt: number
): Event {
  if (!EVENT_ID.test(areaEventId)) {
    throw new ObservationError('A refinement must name the event it refines.');
  }
  const content = checkObservation({ ...observation, precision: 'exact' }, {
    precision: 'exact',
    ...exact
  });
  return finalizeEvent(
    {
      kind: KIND_OBSERVATION,
      created_at: createdAt,
      tags: [['refines', areaEventId]],
      content: JSON.stringify(content)
    },
    contactSecret
  );
}

/** How long an unrefined observation waits before its exact position may publish. */
export const REFINE_AFTER_SECONDS = 48 * 60 * 60;

/** Whether enough time has passed for a refinement to be safe to publish. */
export const readyToRefine = (areaPublishedAt: number, now: number): boolean =>
  now - areaPublishedAt >= REFINE_AFTER_SECONDS;

function checkObservation(o: Observation, where: Where): Record<string, unknown> {
  if (typeof o.anchor !== 'string' || o.anchor.trim() === '') {
    throw new ObservationError('An observation has to name what it is about.');
  }
  if (!Number.isFinite(o.observed_at) || o.observed_at <= 0) {
    throw new ObservationError('An observation has to say when it was seen.');
  }
  if (!Array.isArray(o.tags) || o.tags.length === 0) {
    throw new ObservationError('An observation has to say what was seen.');
  }
  if (o.tags.length > TAGS_MAX) {
    throw new ObservationError(`Keep it to ${TAGS_MAX} things.`);
  }
  for (const t of o.tags) {
    if (!isObservationTag(t)) throw new ObservationError(`"${t}" is not something this can report.`);
  }
  if (!(OBSERVATION_METHODS as readonly string[]).includes(o.method)) {
    throw new ObservationError('An observation has to say how you know.');
  }
  if (!withinLimit(o.callsign, CALLSIGN_MAX)) {
    throw new ObservationError('An observation needs a callsign, or "anonymous".');
  }
  if (o.precision !== where.precision) {
    throw new ObservationError('The stated precision and the position given do not agree.');
  }
  if (where.precision === 'area') {
    // Normative as a count. See AREA_GEOHASH_CHARS.
    if (where.geohash.length !== AREA_GEOHASH_CHARS || !GEOHASH.test(where.geohash)) {
      throw new ObservationError(
        `A coarse area is exactly ${AREA_GEOHASH_CHARS} geohash characters.`
      );
    }
  } else if (!Number.isFinite(where.lat) || !Number.isFinite(where.lon)) {
    throw new ObservationError('An exact position needs coordinates.');
  }
  if (o.supersedes !== undefined && !EVENT_ID.test(o.supersedes)) {
    throw new ObservationError('What this supersedes has to be an event id.');
  }

  const content: Record<string, unknown> = {
    anchor: o.anchor.trim(),
    observed_at: Math.floor(o.observed_at),
    tags: [...o.tags],
    method: o.method,
    callsign: o.callsign.trim(),
    precision: o.precision,
    ...(where.precision === 'area'
      ? { area: where.geohash }
      : { lat: where.lat, lon: where.lon })
  };
  if (o.supersedes) content.supersedes = o.supersedes;
  return content;
}

/**
 * What an observation can be filed against, derived from a directory record.
 *
 * The interim form of §5's anchor rule. The anchor object does not exist, so the only thing
 * an observation may name is a record the published directory already has — which satisfies
 * *"a thing that is already a matter of public record"* by construction, because being in the
 * directory is what being on record means here.
 *
 * ## The area is the anchor's, never the operator's
 *
 * Worth stating because the opposite is the obvious implementation and it is the one that
 * gets somebody hurt. The cell published is a coarsening of **where the thing observed is** —
 * a shelter whose address is already in the directory. It is not a reading from this phone,
 * and nothing in this path touches the operator's position at any precision.
 *
 * What the coarseness still buys is timing: `saw` on a record implies the author was near it
 * recently, and ±20 km makes *which* of the places in that cell unresolvable until the
 * refinement lands two days later.
 *
 * ## Refusals fall out rather than being added
 *
 * A refuge carries no coordinates in this directory — `confidential.ts` strips them at parse
 * and again at read — so it cannot produce a cell and is refused here without a rule of its
 * own. That is the good kind of protection: one already in force, doing a second job.
 */
export type AnchorFor =
  | { ok: true; anchor: string; region: string; where: Where }
  | { ok: false; because: string };

export function anchorFromRecord(record: ResourceRecord): AnchorFor {
  if (typeof record.id !== 'string' || record.id.trim() === '') {
    return { ok: false, because: 'That record has no id to file against.' };
  }
  if (typeof record.lat !== 'number' || typeof record.lon !== 'number') {
    // A refuge reaches this branch, and so does any record nobody has placed yet.
    return { ok: false, because: 'Nothing can be filed against a place with no position on record.' };
  }
  // Attached by the loader and never read from the CSV, so a row cannot claim to be somewhere
  // it is not. Without it the observation has no region to be asked for by.
  if (typeof record.region !== 'string' || record.region.trim() === '') {
    return { ok: false, because: 'That record is not filed under a region.' };
  }
  try {
    return {
      ok: true,
      anchor: record.id.trim(),
      region: record.region.trim(),
      where: { precision: 'area', geohash: geohash(record.lat, record.lon, AREA_GEOHASH_CHARS) }
    };
  } catch {
    return { ok: false, because: 'That record\'s position is not a position.' };
  }
}

export interface PublishedObservation {
  /** The contact key that signed it. Two `anonymous` observations from one operator share it. */
  author: string;
  observation: Observation;
  where: Where;
  /** The event this refines, if it is the exact half of a pair. Never a corroboration. */
  refines: string | null;
  /** The metro this was filed in, when the publisher said. */
  region: string | null;
  at: number;
}

/**
 * Reads an observation, or returns null.
 *
 * Null rather than throwing, for the reason it is null everywhere else here: a relay serves
 * whatever it likes, and one malformed observation must not empty a screen.
 */
export function readObservation(event: Event): PublishedObservation | null {
  if (event.kind !== KIND_OBSERVATION) return null;
  if (!verifyEvent(event)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(event.content);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;

  // Refused, not trimmed -- §6's mechanism. The field somebody eventually tries to add here
  // is a description of a person, and a reader that ignored what it did not recognise would
  // pass it through to a screen.
  const allowed = new Set<string>([...OBSERVATION_FIELDS, 'area', 'lat', 'lon']);
  for (const key of Object.keys(c)) if (!allowed.has(key)) return null;

  if (typeof c.anchor !== 'string' || c.anchor.trim() === '') return null;
  if (typeof c.observed_at !== 'number' || !Number.isFinite(c.observed_at)) return null;
  if (!Array.isArray(c.tags) || c.tags.length === 0 || c.tags.length > TAGS_MAX) return null;
  const tags = c.tags as unknown[];
  if (!tags.every((t) => typeof t === 'string' && isObservationTag(t))) return null;
  if (typeof c.method !== 'string' || !(OBSERVATION_METHODS as readonly string[]).includes(c.method)) return null;
  if (!withinLimit(c.callsign, CALLSIGN_MAX)) return null;
  if (c.precision !== 'area' && c.precision !== 'exact') return null;
  if (c.supersedes !== undefined && (typeof c.supersedes !== 'string' || !EVENT_ID.test(c.supersedes))) {
    return null;
  }

  let where: Where;
  if (c.precision === 'area') {
    if (typeof c.area !== 'string') return null;
    if (c.area.length !== AREA_GEOHASH_CHARS || !GEOHASH.test(c.area)) return null;
    where = { precision: 'area', geohash: c.area };
  } else {
    if (typeof c.lat !== 'number' || typeof c.lon !== 'number') return null;
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return null;
    where = { precision: 'exact', lat: c.lat, lon: c.lon };
  }

  const refines = event.tags.find((t) => t[0] === 'refines')?.[1] ?? null;
  if (refines !== null && !EVENT_ID.test(refines)) return null;

  const observation: Observation = {
    anchor: c.anchor.trim(),
    observed_at: c.observed_at,
    tags: tags as string[],
    method: c.method as ObservationMethod,
    callsign: (c.callsign as string).trim(),
    precision: c.precision
  };
  if (typeof c.supersedes === 'string') observation.supersedes = c.supersedes;

  return {
    author: event.pubkey,
    observation,
    where,
    refines,
    region: event.tags.find((t) => t[0] === 'g')?.[1] ?? null,
    at: event.created_at
  };
}

/**
 * How long a device keeps an observation nothing has corroborated or cited.
 *
 * Reuses the window the Accountability tier already has rather than inventing one, and it is
 * long enough for a second operator to visit the same place in an ordinary patrol cycle.
 */
export const RETENTION_DAYS = 90;
const RETENTION_SECONDS = RETENTION_DAYS * 24 * 60 * 60;

/**
 * What a device should still be holding — **dropped, not deleted.**
 *
 * The distinction is not pedantic. A regular Nostr event is immutable and held by whatever
 * relay chose to store it; §11 forbids deletion; nothing here can reach across the network and
 * remove something already published. An earlier draft of the spec said observations "expire",
 * which described something no relay would honour and no client could enforce.
 *
 * So this is what *we* hold. A relay that keeps everything forever is not in violation, it is
 * simply not participating in the part we control. The honest claim is that the Doxxer's
 * dataset shrinks wherever this runs, and it is smaller than the one it replaces.
 *
 * **Citation pins**, so the provenance chain can never break: anything a report depends on is
 * by definition cited.
 */
export function reapObservations<T extends { at: number; corroborated?: boolean; cited?: boolean }>(
  held: readonly T[],
  now: number
): T[] {
  return held.filter((o) => o.corroborated || o.cited || now - o.at < RETENTION_SECONDS);
}
