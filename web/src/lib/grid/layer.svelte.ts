/**
 * Which layer the map draws, and what each layer has loaded, shared by the map and by Com's screens
 * [docs/design/map.md, Layers].
 *
 * One layer at a time, as Starcom's picker has it: Nation States, which is today's map; Starcom's
 * Zones; Time zones; or none. A pick leaves that layer on and the others off. The missions light
 * whichever is drawn, because they are not a way of dividing the Earth.
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
import type { Shape } from './topology';
import type { ZonesOutlines } from './layers/zones';

export type MapLayer = 'nations' | 'zones' | 'timezones' | 'none';
export const MAP_LAYERS: readonly MapLayer[] = ['nations', 'zones', 'timezones', 'none'];

/** Where the vendored Zones are served from: navcom.app's own origin, and nowhere else [D6]. */
export const ZSP_DIR = '/grid/zsp/';

/** `absent`: this build carries no such data, which is not a failure to load it. */
export type Loading = 'off' | 'loading' | 'ready' | 'absent' | 'failed';

/** One standard-time band: its offset from UTC in hours, and its outline on the map. */
export interface Band {
  offset: number;
  shape: Shape;
}

/** The map's neutral tokens, read once per frame: every hue on these screens is a watch state. */
export interface Ink {
  ink: string;
  muted: string;
  line: string;
  strong: string;
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
  /** What the map's legend says while it is drawn: what it is, whose, and how old. */
  legend(): string;
  /** What is open in Com, lifted on the map while it is, however it was opened. */
  lifted?(current: unknown): Shape | null;
  /** What a directory region's ring adds to what it says: its own clocks, with Time zones drawn. */
  region?(slug: string): string | null;
}

/** A directory region's own clocks: `12:05 BST` and its IANA zone, or null for a region with none known. */
export type RegionTime = (region: string) => { time: string; zone: string } | null;

/**
 * The choice, and how each layer's files stand: small, and read everywhere. `loaded` counts what the
 * layers' code has brought into `layerData`, so whatever shows it reads it again.
 */
export const mapLayers = $state({
  chosen: 'nations' as MapLayer,
  /** Starcom's outlines: every Terra, Mare and Zone, fetched whole when Zones is chosen [D10]. */
  zones: 'off' as Loading,
  /** Natural Earth's standard-time bands, and the regions' own zones, fetched when Time zones is chosen [D8]. */
  times: 'off' as Loading,
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
  /**
   * Sectors' names this phone holds without their containers: what the lookup found, named from its own
   * index. A Sector opened from there is named from here, and its container is never fetched for it [D7].
   */
  named: {} as Record<string, string>,
  opening: {} as Record<string, Loading>,
  bands: null as Band[] | null,
  /** Set by the time zones layer, so a screen that shows a region's clocks carries none of its code. */
  regionTime: null as RegionTime | null
};

/** Says that `layerData` changed. */
export const loaded = (): void => void (mapLayers.loaded += 1);
