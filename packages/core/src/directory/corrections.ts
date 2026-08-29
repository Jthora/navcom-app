import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import type { SecretKey } from '../crypto/keys.js';
import { KIND_CORRECTION } from '../events/kinds.js';
import { confidenceForField } from './confidence.js';
import { displayField, type FieldDisplay } from './display.js';
import { CALLSIGN_MAX, FIELDS_MAX, VALUE_MAX, withinLimit } from '../limits.js';
import type { Confidence, Method, ResourceField, ResourceRecord } from './types.js';
import { FIELD_CLASS } from './volatility.js';
import { isValidIsoDate } from './iso-date.js';

/**
 * What an operator learned, on the way back from the block they learned it on.
 *
 * The directory is a CSV in a repository, prerendered into the site at build time. That is a
 * good shape for a durable public artifact and a useless one for *"St Pat's shut intake at
 * 20:30 tonight"*, which is perishable, true now, and known only by the person who was
 * standing there.
 *
 * So there are **two directories**, and the split is the design rather than a compromise:
 *
 * - **Live corrections** — these. Attestations that travel on relays and are merged over the
 *   cached directory **on the device, at read time**. No build, no deploy, no maintainer, no
 *   server. An operator sees their squad's corrections offline, immediately
 * - **The published directory** — the curated artifact a stranger gets. Corrections are
 *   promoted into it periodically by a person, which is the bottleneck on purpose: a public
 *   artifact anybody can rewrite is not one anybody can rely on
 *
 * ## A correction is a record fragment, not a new kind of thing
 *
 * It carries the same attestation fields every record carries — who says so, by what method,
 * and when. That is not tidiness: it means the existing confidence machinery weighs a
 * correction against the base record **without anybody inventing a merge rule**. An
 * in-person check from last night beats a website scrape from March because the rules
 * already said so.
 *
 * ## Additive, never subtractive — and this is also the abuse answer
 *
 * A correction can assert a value. It cannot remove a record, blank a field, or overrule
 * anybody. A hostile operator flagging every shelter closed adds claims with an author and
 * an age attached; the base record is untouched and the reader weighs the report like any
 * other attestation.
 *
 * That matters because [`declined.md`](../../../docs/declined.md) declines adjudication
 * between operators, so there is nobody to appeal to and there must not need to be. **The
 * shape of the data is what makes the abuse survivable**, not a moderator.
 *
 * Normative source: docs/product/directory-schema.md
 */

/**
 * Fields a correction may assert.
 *
 * Derived from `FIELD_CLASS`, which is a `Record<ResourceField, …>` and therefore **exhaustive
 * by type** — a field added to the schema appears here without anybody remembering to add it,
 * and a hand-kept list is exactly the thing that drifts.
 *
 * Coordinates are excluded. A correction is about what a place does, not where it is, and the
 * position of a building is not something an operator learns by being turned away at the door.
 */
const CORRECTABLE: readonly ResourceField[] = (Object.keys(FIELD_CLASS) as ResourceField[]).filter(
  (f) => f !== 'lat' && f !== 'lon'
);

export interface Correction {
  /** Which record this is about. */
  record: string;
  /** A callsign, or `anonymous`. **Never a legal name** [invariant 8]. */
  verified_by: string;
  method: Method;
  /** ISO date, `YYYY-MM-DD`. What makes this weighable against the base record. */
  last_verified: string;
  /**
   * What is being asserted.
   *
   * A subset of the schema and **nothing else** — an unknown key is refused on read rather
   * than ignored, so a client written against a looser idea of this type cannot put a
   * coordinate, a name, or anything about a person onto somebody's screen.
   */
  fields: Partial<Record<ResourceField, string>>;
  /**
   * Which of the fields above the author is flagging as weakly backed, despite the method
   * just stated.
   *
   * The name and the shape are deliberate, not invented here: the EIN consensus round ratified
   * *"a `bridged`-style self-declared-weakness field"* network-wide, after Starcom Academy's
   * credential format used exactly this pattern to name which of its own modules were still
   * backed by template content rather than real sourcing. The general version of the idea:
   * **a claim declares its own weak backing**, rather than a consumer having to guess at it.
   *
   * The case this exists for: a phone call is `method: phone`, medium confidence, same as any
   * other. But *"I called and they confirmed the website's hours"* is not the same claim as
   * *"I called and they read me the current hours"* — the first is a phone call about a
   * website, and recording only the stronger-looking method launders a low-confidence value
   * into a medium one. `bridged` lets the author say so without inventing a fourth method or
   * a discounted confidence tier: **the ranking this correction earns from `method` and
   * `last_verified` is unchanged** — `bridged` is a caveat surfaced alongside it, for a reader
   * to weigh, never a silent downgrade computed on their behalf.
   *
   * Every entry must name a field this same correction actually asserts. Flagging a field as
   * weakly backed while not asserting any value for it is not a caveat, it is a claim about
   * nothing, and is refused rather than accepted as a stray warning.
   */
  bridged?: readonly ResourceField[];
}

export class CorrectionError extends Error {}

const METHODS: readonly string[] = ['in_person', 'phone', 'staff_confirmed', 'secondhand', 'website'];

/**
 * Builds a correction, signed by the operator's **contact key**.
 *
 * The same key that signs a card, and for the same reason: contributing publicly must cost
 * no operational exposure. An operator who has never published a card still has a contact
 * key, so contribution is not gated behind being findable — which matters most for exactly
 * the person with the best knowledge and the most reason to stay unlinkable.
 *
 * Addressable, keyed on the record: an operator's latest word about a place replaces their
 * earlier word about it rather than accumulating.
 */
export function buildCorrection(
  contactSecret: SecretKey,
  correction: Correction,
  createdAt: number
): Event {
  if (!correction.record.trim()) throw new CorrectionError('A correction needs a record.');
  if (!withinLimit(correction.verified_by, CALLSIGN_MAX)) {
    throw new CorrectionError(`A correction needs a callsign of ${CALLSIGN_MAX} characters or fewer, or \`anonymous\`.`);
  }
  if (!METHODS.includes(correction.method)) throw new CorrectionError('Unknown method.');
  if (!isValidIsoDate(correction.last_verified)) {
    throw new CorrectionError('last_verified must be a real YYYY-MM-DD date.');
  }

  const fields = Object.entries(correction.fields).filter(([k, v]) => {
    if (!CORRECTABLE.includes(k as ResourceField)) {
      throw new CorrectionError(`"${k}" is not a field of a record.`);
    }
    if (typeof v === 'string' && v.length > VALUE_MAX) {
      throw new CorrectionError(`"${k}" is longer than ${VALUE_MAX} characters.`);
    }
    return typeof v === 'string' && v.trim() !== '';
  });
  if (fields.length === 0) throw new CorrectionError('A correction that asserts nothing is not one.');
  if (fields.length > FIELDS_MAX) {
    // Somebody with more to say than this is doing the maintainer's job, and should be in
    // the maintainer's path rather than broadcasting a re-import.
    throw new CorrectionError(`A correction says at most ${FIELDS_MAX} things at once.`);
  }

  const assertedFields = new Set(fields.map(([k]) => k));
  const bridged = [...new Set(correction.bridged ?? [])];
  for (const field of bridged) {
    // A caveat on a value this correction does not assert is a claim about nothing — refused
    // rather than silently accepted as a stray warning nobody can act on.
    if (!assertedFields.has(field)) {
      throw new CorrectionError(`"${field}" is flagged as bridged but this correction does not assert it.`);
    }
  }

  return finalizeEvent(
    {
      kind: KIND_CORRECTION,
      created_at: createdAt,
      tags: [['d', correction.record]],
      content: JSON.stringify({
        record: correction.record,
        verified_by: correction.verified_by.trim(),
        method: correction.method,
        last_verified: correction.last_verified,
        fields: Object.fromEntries(fields),
        ...(bridged.length > 0 ? { bridged } : {})
      })
    },
    contactSecret
  );
}

/** Reads a correction, or returns null. A relay serves whatever it likes. */
export function readCorrection(event: Event): (Correction & { by: string }) | null {
  if (event.kind !== KIND_CORRECTION) return null;
  if (!verifyEvent(event)) return null;

  try {
    const c = JSON.parse(event.content) as Partial<Correction>;
    if (typeof c.record !== 'string' || !c.record) return null;
    if (!withinLimit(c.verified_by, CALLSIGN_MAX)) return null;
    if (typeof c.method !== 'string' || !METHODS.includes(c.method)) return null;
    if (typeof c.last_verified !== 'string' || !isValidIsoDate(c.last_verified)) return null;
    if (!c.fields || typeof c.fields !== 'object' || Array.isArray(c.fields)) return null;

    for (const [k, v] of Object.entries(c.fields)) {
      // Refused, not trimmed. The field somebody will eventually try to add here is a
      // coordinate, or a sentence about a person.
      if (!CORRECTABLE.includes(k as ResourceField)) return null;
      /*
       * Non-empty, and this is the half that was missing.
       *
       * `buildCorrection` refuses a correction that asserts nothing; this did not, so a
       * hand-rolled client could publish `{"hours": ""}`. An empty string is still a string,
       * so it became a merge candidate — and with an in-person method and today's date it
       * **outranked the published record and won**, blanking the field for every device
       * carrying that area. A merge documented as *additive, never deletes* deleted.
       *
       * A flag is the exception: it is a report about the record rather than a value, and
       * `ok` is a meaningful thing to say.
       */
      if (typeof v !== 'string' || v.length > VALUE_MAX) return null;
      if (v.trim() === '') return null;
    }
    // A correction that asserts nothing is not a correction — the same rule the builder
    // applies, and until now the only place it was applied. It also bought a free slot in
    // every device's bounded store.
    if (Object.keys(c.fields).length === 0) return null;
    if (Object.keys(c.fields).length > FIELDS_MAX) return null;

    if (c.bridged !== undefined) {
      if (!Array.isArray(c.bridged)) return null;
      // Deduped, so a hand-rolled client cannot pad the array to buy an oversized event, and
      // checked against the *asserted* fields — the same rule the builder applies, refused here
      // for the same reason: a caveat on a value nobody stated is a claim about nothing.
      const bridged = [...new Set(c.bridged)];
      if (bridged.length > Object.keys(c.fields).length) return null;
      if (!bridged.every((f) => typeof f === 'string' && Object.hasOwn(c.fields as object, f))) return null;
      c.bridged = bridged as ResourceField[];
    }

    // The `d` tag is what a relay indexed; if it disagrees with the payload, one of them is
    // lying and neither is worth guessing about.
    if (event.tags.find((t) => t[0] === 'd')?.[1] !== c.record) return null;

    return { ...(c as Correction), by: event.pubkey };
  } catch {
    return null;
  }
}

/** Where a displayed value came from, so a reader can weigh it. */
export interface FieldSource {
  /** `null` when the published record still holds the field. */
  correction: (Correction & { by: string }) | null;
  confidence: Confidence;
}

export interface MergedRecord {
  record: ResourceRecord;
  /** Per field, what won and why. Only fields a correction changed appear. */
  sources: Partial<Record<ResourceField, FieldSource>>;
  /**
   * Flags asserted by corrections, **as reports rather than as properties of the record**.
   *
   * A correction's flag does not make the base record `suspect`. If it did, one hostile
   * operator could make any record unusable for everybody, which is deletion wearing a
   * different hat. Display rule 3 still applies — a reader sees these first — but they are
   * attributed and dated, and the record underneath is untouched.
   */
  reports: (Correction & { by: string })[];
}

const RANK: Record<Confidence, number> = { high: 4, medium: 3, low: 2, stale: 1, suspect: 0 };

/**
 * Merges live corrections over a published record.
 *
 * For each field the strongest attestation wins, using the confidence rules the directory
 * already applies — an in-person check from last night beats a website scrape from March.
 * Ties go to the more recent one, and then to the published record, which is the version a
 * person stood behind.
 */
export function mergeCorrections(
  base: ResourceRecord,
  corrections: readonly (Correction & { by: string })[],
  now: Date
): MergedRecord {
  /*
   * Sorted, so the merge is a function of the data and not of delivery order.
   *
   * Ranking already settles almost everything: an in-person check beats a website scrape,
   * and a newer date beats an older one. What it could not settle was an exact tie — two
   * people who both stood at the same door on the same day and disagree — and there the
   * first candidate encountered won. **Two operators carrying the same area, receiving the
   * same two corrections from relays in a different order, saw different opening hours for
   * the same shelter.** Each device drawing its own picture is the design; drawing a
   * different one from identical evidence is not.
   *
   * The author's key is an arbitrary tie-break and deliberately so — there is no ground
   * truth to prefer between two equally recent in-person reports, and inventing one would be
   * worse than admitting it. It is not worth gaming: winning a tie requires matching the
   * other correction's date and method exactly, and anybody willing to do that can simply
   * publish tomorrow's date and win outright. What the reader gets is unchanged and is the
   * real answer here — **the field carries its provenance**, so they see who said it and
   * when, and can weigh two names the way this system asks them to everywhere else.
   */
  // Shape-checked here, not just typed: relay delivery and an operator's own submit() both
  // go through readCorrection() first, but a cache loaded straight from storage does not
  // [found in robustness audit] -- an entry written by an older schema, or otherwise not
  // actually shaped like a Correction, would otherwise throw reading `.fields.flag` a few
  // lines down and could take down a whole page's render over one bad cached row. Excluded
  // like any other correction that never existed, not surfaced as an error: there is nobody
  // to tell and nothing actionable to tell them.
  const mine = corrections
    .filter(
      (c): c is Correction & { by: string } =>
        !!c && typeof c === 'object' && c.record === base.id && !!c.fields && typeof c.fields === 'object'
    )
    .slice()
    .sort((a, b) => (a.by < b.by ? -1 : a.by > b.by ? 1 : 0));
  const record = { ...base };
  const sources: Partial<Record<ResourceField, FieldSource>> = {};
  const reports: (Correction & { by: string })[] = [];

  for (const c of mine) {
    if (c.fields.flag && c.fields.flag !== 'ok') reports.push(c);
  }

  for (const field of CORRECTABLE) {
    // A flag is a report about a record, not a value to overwrite. Handled above.
    if (field === 'flag') continue;

    const candidates = mine.filter((c) => typeof c.fields[field] === 'string');
    if (candidates.length === 0) continue;

    /*
     * The bar a correction has to clear.
     *
     * A blank field in the published record is not a weak claim, it is no claim -- so
     * anything at all beats it. Otherwise the base record's own confidence is the bar, and
     * ties go to the published version, which is what a person stood behind.
     */
    const blank = base[field] === undefined || base[field] === '';
    let bestConfidence: Confidence = blank ? 'suspect' : confidenceForField(base, field, now);
    let winner: (Correction & { by: string }) | null = null;

    for (const c of candidates) {
      // Weighed as the record fragment it is: its own author, method and date, run through
      // the same rules as everything else.
      const confidence = confidenceForField(
        {
          ...base,
          [field]: c.fields[field],
          verified_by: c.verified_by,
          method: c.method,
          last_verified: c.last_verified,
          flag: 'ok'
        } as ResourceRecord,
        field,
        now
      );

      const beatsBest = RANK[confidence] > RANK[bestConfidence];
      const tiesButNewer =
        RANK[confidence] === RANK[bestConfidence] &&
        winner !== null &&
        c.last_verified > winner.last_verified;
      // A blank field has no incumbent, so an equal-ranked first candidate still wins.
      const fillsABlank = blank && winner === null && RANK[confidence] >= RANK[bestConfidence];

      if (beatsBest || tiesButNewer || fillsABlank) {
        bestConfidence = confidence;
        winner = c;
      }
    }

    if (winner) {
      record[field] = winner.fields[field] as never;
      sources[field] = { correction: winner, confidence: bestConfidence };
    }
  }

  return { record, sources, reports };
}

/**
 * How a merged field should be displayed, with the provenance that actually won.
 *
 * **Use this rather than `displayField` on a merged record.** A record carries one set of
 * attestation fields — one `verified_by`, one `method`, one `last_verified` — and a merged
 * record has as many provenances as it has corrections. `displayField` on the merged record
 * therefore reads the *base* record's age for every field, which is wrong in the worst
 * direction:
 *
 * > A correction made last night in person, over a record scraped in January, rendered as
 * > **`call-first / stale`** — display rule 2 blanking a value because of an age that was
 * > not its own. The corrections were invisible on the face of the record they corrected.
 *
 * Found by probing rather than by reading. Both halves were tested; the join was not, which
 * is the second time that has been the shape of a bug in this system.
 */
export function displayMerged(
  merged: MergedRecord,
  field: ResourceField,
  now: Date
): { display: FieldDisplay; by: (Correction & { by: string }) | null } {
  const source = merged.sources[field];
  if (!source?.correction) {
    return { display: displayField(merged.record, field, now), by: null };
  }

  const c = source.correction;
  // The winning attestation's own author, method and date -- which is what the confidence
  // rules are supposed to be weighing.
  const asRecord = {
    ...merged.record,
    verified_by: c.verified_by,
    method: c.method,
    last_verified: c.last_verified,
    flag: 'ok'
  } as ResourceRecord;
  return { display: displayField(asRecord, field, now), by: c };
}

/**
 * What this record most needs somebody to find out.
 *
 * *"Contribute something"* is paralysing — it asks an operator to audit a database. *"You are
 * passing St Pat's tonight; ask them one thing"* is an errand, and an errand gets done.
 *
 * The schema already knows both halves of this: which fields are blank, and how stale the
 * rest are. Nothing new has to be collected, and nobody has to be assigned anything —
 * [invariant 6] says nothing tasks anyone, so this returns **what is missing**, never a
 * request addressed to a person.
 *
 * Ordered by what decides whether somebody gets a bed. A blank `pets` turns a person away at
 * the door; a blank `languages` rarely does.
 */
export function needsChecking(
  record: ResourceRecord,
  corrections: readonly (Correction & { by: string })[],
  now: Date,
  limit = 3
): ResourceField[] {
  const merged = mergeCorrections(record, corrections, now).record;

  const missing = ASK_FIRST.filter((field) => {
    const value = merged[field];
    return value === undefined || value === null || String(value).trim() === '';
  });
  if (missing.length >= limit) return missing.slice(0, limit);

  // Nothing blank left worth asking about, so fall back to what has gone stale. A value
  // nobody has confirmed in a season is a value worth a question, not a value to distrust.
  const stale = ASK_FIRST.filter(
    (field) => !missing.includes(field) && confidenceForField(merged, field, now) === 'stale'
  );
  return [...missing, ...stale].slice(0, limit);
}

/**
 * The order to ask in, most consequential first.
 *
 * A blank `pets` turns somebody away at the door — it is the commonest reason a person
 * refuses a bed. A blank `languages` almost never does. This ordering is a claim about the
 * street rather than about the schema, and it is the sort of claim that should be corrected
 * by somebody who works one.
 */
const ASK_FIRST: readonly ResourceField[] = [
  'intake_hours',
  'pets',
  'id_required',
  'capacity_signal',
  'sobriety',
  'accepts',
  'curfew',
  'hours',
  'phone'
];
