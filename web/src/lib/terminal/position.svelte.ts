/**
 * Where you are, while you are out.
 *
 * **Live only, never a track, and never public.** Three rules, and the third is the one
 * that makes the other two survivable:
 *
 *  - It goes to the watch and to paired peers. There is no setting that publishes it and no
 *    combination of settings that adds up to one [`product/visibility.md`](../../../docs/product/visibility.md)
 *  - Nothing keeps a history. Each update replaces the last, and standing down clears it
 *  - It only runs while signed on, so nobody broadcasts from their kitchen
 *
 * The failure mode was chosen rather than avoided: somebody will leave this on. If position
 * can never be public, that mistake shows their home to a few people who already know where
 * they live. If it could be public, the same mistake writes their home address into a
 * permanent, machine-readable record. Same lapse, wildly different consequence.
 *
 * A browser cannot read location in the background, so this updates while the app is open
 * and freezes at the last fix when it is not. That is stated on the screen rather than
 * implied — an operator who thinks they are being followed continuously and is not has been
 * misled about the one thing that would matter.
 */

import type { Position } from '@navcom/core';
import { get, set } from './storage';

export type Precision = 'off' | 'area' | 'coarse' | 'exact';

/**
 * How far to round a fix before it leaves the phone.
 *
 * Coarse is ~500 metres, which is a neighbourhood rather than a doorway — enough for
 * somebody to come and find you, not enough to say which building you are in.
 */
const METRES: Record<Exclude<Precision, 'off' | 'area'>, number> = {
  coarse: 500,
  exact: 0
};

const FIELD = 'position_precision';

/** Off by default, and it stays off until somebody chooses otherwise. */
export function precision(): Precision {
  return get<Precision>('accruing', FIELD) ?? 'off';
}

export function setPrecision(p: Precision): void {
  set('accruing', FIELD, p);
}

/**
 * Rounds a fix to a grid.
 *
 * Rounding rather than jittering: jitter changes every reading, so several readings of a
 * stationary person average back to the true point. A grid does not — the same place always
 * lands on the same cell, and the cell is all anyone ever sees.
 */
export function coarsen(lat: number, lon: number, metres: number): Position {
  if (metres <= 0) return { lat, lon, precision_m: 0 };

  const latStep = metres / 111_320;
  const cellLat = Math.round(lat / latStep) * latStep;

  // Longitude degrees shrink toward the poles, so the step has to follow the latitude, or a
  // "500 metre" cell in Anchorage is a fifth the width of one in Miami.
  //
  // Computed from the ROUNDED latitude, not the raw one. Using the raw value gives two
  // points a metre apart very slightly different grids, so they land on different cells --
  // which quietly turns the grid back into jitter, and jitter averages away over several
  // readings of somebody standing still.
  const lonStep = metres / (111_320 * Math.max(Math.cos((cellLat * Math.PI) / 180), 0.01));

  return {
    lat: cellLat,
    lon: Math.round(lon / lonStep) * lonStep,
    precision_m: metres
  };
}

let last = $state<Position | null>(null);
let live = $state(false);
let denied = $state(false);
let unavailable = $state(false);
let watchId: number | null = null;

export const position = {
  /** The most recent fix, at the precision the operator chose. Never a history. */
  get current(): Position | null {
    return last;
  },
  get live(): boolean {
    return live;
  },
  /** True when the operator wanted it and the phone refused. Different from "off". */
  get denied(): boolean {
    return denied;
  },
  /**
   * True when the operator wanted it, permission was granted, and there is simply no fix
   * yet — poor signal, indoors, or a timeout. Distinct from `denied` since found in
   * robustness audit: both used to set the same flag, and the screen told an operator with
   * a genuine GPS problem to go check a permission that was never the issue — the situation
   * an outdoor operator with a weak fix is most likely to actually hit.
   */
  get unavailable(): boolean {
    return unavailable;
  },

  /**
   * Starts following, if the operator asked for it.
   *
   * Called on sign-on. Does nothing when precision is `off` or `area` — `area` means the
   * district they typed, which needs no satellites.
   */
  start(): void {
    const p = precision();
    if (p === 'off' || p === 'area') return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    this.stop();
    denied = false;
    unavailable = false;
    watchId = navigator.geolocation.watchPosition(
      (fix) => {
        live = true;
        last = coarsen(fix.coords.latitude, fix.coords.longitude, METRES[p]);
      },
      (error) => {
        // Denied, or no fix. Reported as itself rather than as "off", because an operator
        // who chose to share and is not sharing should know which of those is true --
        // and PERMISSION_DENIED is reported separately from POSITION_UNAVAILABLE/TIMEOUT
        // (found in robustness audit: these used to be conflated into one flag).
        live = false;
        if (error.code === error.PERMISSION_DENIED) denied = true;
        else unavailable = true;
      },
      { enableHighAccuracy: p === 'exact', maximumAge: 30_000, timeout: 60_000 }
    );
  },

  /** Stops, and forgets. Standing down leaves nothing behind. */
  stop(): void {
    if (watchId !== null && typeof navigator !== 'undefined') {
      navigator.geolocation.clearWatch(watchId);
    }
    watchId = null;
    live = false;
    last = null;
  }
};
