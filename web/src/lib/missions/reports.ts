/**
 * Reporting the work, from this device [core: events/report.ts; interchange spec §5.2–§5.3].
 *
 * **Not today.** A report tells of a day that has ended: the screen offers no way to report today,
 * and this refuses one. A report from tonight is worth most to somebody tracking an operator and
 * little to the operator, so the delay costs the honest player almost nothing. There is no queue —
 * nothing is held on the device to send later, because a store of unsent reports is a store of
 * where somebody has been [the-artifact-that-leaves.md P5]. Not tonight means come back.
 *
 * **A second report in one place inside a week is warned about, not refused.** One callsign, one
 * state, a date, again and again, is a series somebody can read; the operator decides.
 *
 * What was sent is listed here, Wipeable, so it can be seen and withdrawn — a list of what left,
 * never a count of it [C20].
 */
import type { Event } from 'nostr-tools/core';
import {
  CHALLENGE_WINDOW_SECONDS,
  KIND_CARD,
  KIND_DELETION,
  KIND_LABEL,
  KIND_REPORT,
  MISSION_RELAYS,
  againstMission,
  buildDeletion,
  buildReport,
  buildReportLabel,
  buildSealedReport,
  readCard,
  readReport,
  settlementOf,
  withdrawnReports,
  type Mission,
  type Report,
  type Settlement
} from '@navcom/core';
import { get, set } from '$lib/terminal/storage';
import { contactPubkey, ensureContactKey } from '$lib/terminal/card';
import { relays } from '$lib/terminal/relays';
import { isHidden } from '$lib/hidden';
import { inboxOf, signedOn, tookPart, wire as defaultWire, type Visibility, type Wire } from './claims';

const SENT = 'mission_reports';
/** The window inside which a second report in one place is warned about. */
export const SERIES_DAYS = 7;

export interface Sent {
  /** The report's id: the event's own, or for a sealed report the id inside the seal. */
  id: string;
  address: string;
  title: string;
  /** Where the mission is, from the package: what the series warning compares. */
  jurisdiction: string | null;
  poster: string;
  date: string;
  /** Unix seconds: when it was sent. */
  at: number;
  visibility: Visibility;
  /** Set once a withdrawal has been asked for. Relays may not honour it, and the screen says so. */
  withdrawn?: boolean;
}

/** What this device has sent. */
export function sent(): Sent[] {
  return get<Sent[]>('wipeable', SENT) ?? [];
}

/** `YYYY-MM-DD` for a moment, in this device's own day. */
export function localDay(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The days a report may tell of: yesterday and the six before it. Never today. */
export function reportableDays(now: number): string[] {
  return Array.from({ length: 7 }, (_, i) => localDay(now - (i + 1) * 86_400));
}

/** A report sent for the same place inside the window, if there is one. */
export function series(m: Mission, now: number): Sent | null {
  if (!m.placement.jurisdiction) return null;
  return (
    sent().find(
      (s) => !s.withdrawn && s.jurisdiction === m.placement.jurisdiction && s.at > now - SERIES_DAYS * 86_400
    ) ?? null
  );
}

export interface Draft {
  date: string;
  asks: string[];
  /** Counts of the poster's own lines; a line left blank is not counted. */
  counts: { line: string; n: number }[];
}

export type Filed =
  | { ok: true; sent: Sent }
  | { ok: false; because: 'signed-out' }
  | { ok: false; because: 'today' }
  | { ok: false; because: 'series'; series: Sent }
  | { ok: false; because: 'not-sent'; detail: string };

/** Send a report. `series: true` is the operator having read the warning and chosen to send anyway. */
export async function fileReport(
  m: Mission,
  draft: Draft,
  visibility: Visibility,
  now: number,
  opts: { series?: boolean } = {},
  w: Wire = defaultWire
): Promise<Filed> {
  if (!signedOn()) return { ok: false, because: 'signed-out' };
  if (draft.date >= localDay(now)) return { ok: false, because: 'today' };
  const repeat = series(m, now);
  if (repeat && !opts.series) return { ok: false, because: 'series', series: repeat };

  const report: Report = {
    callsign: get<string>('accruing', 'callsign') ?? '',
    date: draft.date,
    mission: { address: m.address, asks: draft.asks, counts: draft.counts }
  };
  const contact = ensureContactKey();
  let id: string;
  let ok: boolean;
  try {
    if (visibility === 'open') {
      const e = buildReport(contact, report, now);
      id = e.id;
      ok = await w.publish(relays(), e);
    } else {
      const inbox = await inboxOf(m.publisher.pubkey, w);
      if (inbox.length === 0) {
        return { ok: false, because: 'not-sent', detail: `${m.publisher.name}'s inbox could not be found, so nothing was sent.` };
      }
      const sealed = buildSealedReport(contact, report, now);
      id = sealed.inner;
      ok = await w.publish(inbox, sealed.wrap);
    }
  } catch (err) {
    return { ok: false, because: 'not-sent', detail: err instanceof Error ? err.message : 'It could not be built.' };
  }
  if (!ok) return { ok: false, because: 'not-sent', detail: 'No relay took it. Nothing was sent; try again with signal.' };

  const s: Sent = {
    id,
    address: m.address,
    title: m.title,
    jurisdiction: m.placement.jurisdiction,
    poster: m.publisher.pubkey,
    date: draft.date,
    at: now,
    visibility
  };
  set('wipeable', SENT, [...sent(), s]);
  return { ok: true, sent: s };
}

/**
 * Ask for an open report to be withdrawn. Relays may honour it or not, and nothing recalls a copy
 * somebody already has — so it changes what is shared from now on, and the screen says exactly
 * that. A sealed report has already reached its poster, so it is not offered.
 */
export async function withdraw(id: string, now: number, w: Wire = defaultWire): Promise<boolean> {
  const s = sent().find((x) => x.id === id);
  if (!s || s.visibility !== 'open' || s.withdrawn) return false;
  const ok = await w.publish(relays(), buildDeletion(ensureContactKey(), id, KIND_REPORT, now));
  // Marked only once a relay took the request: "relays were asked" must be true when it is shown.
  if (ok) set('wipeable', SENT, sent().map((x) => (x.id === id ? { ...x, withdrawn: true } : x)));
  return ok;
}

/** Every relay a report or a label on one may be on: the poster's, and operators'. */
const everywhere = () => [...new Set([...MISSION_RELAYS, ...relays()])];

/**
 * The labels on these missions' reports, asked for **by mission, never by report**. Asking a relay
 * for the labels on a list of report ids tells it which reports this device cares about, and for
 * an operator's own that is as good as a name [docs/design/grid.md §1]. Every label on a report
 * names its mission too [spec §5.3], so the mission is enough, and the rest is sorted here.
 */
async function labelsOn(addresses: string[], w: Wire): Promise<Event[]> {
  if (addresses.length === 0) return [];
  try {
    return await w.query(everywhere(), { kinds: [KIND_LABEL], '#a': addresses, limit: LABELS_MAX });
  } catch {
    return [];
  }
}

/** The most labels read for one screen, and the most reports: a relay serving thousands is an attack, not a night. */
const LABELS_MAX = 1_000;
export const REPORTS_MAX = 200;

/**
 * What a contact key calls itself: the callsign on its report, or on its card. A key with neither
 * is shown by its first eight characters — a challenge is under a name, and that is the name it
 * gave [economy.md §8].
 */
export type Names = Map<string, string>;

async function namesOf(keys: string[], known: Names, w: Wire): Promise<Names> {
  const names = new Map(known);
  const unknown = [...new Set(keys)].filter((k) => !names.has(k) && !isHidden(k));
  if (unknown.length === 0) return names;
  let cards: Event[] = [];
  try {
    cards = await w.query(everywhere(), { kinds: [KIND_CARD], authors: unknown.slice(0, 100) });
  } catch {
    cards = [];
  }
  const newest = new Map<string, { at: number; callsign: string }>();
  for (const e of cards) {
    const c = readCard(e);
    if (!c || isHidden(c.contact)) continue;
    const was = newest.get(c.contact);
    if (!was || c.at > was.at) newest.set(c.contact, { at: c.at, callsign: c.card.callsign });
  }
  for (const [k, v] of newest) names.set(k, v.callsign);
  return names;
}

/** Where each of this device's reports stands, and the names of whoever settled or challenged them. */
export async function settlements(
  now: number,
  w: Wire = defaultWire
): Promise<{ standing: Map<string, Settlement>; names: Names }> {
  const mine = sent().filter((s) => !s.withdrawn);
  const me = contactPubkey();
  const standing = new Map<string, Settlement>();
  if (mine.length === 0 || !me) return { standing, names: new Map() };
  const labels = await labelsOn([...new Set(mine.map((s) => s.address))], w);
  for (const s of mine) standing.set(s.id, settlementOf({ id: s.id, author: me, at: s.at }, s.poster, labels, now));
  const keys = [...standing.values()].flatMap((x) => [...x.challengedBy, ...('by' in x ? [x.by] : [])]);
  return { standing, names: await namesOf(keys, new Map(), w) };
}

/** Somebody's report on a mission, as read: verified, and held to the mission's own words. */
export interface OnMission {
  id: string;
  author: string;
  /** Unix seconds: when it was sent, from which its seven days run. */
  at: number;
  report: Report;
}

export interface MissionReports {
  reports: OnMission[];
  labels: Event[];
  names: Names;
}

/**
 * The open reports on one mission, from every relay they may be on. Each is verified and read
 * against the mission, so an objective it does not have or a line its poster never wrote never
 * reaches a screen; one that tells of nothing this mission asked is not shown at all; and one its
 * author withdrew is not shown, whether or not a relay honoured the request.
 */
export async function reportsOn(m: Mission, w: Wire = defaultWire): Promise<MissionReports> {
  let raw: Event[] = [];
  try {
    raw = await w.query(everywhere(), { kinds: [KIND_REPORT], '#a': [m.address], limit: REPORTS_MAX });
  } catch {
    raw = [];
  }
  const byId = new Map<string, OnMission>();
  for (const e of raw) {
    if (byId.size >= REPORTS_MAX) break;
    if (byId.has(e.id)) continue;
    const read = readReport(e);
    if (!read || read.report.mission?.address !== m.address) continue;
    // A key navcom.app will not show [hidden.ts] is not shown here either: its report carries the same callsign.
    if (isHidden(read.author)) continue;
    const report = againstMission(read.report, m);
    if (!report.mission || report.mission.asks.length === 0) continue;
    byId.set(read.id, { id: read.id, author: read.author, at: read.at, report });
  }
  let reports = [...byId.values()];
  if (reports.length > 0) {
    let deletions: Event[] = [];
    try {
      deletions = await w.query(everywhere(), { kinds: [KIND_DELETION], '#e': reports.map((r) => r.id) });
    } catch {
      deletions = [];
    }
    const gone = withdrawnReports(reports, deletions);
    reports = reports.filter((r) => !gone.has(r.id));
  }
  reports.sort((a, b) => b.at - a.at);
  const labels = await labelsOn([m.address], w);
  const known: Names = new Map(reports.map((r) => [r.author, r.report.callsign]));
  known.set(m.publisher.pubkey, m.publisher.name);
  // This device's own label reads under its own callsign, card or no card.
  const me = contactPubkey();
  const callsign = get<string>('accruing', 'callsign');
  if (me && callsign) known.set(me, callsign);
  const keys = labels.map((l) => l.pubkey);
  return { reports, labels, names: await namesOf(keys, known, w) };
}

export type Labelled =
  | { ok: true; label: Event }
  | { ok: false; because: 'signed-out' | 'own' | 'not-there' | 'late' }
  | { ok: false; because: 'not-sent'; detail: string };

/**
 * Say, under this card, that you were there, or that you dispute somebody's report.
 *
 * A witness is somebody who was there [spec §5.3], and this device knows only whether it took part
 * in the mission — so that is what it asks; a hand-rolled client may witness anything, and the
 * reader names who did. A challenge may come from anybody, inside the seven days: a late one counts
 * for nothing, so it is not sent. Neither carries text: there is nothing to adjudicate.
 */
export async function labelReport(
  kind: 'witnessed' | 'challenged',
  r: OnMission,
  m: Mission,
  now: number,
  w: Wire = defaultWire
): Promise<Labelled> {
  if (!signedOn()) return { ok: false, because: 'signed-out' };
  if (r.author === contactPubkey()) return { ok: false, because: 'own' };
  if (kind === 'witnessed' && !tookPart(now).some((t) => t.mission.address === m.address)) {
    return { ok: false, because: 'not-there' };
  }
  if (kind === 'challenged' && now > r.at + CHALLENGE_WINDOW_SECONDS) return { ok: false, because: 'late' };
  const label = buildReportLabel(ensureContactKey(), kind, { id: r.id, mission: m.address }, now);
  if (!(await w.publish(relays(), label))) {
    return { ok: false, because: 'not-sent', detail: 'No relay took it. Nothing was sent; try again with signal.' };
  }
  return { ok: true, label };
}
