/**
 * Which Zone and Sector a point is in, looked up on the phone [D7, D10; docs/design/map.md, Zones].
 *
 * The map line `zones-lookup` in `scripts/lib/budget.mjs`, loaded by `import()` the first time somebody
 * asks. The index of every Sector on Earth is fetched whole, the same file for everybody, so asking
 * tells NavCom's host only that somebody asked; the point asked about, a tap or this phone's own
 * position-once fix, never leaves the phone. In longitude and latitude, never projected, so a Sector
 * that runs to the pole is answered like any other [@navcom/core/zones]. Nothing it finds opens a
 * container: the index names every Sector itself.
 */

import { placeAt, zspIndex, type ZspIndex } from '@navcom/core/zones';
import { decode, lonLat, type Topology } from '../topology';
// Not from `./zones`: a line's code imported statically would arrive with this one [budget.mjs MAP_LINES].
import { ZSP_DIR } from '../layer.svelte';

/** The index file, decoded in longitude and latitude. */
export function indexOf(topology: Topology): ZspIndex {
  const shapes = decode(topology, lonLat)['sectors']?.shapes ?? [];
  return zspIndex(shapes.flatMap((s) => (s.id ? [{ id: s.id, rings: s.rings }] : [])));
}

/** Each Sector's name, from the index itself: a lookup names what it found without opening anything. */
function namesOf(topology: Topology): Map<string, string> {
  const out = new Map<string, string>();
  for (const g of Object.values(topology.objects)[0]?.geometries ?? []) {
    const p = g.properties ?? {};
    if (typeof p.id === 'string') out.set(p.id, typeof p.name === 'string' ? p.name : p.id);
  }
  return out;
}

/** A Sector found, by its id and its name. */
export interface Found {
  id: string;
  name: string;
}

type Answer =
  | { status: 'ready'; inside: Found | null; near: Found[] }
  | { status: 'absent' }
  | { status: 'failed' }
  /** The index is of another stage than the outlines on this page: a deploy landed between them. */
  | { status: 'stale' };

let index: Promise<{ index: ZspIndex; names: Map<string, string>; digest: string } | null> | null = null;

/**
 * The Sector holding (lon, lat), and any within about a kilometre and a half of it, nearest first:
 * the index's edges are quantised to about 400 m, so near one the person chooses. `digest` is the
 * manifest the outlines on the page came from, so an index of another stage is not mixed with them.
 */
export async function lookUp(lon: number, lat: number, digest: string): Promise<Answer> {
  index ??= fetch(`${ZSP_DIR}index.json`).then(async (r) => {
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(String(r.status));
    const topology = (await r.json()) as Topology;
    return { index: indexOf(topology), names: namesOf(topology), digest: String(topology.navcom?.manifest_sha256 ?? '') };
  });
  try {
    const held = await index;
    if (!held) return { status: 'absent' };
    if (held.digest !== digest) return { status: 'stale' };
    const { inside, near } = placeAt(held.index, lon, lat);
    const found = (id: string): Found => ({ id, name: held.names.get(id) ?? id });
    // Named from the index, never by opening a container: a fetch chosen by where the phone is would
    // tell the host where that is [map.md §2; decided 2026-10-06].
    return { status: 'ready', inside: inside === null ? null : found(inside), near: near.map(found) };
  } catch {
    index = null;
    return { status: 'failed' };
  }
}
