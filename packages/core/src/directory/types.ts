/**
 * Types for the resource directory.
 *
 * Normative source: docs/product/directory-schema.md
 * Do not add a field here that describes a person being served. There is no field for it
 * because there must never be a field for it [invariant 1, H1].
 */

export const RESOURCE_TYPES = [
  'shelter', 'meal', 'hygiene', 'medical', 'harm_reduction', 'warming', 'cooling',
  'storage', 'legal', 'id_docs', 'mail', 'charging', 'veterinary', 'youth', 'dv',
  'detox', 'daytime'
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const ACCEPTS = [
  'single_men', 'single_women', 'couples', 'families', 'minors', 'trans_inclusive'
] as const;
export type Accepts = (typeof ACCEPTS)[number];

export const PETS = ['yes', 'service_only', 'kennel_onsite', 'no'] as const;
export type Pets = (typeof PETS)[number];

export const SOBRIETY = ['sober_required', 'harm_reduction_ok', 'no_questions'] as const;
export type Sobriety = (typeof SOBRIETY)[number];

export const ID_REQUIRED = ['yes', 'no', 'helps_but_not_required'] as const;
export type IdRequired = (typeof ID_REQUIRED)[number];

export const SEX_OFFENDER_OK = ['yes', 'no', 'unknown'] as const;
export type SexOffenderOk = (typeof SEX_OFFENDER_OK)[number];

/**
 * Who a service passes information to. Describes the SERVICE, never a person, so
 * invariant 1 is untouched.
 *
 * Exists because the Medic archetype asks for "the nearest ER that won't call police" and
 * nothing in this schema could answer that. Globally it is often immigration rather than
 * police that decides whether someone will walk through a door.
 *
 * `no_one` and blank are not the same thing, and the difference matters more here than
 * anywhere else in the schema: blank renders as *unknown* [rule 5]. Not knowing whether a
 * clinic calls the police is a completely different fact from knowing it does not.
 */
export const REPORTS_TO = ['no_one', 'police', 'immigration', 'child_services', 'unknown'] as const;
export type ReportsTo = (typeof REPORTS_TO)[number];

export const BELONGINGS = ['storage_provided', 'carry_on_only', 'size_limit'] as const;
export type Belongings = (typeof BELONGINGS)[number];

export const ACCESSIBILITY = ['wheelchair', 'ground_floor', 'none'] as const;
export type Accessibility = (typeof ACCESSIBILITY)[number];

export const COST = ['free', 'sliding', 'fee'] as const;
export type Cost = (typeof COST)[number];

export const SEASONAL = ['year_round', 'winter_only', 'summer_only', 'weather_activated'] as const;
export type Seasonal = (typeof SEASONAL)[number];

export const CAPACITY_SIGNAL = ['usually_available', 'often_full', 'call_first', 'unknown'] as const;
export type CapacitySignal = (typeof CAPACITY_SIGNAL)[number];

export const METHOD = ['in_person', 'phone', 'staff_confirmed', 'secondhand', 'website'] as const;
export type Method = (typeof METHOD)[number];

export const FLAG = ['ok', 'reported_closed', 'reported_wrong', 'permanently_closed'] as const;
export type Flag = (typeof FLAG)[number];

/** Derived, never entered by hand. */
export type Confidence = 'high' | 'medium' | 'low' | 'stale' | 'suspect';

/** Different fields rot at different speeds. Staleness is per field-group, not per record. */
export type VolatilityClass = 'static' | 'slow' | 'seasonal' | 'volatile';

export interface ResourceRecord {
  id: string;
  /**
   * Which region's folder this came from. Attached by the loader, never read from the CSV,
   * so a row cannot claim to be somewhere it is not. Always set on loaded records.
   */
  region?: string;
  name: string;
  type: ResourceType;

  address?: string;
  lat?: number;
  lon?: number;
  phone?: string;

  accepts?: Accepts[];
  pets?: Pets;
  sobriety?: Sobriety;
  id_required?: IdRequired;
  referral_required?: boolean;
  sex_offender_ok?: SexOffenderOk;
  reports_to?: ReportsTo[];
  curfew?: string;
  max_stay?: string;
  belongings?: Belongings;
  accessibility?: Accessibility[];
  languages?: string[];
  cost?: Cost;

  hours?: string;
  intake_hours?: string;
  seasonal?: Seasonal;
  capacity_signal?: CapacitySignal;

  /** ISO date, YYYY-MM-DD. */
  last_verified?: string;
  /** The name its author goes by, or 'anonymous': their choice [invariant 6]. */
  verified_by?: string;
  method?: Method;
  flag: Flag;

  notes?: string;
}

/** Every field of ResourceRecord that carries directory content. */
export type ResourceField = keyof Omit<ResourceRecord, 'id'>;
