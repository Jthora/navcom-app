/**
 * How a mission's place and end read on screen. Pure: tested directly.
 *
 * Places are named from the package's own `jurisdiction` code, never from the map's outlines —
 * placement never asks a drawn border where something is [docs/design/map.md §3]. Missions are
 * filed by US state today, so those have names; anything else reads as its code, upper-case,
 * rather than as a guess.
 */
import { MISSION_PUBLISHERS, keyOf, type Settlement } from '@navcom/core';
import { countryName, filedUnder } from '$lib/grid/topology';

/**
 * The US states, DC and the five inhabited territories, by the code a mission files them under after
 * `us-`: also the NWS's own areas, upper-cased, which is what `missions/nws.ts` asks by.
 */
export const US: Readonly<Record<string, string>> = {
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

/**
 * `us-ca` → California; `us` → United States; a country by its code from the phone's own tables
 * (`ke` → Kenya); anything else, its code upper-case.
 */
export function placeName(jurisdiction: string | null): string {
  if (!jurisdiction) return '—';
  if (jurisdiction === 'us') return 'United States';
  const [country, sub] = jurisdiction.split('-');
  if (country === 'us' && sub && US[sub]) return US[sub]!;
  if (!sub && /^[a-z]{2}$/.test(jurisdiction)) return countryName(jurisdiction) ?? jurisdiction.toUpperCase();
  return jurisdiction.toUpperCase();
}

/** Whether a mission filed under a jurisdiction belongs to a place: the map's test too, so it lives there. */
export { filedUnder };

/** Great-circle distance in km between two `[lat, lon]` points: what "near" means on the place screen. */
export function kmBetween([lat1, lon1]: readonly [number, number], [lat2, lon2]: readonly [number, number]): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `10 Oct, 05:00 UTC` — the form Mecha Jono's own clock lines use. */
export function stampUtc(unixSeconds: number): string {
  const t = new Date(unixSeconds * 1000);
  // A date no calendar can draw reads as unknown, never as "NaN undefined" [11.R].
  if (!Number.isFinite(t.getTime())) return '—';
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

/**
 * A claim let go whose release no relay has confirmed [audit 11.S, finding 66]. "Unconfirmed" — it
 * may have arrived — only when the release left the phone and no relay refused it; otherwise no
 * relay has it, and the claim certainly stands. Said as unconfirmed with no signal at all, it
 * invited her to read the claim as maybe released and not send it [review].
 */
export function releaseReadout(u: { ends: number; mayHaveArrived?: true }, nowMs: number): { value: string; sub: string } {
  const left = endsIn(u.ends, nowMs);
  return u.mayHaveArrived
    ? { value: 'Release unconfirmed', sub: `no relay confirmed it; it may have arrived · the claim ends by itself in ${left}` }
    : { value: 'Release not sent', sub: `no relay has it · the claim stands until it ends by itself in ${left}` };
}

/**
 * Why a day cannot be reported again [audit 11.S, finding 52]. Withdrawing is offered only for a
 * report that can be withdrawn: a sealed one has already reached its poster, and told to withdraw
 * it, she had no way to [review].
 */
export function alreadyReported(visibility: 'open' | 'sealed', posterName: string): string {
  return visibility === 'open'
    ? 'This day is already reported, to everyone. Withdraw that one to report it again.'
    : `This day is already reported, sealed to ${posterName}. A sealed report cannot be withdrawn, so the day stays reported.`;
}

/** `about 20 minutes`, `about 1.5 hours`: effort is a publisher's estimate, and reads as one. */
export function effort(minutes: number | null): string | null {
  if (minutes === null || !(minutes > 0)) return null;
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round((minutes / 60) * 2) / 2;
  return `about ${hours} hour${hours === 1 ? '' : 's'}`;
}

const NO_AGENTS: ReadonlySet<string> = new Set();

/**
 * A contact key by the name it gave, with the key's own first eight characters beside it — a name
 * is self-chosen, so anybody may call themselves anything, the poster's name included [11.R] — or
 * by those characters alone when it gave none.
 *
 * **An agent is said to be one, wherever its key appears** [invariant 4]: a registered publisher
 * by the registry's name and mark, and any key in `agents` — a poster whose package declared
 * itself one — by its mark. A settlement is where an agent's judgment of a person's work is
 * shown, and it read as a bare key on one screen and as a person's name on the other [audit 11.I].
 */
export function nameOf(key: string, names: ReadonlyMap<string, string>, agents: ReadonlySet<string> = NO_AGENTS): string {
  // By the key's own entry, never by a name: a second entry can never read as the first [rev 7].
  const registered = keyOf(MISSION_PUBLISHERS, key)?.entry;
  const name = registered?.name ?? names.get(key);
  const id = key.slice(0, 8);
  if (registered?.agent || agents.has(key)) return name ? `${name} (${id}, an agent)` : `${id} (an agent)`;
  return name ? `${name} (${id})` : id;
}

/**
 * Where a report stands, said the way economy.md §7–§8 says it: **how** it settled is part of the
 * fact — *settled by poster* and *settled unchallenged* are different evidence and are never
 * laundered into one word — and a challenge is shown by name beside the settlement, reversing
 * nothing.
 */
export function standingOf(
  s: Settlement,
  names: ReadonlyMap<string, string>,
  agents: ReadonlySet<string> = NO_AGENTS
): { value: string; tone: 'neutral' | 'good'; sub: string } {
  const challenged = s.challengedBy.length > 0 ? ` · challenged by ${s.challengedBy.map((k) => nameOf(k, names, agents)).join(', ')}` : '';
  // A challenge stops nothing, so neither line may say it would: it stands beside the settlement [economy.md §8].
  if (s.state === 'pending') return { value: 'Waiting', tone: 'neutral', sub: `settles by itself ${stampUtc(s.until)}${challenged}` };
  if (s.how === 'silence') {
    return { value: 'Settled', tone: 'good', sub: challenged ? `seven days passed${challenged}` : 'unchallenged for seven days' };
  }
  return { value: 'Settled', tone: 'good', sub: `${s.how === 'poster' ? 'by the poster' : 'by a witness'}, ${nameOf(s.by, names, agents)}${challenged}` };
}

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `2026-09-28` → `28 September`: a day said the way a person says it. */
export function dayName(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const month = m ? MONTHS_LONG[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month}` : day;
}

/** `8 Oct, 03:14:15 UTC`: the second something left this phone, as the row it is on says it. */
export function secondUtc(unixSeconds: number): string {
  const t = new Date(unixSeconds * 1000);
  if (!Number.isFinite(t.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}, ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())} UTC`;
}

/**
 * What a row in this device's own mission history says about something it sealed to a key whose
 * secret leaked [decided 2026-10-18, decision 2]: past tense, on the row it is about — what was in
 * it, what was not, and that there is nothing to do. Never a banner, never red, and never
 * "compromised": the operator did nothing wrong.
 */
export function leakedLine(kind: 'report' | 'claim', name: string, exposed: string, sentAt?: number): string {
  const when = dayName(exposed);
  if (kind === 'claim') {
    return `Sealed to ${name}'s old key, whose secret leaked on ${when}: whoever holds it can see that your card took part in this mission, and the second you did.`;
  }
  return (
    `Sealed to ${name}'s old key. Its secret leaked on ${when}, so whoever holds it can open this report and show others it came from your card. ` +
    `It held your callsign, the day, the mission, the objectives you ticked, your counts and the second you sent it${sentAt === undefined ? '' : `, ${secondUtc(sentAt)}`}: no place, and nothing else from this phone.`
  );
}
