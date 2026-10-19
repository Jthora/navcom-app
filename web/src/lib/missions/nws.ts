/**
 * The US National Weather Service's warnings for the state a mission is filed under, asked when a
 * person taps and never otherwise [docs/design/map.md, Weather warnings on a mission].
 *
 * **It informs and never gates.** Starcom's own reader calls a mission off on a warning; NavCom's never
 * does: nothing here is read by `TakePart`, and taking a mission stays the operator's own act
 * [invariants 8 and 9]. Nothing pages, nothing notifies, and nothing here is near Distress.
 *
 * One request, `alerts/active?area=<STATE>`, which tells api.weather.gov this phone's address, its
 * browser, the time, that it asked from navcom.app, and which state: the screen says so before the tap.
 * Every alert it answers with is filtered here to the warnings it issued (an event ending in *Warning*)
 * and the emergencies it relays that ask people to act now and whose names do not (`EMERGENCIES`), each
 * of status *Actual* and not a cancellation, and kept in the NWS's own words, with the area it names.
 * Watches, advisories, statements and the rest are not shown, and **how many there were is said**, so
 * none shown is never read as nothing out. No server-side filter is sent that was not measured.
 */

import { countryName } from '$lib/grid/topology';
import { CAPS, NWS, quoted, readOutside } from '$lib/outside';
import { US } from '$lib/components/missions/format';

export type Area =
  /** A US state, DC or territory, by the NWS's two-letter area. */
  | { kind: 'state'; area: string; name: string }
  /** Filed for the whole United States, which the NWS is not asked by. */
  | { kind: 'national' }
  /** Outside the US: no warning service is read for it. */
  | { kind: 'elsewhere'; name: string }
  /** No jurisdiction NavCom can name: nothing is asked. */
  | { kind: 'unknown' };

/** Which NWS area a mission's jurisdiction names, if any. Only codes in NavCom's own table are ever sent. */
export function areaOf(jurisdiction: string | null): Area {
  if (!jurisdiction || !/^[a-z]{2}(-[a-z0-9]{1,3})?$/.test(jurisdiction)) return { kind: 'unknown' };
  const [country, sub] = jurisdiction.split('-') as [string, string | undefined];
  if (country === 'us') {
    if (sub === undefined) return { kind: 'national' };
    const name = US[sub];
    return name && /^[a-z]{2}$/.test(sub) ? { kind: 'state', area: sub.toUpperCase(), name } : { kind: 'unknown' };
  }
  return { kind: 'elsewhere', name: countryName(country) ?? country.toUpperCase() };
}

/**
 * Emergencies the NWS relays for civil authorities whose names do not end in *Warning*, kept beside the
 * warnings: each asks people to act now, or says a way of asking for help is down. *Child Abduction
 * Emergency* is not among them: it is about a person, not a place.
 */
export const EMERGENCIES: ReadonlySet<string> = new Set([
  'Evacuation Immediate',
  'Civil Emergency Message',
  'Local Area Emergency',
  '911 Telephone Outage Emergency'
]);

/** One warning, in the NWS's own words. */
export interface Warning {
  id: string;
  event: string;
  headline: string | null;
  /** The area it covers, as issued (`areaDesc`), cut with a visible … where it is long. */
  area: string | null;
  sender: string | null;
  sent: string | null;
  /** When the hazard ends, as issued, or null when none was issued. */
  ends: string | null;
  /** When this message itself expires, as issued. */
  expires: string | null;
  /** `sent`, in ms, for its age. */
  at: number | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** What one answer held: the warnings and emergencies shown, and how many other actual alerts were not. */
export interface Issued {
  warnings: Warning[];
  /** Watches, advisories, statements and the rest, actual and not cancelled: not shown, and counted. */
  others: number;
}

/**
 * The warnings the NWS issued, and the emergencies it relays, from its `alerts/active` answer, or null
 * when the answer is not the shape it sends. An alert missing its event is left out rather than guessed
 * at; a test, an exercise or a cancellation is not an alert that is out, and is neither shown nor counted.
 */
export function warningsOf(json: unknown): Issued | null {
  if (!isObj(json) || !Array.isArray(json['features'])) return null;
  const out: Warning[] = [];
  let others = 0;
  for (const f of json['features']) {
    const p = isObj(f) && isObj(f['properties']) ? f['properties'] : null;
    const event = quoted(p?.['event'], 200);
    if (!p || !event || p['status'] !== 'Actual' || p['messageType'] === 'Cancel') continue;
    if (!event.endsWith('Warning') && !EMERGENCIES.has(event)) {
      others += 1;
      continue;
    }
    const sent = quoted(p['sent'], 40);
    const ms = sent ? Date.parse(sent) : NaN;
    out.push({
      id: quoted(p['id'], 200) ?? event,
      event,
      headline: quoted(p['headline']),
      area: quoted(p['areaDesc'], 300),
      sender: quoted(p['senderName'], 200),
      sent,
      ends: quoted(p['ends'], 40),
      expires: quoted(p['expires'], 40),
      at: Number.isFinite(ms) ? ms : null
    });
  }
  return { warnings: out, others };
}

export type WarningsRead = ({ ok: true; at: number } & Issued) | { ok: false; why: 'failed' };

/** Asks the NWS for one area's active alerts, once, and keeps its warnings. A failure is never *none*. */
export async function readWarnings(area: string, fetcher: typeof fetch = fetch): Promise<WarningsRead> {
  const url = NWS.alertsUrl(area);
  const read = await readOutside(url, CAPS.nws, { accept: 'application/geo+json', fetcher });
  const issued = read.ok ? warningsOf(read.json) : null;
  return issued ? { ok: true, ...issued, at: Date.now() } : { ok: false, why: 'failed' };
}
