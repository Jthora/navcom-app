/**
 * How a mission's place and end read on screen. Pure: tested directly.
 *
 * Places are named from the package's own `jurisdiction` code, never from the map's outlines —
 * placement never asks a drawn border where something is [docs/design/map.md §3]. Missions are
 * filed by US state today, so those have names; anything else reads as its code, upper-case,
 * rather than as a guess.
 */
import type { Settlement } from '@navcom/core';

const US: Record<string, string> = {
  al: 'Alabama', ak: 'Alaska', az: 'Arizona', ar: 'Arkansas', ca: 'California', co: 'Colorado',
  ct: 'Connecticut', de: 'Delaware', dc: 'Washington, DC', fl: 'Florida', ga: 'Georgia', hi: 'Hawaii',
  id: 'Idaho', il: 'Illinois', in: 'Indiana', ia: 'Iowa', ks: 'Kansas', ky: 'Kentucky', la: 'Louisiana',
  me: 'Maine', md: 'Maryland', ma: 'Massachusetts', mi: 'Michigan', mn: 'Minnesota', ms: 'Mississippi',
  mo: 'Missouri', mt: 'Montana', ne: 'Nebraska', nv: 'Nevada', nh: 'New Hampshire', nj: 'New Jersey',
  nm: 'New Mexico', ny: 'New York', nc: 'North Carolina', nd: 'North Dakota', oh: 'Ohio', ok: 'Oklahoma',
  or: 'Oregon', pa: 'Pennsylvania', ri: 'Rhode Island', sc: 'South Carolina', sd: 'South Dakota',
  tn: 'Tennessee', tx: 'Texas', ut: 'Utah', vt: 'Vermont', va: 'Virginia', wa: 'Washington',
  wv: 'West Virginia', wi: 'Wisconsin', wy: 'Wyoming', pr: 'Puerto Rico', gu: 'Guam',
  vi: 'US Virgin Islands', as: 'American Samoa', mp: 'Northern Mariana Islands'
};

/** `us-ca` → California; `us` → United States; anything else, its code upper-case. */
export function placeName(jurisdiction: string | null): string {
  if (!jurisdiction) return '—';
  if (jurisdiction === 'us') return 'United States';
  const [country, sub] = jurisdiction.split('-');
  if (country === 'us' && sub && US[sub]) return US[sub]!;
  return jurisdiction.toUpperCase();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `10 Oct, 05:00 UTC` — the form Mecha Jono's own clock lines use. */
export function stampUtc(unixSeconds: number): string {
  const t = new Date(unixSeconds * 1000);
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}, ${hh}:${mm} UTC`;
}

/** How long until a mission ends, in the largest whole unit: `3 days`, `5 hours`, `ended`. */
export function endsIn(unixSeconds: number, nowMs: number): string {
  const s = unixSeconds - Math.floor(nowMs / 1000);
  if (s <= 0) return 'Ended';
  const days = Math.floor(s / 86_400);
  if (days >= 2) return `${days} days`;
  const hours = Math.floor(s / 3_600);
  if (hours >= 2) return `${hours} hours`;
  const minutes = Math.max(1, Math.floor(s / 60));
  return minutes >= 60 ? '1 hour' : `${minutes} min`;
}

/** Under a day left: worth an amber readout, never an alarm [panel.md rule 7]. */
export function endsSoon(unixSeconds: number, nowMs: number): boolean {
  const s = unixSeconds - Math.floor(nowMs / 1000);
  return s > 0 && s < 86_400;
}

/** `about 20 minutes`, `about 1.5 hours`: effort is a publisher's estimate, and reads as one. */
export function effort(minutes: number | null): string | null {
  if (minutes === null || !(minutes > 0)) return null;
  if (minutes < 60) return `about ${minutes} minutes`;
  const hours = Math.round((minutes / 60) * 2) / 2;
  return `about ${hours} hour${hours === 1 ? '' : 's'}`;
}

/** A contact key by the name it gave, or by its first eight characters when it gave none. */
export function nameOf(key: string, names: ReadonlyMap<string, string>): string {
  return names.get(key) ?? key.slice(0, 8);
}

/**
 * Where a report stands, said the way economy.md §7–§8 says it: **how** it settled is part of the
 * fact — *settled by poster* and *settled unchallenged* are different evidence and are never
 * laundered into one word — and a challenge is shown by name beside the settlement, reversing
 * nothing.
 */
export function standingOf(
  s: Settlement,
  names: ReadonlyMap<string, string>
): { value: string; tone: 'neutral' | 'good'; sub: string } {
  const challenged = s.challengedBy.length > 0 ? ` · challenged by ${s.challengedBy.map((k) => nameOf(k, names)).join(', ')}` : '';
  if (s.state === 'pending') return { value: 'Waiting', tone: 'neutral', sub: `settles by itself ${stampUtc(s.until)} unless challenged${challenged}` };
  if (s.how === 'silence') return { value: 'Settled', tone: 'good', sub: `unchallenged for seven days${challenged}` };
  return { value: 'Settled', tone: 'good', sub: `${s.how === 'poster' ? 'by the poster' : 'by a witness'}, ${nameOf(s.by, names)}${challenged}` };
}
