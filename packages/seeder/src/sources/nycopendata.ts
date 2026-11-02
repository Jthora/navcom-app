import type { RawRecord } from "../seeded.js";

/**
 * New York City's own published open data, via the Socrata API at `data.cityofnewyork.us`.
 *
 * The third source, and the first that is a government rather than an aggregator. Overture gave
 * New York 267 records, every one a `shelter` or a `meal` and none with hours -- which answers
 * *where can somebody eat*, and not the question a watch is actually asked at night: *where can
 * someone go right now?* In New York the answer to that is a drop-in centre, and the city
 * publishes which ones it funds.
 *
 * ## Why this source is allowed
 *
 * **Licensing.** New York's Open Data Law (Administrative Code §23-502(d), Local Law 11 of 2012)
 * says public data sets *"shall be made available without any registration requirement, license
 * requirement or restrictions on their use"*. The one thing the city may ask is that whoever
 * republishes a data set identify its source and version and describe what was changed, which
 * `data/regions/NOTICE.md` does. Nothing is share-alike, so -- unlike OpenStreetMap -- rows from
 * here do not turn the directory into somebody else's derivative database (`LICENSING.md`).
 *
 * **Distinction.** The rule `osm.ts` learned: *a source that cannot distinguish the thing that
 * matters must not be used for that category.* Each mapping below reads a list the city keeps of
 * exactly one kind of service, or one programme type the city names in a wider list, so the
 * category is the city's own and never a guess from a place's name.
 *
 * ## Data sets, and why only these
 *
 * A region names the data sets it wants, and **an id this module has no mapping for is refused**
 * rather than read. Every mapping is a decision somebody made about what a list of places means,
 * and a new one needs that decision made again.
 *
 * - **`bmxf-3rd4`, DHS's Directory of Homeless Drop-In Centers → `daytime`.** Eight places, with
 *   coordinates, and the only one of these with hours: DHS states them in a column called
 *   `comments`. See `dropInHours` for why only a comment that reads as opening hours is kept
 * - **`ebkm-iyma`, DYCD Program Sites → `youth`**, filtered to `program_area` `RHY` and
 *   `program_type` `Drop-in Centers`: the runaway-and-homeless-youth drop-ins DYCD funds. The
 *   same data set lists 31,000 other sites -- summer jobs, sports, and residences for young
 *   people whose addresses have no place here -- so the filter is applied in the query **and**
 *   again in `fromYouthDropIns`, as `overture.ts` does with its categories. It is also listed
 *   by fiscal year, and a site in an old year may have closed, so only the latest year is read
 *
 * ## Declined
 *
 * - **`i7jb-7jku`, Public Restrooms, for `hygiene`.** A clean, official list, and still the wrong
 *   one. `hygiene` is showers and laundry, and 872 operational year-round toilets would bury the
 *   few places that have either; 507 of those list 8am-4pm, almost none are open at night, and
 *   none has a phone, so once their hours age past the volatile window every one reads *call
 *   first* with nothing to call. The data set does say which are seasonal (`open`) and which are
 *   shut (`status`); what it cannot say is the thing a watch needs at 1am
 * - **`harm_reduction`.** No NYC data set lists syringe service or overdose prevention programmes.
 *   Two list syringe *disposal* points (`edk2-vkjh`, `r465-fr2q`), which are bins, not services.
 *   DOHMH's HIV Service Directory (`pwts-g83w`) has harm reduction among its services, but only
 *   for clients who are HIV-positive and under an income limit -- filed as `harm_reduction` it
 *   would send somebody who is neither -- and its contact columns carry staff names
 *
 * ## What it is not
 *
 * **A phone book.** Neither data set carries a phone number, so these rows are an address and a
 * position. An Overture row at the same address does not lend its number: it is a shelter or a
 * meal, a different service with its own line (see `dedupe`). Finding the number is a person's job.
 *
 * **Live.** DHS updates its list about once a year and DYCD by fiscal year. Each row is dated by
 * the data set's own date -- see `asOf` on `RawRecord` -- so its age is the city's, not the day it
 * was fetched. Which means DHS's hours, dated by an update weeks old, already read *call first*:
 * the fourteen-day rule in `directory-schema.md` §3a, working as written.
 */

/** Which of the city's data sets a region reads. Each must be one this module has a mapping for. */
export interface NycOpenDataConfig {
  datasets: string[];
}

const DOMAIN = "https://data.cityofnewyork.us";

/**
 * More than any of these lists holds, by two orders of magnitude.
 *
 * Socrata answers a request with no limit with the first thousand rows and says nothing about
 * the rest. A source quietly returning part of itself is the failure `merge` reports as
 * "no longer in public sources" -- so a page that comes back full is refused instead of used.
 */
const LIMIT = 5000;

/** A row as Socrata's JSON endpoint gives it: every value a string, absent when empty. */
export type SocrataRow = Record<string, unknown>;

interface Dataset {
  /** SoQL, applied by the server. Never the only filter -- see `fromYouthDropIns`. */
  where?: string;
  map(rows: readonly SocrataRow[], updatedOn: string): RawRecord[];
}

const text = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  // DHS's file carries a no-break space whose UTF-8 bytes were once read as Latin-1, so
  // "14th Street" arrives as "14thÂ Street". The Â is an artefact; the space is the content.
  const t = v.replace(/Â(?= )/g, "").replace(/\s+/g, " ").trim();
  return t ? t : undefined;
};

const coordinate = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : NaN;
  // Zero is how a failed geocode looks, and 0,0 is in the Gulf of Guinea.
  return Number.isFinite(n) && n !== 0 ? n : undefined;
};

/**
 * The city's own identifier for a building, when it is a real one.
 *
 * A BIN is stable across the city's updates and across re-scrapes, which is what `seededId`
 * needs; a row number is not, and a name changes with a rebrand. `1000000` through `5000000` --
 * the borough digit and six zeroes -- are placeholders the city writes when it does not know the
 * building, and DYCD writes one for The Door in 2025. Two places sharing a placeholder would
 * collapse into one id.
 */
function bin(v: unknown): string | undefined {
  const t = text(v);
  return t && /^[1-5]\d{6}$/.test(t) && !/^[1-5]0{6}$/.test(t) ? t : undefined;
}

/** Where a person could read the same thing. Ends up in `notes` as the source. */
const page = (id: string) => DOMAIN + "/d/" + id;

/**
 * Hours, only when DHS's comment is a statement of hours.
 *
 * The column is `comments`, not `hours`, and today every one of its eight values is opening
 * hours: *"Open 24 hours a day, seven days a week"*, *"Open from 7:30 a.m.-8:30 p.m. This program
 * remain open 24 hours during winter months"*. A free-text column can hold anything tomorrow,
 * though, including who a place will take -- and an intake rule arriving in `hours` would walk
 * straight past the lock `seeded.ts` puts on every intake field. So a comment is kept only when
 * it opens with *Open*, and kept whole, winter clause and all; anything else is left out and the
 * field reads *unknown*.
 */
export function dropInHours(comment: unknown): string | undefined {
  const t = text(comment);
  return t && /^open\b/i.test(t) ? t : undefined;
}

/**
 * DHS writes some addresses as a bare street and some with a city and postcode, separated by a
 * semicolon. A bare street gets the borough and postcode the row carries in its own columns, so
 * every address can be walked to without knowing which borough "771 9th Avenue" is in.
 */
function dropInAddress(r: SocrataRow): string | undefined {
  const given = text(r["address"])?.replace(/\s*;\s*/g, ", ");
  if (!given) return undefined;
  if (given.includes(",")) return given;
  const state = ["NY", text(r["postcode"])].filter(Boolean).join(" ");
  return [given, text(r["borough"]), state].filter(Boolean).join(", ");
}

/** Pure: DHS's rows in, `RawRecord`s out. */
export function fromDropInCentres(rows: readonly SocrataRow[], updatedOn: string): RawRecord[] {
  return unique(
    rows.flatMap((r): RawRecord[] => {
      const name = text(r["center_name"]);
      const address = dropInAddress(r);
      // Identity is the building, or failing that the address. A row with neither cannot be
      // told apart from the next, and cannot be walked to either.
      const key = bin(r["bin"]) ?? address?.toLowerCase();
      if (!name || !key) return [];
      const lat = coordinate(r["latitude"]);
      const lon = coordinate(r["longitude"]);
      const hours = dropInHours(r["comments"]);
      return [{
        source: "nycopendata",
        sourceId: "bmxf-3rd4/" + key,
        name,
        category: "daytime",
        ...(address ? { address } : {}),
        country: "US",
        ...(lat !== undefined && lon !== undefined ? { lat, lon } : {}),
        ...(hours ? { hours } : {}),
        url: page("bmxf-3rd4"),
        asOf: updatedOn,
      }];
    }),
  );
}

/**
 * The last day a fiscal year's listing can speak for.
 *
 * DYCD lists a site under the fiscal year it operated in, and New York's fiscal year ends on
 * 30 June. A row for FY2026 says the site ran until then at most -- so it is dated then, or by
 * the data set's own update if that is earlier, never by an update months later that only
 * republished the same year.
 */
export function fiscalYearAsOf(fiscalYear: string, updatedOn: string): string {
  const end = fiscalYear + "-06-30";
  return end < updatedOn ? end : updatedOn;
}

const isYouthDropIn = (r: SocrataRow) =>
  text(r["program_area"]) === "RHY" && text(r["program_type"]) === "Drop-in Centers";

/** Pure: DYCD's rows in, `RawRecord`s out -- the RHY drop-ins of the latest fiscal year only. */
export function fromYouthDropIns(rows: readonly SocrataRow[], updatedOn: string): RawRecord[] {
  // Defence in depth: the query filters, and so does this. A query edited by hand, or a
  // fixture from the wrong programme, must not put a summer-jobs office in the directory.
  const dropIns = rows.filter(isYouthDropIn);
  const years = dropIns.map((r) => text(r["date"])).filter((y): y is string => !!y && /^\d{4}$/.test(y));
  const latest = years.sort().at(-1);
  if (!latest) return [];
  const asOf = fiscalYearAsOf(latest, updatedOn);

  return unique(
    dropIns
      .filter((r) => text(r["date"]) === latest)
      .flatMap((r): RawRecord[] => {
        const name = text(r["program_site_name"]);
        const street = text(r["street_address"]);
        const state = [text(r["state"]), text(r["zipcode"])].filter(Boolean).join(" ");
        const address = street ? [street, text(r["city"]), state].filter(Boolean).join(", ") : undefined;
        const key = bin(r["bin"]) ?? address?.toLowerCase();
        if (!name || !key) return [];
        const lat = coordinate(r["latitude"]);
        const lon = coordinate(r["longitude"]);
        return [{
          source: "nycopendata",
          sourceId: "ebkm-iyma/" + key,
          name,
          category: "youth",
          ...(address ? { address } : {}),
          country: "US",
          ...(lat !== undefined && lon !== undefined ? { lat, lon } : {}),
          url: page("ebkm-iyma"),
          asOf,
        }];
      }),
  );
}

/**
 * One record per place: per source id, and per address.
 *
 * DYCD lists one site once per contract, so FY2025 has every drop-in twice -- and one of The
 * Door's two rows carries the placeholder building number, so its twin keys on its address
 * instead and the source id alone would not catch it. Rows with a real building number go
 * first, so the id a place keeps is the durable one. Two rows with one id would fail the audit
 * as a duplicate, and they are the same place, so nothing is lost.
 */
function unique(records: RawRecord[]): RawRecord[] {
  const byBuilding = (r: RawRecord) => (/\/\d{7}$/.test(r.sourceId) ? 0 : 1);
  const seen = new Set<string>();
  return [...records]
    .sort((a, b) => byBuilding(a) - byBuilding(b))
    .filter((r) => {
      const keys = [r.sourceId, ...(r.address ? [r.address.toLowerCase()] : [])];
      if (keys.some((k) => seen.has(k))) return false;
      for (const k of keys) seen.add(k);
      return true;
    });
}

const DATASETS: Record<string, Dataset> = {
  "bmxf-3rd4": { map: fromDropInCentres },
  "ebkm-iyma": { where: "program_area='RHY' AND program_type='Drop-in Centers'", map: fromYouthDropIns },
};

/** The request for one data set's rows, as a pure string so a test can read it. */
export function nycRowsUrl(id: string): string {
  const dataset = DATASETS[id];
  if (!dataset) throw new Error(unknown(id));
  const params = new URLSearchParams({
    ...(dataset.where ? { $where: dataset.where } : {}),
    // A stable order, so a re-scrape of unchanged data writes an unchanged file.
    $order: ":id",
    $limit: String(LIMIT),
  });
  return DOMAIN + "/resource/" + id + ".json?" + params.toString();
}

/** The data set's own last update, as a date: `2026-10-08T13:49:12+0000` → `2026-10-08`. */
export function updatedOnOf(meta: { dataUpdatedAt?: unknown }): string {
  const at = meta.dataUpdatedAt;
  const day = typeof at === "string" ? /^(\d{4}-\d{2}-\d{2})T/.exec(at)?.[1] : undefined;
  // Without it a row cannot say how old it is, and a guessed date is a claim nobody made.
  if (!day) throw new Error("NYC Open Data gave no update date for this data set");
  return day;
}

const unknown = (id: string) =>
  `no mapping for NYC Open Data set "${id}". Each data set is a decision about what a list of ` +
  "places means; add one to DATASETS in sources/nycopendata.ts rather than reading it unmapped.";

/**
 * The only function here that touches a network.
 *
 * Two requests per data set: its metadata, for the date every row is stamped with, and its rows.
 * No key and no registration, which the Open Data Law requires of the city.
 */
export async function fetchNycOpenData(
  config: NycOpenDataConfig,
  userAgent: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RawRecord[]> {
  // Refused before anything is fetched, so a typo costs nobody's server a request.
  for (const id of config.datasets) if (!DATASETS[id]) throw new Error(unknown(id));

  const out: RawRecord[] = [];
  for (const id of config.datasets) {
    const get = async (url: string): Promise<unknown> => {
      const response = await fetchImpl(url, { headers: { "user-agent": userAgent, accept: "application/json" } });
      if (!response.ok) throw new Error(`NYC Open Data returned ${response.status} for ${id}`);
      return response.json();
    };
    const meta = (await get(DOMAIN + "/api/views/metadata/v1/" + id)) as { dataUpdatedAt?: unknown };
    const rows = await get(nycRowsUrl(id));
    if (!Array.isArray(rows)) throw new Error(`NYC Open Data returned something other than rows for ${id}`);
    if (rows.length >= LIMIT) throw new Error(`${id} returned ${rows.length} rows, the most asked for; refusing a list that may be cut short`);
    out.push(...DATASETS[id]!.map(rows as SocrataRow[], updatedOnOf(meta)));
  }
  return out;
}
