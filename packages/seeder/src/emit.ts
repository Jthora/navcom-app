import { parseCsv, type ResourceRecord } from "@navcom/core";

/**
 * Writing the CSV.
 *
 * Column order is fixed and matches what is already committed, so a re-scrape produces a
 * diff about the data rather than about the file format.
 */

export const COLUMNS = [
  "id", "name", "type", "address", "lat", "lon", "phone", "accepts", "pets", "sobriety",
  "id_required", "referral_required", "sex_offender_ok", "reports_to", "curfew", "max_stay",
  "belongings", "accessibility", "languages", "cost", "hours", "intake_hours", "seasonal",
  "capacity_signal", "last_verified", "verified_by", "method", "flag", "notes",
] as const;

/**
 * The columns a scraper may never fill.
 *
 * `SeededRecord` already makes them unreachable at the type level. This is the second lock,
 * checked at the moment of writing, because the first one is only as good as nobody casting
 * around it.
 */
export const INTAKE_COLUMNS = [
  "accepts", "pets", "sobriety", "id_required", "referral_required", "sex_offender_ok",
  "reports_to", "curfew", "max_stay", "belongings", "capacity_signal",
] as const;

function cell(value: unknown): string {
  if (value === undefined || value === null) return "";
  const s = Array.isArray(value) ? value.join("|") : String(value);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * How each coordinate is written in the committed file, by record id.
 *
 * A number does not remember how it was written. Every coordinate in the directory was rewritten
 * to five fixed decimals on 2026-10-06 -- `40.80400` -- and `cell` writes the shortest form,
 * `40.804`, which is the same place. So rebuilding New York from the very cache it was built from
 * changed 61 of its 267 rows and none of their data, which is the diff about the file format this
 * module exists to avoid. Padding every coordinate instead would be worse: it would claim a metre
 * for a source that printed four decimals, which is the false precision `precision.ts` refuses.
 *
 * So an unchanged coordinate is written as it was, and a new or moved one in its shortest form.
 */
export type WrittenCoordinates = Map<string, { lat?: string; lon?: string }>;

/** Reads `WrittenCoordinates` out of a committed CSV. */
export function writtenCoordinates(csv: string): WrittenCoordinates {
  const [head = [], ...rows] = parseCsv(csv);
  const at = { id: head.indexOf("id"), lat: head.indexOf("lat"), lon: head.indexOf("lon") };
  const out: WrittenCoordinates = new Map();
  if (at.id === -1) return out;
  for (const row of rows) {
    const id = row[at.id]?.trim();
    if (!id) continue;
    const lat = at.lat === -1 ? undefined : row[at.lat]?.trim();
    const lon = at.lon === -1 ? undefined : row[at.lon]?.trim();
    out.set(id, { ...(lat ? { lat } : {}), ...(lon ? { lon } : {}) });
  }
  return out;
}

export function toCsv(records: ResourceRecord[], written: WrittenCoordinates = new Map()): string {
  const rows = records.map((r) =>
    COLUMNS.map((c) => {
      const value = (r as unknown as Record<string, unknown>)[c];
      if ((c === "lat" || c === "lon") && typeof value === "number") {
        const before = written.get(r.id)?.[c];
        if (before !== undefined && Number(before) === value) return before;
      }
      return cell(value);
    }).join(","),
  );
  return [COLUMNS.join(","), ...rows].join("\n") + "\n";
}
