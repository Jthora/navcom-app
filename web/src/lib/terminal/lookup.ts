/**
 * A place, looked up by the watch to answer somebody.
 *
 * *"Someone with both hands free does the lookup. That is the product."* The watch answered a
 * `Query` by typing from memory, so every answer reached the operator marked **Unverified — no
 * source given**, even when it came straight off a directory record. This narrows a region's
 * records the way the area screen does — on the phone, asking nobody — and turns the one picked
 * into a line of the answer and its provenance, attached verbatim as the export says to
 * [`directory/export.ts`, `signals.spec.md`]. The operator's screen then says where it came from
 * and when it was last checked, rather than nothing.
 *
 * Nothing here is new data: the records are the area page's own, and a refuge whose location is
 * withheld has no address or coordinates to give [core `confidential.ts`].
 */
import { labelValue, type Provenance, type ResourceRecord } from '@navcom/core';
import { metresApart, type Fix } from '$lib/console/position-once';

export interface Found {
  record: ResourceRecord;
  /** Metres from the fix the ask carried, when it carried one and the record has a position. */
  metres: number | null;
}

/** Records matching every word typed, nearest the asker first where both have a position. */
export function narrow(records: readonly ResourceRecord[], typed: string, near: Fix | null, limit = 6): Found[] {
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  const found = records
    .filter((r) => {
      const hay = `${r.name} ${labelValue(r.type)} ${r.type} ${r.address ?? ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .map((record) => ({
      record,
      metres:
        near && record.lat !== undefined && record.lon !== undefined
          ? metresApart(near, { lat: record.lat, lon: record.lon })
          : null
    }));
  if (near) found.sort((a, b) => (a.metres ?? Infinity) - (b.metres ?? Infinity));
  return found.slice(0, limit);
}

/** "1.2 km" or "350 m". */
export function distance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres / 50) * 50} m`;
}

/** The line put into the answer: name, address, phone, and the hours where the record has them. */
export function placeLine(r: ResourceRecord): string {
  return [r.name, r.address, r.phone, r.intake_hours ? `intake ${r.intake_hours}` : r.hours]
    .filter((s): s is string => !!s && s.trim().length > 0)
    .join(', ');
}

/** What the answer carries about where its words came from, exactly as the export gives it. */
export function provenanceOf(r: ResourceRecord): Provenance {
  return { record_id: r.id, verified: r.last_verified ?? null, method: r.method ?? null };
}
