import type { SeededRecord } from "./seeded.js";

/**
 * The same shelter under two names in three sources is the normal case, not an edge one.
 *
 * **When unsure, keep both.** A duplicate is a nuisance an operator resolves by reading two
 * entries. A wrongly-merged record is two half-truths welded together, with one address and
 * the other one's phone number, and nothing about it looks wrong afterwards.
 *
 * So the bar for merging is deliberately high: near-identical names AND physical proximity,
 * or an exact phone match. Anything less stays two records.
 */

/** Metres between two points. Equirectangular is ample at city scale and has no edge cases. */
export function metresApart(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  // Wrapped to [-180, 180): found in robustness audit. A raw longitude difference blows up
  // crossing the antimeridian -- two points 0.2 degrees apart at +/-179.9 computed as
  // ~40,000km instead of ~22km. Latent everywhere every current region is (nowhere near the
  // dateline), not live -- cheap to close regardless.
  const dLon = ((b.lon - a.lon + 540) % 360) - 180;
  const x = dLon * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * R;
}

/** Lowercased, punctuation gone, and the words that appear in half of all charity names. */
export function nameKey(name: string): string {
  const STOP = new Set([
    "the", "of", "and", "inc", "llc", "center", "centre", "services", "service",
    "mission", "ministries", "ministry", "foundation", "society", "association",
  ]);
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .sort()
    .join(" ");
}

const SAME_PLACE_METRES = 120;

function sameThing(a: SeededRecord, b: SeededRecord): boolean {
  if (a.phone && b.phone && a.phone === b.phone) return true;

  const keyA = nameKey(a.name);
  const keyB = nameKey(b.name);
  if (!keyA || keyA !== keyB) return false;

  // Same name, and we cannot tell where either one is. Two branches of one charity across
  // a city look exactly like this, so it is not enough.
  const hasA = typeof a.lat === "number" && typeof a.lon === "number";
  const hasB = typeof b.lat === "number" && typeof b.lon === "number";
  if (!hasA || !hasB) return false;

  return (
    metresApart(
      { lat: a.lat as number, lon: a.lon as number },
      { lat: b.lat as number, lon: b.lon as number },
    ) <= SAME_PLACE_METRES
  );
}

/**
 * Fills gaps from a duplicate without ever overwriting.
 *
 * The record that survives is the one seen first, and its own values are never replaced --
 * so merging can only ever add facts, never silently substitute one source's answer for
 * another's. A field the winner already has is a field the loser cannot touch.
 */
function absorb(winner: SeededRecord, loser: SeededRecord): SeededRecord {
  const merged: SeededRecord = { ...winner };
  for (const key of ["address", "lat", "lon", "phone", "hours", "cost", "languages"] as const) {
    if (merged[key] === undefined && loser[key] !== undefined) {
      (merged as unknown as Record<string, unknown>)[key] = loser[key];
    }
  }
  return merged;
}

export interface DedupeResult {
  records: SeededRecord[];
  /** Which ids were folded into which, so a report can show it and a human can disagree. */
  merged: { kept: string; dropped: string; reason: "phone" | "name-and-place" }[];
}

/**
 * Order matters and is the caller's responsibility: whichever record appears first wins,
 * so pass the sources you trust most first.
 */
export function dedupe(records: SeededRecord[]): DedupeResult {
  const kept: SeededRecord[] = [];
  const merged: DedupeResult["merged"] = [];

  for (const record of records) {
    const hit = kept.findIndex((k) => sameThing(k, record));
    if (hit === -1) {
      kept.push(record);
      continue;
    }
    const winner = kept[hit] as SeededRecord;
    merged.push({
      kept: winner.id,
      dropped: record.id,
      reason: winner.phone && winner.phone === record.phone ? "phone" : "name-and-place",
    });
    kept[hit] = absorb(winner, record);
  }

  return { records: kept, merged };
}
