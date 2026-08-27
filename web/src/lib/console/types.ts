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
