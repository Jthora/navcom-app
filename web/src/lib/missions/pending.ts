/**
 * The mission somebody left to take a callsign, so they can be taken back to it [missions.md §3:
 * *the mission reopens when they come back*].
 *
 * This tab only (`sessionStorage`), and its address and title only: where it is on the map is the
 * mission's, and a fresh tab finds it there. Kept out of the mission modules so the terminal can
 * say "Back to …" without loading any of them.
 */

const ADDRESS = 'navcom.pending-mission';
const TITLE = 'navcom.pending-mission-name';

export interface PendingMission {
  address: string;
  title: string | null;
}

export function rememberMission(address: string, title: string): void {
  try {
    sessionStorage.setItem(ADDRESS, address);
    sessionStorage.setItem(TITLE, title);
  } catch {
    /* a private window: they find it again on the map */
  }
}

export function pendingMission(): PendingMission | null {
  try {
    const address = sessionStorage.getItem(ADDRESS);
    return address ? { address, title: sessionStorage.getItem(TITLE) } : null;
  } catch {
    return null;
  }
}

export function forgetMission(): void {
  try {
    sessionStorage.removeItem(ADDRESS);
    sessionStorage.removeItem(TITLE);
  } catch {
    /* nothing was kept */
  }
}

const SHORT = 32;

/**
 * Where it is named on a button: short enough not to wrap the control. A trailing aside goes first —
 * "Heat relief: California (124 forecast areas)" is "Heat relief: California" — then whole words.
 */
export function backTo(p: PendingMission): string {
  let t = p.title?.trim() ?? '';
  if (!t) return 'Back to the mission';
  if (t.length > SHORT) t = t.replace(/\s*\([^)]*\)$/, '');
  if (t.length > SHORT) {
    const cut = t.slice(0, SHORT);
    const space = cut.lastIndexOf(' ');
    t = `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s:;,.-]+$/, '')}…`;
  }
  return `Back to ${t}`;
}
