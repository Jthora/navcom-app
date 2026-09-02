import type { ResourceRecord } from "@navcom/core";

/**
 * What a scraper is permitted to produce.
 *
 * **The intake fields are not in this type, and that is the whole safety mechanism.**
 *
 * `sobriety`, `pets`, `id_required`, `referral_required`, `sex_offender_ok`, `reports_to`,
 * `curfew`, `max_stay`, `belongings` and `capacity_signal` are the fields the directory
 * exists for. They are absent from every public listing precisely because nobody maintains
 * them, and a plausible guess in any of them is somebody walking two miles at 11pm and
 * being turned away.
 *
 * `docs/product/seeding.md` says never to write them. A written rule is something a tired
 * human or a creative agent reasons around at 3am; a missing field is not. There is no
 * override, no flag, and no argument to `emit` that would let one through -- the same
 * choice made for accountability-log outcomes and for the public presence payload.
 */
export type SeededRecord = Pick<
  ResourceRecord,
  "id" | "name" | "type" | "address" | "lat" | "lon" | "phone" | "hours" | "cost" | "languages"
>;

/** Columns a seeded row may carry. Everything else is emitted empty. */
export const SEEDED_FIELDS = [
  "id", "name", "type", "address", "lat", "lon", "phone", "hours", "cost", "languages",
] as const satisfies readonly (keyof SeededRecord)[];

/**
 * A record as a source gave it to us, before anything has been decided about it.
 *
 * Kept separate from `SeededRecord` so normalisation is an explicit step with an explicit
 * output, rather than a pile of optional fields that might or might not have been mapped.
 */
export interface RawRecord {
  /** Which source module produced this. Part of the id, and part of every report. */
  source: string;
  /** The source's OWN identifier. Ids must survive a re-scrape, so this must be durable. */
  sourceId: string;
  name: string;
  /** The source's word for what this is. Mapped by `normalise`, never trusted directly. */
  category?: string;
  /**
   * Who the source says this serves, in the source's own words.
   *
   * Never mapped to a `type` and never used to include a record. It says *who* a place is
   * for, which is not the same as *what it provides* -- and a record that serves homeless
   * people while saying nothing about whether it is a bed or a meal cannot be characterised
   * without guessing. It is kept so a dropped record can be named for a human instead of
   * disappearing into a count.
   */
  serves?: string[];
  address?: string;
  lat?: number;
  lon?: number;
  phone?: string;
  hours?: string;
  languages?: string[];
  /** Where a human could go and read the same thing. Ends up in `notes`. */
  url?: string;
}
