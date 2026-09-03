import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RawRecord } from "../seeded.js";

const run = promisify(execFile);

/**
 * Overture Maps, via DuckDB.
 *
 * The second source, and the reason for it is one number. Over Seattle's bounding box, for the
 * same three categories the OSM source asks for:
 *
 * | | OpenStreetMap | Overture |
 * |---|---|---|
 * | records | 45 | 84 |
 * | **carrying a phone** | **14 (31%)** | **81 (96%)** |
 * | carrying an address | 35 | 84 (100%) |
 *
 * The doubling is not the point. A phone number is what turns a record into something a person
 * can settle in a minute, and ringing round is the single most effective thing anybody can do
 * for this directory -- `callsheet.ts` exists for exactly that hour. Thirty-one per cent to
 * ninety-six is the difference between a locator and a work list.
 *
 * ## Why this source is allowed where others were not
 *
 * `osm.ts` states the rule its own mistakes produced: **a source that cannot distinguish the
 * thing that matters must not be used for that category.** It is why there is no medical query
 * (a medspa and four urgent-care franchises) and no `amenity=shelter` (a duck shelter and a
 * park pavilion), and why `social_facility=outreach` was declined in `declined.md` despite
 * being the largest unmapped category in OSM.
 *
 * Overture clears that bar on two counts. Its taxonomy carries `homeless_shelter` under
 * `[public_service_and_government, organization, social_service_organizations]` -- a category
 * about the service rather than the architecture. And every place carries a **confidence**,
 * which sorts the noise to the bottom: 0.92 for Union Gospel Mission, Northwest Harvest and
 * Dorothy Day House; 0.32 and below for "Seattle Housing Authority Resident Managers" and
 * "Level Up Seattle".
 *
 * **Confidence is not a filter for correctness.** A housing authority's office still arrives at
 * 0.81. The threshold removes obvious junk; a person removes the rest, which is what
 * `uncategorised.md` and `audit` are for.
 *
 * ## What it is not
 *
 * **A replacement for OSM.** Overture publishes about monthly and keeps two releases, so its
 * freshness floor is weeks where Overpass answers live. It is a *locator* source -- names,
 * addresses, coordinates, phones -- layering under a live one, and it carries no intake rule
 * whatsoever. Nothing here gets somebody a bed; it gets somebody a number to ring.
 */

/** Overture's own release, pinned per region so a re-scrape is reproducible. */
export interface OvertureConfig {
  /** [west, south, east, north] -- the same shape the OSM config uses. */
  bbox: [number, number, number, number];
  /** e.g. `2026-08-19.0`. Pinned, never "latest": a moving source is not a reproducible one. */
  release: string;
  /**
   * Below this, a place is not proposed.
   *
   * 0.5 by default, which over Seattle kept 79 of 84 and dropped exactly the rows a person
   * would have deleted by hand. Raise it for a region full of noise rather than lowering the
   * bar everywhere.
   */
  minConfidence?: number;
}

const BUCKET = "s3://overturemaps-us-west-2/release";
const DEFAULT_MIN_CONFIDENCE = 0.5;

/**
 * Overture's category, mapped to ours.
 *
 * Deliberately three. `normalise.ts` owns the vocabulary and refuses anything it cannot place,
 * so a wider net here would only produce a longer unmapped tally -- and every additional
 * category is a claim that a person in trouble can act on it.
 */
const CATEGORIES: Record<string, string> = {
  homeless_shelter: "shelter",
  food_bank: "food_bank",
  soup_kitchen: "soup_kitchen",
};

/**
 * The query, as a pure string, so it can be read in a test without touching S3.
 *
 * `bbox.xmin`/`ymin` rather than a spatial predicate: the files are partitioned and Parquet
 * row-group statistics prune on those columns, which is the difference between reading a
 * bounding box and reading the planet.
 */
export function overtureQuery(config: OvertureConfig, extensionDir?: string): string {
  const [w, s, e, n] = config.bbox;
  const min = config.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const cats = Object.keys(CATEGORIES).map((c) => `'${c}'`).join(", ");
  return [
    /*
     * Where DuckDB keeps `httpfs`, when it cannot use its own default.
     *
     * It writes to `~/.duckdb/` and a sandbox, a locked-down build agent or a read-only home
     * will refuse that -- reporting it as *"Extension httpfs not found"*, which reads like a
     * missing install rather than an unwritable directory and sends somebody to reinstall a
     * thing they already have. `NAVCOM_DUCKDB_EXTENSIONS` points it somewhere writable.
     */
    ...(extensionDir ? [`SET extension_directory='${extensionDir}';`] : []),
    "INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';",
    "SELECT id, names.primary AS name, taxonomy.primary AS category, confidence,",
    "       addresses[1].freeform AS address, addresses[1].locality AS locality,",
    "       phones[1] AS phone, websites[1] AS website,",
    "       bbox.xmin AS lon, bbox.ymin AS lat",
    `FROM read_parquet('${BUCKET}/${config.release}/theme=places/type=place/*')`,
    `WHERE bbox.xmin BETWEEN ${w} AND ${e}`,
    `  AND bbox.ymin BETWEEN ${s} AND ${n}`,
    `  AND taxonomy.primary IN (${cats})`,
    `  AND confidence >= ${min}`,
    "ORDER BY confidence DESC;",
  ].join("\n");
}

interface OvertureRow {
  id?: string;
  name?: string;
  category?: string;
  confidence?: number;
  address?: string;
  locality?: string;
  phone?: string;
  website?: string;
  lat?: number;
  lon?: number;
}

/** Pure: rows in, `RawRecord`s out. Everything interesting is testable without a network. */
export function fromOverture(rows: readonly OvertureRow[]): RawRecord[] {
  const out: RawRecord[] = [];
  for (const r of rows) {
    // No name is no record -- an operator cannot be sent to an unnamed building. Same rule
    // `fromOverpass` applies, for the same reason.
    if (!r.name || !r.id) continue;
    const category = r.category ? CATEGORIES[r.category] : undefined;
    if (!category) continue;

    const address = [r.address, r.locality].filter(Boolean).join(", ");
    out.push({
      source: "overture",
      // Overture's GERS id is stable across releases, which is what `seededId` needs: a
      // re-scrape must read as a diff a person can review, not a mass delete and re-create.
      sourceId: r.id,
      name: r.name,
      category,
      ...(address ? { address } : {}),
      ...(typeof r.lat === "number" ? { lat: r.lat } : {}),
      ...(typeof r.lon === "number" ? { lon: r.lon } : {}),
      ...(r.phone ? { phone: r.phone } : {}),
      url: r.website ?? "https://overturemaps.org/",
    });
  }
  return out;
}

/** Raised when `duckdb` is absent, so the caller can say which tool and stop guessing. */
export class DuckDbMissing extends Error {}

/**
 * The only function here that touches anything outside this process.
 *
 * **Shells out rather than taking a dependency.** Overture is partitioned Parquet on S3, not an
 * API, and reading it needs DuckDB -- but a native npm module would be built and downloaded by
 * every contributor who runs `npm install`, including everybody who never seeds a region. So
 * this looks for a binary and **says plainly when there is not one**, which is the same posture
 * `watchtower-daemon --check` takes toward an unreachable relay: an absent tool is a fact to
 * report, not a failure to blame somebody for.
 */
export async function fetchOverture(
  config: OvertureConfig,
  duckdbPath = process.env["NAVCOM_DUCKDB"] ?? "duckdb",
  extensionDir = process.env["NAVCOM_DUCKDB_EXTENSIONS"]
): Promise<RawRecord[]> {
  const sql = overtureQuery(config, extensionDir);
  let stdout: string;
  try {
    ({ stdout } = await run(duckdbPath, ["-json", "-c", sql], {
      maxBuffer: 64 * 1024 * 1024,
      timeout: 15 * 60_000,
    }));
  } catch (err: unknown) {
    const e = err as { code?: string; stderr?: string; message?: string };
    if (e.code === "ENOENT") {
      throw new DuckDbMissing(
        `\`${duckdbPath}\` not found. Overture is Parquet on S3 rather than an API, so this ` +
          "source needs the DuckDB CLI: https://duckdb.org/docs/installation/ , or set " +
          "NAVCOM_DUCKDB to a binary. Every other source works without it."
      );
    }
    throw new Error("duckdb failed: " + (e.stderr || e.message || String(err)).slice(0, 400));
  }

  let rows: OvertureRow[];
  try {
    rows = JSON.parse(stdout || "[]") as OvertureRow[];
  } catch {
    throw new Error("duckdb returned something that is not JSON: " + stdout.slice(0, 200));
  }
  return fromOverture(rows);
}
