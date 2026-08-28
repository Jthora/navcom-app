/** Just enough of a record to search and link onward — see `routes/+page.server.ts`. */
export interface ConsoleIndexEntry {
  id: string;
  name: string;
  type: string;
  region: string;
  regionName: string;
}

/** A region's centroid, derived from its own geotagged records — never hand-curated. */
export interface ConsoleCentroid {
  region: string;
  name: string;
  lat: number;
  lon: number;
}

/**
 * What's actually true about one region's own slice of the directory — never about who is
 * watching it. There is no field anywhere that ties a Watchtower to a region, and there
 * should not be one [docs/spec/bootstrap.spec.md] — this carries only directory facts.
 */
export interface ConsoleRegionFigures {
  region: string;
  name: string;
  records: number;
  /** `verified_by` set, a real method, and not `isSeeded` — matches `BROADCAST.measure`. */
  confirmedByPerson: number;
  /** ISO date, YYYY-MM-DD, or null if nothing in this region has ever been checked. */
  freshest: string | null;
  /** ISO 639-1 codes, from the region's own manifest — what its records are written in. */
  languages: string[];
}
