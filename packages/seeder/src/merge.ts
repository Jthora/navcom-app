import type { ResourceRecord } from "@navcom/core";
import type { SeededRecord } from "./seeded.js";

/**
 * Putting a scrape together with what is already committed.
 *
 * **Human rows are sacred, and that is enforced here rather than remembered.** Any row a
 * person checked passes through untouched -- never rewritten, never deleted, never
 * reordered. The scraper proposes; a person disposes.
 */

/** A row somebody actually checked in person or by phone. */
export function isHumanVerified(record: ResourceRecord): boolean {
  return record.method !== undefined && record.method !== "website";
}

/**
 * Ids this tool produced: `<region>-<source>-<8 hex>`, from `seededId`.
 *
 * **Found by running it for real.** The merge originally replaced every `method: website`
 * row wholesale, on the reasoning that those were previous scrape output. They are not:
 * `website` also describes a person who read a shelter's site and typed the details in by
 * hand, which is exactly how this project's first ten St. Louis records were made. The
 * first real run proposed deleting all ten.
 *
 * So the rule is narrower and more honest: **the scraper owns only what it made.** Anything
 * else, whoever made it owns, and it is protected like a human row.
 */
export function isScraperOwned(record: ResourceRecord, region: string): boolean {
  return new RegExp("^" + region + "-[a-z0-9]+-[0-9a-f]{8}$").test(record.id);
}

export interface ReviewItem {
  id: string;
  name: string;
  reason: string;
}

export interface MergeResult {
  /** Human rows first, in their original order, then the fresh scrape. */
  records: ResourceRecord[];
  added: number;
  changed: number;
  unchanged: number;
  /** How many human rows were carried through untouched. */
  protected: number;
  /** Questions for a person. Never resolved automatically. */
  review: ReviewItem[];
}

function seededToRecord(s: SeededRecord, scrapedOn: string, url?: string): ResourceRecord {
  return {
    ...s,
    // Provenance is not optional and not configurable. These three together are what makes
    // a row render visibly unverified on every surface.
    last_verified: scrapedOn,
    verified_by: "",
    method: "website",
    flag: "ok",
    ...(url ? { notes: "Source: " + url } : {}),
  };
}

function sameSeeded(a: ResourceRecord, b: ResourceRecord): boolean {
  const fields = ["name", "type", "address", "lat", "lon", "phone", "hours", "cost"] as const;
  return fields.every((f) => a[f] === b[f]);
}

export function merge(
  committed: ResourceRecord[],
  scraped: SeededRecord[],
  scrapedOn: string,
  urls: Map<string, string> = new Map(),
  region = "",
  /**
   * Each record's own date, by id, where its source gave one -- see `asOf` on `RawRecord`.
   * `scrapedOn` is for a record that arrived without one, from a cache older than the field.
   */
  dates: Map<string, string> = new Map(),
): MergeResult {
  // Everything the scraper did not make is carried through untouched -- rows a person
  // checked, and rows a person typed in from a website. Both were made by somebody.
  const keep = committed.filter((r) => isHumanVerified(r) || !isScraperOwned(r, region));
  const previousSeeded = new Map(
    committed.filter((r) => !isHumanVerified(r) && isScraperOwned(r, region)).map((r) => [r.id, r]),
  );

  const review: ReviewItem[] = [];
  const fresh: ResourceRecord[] = [];
  let added = 0;
  let changed = 0;
  let unchanged = 0;

  const keptByPhone = new Map(
    keep.filter((h) => h.phone).map((h) => [h.phone as string, h]),
  );

  for (const s of scraped) {
    const record = seededToRecord(s, dates.get(s.id) ?? scrapedOn, urls.get(s.id));

    // A human row already covers this place. The scrape must not add a second copy, and
    // must not correct the human's own fields -- it can only report the disagreement.
    const overlap = record.phone ? keptByPhone.get(record.phone) : undefined;
    if (overlap) {
      if (overlap.address !== record.address && record.address) {
        review.push({
          id: overlap.id,
          name: overlap.name,
          reason: "public sources now list a different address: " + record.address,
        });
      }
      continue;
    }

    const before = previousSeeded.get(record.id);
    if (!before) added++;
    else if (sameSeeded(before, record)) unchanged++;
    else changed++;

    previousSeeded.delete(record.id);
    fresh.push(record);
  }

  // Whatever the previous scrape found and this one did not. Seeded rows simply go; the
  // report says how many, so a source quietly returning nothing is visible rather than
  // silently emptying a region.
  const removed = previousSeeded.size;
  if (removed > 0) {
    review.push({
      id: "",
      name: "",
      reason: removed + " seeded record(s) are no longer in public sources and were dropped",
    });
  }

  // A human-verified place that public data no longer lists STAYS. A shelter missing from
  // a listing site has not necessarily closed, and the person who went there knew something
  // the scraper does not.
  const scrapedPhones = new Set(scraped.map((s) => s.phone).filter(Boolean));
  for (const h of keep.filter(isHumanVerified)) {
    if (h.phone && !scrapedPhones.has(h.phone)) {
      review.push({
        id: h.id,
        name: h.name,
        reason: "human-verified, no longer found in public sources -- kept, please check",
      });
    }
  }

  return {
    records: [...keep, ...fresh],
    added,
    changed,
    unchanged,
    protected: keep.length,
    review,
  };
}
