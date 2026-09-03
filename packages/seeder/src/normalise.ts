import { createHash } from "node:crypto";
import { RESOURCE_TYPES, type ResourceType } from "@navcom/core";
import type { RawRecord, SeededRecord } from "./seeded.js";

/**
 * Turning what a source said into something this directory can hold.
 *
 * Every judgement here fails toward "I do not know" rather than toward a plausible guess.
 * A warming centre filed as a shelter sends somebody to a building that will not take them.
 */

/**
 * Ids must survive a re-scrape.
 *
 * Derived from the region, the source and the source's own identifier -- never from a row
 * number, a position in a list, or a name. Otherwise every run reads as a mass deletion
 * followed by a mass creation, and the git diff that was supposed to be the review
 * mechanism becomes unreadable.
 */
export function seededId(region: string, raw: RawRecord): string {
  const digest = createHash("sha256")
    .update(raw.source + " " + raw.sourceId)
    .digest("hex")
    .slice(0, 8);
  return region + "-" + raw.source + "-" + digest;
}

/**
 * A source's own vocabulary, mapped onto ours.
 *
 * **Returns undefined for anything that does not map cleanly, and the record is then not
 * shipped at all.** There is no catch-all type, and adding one is not this tool's decision:
 * extending the `type` taxonomy needs a human with local knowledge, by an explicit rule.
 *
 * "Somewhere that helps, uncharacterised" is not something an operator can act on at 11pm,
 * and a confident wrong category is worse -- a warming centre filed as a shelter sends
 * somebody to a building that will not take them. So unmapped categories become a line in
 * the report for the person who owns the taxonomy, not a row in the directory.
 */
export function mapType(category: string | undefined): ResourceType | undefined {
  if (!category) return undefined;
  const c = category.toLowerCase().replace(/[\s_-]+/g, "");

  const table: Record<string, ResourceType> = {
    shelter: "shelter", homelessshelter: "shelter", emergencyshelter: "shelter",
    nightshelter: "shelter", refuge: "shelter",
    soupkitchen: "meal", foodbank: "meal", foodpantry: "meal", meal: "meal", food: "meal",
    // Overture's vocabulary, which happens to normalise onto the same keys as OSM's once
    // spaces and underscores are stripped -- `homeless_shelter` and `food_bank` are already
    // covered above. Listed for the reader rather than needed by the code.
    shower: "hygiene", laundry: "hygiene", hygiene: "hygiene", toilets: "hygiene",
    clinic: "medical", doctors: "medical", hospital: "medical", healthcare: "medical",
    medical: "medical", pharmacy: "medical",
    harmreduction: "harm_reduction", needleexchange: "harm_reduction",
    syringeservices: "harm_reduction",
    warming: "warming", warmingcenter: "warming", warmingcentre: "warming",
    cooling: "cooling", coolingcenter: "cooling", coolingcentre: "cooling",
    storage: "storage", legal: "legal", legalaid: "legal",
    iddocs: "id_docs", identification: "id_docs",
    mail: "mail", post: "mail", charging: "charging",
    veterinary: "veterinary", vet: "veterinary", animalshelter: "veterinary",
    youth: "youth", youthservices: "youth",
    dv: "dv", domesticviolence: "dv",
    detox: "detox", substanceabuse: "detox",
    daytime: "daytime", daycentre: "daytime", daycenter: "daytime", dropin: "daytime",
  };

  const mapped = table[c];
  // Defensive: a table entry that drifts from the core enum must not ship a bad type. An
  // earlier version cast an invented "other" past the compiler; the data validator caught
  // it on the first real run, and this is the check that would have caught it sooner.
  return mapped && RESOURCE_TYPES.includes(mapped) ? mapped : undefined;
}

/**
 * Country dialling rules, for turning a locally-written number into one a phone can dial.
 *
 * `trunk` is the digit a country puts in front of a domestic number and drops when dialling
 * internationally -- 0 across most of Europe and Oceania, absent in the US and Japan.
 * `national` is how many digits a complete domestic number has, without that prefix.
 *
 * Only countries this directory actually covers. **An unlisted country is not a failure
 * mode, it is a country where only explicitly international numbers are accepted** -- which
 * is correct, because guessing a dialling plan produces a number that rings somewhere else.
 */
const DIALLING: Record<string, { cc: string; trunk?: string; national: number[] }> = {
  US: { cc: "1", national: [10] },
  CA: { cc: "1", national: [10] },
  GB: { cc: "44", trunk: "0", national: [10, 9] },
  AU: { cc: "61", trunk: "0", national: [9] },
  NZ: { cc: "64", trunk: "0", national: [8, 9] },
  IE: { cc: "353", trunk: "0", national: [9, 8] },
  JP: { cc: "81", trunk: "0", national: [10, 9] },
  IN: { cc: "91", trunk: "0", national: [10] },
};

/**
 * Phone numbers, normalised so a `tel:` link works on the first tap.
 *
 * The most-used field on the whole surface at 11pm, and the one where a stray character
 * costs somebody a call. Returns undefined rather than guessing at anything it cannot
 * confidently read -- an absent phone renders as unknown, which is true, and a wrong one is
 * a failed call that nothing on the surface would show as wrong.
 */
export function normalisePhone(raw: string | undefined, country = "US"): string | undefined {
  if (!raw) return undefined;

  // Drop extensions before counting digits: "555-0100 x23" is a 7-digit number, not 9.
  const trunk = raw.split(/\s(?:x|ext\.?|extension)\s*/i)[0] ?? raw;
  const digits = trunk.replace(/\D/g, "");
  if (digits.length === 0) return undefined;

  // Already international, whoever wrote it. Nothing to infer.
  if (raw.trim().startsWith("+")) return "+" + digits;
  if (digits.startsWith("00")) return "+" + digits.slice(2);

  const plan = DIALLING[country];
  if (!plan) return undefined;

  // Written with the country code but no plus: "1 314 802 0700", "44 20 7946 0958".
  if (digits.startsWith(plan.cc)) {
    const rest = digits.slice(plan.cc.length);
    if (plan.national.includes(rest.length)) return "+" + digits;
  }

  // Written domestically, with the trunk prefix: "020 7946 0958", "(02) 9374 4000".
  if (plan.trunk && digits.startsWith(plan.trunk)) {
    const rest = digits.slice(plan.trunk.length);
    if (plan.national.includes(rest.length)) return "+" + plan.cc + rest;
  }

  // Written domestically with no prefix at all, which is how the US is always written.
  if (plan.national.includes(digits.length)) return "+" + plan.cc + digits;

  return undefined;
}

/** Collapses whitespace and strips the wrapping quotes some sources leave behind. */
function tidy(s: string | undefined): string | undefined {
  const t = s?.replace(/\s+/g, " ").replace(/^["']|["']$/g, "").trim();
  return t ? t : undefined;
}

/** Null when the record cannot be characterised. The caller drops it and reports why. */
export function normalise(region: string, raw: RawRecord, country = "US"): SeededRecord | null {
  // Skipped and reported, not thrown: found in robustness audit. This function's own
  // contract, one line down, is "null when the record cannot be characterised -- the caller
  // drops it and reports why," and mapType() already honours it. A throw here means one bad
  // record from a future second source module kills the whole region's build instead of
  // being tallied and skipped like everything else in this file. Currently unreachable --
  // the one wired source, osm.ts, already filters a nameless record before it gets here --
  // which is exactly what makes this a landmine rather than a live bug.
  const name = tidy(raw.name);
  if (!name) return null;

  const type = mapType(raw.category);
  if (!type) return null;

  const address = tidy(raw.address);
  const phone = normalisePhone(raw.phone, country);
  // Free text on purpose. An "open now" computed from a scraped string is a confident
  // wrong answer waiting for a public holiday.
  const hours = tidy(raw.hours);

  return {
    id: seededId(region, raw),
    name,
    type,
    ...(address ? { address } : {}),
    ...(typeof raw.lat === "number" && Number.isFinite(raw.lat) ? { lat: raw.lat } : {}),
    ...(typeof raw.lon === "number" && Number.isFinite(raw.lon) ? { lon: raw.lon } : {}),
    ...(phone ? { phone } : {}),
    ...(hours ? { hours } : {}),
    ...(raw.languages?.length ? { languages: raw.languages } : {}),
  };
}
