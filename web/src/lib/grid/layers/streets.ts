/**
 * The live map's streets, drawn by MapLibre from our own extract of OpenStreetMap, with the same blips
 * as the radar over them (the owner's map decisions, 2026-11-03).
 *
 * Loaded by `import()` from the map screen, and from nowhere else: nobody pays for a map engine who
 * does not open the map [budget.mjs MAP_LINES]. Reads the extract from the phone where it was saved for
 * the night, or else from navcom.app a range at a time; never from anybody else. Labels are drawn with
 * fonts and sprites served from navcom.app too, so drawing the map asks no third party anything.
 */
import type { GeoJSONSource, LayerSpecification, SourceSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
/*
 * The engine and its worker, by URL rather than bundled: files of their own, under their own names, so
 * the service worker can leave them out of every install and keep them once somebody opens the map
 * [service-worker.ts isMapEngine]. The budget counts them as this line's code [closure.mjs].
 */
import engineUrl from 'maplibre-gl/dist/maplibre-gl.mjs?url';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { PMTiles, type RangeResponse, type Source } from 'pmtiles';
import { layers, namedFlavor } from '@protomaps/basemaps';
import { trailLine, type Blip } from '$lib/map/blips';
import type { StreetArea } from '$lib/map/tiles';

/** A saved extract read straight from the phone: a slice of the file, never the network. */
class SavedSource implements Source {
  constructor(
    private readonly blob: Blob,
    private readonly key: string
  ) {}
  getKey(): string {
    return this.key;
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    return { data: await this.blob.slice(offset, offset + length).arrayBuffer() };
  }
}

export interface Streets {
  draw(blips: Blip[], fresh: (b: Blip) => 'fresh' | 'aging' | 'stale', selected: string | null, from: Blip | null): void;
  centre(at: { lat: number; lon: number }): void;
  /** An area just saved: its tiles come from the phone from now on, with no reload. */
  saved(area: StreetArea, blob: Blob): void;
  destroy(): void;
}

/** A tile's edges in degrees: west, south, east, north. */
function tileEdges(z: number, x: number, y: number): [number, number, number, number] {
  const n = 2 ** z;
  const lat = (row: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / n))) * 180) / Math.PI;
  return [(x / n) * 360 - 180, lat(y + 1), ((x + 1) / n) * 360 - 180, lat(y)];
}

/**
 * Every area's archive, read as one street map.
 *
 * One vector source for all of them, so a map that pans from Manhattan into Brooklyn keeps drawing:
 * a source per area would put every style layer on the map once per area, which a phone pays for on
 * every frame. Each tile goes to the area its middle is deepest inside, or failing that to any area
 * it touches; all of them are cut from the same build, so wherever two overlap they hold the same tile.
 */
const archives = new Map<string, { area: StreetArea; tiles: PMTiles }>();

function archiveFor(z: number, x: number, y: number): PMTiles | null {
  const [w, s, e, n] = tileEdges(z, x, y);
  const lon = (w + e) / 2;
  const lat = (s + n) / 2;
  let best: PMTiles | null = null;
  let depth = -Infinity;
  for (const { area, tiles } of archives.values()) {
    const [aw, as, ae, an] = area.bbox;
    const d = Math.min(lon - aw, ae - lon, lat - as, an - lat);
    if (d >= 0 && d > depth) {
      best = tiles;
      depth = d;
    }
  }
  if (best) return best;
  for (const { area, tiles } of archives.values()) {
    const [aw, as, ae, an] = area.bbox;
    if (w < ae && e > aw && s < an && n > as) return tiles;
  }
  return null;
}

function useArchive(area: StreetArea, blob: Blob | null) {
  archives.set(area.id, { area, tiles: new PMTiles(blob ? new SavedSource(blob, area.url) : area.url) });
}

const EMPTY_TILE = new ArrayBuffer(0);

const empty = { type: 'FeatureCollection' as const, features: [] };

/** A precision as a ring of points: what a fix shared roughly covers, drawn to scale at every zoom. */
function ring(b: Blip): [number, number][] {
  const out: [number, number][] = [];
  const dLat = b.precision_m / 111_320;
  const dLon = dLat / Math.cos((b.lat * Math.PI) / 180);
  for (let i = 0; i <= 32; i++) {
    const a = (i / 32) * 2 * Math.PI;
    out.push([b.lon + dLon * Math.cos(a), b.lat + dLat * Math.sin(a)]);
  }
  return out;
}

/** The terminal's own colours, read where it draws, so a watch state is the same hue on every screen. */
function token(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

let registered = false;
type Engine = typeof import('maplibre-gl');
let engine: Engine | null = null;

async function load(): Promise<Engine> {
  if (!engine) {
    const loaded = (await import(/* @vite-ignore */ engineUrl)) as Engine;
    loaded.setWorkerUrl(new URL(workerUrl, location.href).href);
    engine = loaded;
  }
  return engine;
}

/**
 * Fetches the engine and its worker, so the service worker keeps both [service-worker.ts isMapEngine].
 *
 * Called when an area is saved: saved streets are for a night with no signal, and an engine the phone
 * never kept would leave the saved streets with nothing to draw them, if the map was first opened only
 * once the signal had gone. True when both arrived.
 */
export async function preload(): Promise<boolean> {
  try {
    const got = await Promise.all([fetch(engineUrl), fetch(new URL(workerUrl, location.href).href)]);
    return got.every((r) => r.ok);
  } catch {
    return false;
  }
}

/** Where the streets come from: our extracts, each saved or read from navcom.app, or OpenFreeMap, only when chosen. */
export type StreetSource =
  | { kind: 'ours'; areas: readonly StreetArea[]; saved: ReadonlyMap<string, Blob> }
  | { kind: 'openfreemap'; style: string };

export async function mountStreets(
  container: HTMLElement,
  options: { source: StreetSource; centre: { lat: number; lon: number }; onselect: (id: string) => void }
): Promise<Streets> {
  const gl = await load();
  const ours = options.source.kind === 'ours' ? options.source : null;
  if (ours) {
    for (const area of ours.areas) useArchive(area, ours.saved.get(area.id) ?? null);
    if (!registered) {
      registered = true;
      gl.addProtocol('navcom-streets', async (params, abort) => {
        const [z, x, y] = params.url.replace('navcom-streets://', '').split('/').map(Number) as [number, number, number];
        const tiles = archiveFor(z, x, y);
        if (!tiles) return { data: EMPTY_TILE };
        const got = await tiles.getZxy(z, x, y, abort.signal);
        return { data: got?.data ?? EMPTY_TILE };
      });
    }
  }
  /** West, south, east, north of every area together, so nothing is asked for past them. */
  const bounds = ours
    ? (ours.areas.reduce(
        (b, a) => [Math.min(b[0], a.bbox[0]), Math.min(b[1], a.bbox[1]), Math.max(b[2], a.bbox[2]), Math.max(b[3], a.bbox[3])],
        [180, 90, -180, -90]
      ) as [number, number, number, number])
    : undefined;

  const station = token('--t-station', '#7fbf7f');
  const oncall = token('--t-oncall', '#e0a030');
  const alarm = token('--t-alarm', '#e04030');
  const ink = token('--t-ink', '#e8e8e8');
  const ground = token('--t-ground', '#0b0e12');
  const muted = token('--t-muted', '#8a8f98');
  /*
   * Neutral, as every surface here is drawn: every hue on these screens is a watch state [map.md], and
   * the dark flavor's places of interest were blue, green and orange, so a park beside somebody's blip
   * read as *out*. Their names stay, in grey, for finding your way; their icons are the grayscale set.
   */
  const dark = namedFlavor('dark');
  const flavor = {
    ...dark,
    background: ground,
    earth: ground,
    pois: { blue: muted, green: muted, lapis: muted, pink: muted, red: muted, slategray: muted, tangerine: muted, turquoise: muted }
  };
  /** The blips, the same over either streets. OpenFreeMap's fonts name Noto Sans Regular, ours Medium too. */
  const blipLayers = (font: string): LayerSpecification[] => [
      // The last ten minutes, on the watch only: a thin line in ink, under everything else drawn here.
      { id: 'trail', type: 'line', source: 'trails', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ink, 'line-width': 2, 'line-opacity': 0.45 } },
      { id: 'spread', type: 'fill', source: 'spread', paint: { 'fill-color': station, 'fill-opacity': 0.1, 'fill-outline-color': station } },
      { id: 'go', type: 'line', source: 'go', paint: { 'line-color': ink, 'line-width': 2, 'line-dasharray': [2, 1.5] } },
      {
        id: 'alarm',
        type: 'circle',
        source: 'blips',
        filter: ['==', ['get', 'asking'], 'distress'],
        paint: { 'circle-radius': 13, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': alarm, 'circle-stroke-width': 2.5 }
      },
      {
        id: 'blip',
        type: 'circle',
        source: 'blips',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'kind'], 'self'], 6, 8],
          'circle-color': [
            'case',
            ['==', ['get', 'fresh'], 'stale'], ground,
            ['==', ['get', 'kind'], 'place'], ground,
            ['==', ['get', 'kind'], 'self'], ink,
            ['==', ['get', 'state'], 'distress'], alarm,
            ['==', ['get', 'state'], 'overdue'], oncall,
            station
          ],
          'circle-stroke-color': ['case', ['get', 'selected'], ink, ['==', ['get', 'kind'], 'place'], ink, ground],
          'circle-stroke-width': ['case', ['get', 'selected'], 3, ['==', ['get', 'kind'], 'place'], 2.5, 1.5],
          'circle-opacity': ['case', ['==', ['get', 'fresh'], 'aging'], 0.7, 1]
        }
      },
      {
        id: 'blip-label',
        type: 'symbol',
        source: 'blips',
        layout: { 'text-field': ['get', 'text'], 'text-font': [font], 'text-size': 13, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-allow-overlap': true },
        paint: { 'text-color': ink, 'text-halo-color': ground, 'text-halo-width': 1.5 }
      }
    ];
  const blipSources: Record<string, SourceSpecification> = {
    trails: { type: 'geojson', data: empty },
    spread: { type: 'geojson', data: empty },
    go: { type: 'geojson', data: empty },
    blips: { type: 'geojson', data: empty }
  };

  const map = new gl.Map({
    container,
    center: [options.centre.lon, options.centre.lat],
    zoom: 15,
    maxZoom: 19,
    attributionControl: { compact: true },
    // Labels' fonts, from navcom.app, under names without spaces.
    transformRequest: (url: string) =>
      ours && url.includes('/map/fonts/')
        ? { url: url.replace(/\/map\/fonts\/([^/]+)\//, (_: string, stack: string) => `/map/fonts/${decodeURIComponent(stack).toLowerCase().replace(/\s+/g, '-')}/`) }
        : { url },
    style: ours
      ? {
          version: 8,
          glyphs: `${location.origin}/map/fonts/{fontstack}/{range}.pbf`,
          sprite: `${location.origin}/map/sprites/v4/grayscale`,
          sources: {
            protomaps: {
              type: 'vector',
              tiles: ['navcom-streets://{z}/{x}/{y}'],
              minzoom: 0,
              maxzoom: 15,
              bounds,
              attribution: '© OpenStreetMap contributors · Protomaps'
            },
            ...blipSources
          },
          layers: [...layers('protomaps', flavor, { lang: 'en' }), ...blipLayers('Noto Sans Medium')]
        }
      : (options.source as { style: string }).style
  });
  if (!ours) {
    // OpenFreeMap's own style, with the blips laid over it once it has loaded.
    map.once('style.load', () => {
      for (const [id, source] of Object.entries(blipSources)) map.addSource(id, source);
      for (const layer of blipLayers('Noto Sans Regular')) map.addLayer(layer);
    });
  }
  map.addControl(new gl.NavigationControl({ showCompass: true, visualizePitch: false }), 'top-right');
  map.on('click', 'blip', (e) => {
    const id = e.features?.[0]?.properties?.['id'];
    if (typeof id === 'string') options.onselect(id);
  });
  map.on('mouseenter', 'blip', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'blip', () => (map.getCanvas().style.cursor = ''));
  await new Promise<void>((done) => (map.loaded() ? done() : map.once('load', () => done())));
  // Measured once, MapLibre drew into the box as it was before the screen finished laying out.
  map.resize();
  const sized = new ResizeObserver(() => map.resize());
  sized.observe(container);

  return {
    draw(blips, fresh, selected, from) {
      const teams = (t: string | null) => (t ? ` ${t.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase()}` : '');
      (map.getSource('blips') as GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: blips.map((b) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [b.lon, b.lat] },
          properties: { id: b.id, kind: b.kind, state: b.state ?? '', asking: b.asking ?? '', fresh: fresh(b), selected: b.id === selected, text: `${b.label}${teams(b.team)}` }
        }))
      });
      (map.getSource('trails') as GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: blips
          .filter((b) => b.trail && b.trail.length > 0)
          .map((b) => ({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: trailLine(b).map((p) => [p.lon, p.lat]) },
            properties: { id: b.id }
          }))
      });
      (map.getSource('spread') as GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: blips.filter((b) => b.precision_m > 0).map((b) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring(b)] }, properties: {} }))
      });
      const to = selected ? blips.find((b) => b.id === selected) : null;
      (map.getSource('go') as GeoJSONSource | undefined)?.setData(
        from && to && to.id !== from.id
          ? { type: 'Feature', geometry: { type: 'LineString', coordinates: [[from.lon, from.lat], [to.lon, to.lat]] }, properties: {} }
          : empty
      );
    },
    centre(at) {
      map.easeTo({ center: [at.lon, at.lat], duration: 400 });
    },
    saved(area, blob) {
      if (ours) useArchive(area, blob);
    },
    destroy() {
      sized.disconnect();
      map.remove();
    }
  };
}
