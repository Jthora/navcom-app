/**
 * Which way this phone is facing, so Go's arrow can point where somebody is, in a crowd where a street
 * map is no use because the streets are shut.
 *
 * Read only while the map screen asks, and kept nowhere. On iOS it needs a tap to allow it; on a
 * laptop there is none, and the radar stays north up.
 */

/** Degrees clockwise from north, from what the browser gave, or null where it cannot say. */
export function headingOf(e: { alpha?: number | null; absolute?: boolean; webkitCompassHeading?: number }): number | null {
  if (typeof e.webkitCompassHeading === 'number' && Number.isFinite(e.webkitCompassHeading)) return ((e.webkitCompassHeading % 360) + 360) % 360;
  if (e.absolute && typeof e.alpha === 'number' && Number.isFinite(e.alpha)) return (360 - e.alpha + 360) % 360;
  return null;
}

let heading = $state<number | null>(null);
let listening: ((e: Event) => void) | null = null;
let kind: 'deviceorientationabsolute' | 'deviceorientation' | null = null;

export const compass = {
  get heading(): number | null {
    return heading;
  },
  /** Whether this browser can ever say. */
  get supported(): boolean {
    return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  },

  /** Starts, from a tap where iOS needs one. Says whether it was allowed. */
  async start(): Promise<boolean> {
    if (!this.supported || listening) return listening !== null;
    const ask = (globalThis as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent?.requestPermission;
    if (typeof ask === 'function') {
      try {
        if ((await ask()) !== 'granted') return false;
      } catch {
        return false;
      }
    }
    listening = (e: Event) => {
      const h = headingOf(e as unknown as { alpha?: number | null; absolute?: boolean; webkitCompassHeading?: number });
      if (h !== null) heading = h;
    };
    kind = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(kind, listening);
    return true;
  },

  stop(): void {
    if (listening && kind) window.removeEventListener(kind, listening);
    listening = null;
    kind = null;
    heading = null;
  }
};
