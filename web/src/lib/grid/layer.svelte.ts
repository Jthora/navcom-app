/**
 * Which layer the map draws, and what each layer has loaded, shared by the map and by Com's screens
 * [docs/design/map.md, Layers].
 *
 * One layer at a time, as Starcom's picker has it: Nation States, which is today's map; Starcom's
 * Zones; the Spheres; Time zones; or none. A pick leaves that layer on and the others off. The missions
 * light whichever is drawn, because they are not a way of dividing the Earth. Over a layer, overlays:
 * day and night, the directory by when it was last checked, the open missions counted by Zone, and
 * Hazards, the one overlay that asks anybody outside navcom.app, and only once somebody chooses it
 * [$lib/outside].
 *
 * Only the choice and a few small flags live here, loaded with the map as it mounts. Each layer's own
 * code and data arrive when somebody chooses it, never before [scripts/lib/budget.mjs MAP_LINES]:
 * `layers/zones.ts` and `layers/timezones.ts` fill this in, and draw themselves through `DrawnLayer`,
 * so the map that every visit loads carries none of it. What they load is held raw, never proxied, so
 * a tap's hit-test reads plain arrays at the device floor's speed.
 *
 * Nothing here is stored. The choice lasts the page's life; where somebody works is the one thing kept,
 * and it is kept in the Wipeable tier by the screen that asks for it [D7].
 */

import type { Screen } from '$lib/com/screens';
import type { View } from './pick';
import type { PlaceOfRecord } from './places';
import type { Shape } from './topology';
import type { HazardsHeld } from './layers/hazards';
import type { SpheresFile } from './layers/spheres';
import type { ZonesOutlines } from './layers/zones';

export type MapLayer = 'nations' | 'zones' | 'spheres' | 'timezones' | 'none';
export const MAP_LAYERS: readonly MapLayer[] = ['nations', 'zones', 'spheres', 'timezones', 'none'];

/** Where the vendored Zones are served from: navcom.app's own origin, and nowhere else [D6]. */
export const ZSP_DIR = '/grid/zsp/';

/** `absent`: this build carries no such data, which is not a failure to load it. */
export type Loading = 'off' | 'loading' | 'ready' | 'absent' | 'failed';

/** One standard-time band: its offset from UTC in hours, and its outline on the map. */
export interface Band {
  offset: number;
  shape: Shape;
}

/**
 * The map's neutral tokens, read once per frame, so a drawing follows Low signature the moment it is
 * switched: every hue on these screens is a watch state. In Low signature the three text tones are
 * close in brightness (ink to muted ΔE 10, muted to faint ΔE 2), so nothing drawn here tells two
 * things apart by tone alone: shape, fill and size carry every difference, and tone only adds to it.
 */
export interface Ink {
  ink: string;
  muted: string;
  faint: string;
  line: string;
  strong: string;
  /** The deepest neutral: night's shade, under everything else. */
  sunk: string;
  /** The canvas's own ground: a badge's fill, and the casing every mark sits on. */
  ground: string;
  /** The land, lifted off the sea far enough to read in sunlight [GridMap.svelte --map-land]. */
  land: string;
}

/**
 * How a chosen layer draws itself and answers a tap, supplied by its own module once that arrives.
 * `hit` is `undefined` while the layer has nothing loaded, so the map answers as Nation States.
 */
export interface DrawnLayer {
  /** Starts its files arriving, once. */
  load(): void;
  /** Under the missions' lights: a lift, if the layer has one. In map units. */
  fill?(ctx: CanvasRenderingContext2D, ink: Ink): void;
  /** Its own lines, at `scale` CSS px to the unit. */
  lines(ctx: CanvasRenderingContext2D, scale: number, ink: Ink): void;
  hit(v: View, at: readonly [number, number]): Shape | null | undefined;
  say(shape: Shape): string;
  open(shape: Shape): Screen;
  /** What the map's legend says while it is drawn, in one short line: what it is, whose, and how old. */
  legend(): string;
  /** The rest of whose it is and how it was made, for the full key on the layers screen. */
  credit?(): string;
  /** Whose it is, as its licence asks, shown over the map's foot while it is drawn: `''` for none. */
  attribution?(): string;
  /** What is open in Com, lifted on the map while it is, however it was opened. */
  lifted?(current: unknown): Shape | null;
  /** What a directory region's ring adds to what it says: its own clocks, with Time zones drawn. */
  region?(slug: string): string | null;
}

/**
 * Something drawn over whichever layer is chosen, rather than instead of it: day and night, the
 * directory by last check, open missions counted by Zone, Hazards. Each is a module of its own under
 * `layers/`, loaded by `import()` when it is first wanted and charged to its own line
 * [budget.mjs MAP_LINES]. **Hazards is the one that answers a tap**, with its own marks, after the
 * places of record and before a lit shape [map.md §8]; the rest answer none, and the layer under them
 * and the points do.
 */
export interface Overlay {
  /** Starts it: its files, once, and any tick it keeps. */
  load(): void;
  /** Stops any tick it keeps, when it is no longer drawn. */
  stop?(): void;
  /** In map units, after the layer's own lift and before the missions' lights. `edge` is the Earth's outline. */
  under?(ctx: CanvasRenderingContext2D, scale: number, ink: Ink, edge: Path2D | null): void;
  /** In map units, over the layer's lines. */
  over?(ctx: CanvasRenderingContext2D, scale: number, ink: Ink, edge: Path2D | null): void;
  /**
   * In CSS px, in place of the directory's own points: `points` are the regions or records shown at this
   * zoom. True when it drew them, so the map draws only the missions' rings, and the dashed rings of
   * the regions whose places it holds back.
   */
  points?(ctx: CanvasRenderingContext2D, view: View, ink: Ink, points: readonly PlaceOfRecord[]): boolean;
  /**
   * In CSS px, over every point: a badge, the sun, a hazard's mark. Under only what a hover or a tap
   * lifted, and the reticle. `lifted` are the ids of the marks a hover, a tap or the screen open in Com
   * has taken, drawn heavier.
   */
  marks?(ctx: CanvasRenderingContext2D, view: View, ink: Ink, lifted: ReadonlySet<string>): void;
  /**
   * Its own marks under `at` (CSS px), nearest first, and what a hover says of them: only Hazards
   * answers, and only with marks it drew. `ids` is what the screen a tap opens is given, and `of` how
   * many marks were in reach, which `ids` may name fewer of.
   */
  hit?(view: View, at: readonly [number, number]): { ids: string; say: string; of: number } | null;
  /** Its line in the map's key, one short line: what it is, whose, and how old [invariant 7]. */
  legend(): string;
  /** The rest of whose it is and how it was made, for the full key on the layers screen. */
  credit?(): string;
  /**
   * Where its marks and their counts go at this view, once a frame and before `marks` draws them: clear
   * of `taken`, which holds what was placed before it (the missions' rings first, then each overlay in
   * turn), and to which it adds its own, so the names keep off them too [layers/labels.ts]. Returns the
   * counts it drew, which the canvas carries for a browser test to find [GridMap.svelte data-counts].
   */
  place?(ctx: CanvasRenderingContext2D, view: View, taken: Box[]): Counted[];
  /** What it adds to what a hover over an area says. */
  about?(shape: Shape): string | null;
  /** What it adds to what a directory region's ring, or one of its records, says. */
  region?(slug: string, record?: number): string | null;
  /** Rows under the map's key: one swatch per class it draws, in the shape it draws it. */
  swatches?(): readonly Swatch[];
}

/** A box on the canvas, in CSS px from its top left. */
export interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** A count an overlay drew: what it counts (`zone:…`, `wildfire`), how many, its glyph's or area's point, and the count's own box. */
export interface Counted {
  of: string;
  n: number;
  x: number;
  y: number;
  box: Box;
}

/** Whether two boxes overlap, with `pad` CSS px of air between them. */
export const overlaps = (a: Box, b: Box, pad = 0): boolean => a.l < b.r + pad && a.r > b.l - pad && a.t < b.b + pad && a.b > b.t - pad;

/** One row of a key under the map's own: a mark drawn as the map draws it, and what it means. */
export interface Swatch {
  /**
   * The directory's ages, a family of squares, since the circle is the missions' alone: `square` filled,
   * `square-small` a smaller one filled, `square-ring` hollow, `square-cross` hollow and crossed
   * [layers/ages.ts]. `dots`: a patch of night's dots, as day and night lays them over an area. The rest
   * are Hazards' shapes, all outlines, two of them hatched [layers/hazards.ts]. `lit`: a patch of the lift
   * a mission filed under a place gives it, as the map lights a province or a country [GridMap.svelte].
   */
  mark: 'square' | 'square-small' | 'square-ring' | 'square-cross' | 'dots' | 'asterisk' | 'triangle' | 'triangle-hatched' | 'hexagon' | 'diamond' | 'diamond-hatched' | 'lit';
  tone: 'ink' | 'muted' | 'faint';
  text: string;
  /** Shares a line with the next, wrapping, rather than a row of its own: Hazards' six kinds. */
  inline?: boolean;
}

/**
 * Whether day and night is drawn: always with Time zones, and over any other layer while its box is
 * ticked. One place, so whether Time zones draws it always is one line to change.
 */
export const daylightDrawn = (): boolean => mapLayers.chosen === 'timezones' || mapLayers.daylight;

/** A directory region's own clocks: `12:05 BST` and its IANA zone, or null for a region with none known. */
export type RegionTime = (region: string) => { time: string; zone: string } | null;

/** How a region's places stand by when they were last checked, from this phone's clock [layers/ages.ts]. */
export interface RegionAge {
  /** The oldest and the newest check among its records, as dates, or null when none is dated. */
  oldest: string | null;
  newest: string | null;
  /**
   * A region's cautious reading, its oldest check's, so everything there was checked at least this
   * recently; or, when one record was asked for, that record's own.
   */
  reading: 'current' | 'hours' | 'stale' | 'unknown';
  /** One record's own check, when asked for one. */
  record: string | null;
}

/**
 * The choice, and how each layer's files stand: small, and read everywhere. `loaded` counts what the
 * layers' code has brought into `layerData`, so whatever shows it reads it again.
 */
export const mapLayers = $state({
  chosen: 'nations' as MapLayer,
  /** Day and night over a layer other than Time zones, which always draws it [daylightDrawn]. */
  daylight: false,
  /** The directory's regions by when they were last checked, over Nation States. */
  ages: false,
  /** The Sphere picked out on the Spheres layer, by its id; null shows every Sphere's members alike. */
  sphere: null as string | null,
  /** Starcom's outlines: every Terra, Mare and Zone, fetched whole when Zones is chosen [D10]. */
  zones: 'off' as Loading,
  /** Natural Earth's standard-time bands, and the regions' own zones, fetched when Time zones is chosen [D8]. */
  times: 'off' as Loading,
  /** Day and night's code: nothing is fetched for it, so only its code can fail to arrive. */
  sun: 'off' as Loading,
  /** The directory's check dates, `/grid/region-ages.json`, fetched when the ages are first shown. */
  agesFile: 'off' as Loading,
  /** Open missions counted by Zone: its code, which fetches nothing. */
  counts: 'off' as Loading,
  /** The Spheres' lists and their small members' label points, fetched when Spheres is chosen [D9]. */
  spheres: 'off' as Loading,
  /**
   * Hazards over any layer, from three public feeds outside navcom.app: off until somebody ticks it,
   * and never stored, so a reload asks nobody [$lib/outside].
   */
  hazards: false,
  /** Hazards' own code: what it reads arrives with its own states, per feed, in `layerData.hazards`. */
  hazardsCode: 'off' as Loading,
  loaded: 0
});

/**
 * What the layers' code has loaded, held raw and never proxied, so a tap's hit-test reads plain arrays
 * at the device floor's speed. Written by `layers/zones.ts` and `layers/timezones.ts`, and `named` by
 * the lookup's screen, each write followed by `loaded()`.
 */
export const layerData = {
  outlines: null as ZonesOutlines | null,
  /** A container's Sectors, by its id, fetched when somebody opens it and never by what is on screen [D10]. */
  sectors: {} as Record<string, Shape[]>,
  /** Each opened container file's own drift from its source, in metres, as the vendoring measured it. */
  sectorDrift: {} as Record<string, number | undefined>,
  /**
   * Sectors' names this phone holds without their containers: what the lookup found, named from its own
   * index. A Sector opened from there is named from here, and its container is never fetched for it [D7].
   */
  named: {} as Record<string, string>,
  opening: {} as Record<string, Loading>,
  bands: null as Band[] | null,
  /** Set by the time zones layer, so a screen that shows a region's clocks carries none of its code. */
  regionTime: null as RegionTime | null,
  /** Where the sun is overhead, by this phone's clock, to the minute: set by day and night [layers/daylight.ts]. */
  sun: null as { lat: number; lon: number; at: number } | null,
  /** Set by the directory's ages, so the place screen can say when a place was checked and carries none of its code. */
  regionAges: null as ((region: string, record?: number) => RegionAge | null) | null,
  /**
   * The open missions the map draws, as the map has them: the rings of those whose package locates
   * their subject, how many are filed by jurisdiction only, and the feed's age, null while the missions
   * have not been read, which is unknown and not none. Set by the map and read by the Zones' counts, so
   * no layer's code reads the mission feed itself.
   */
  missions: null as { rings: readonly PlaceOfRecord[]; unplaced: number; age: string | null } | null,
  /**
   * The world's countries as the map decoded them, for a layer that draws over them by code: Spheres'
   * members. Set by the map when its geometry arrives.
   */
  countries: null as Shape[] | null,
  /** What lies over the canvas, the key and the controls, in CSS px: a count is never hung under them [GridMap covers]. */
  covers: [] as Box[],
  /** The provinces the world's file carries, for the names drawn on them closer in [layers/labels.ts]. */
  provinces: null as Shape[] | null,
  /** The Spheres' lists, vendored, fetched whole when Spheres is chosen [layers/spheres.ts; D9]. */
  spheres: null as SpheresFile | null,
  /**
   * What Hazards has read, every mark and each feed's state and age, set by its own code so the screens
   * that show it carry none of that code [layers/hazards.ts]. Null until it is first turned on.
   */
  hazards: null as HazardsHeld | null
};

/**
 * What the map's key says, as the map last drew it: each thing drawn, its one short line on the map and
 * the rest of its words, so the layers screen gives the whole of it and the map keeps one line each.
 */
export const mapKey = $state({ lines: [] as { line: string; credit: string }[], swatches: [] as readonly Swatch[] });

/** Says that `layerData` changed. */
export const loaded = (): void => void (mapLayers.loaded += 1);
