/**
 * Where you are, once, for the second it takes to find what is near you.
 *
 * Deliberately not `$lib/terminal/position.svelte.ts` — that module is gated behind a
 * persisted `precision` preference (default `off`) tied to the operator sign-on/live-sharing
 * flow, so calling its `start()` here would silently no-op for a fresh visitor. This is a
 * one-shot fix, rounded before it is ever held in memory, discarded once the nearest region is
 * found, and **never sent anywhere** — no server, no watch, no peer. Denial or absence is a
 * normal, silent no-op, not an error state.
 */
import type { ConsoleCentroid } from './types';

export interface Fix {
  lat: number;
  lon: number;
}

/** Rounds to a ~500m grid, same reasoning as `coarsen()` in the terminal's position module. */
function coarsen(lat: number, lon: number): Fix {
  const metres = 500;
  const latStep = metres / 111_320;
  const cellLat = Math.round(lat / latStep) * latStep;
  const lonStep = metres / (111_320 * Math.max(Math.cos((cellLat * Math.PI) / 180), 0.01));
  return { lat: cellLat, lon: Math.round(lon / lonStep) * lonStep };
}

export function locateOnce(): Promise<Fix | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(coarsen(pos.coords.latitude, pos.coords.longitude)),
      () => resolve(null),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 }
    );
  });
}

/** Equirectangular approximation — ample at city scale, the same reasoning as the seeder's. */
export function metresApart(a: Fix, b: Fix): number {
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

/** The nearest region that actually has records — an empty seeded region should never win. */
export function nearest(fix: Fix, centroids: ConsoleCentroid[]): ConsoleCentroid | null {
  let best: ConsoleCentroid | null = null;
  let bestDist = Infinity;
  for (const c of centroids) {
    const d = metresApart(fix, c);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}
