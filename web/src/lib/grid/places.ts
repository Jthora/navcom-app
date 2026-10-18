/**
 * The only points the map may draw: places on public record [docs/design/map.md §6; invariant 1].
 *
 * **Nothing on this map, and nothing in any package NavCom reads, locates the people being served:
 * no encampments, no sleeping sites, no person's position. Places on public record are points. dv
 * refuges carry no coordinates at all.**
 *
 * So the map takes no free-form coordinates. Every point it draws is a `PlaceOfRecord`, and this
 * module is the only one that makes one, from exactly two sources:
 *
 * - `placesOfMissions`, from verified packages: a ring where a package locates its subject, an
 *   entity on public record, at the precision the package earned and never finer than
 *   `MISSION_FINEST` until D5 and Q19 are answered [interchange spec §4.2]
 * - `placesOfDirectory`, from the directory: each region's circle, and each record's point from
 *   `/grid/places.json`, which `placesFileOf` builds at prerender with refuges left out through the
 *   rule that withholds their address [core: directory/confidential.ts], never re-checked here
 *
 * `src/lib/boundaries.test.ts` holds both halves: the map's props carry no coordinates, and no other
 * module makes a `PlaceOfRecord`.
 */

import type { ConsoleCentroid, ConsoleRegionFigures } from '$lib/console/types';
import type { GeoPrecision, Mission, ResourceRecord, ResourceType } from '@navcom/core';
import { atPrecision, isConfidential, locatingLeaks } from '@navcom/core';
import { mercator } from './topology';

declare const OF_RECORD: unique symbol;

interface Point {
  /** Only this module sets it: a value of this type was made by one of its constructors. */
  readonly [OF_RECORD]: true;
  readonly lon: number;
  readonly lat: number;
  /** Projected once, into the unit square the map draws in. */
  readonly x: number;
  readonly y: number;
  /** How far from it a tap still lands on it, in CSS px. */
  readonly reach: number;
}

export type PlaceOfRecord =
  | (Point & { readonly kind: 'mission'; readonly address: string; readonly title: string; readonly metres: number })
  | (Point & {
      readonly kind: 'region';
      readonly region: string;
      readonly name: string;
      readonly records: number;
      /** How many of its records the map does not draw, or `null` while the places file is not here: unknown, never none. */
      readonly unmapped: number | null;
    })
  | (Point & { readonly kind: 'record'; readonly region: string; readonly regionName: string; readonly index: number });

/** `/console-regions.json`: the directory's regions, their centres and their figures. */
export interface RegionsFile {
  centroids: ConsoleCentroid[];
  figures: Record<string, ConsoleRegionFigures>;
}

/**
 * `/grid/places.json`: per region, each record's `[lon, lat]` in the order of that region's
 * `console-index`, or `null` for a record the map does not draw. Fetched whole, when Places is
 * switched on, never by what is on screen [map.md §2].
 */
export interface PlacesFile {
  v: 1;
  decimals: number;
  regions: Record<string, ([number, number] | null)[]>;
}

/**
 * Four places, about 11 m: a record's point on the map. Its own five, about a metre, stay on its
 * page and in its handoff [map.md §5]. Decision D5 (2026-10-18) chooses; until it is answered,
 * the more cautious of the two measured.
 */
export const PLACES_DECIMALS = 4;
/**
 * Which types the map draws, decided for **every** type there is: a type added to the taxonomy does
 * not compile until somebody decides it, so nothing new reaches `/grid/places.json` by default. It
 * was a deny-list of two, which already missed two places people sleep (review, 2026-10-18).
 *
 * Held back until the owner answers D5: the published facilities people sleep in — shelters, youth
 * programmes, overnight warming centres, residential detox — which some providers may see as
 * locating the people they shelter. They stay in the directory and on their own pages at five
 * places. Refuges are held back twice over: their location is withheld before this is read.
 */
export const ON_THE_MAP: Readonly<Record<ResourceType, boolean>> = {
  shelter: false,
  youth: false,
  warming: false,
  detox: false,
  dv: false,
  meal: true,
  hygiene: true,
  medical: true,
  harm_reduction: true,
  cooling: true,
  storage: true,
  legal: true,
  id_docs: true,
  mail: true,
  charging: true,
  veterinary: true,
  daytime: true
};
/** The file's budget, gzipped: measured at 64.3 KB with every record at four places (2026-10-18). */
export const PLACES_MAX_GZ = 80 * 1024;

/** How far each kind reaches for a tap, in CSS px: a region's circle is a thumb wide at world zoom. */
const REACH = { mission: 24, region: 24, record: 12 } as const;

/** About how far one unit of each precision spans on the ground, in metres: 0.1° of latitude is 11 km. */
const METRES: Record<GeoPrecision, number> = { city: 11_132, '1km': 1_113, address: 1.1 };
/** Decimal places of each precision, as core keeps them [core: missions/package.ts]. */
const DECIMALS: Record<GeoPrecision, number> = { city: 1, '1km': 2, address: 5 };
/**
 * The finest a package's point is drawn, whatever it declared: about a kilometre, until the owner
 * answers D5 and partners answer Q19 [interchange spec §4.2, rev 8]. A package carries no resource
 * type, so NavCom cannot tell a youth shelter or a refuge from a library, and the hold on the
 * directory's sleeping places has to hold here too. The mission keeps its point as declared; only
 * the drawing is coarser, at the point it rounds to, so the ring's centre gives nothing finer away.
 * One constant, so the answer is one line.
 */
export const MISSION_FINEST: GeoPrecision = '1km';

function at<K extends PlaceOfRecord['kind']>(
  kind: K,
  lon: number,
  lat: number,
  rest: Omit<Extract<PlaceOfRecord, { kind: K }>, keyof Point | 'kind'>
): PlaceOfRecord {
  const [x, y] = mercator(lon, lat);
  return { kind, lon, lat, x, y, reach: REACH[kind], ...rest } as unknown as PlaceOfRecord;
}

/**
 * A ring for each mission whose package locates its subject — an organisation, a facility, a
 * parcel on public record — at the precision the reader kept [core: missions/package.ts], or at
 * `MISSION_FINEST` where that is finer. A point
 * that stands for a jurisdiction is not drawn: the jurisdiction is shaded instead, and a circle at
 * its middle would invent a location somebody might head for [D4].
 */
export function placesOfMissions(missions: readonly Mission[]): PlaceOfRecord[] {
  const out: PlaceOfRecord[] = [];
  for (const m of missions) {
    const p = m.placement.point;
    if (!p || p.kind !== 'subject_location') continue;
    const drawn = DECIMALS[p.precision] > DECIMALS[MISSION_FINEST] ? MISSION_FINEST : p.precision;
    const [lon, lat] = [atPrecision(p.lon, DECIMALS[drawn]), atPrecision(p.lat, DECIMALS[drawn])];
    out.push(at('mission', lon, lat, { address: m.address, title: m.title, metres: METRES[drawn] }));
  }
  return out;
}

/**
 * Whether a record is drawn on the map: it has coordinates, its location is not withheld, and its
 * type is not one D5 holds back.
 */
export function onTheMap(r: Pick<ResourceRecord, 'type' | 'lat' | 'lon'>): boolean {
  if (r.lat === undefined || r.lon === undefined || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) return false;
  if (isConfidential(r.type) || locatingLeaks(r).length > 0) return false;
  return ON_THE_MAP[r.type] === true;
}

/** Builds `/grid/places.json` from each region's records, in the order its `console-index` lists them. */
export function placesFileOf(regions: readonly { region: string; records: readonly ResourceRecord[] }[]): PlacesFile {
  const out: PlacesFile['regions'] = {};
  for (const { region, records } of regions) {
    out[region] = records.map((r) =>
      onTheMap(r) ? [atPrecision(r.lon!, PLACES_DECIMALS), atPrecision(r.lat!, PLACES_DECIMALS)] : null
    );
  }
  return { v: 1, decimals: PLACES_DECIMALS, regions: out };
}

/**
 * Each region's ring, and, from the places file when it arrived, each record's point. A ring knows
 * how many of its region's records the map does not draw, so where the records take over it can
 * stay and say so, rather than leave a held-back region looking empty [invariant 7].
 */
export function placesOfDirectory(regions: RegionsFile, file: PlacesFile | null): { regions: PlaceOfRecord[]; records: PlaceOfRecord[] } {
  const records: PlaceOfRecord[] = [];
  const drawn = new Map<string, number>();
  const ok = file?.v === 1;
  if (ok) {
    for (const [region, points] of Object.entries(file.regions)) {
      const regionName = regions.figures[region]?.name ?? region;
      const before = records.length;
      points.forEach((p, index) => {
        if (p && Number.isFinite(p[0]) && Number.isFinite(p[1])) records.push(at('record', p[0], p[1], { region, regionName, index }));
      });
      drawn.set(region, records.length - before);
    }
  }
  const circles = regions.centroids.map((c) => {
    const listed = ok ? file.regions[c.region]?.length : undefined;
    return at('region', c.lon, c.lat, {
      region: c.region,
      name: c.name,
      records: regions.figures[c.region]?.records ?? 0,
      unmapped: listed === undefined ? null : listed - (drawn.get(c.region) ?? 0)
    });
  });
  return { regions: circles, records };
}
