/**
 * The time zones layer: Natural Earth's standard-time bands, and each directory region's own IANA
 * zone [the owner's map decision D8; docs/design/map.md, Layers].
 *
 * The map line `timezones` in `scripts/lib/budget.mjs`: loaded by `import()` when somebody chooses
 * Time zones, with both its files, each fetched whole and never by what is on screen. Neither is in
 * the service worker's install precache, so somebody who never chooses the layer never pays for it.
 *
 * The bands are standard offsets as drawn in 2012, with no daylight saving, and the layer says so
 * [invariant 7]. A region's own clock comes from its IANA zone instead, through the phone's `Intl`.
 * Drawn as alternating lifts in brightness, never a hue [layer.svelte.ts DrawnLayer].
 */

import { clockAt, labelOf, localTime } from '../clock';
import { areaAt, decode, type Shape, type Topology } from '../topology';
import { layerData, loaded, mapLayers, type Band, type DrawnLayer } from '../layer.svelte';

export { clockAt, labelOf, localTime };

/** `/grid/region-times.json`: each directory region's IANA zone, as an index into one list of zones. */
export interface RegionTimes {
  v: 1;
  zones: string[];
  regions: Record<string, number>;
}

/** The committed file's bands, decoded and projected, each with its standard offset in hours. */
export function bandsOf(topology: Topology): Band[] {
  return (decode(topology)['bands']?.shapes ?? [])
    .flatMap((shape) => (typeof shape.props.zone === 'number' ? [{ offset: shape.props.zone, shape }] : []))
    .sort((a, b) => a.offset - b.offset);
}

let asked: Promise<void> | null = null;

/** Both files, once; asked for again the next time the layer is chosen if either did not arrive. */
export function loadTimes(): Promise<void> {
  asked ??= (async () => {
    mapLayers.times = 'loading';
    try {
      const get = <T,>(url: string) => fetch(url).then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(new Error(url))));
      const [bands, regions] = await Promise.all([get<Topology>('/grid/timezones.json'), get<RegionTimes>('/grid/region-times.json')]);
      layerData.bands = bandsOf(bands);
      layerData.regionTime = (region) => {
        const zone = regions.zones[regions.regions[region] ?? -1];
        const t = zone ? localTime(zone, Date.now()) : null;
        return zone && t ? { time: `${t.time} ${t.abbr}`, zone } : null;
      };
      loaded();
      mapLayers.times = 'ready';
    } catch {
      mapLayers.times = 'failed';
      asked = null;
    }
  })();
  return asked;
}

let drawnFrom: Band[] | null = null;
let drawn: { shapes: Shape[]; lift: Path2D | null; lines: Path2D | null } = { shapes: [], lift: null, lines: null };
function sync() {
  const bands = layerData.bands;
  if (bands === drawnFrom) return;
  const pathOf = (list: readonly Band[]) => {
    const p = new Path2D();
    for (const b of list) {
      for (const r of b.shape.rings) {
        p.moveTo(r[0]!, r[1]!);
        for (let i = 2; i < r.length; i += 2) p.lineTo(r[i]!, r[i + 1]!);
        p.closePath();
      }
    }
    return p;
  };
  // Every other band by offset, so neighbours part.
  drawn = bands ? { shapes: bands.map((b) => b.shape), lift: pathOf(bands.filter((_, i) => i % 2 === 1)), lines: pathOf(bands) } : { shapes: [], lift: null, lines: null };
  drawnFrom = bands;
}

export const layer: DrawnLayer = {
  load: () => void loadTimes(),
  fill(ctx, ink) {
    sync();
    if (!drawn.lift) return;
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = ink.ink;
    ctx.fill(drawn.lift, 'evenodd');
    ctx.globalAlpha = 1;
  },
  lines(ctx, scale, ink) {
    sync();
    if (!drawn.lines) return;
    ctx.lineWidth = 0.8 / scale;
    ctx.strokeStyle = ink.strong;
    ctx.stroke(drawn.lines);
  },
  hit(v, at) {
    if (!layerData.bands) return undefined;
    sync();
    return areaAt(v, at, drawn.shapes);
  },
  say(shape) {
    // Standard time, and said to be: the band does not know daylight saving [D8].
    const offset = Number(shape.props.zone);
    return `${labelOf(offset)} · ${clockAt(offset, Date.now())} now, standard time`;
  },
  open: (shape) => ({ kind: 'time', offset: String(shape.props.zone) }),
  legend: () => 'Time zones · standard time as drawn in 2012, no daylight saving · Natural Earth',
  region(slug) {
    const t = layerData.regionTime?.(slug);
    return t ? `${t.time}, ${t.zone.replace(/_/g, ' ')}` : null;
  }
};
