import type { ResourceField } from './types.js';

/**
 * The fields that decide whether a person gets a bed tonight.
 *
 * Named in three places before it was named here — `well-known.mjs` kept a literal list,
 * `places.ts` describes them in prose twice — which is the drift this package spends most of
 * its comments preventing. One home, imported by the rest.
 *
 * ## Why the distinction earns its own module
 *
 * Every field is worth having and these are the ones somebody is turned away over. Getting
 * `languages` wrong is an inconvenience; getting `id_required` wrong sends a person without
 * papers across a city at 11pm to a door that will not open for them. The display rules
 * already treat a wrong answer as worse than no answer — this is the list where that
 * calculation is most lopsided, so it is the list that gets the strictest handling.
 *
 * ## The specific thing this exists for
 *
 * `method` is **self-asserted**. Nothing verifies that anybody stood anywhere: `corrections.ts`
 * checks only that the value is one of the five, and `in_person` ranks *high* while every
 * record in the published directory is `website`, which ranks *low*. So a single correction
 * claiming to have been there outranks anything we hold, on any record, by saying so.
 *
 * That is survivable for most fields — a wrong `phone` is a wasted call. On a decisive field it
 * is the Medic's kill trigger, **confident wrong guidance**, and it needs no scale: one claim
 * about one shelter on one cold night is the whole attack.
 *
 * So on these fields a contradiction is not resolved in favour of the better-attested claim.
 * It renders **call first** — which is not a new idea, it is [invariant 9] applied to
 * disagreement instead of to age. The system already says *call first* when it does not know,
 * and a field two people disagree about is a field it does not know.
 *
 * The trade, stated rather than discovered: a legitimate operator's correction also renders as
 * contested rather than authoritative, so real intel gets softer. That is the right way round
 * at 2am. **Ambiguity sends somebody to a phone; confidence sends them to a locked door.**
 *
 * Normative source: docs/product/directory-schema.md
 */
export const DECISIVE_FIELDS = [
  'intake_hours',
  'pets',
  'id_required',
  'capacity_signal',
  'sobriety',
  'accepts',
  'curfew'
] as const satisfies readonly ResourceField[];

export type DecisiveField = (typeof DECISIVE_FIELDS)[number];

/** Whether a wrong answer here turns somebody away rather than merely inconveniencing them. */
export const isDecisive = (field: string): field is DecisiveField =>
  (DECISIVE_FIELDS as readonly string[]).includes(field);
