/**
 * Field groupings and human labels.
 *
 * Deliberately separate from load.ts: that module runs `import.meta.glob` at import time,
 * which only works inside a Vite build. Anything that just needs to know what a field is
 * called — a CLI, a test, a consumer — imports this instead.
 */

import {
  ACCEPTS, ACCESSIBILITY, BELONGINGS, CAPACITY_SIGNAL, COST, ID_REQUIRED, PETS,
  REPORTS_TO, SEASONAL, SEX_OFFENDER_OK, SOBRIETY,
  type ResourceField
} from './types.js';

/**
 * Human labels. Written from the reader's side of the screen — someone deciding whether a
 * place will take the person in front of them, not someone reading a schema.
 */
export const FIELD_LABELS: Partial<Record<ResourceField, string>> = {
  accepts: 'Who they take',
  pets: 'Pets',
  sobriety: 'Using',
  id_required: 'ID needed',
  referral_required: 'Referral needed',
  sex_offender_ok: 'Registry restrictions',
  reports_to: 'Reports to',
  curfew: 'Curfew',
  max_stay: 'Max stay',
  belongings: 'Belongings',
  accessibility: 'Access',
  languages: 'Languages',
  cost: 'Cost',
  hours: 'Open',
  intake_hours: 'Intake',
  seasonal: 'Season',
  capacity_signal: 'Usually',
  address: 'Address',
  phone: 'Phone'
};

/** The fields that answer "will they actually take this person, tonight?" */
export const INTAKE_FIELDS: ResourceField[] = [
  'accepts', 'pets', 'sobriety', 'id_required', 'referral_required',
  'sex_offender_ok', 'reports_to', 'curfew', 'max_stay', 'belongings', 'accessibility',
  'languages', 'cost'
];

export const AVAILABILITY_FIELDS: ResourceField[] = [
  'hours', 'intake_hours', 'seasonal', 'capacity_signal'
];

/**
 * The options a field accepts, where it accepts a fixed set.
 *
 * **Most of what an operator learns at a door is an enum**, and that changes what correcting
 * a record has to feel like. *"They turned us away because of the dog"* is `pets: no` — a
 * tap, not typing, which is the difference between a correction somebody makes standing
 * outside in the cold and one they mean to make later and never do.
 *
 * It also carries the invariant for free: **an enum cannot contain a sentence about a
 * person.** Only the free-text fields need guidance at the point of writing, and this is
 * what tells them apart.
 *
 * `null` means free text. Absent means the field is not something a correction offers.
 */
export const FIELD_OPTIONS: Partial<Record<ResourceField, readonly string[] | null>> = {
  // What decides whether somebody gets in. These are the corrections worth making.
  accepts: ACCEPTS,
  pets: PETS,
  sobriety: SOBRIETY,
  id_required: ID_REQUIRED,
  referral_required: ID_REQUIRED,
  sex_offender_ok: SEX_OFFENDER_OK,
  reports_to: REPORTS_TO,
  belongings: BELONGINGS,
  accessibility: ACCESSIBILITY,
  cost: COST,
  seasonal: SEASONAL,
  capacity_signal: CAPACITY_SIGNAL,
  // Free text, because a door does not open on a vocabulary.
  hours: null,
  intake_hours: null,
  curfew: null,
  max_stay: null,
  phone: null
};

/**
 * Fields an operator is offered when correcting, in the order they matter at a door.
 *
 * Deliberately short. Twenty-nine fields on a phone in the dark is a list nobody reads, and
 * the ones below are the ones that decide whether a person gets a bed tonight.
 */
export const CORRECTABLE_FIELDS: readonly ResourceField[] = [
  'capacity_signal',
  'intake_hours',
  'hours',
  'pets',
  'id_required',
  'sobriety',
  'accepts',
  'phone'
];

/** Readable labels for enum values, so the page never shows a snake_case token. */
export const VALUE_LABELS: Record<string, string> = {
  single_men: 'single men',
  single_women: 'single women',
  couples: 'couples',
  families: 'families',
  minors: 'minors',
  trans_inclusive: 'trans inclusive',

  service_only: 'service animals only',
  kennel_onsite: 'kennel on site',

  sober_required: 'sobriety required',
  harm_reduction_ok: 'harm reduction OK',
  no_questions: 'no questions asked',

  helps_but_not_required: 'helps, but not required',

  no_one: 'nobody',
  child_services: 'child services',

  storage_provided: 'storage provided',
  carry_on_only: 'what you can carry',
  size_limit: 'size limit',

  wheelchair: 'wheelchair accessible',
  ground_floor: 'ground floor',

  sliding: 'sliding scale',

  year_round: 'year round',
  winter_only: 'winter only',
  summer_only: 'summer only',
  weather_activated: 'weather activated',

  usually_available: 'usually has space',
  often_full: 'often full',
  call_first: 'call first',

  shelter: 'Shelter', meal: 'Meals', hygiene: 'Showers & laundry', medical: 'Medical',
  harm_reduction: 'Harm reduction', warming: 'Warming centre', cooling: 'Cooling centre',
  storage: 'Storage', legal: 'Legal', id_docs: 'ID & documents', mail: 'Mail',
  charging: 'Charging', veterinary: 'Veterinary', youth: 'Youth', dv: 'Domestic violence',
  detox: 'Detox', daytime: 'Drop-in'
};

/** Formats a single value. Never pass it an already-joined string. */
export function labelValue(raw: string): string {
  return VALUE_LABELS[raw] ?? raw.replace(/_/g, ' ');
}

/** Formats each value, then joins. */
export function labelValues(values: string[]): string {
  return values.map(labelValue).join(', ');
}

/**
 * The question a person can actually say out loud, per field.
 *
 * **In core because two things ask it.** `navcom-seed callsheet` prints these for somebody
 * working a list on a laptop, and the Field Terminal shows the same words to somebody holding
 * a phone. Two wordings would drift, and the drift would land on the half nobody proof-reads.
 *
 * They are phrased for the person being asked, not for the schema: *"Can somebody bring a
 * dog?"* rather than *"pets?"*. The information-and-referral field describes this work as
 * "tedious, unglamorous" and the single most effective thing a navigator does, which is an
 * argument for making the words easy to say rather than accurate to a field name.
 *
 * Only the fields worth a stranger's minute on the phone. A blank `languages` almost never
 * turns somebody away; a blank `pets` routinely does.
 */
export const FIELD_QUESTION: Partial<Record<ResourceField, string>> = {
  intake_hours: "What hours can somebody come in to be taken on? Is that different from when you're open?",
  pets: 'Can somebody bring a dog? Any animal at all, or only a service animal?',
  id_required: 'Does somebody need ID to be taken in? What if they have none?',
  capacity_signal: 'Is there a way to know before coming whether you have room tonight?',
  sobriety: 'Does somebody need to be sober to come in, or is that not a condition?',
  accepts: 'Who can you take? Adults, couples, families, under-18s?',
  curfew: 'Is there a curfew, and what happens if somebody arrives after it?',
  hours: 'What hours are you open?',
  phone: 'Is this the best number for somebody who needs a bed tonight?'
};
