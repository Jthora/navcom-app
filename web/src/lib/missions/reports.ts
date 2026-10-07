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
 *
 * **What nobody answered is never read as nothing** [11.E]. Where a report stands is computed only
 * when the relays that hold its labels answered; otherwise it is unknown, and said so.
 */
import type { Event } from 'nostr-tools/core';
import {
  CHALLENGE_WINDOW_SECONDS,
  FUTURE_TOLERANCE_DAYS,
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
import { isHidden } from '$lib/hidden';
import {
  inboxOf,
  noInbox,
  operatorRelays,
  signedOn,
  tookPart,
  usable,
  wire as defaultWire,
  type TookPart,
  type Visibility,
  type Wire
} from './claims';

const SENT = 'mission_reports';
/** The window inside which a second report in one place is warned about. */
export const SERIES_DAYS = 7;
/** How many days back a report may tell of. */
export const REPORT_DAYS = 7;

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
  /** Where it went, so a withdrawal goes there too [11.E]. Absent on reports sent before. */
  relays?: string[];
  /** The key that signed it: a card withdrawn since cannot sign its withdrawal [11.E]. */
  signer?: string;
  /** How it settled, once that can no longer change: kept, so it is not asked for again. */
  final?: Settlement;
}

/** What this device has sent. */
export function sent(): Sent[] {
  return get<Sent[]>('wipeable', SENT) ?? [];
}

const dayOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** `YYYY-MM-DD` for a moment, in this device's own day. */
export function localDay(unixSeconds: number): string {
  return dayOf(new Date(unixSeconds * 1000));
}

/**
 * The days a report may tell of: yesterday and the six before it, never today — and, for a mission,
 * only days from when this device took part until the mission ended [11.X].
 *
 * Stepped by calendar day, at noon. Stepping back 24 hours at a time gave the same day twice after
 * the clocks went back, and skipped one after they went forward — and a list keyed by day threw on
 * the repeat, so the report screen could not open for an hour on six nights a year [11.X].
 */
export function reportableDays(now: number, mission?: TookPart): string[] {
  const today = new Date(now * 1000);
  const days: string[] = [];
  for (let k = 1; k <= REPORT_DAYS; k++) {
    days.push(dayOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() - k, 12)));
  }
  if (!mission) return days;
  const from = localDay(mission.since);
  const until = localDay(mission.mission.validUntil);
  return days.filter((d) => d >= from && d <= until);
}

/**
 * Whether a mission taken part in is still one to report: its last day is inside the week a report
 * may tell of, or it was taken part in today and its first reportable day is tomorrow [11.X].
 */
export function stillToReport(now: number, t: TookPart): 'now' | 'tomorrow' | null {
  if (reportableDays(now, t).length > 0) return 'now';
  return localDay(t.since) >= localDay(now) && t.mission.validUntil > now ? 'tomorrow' : null;
}

/**
 * A report sent for the same place inside the window, if there is one. A mission with no
 * jurisdiction is compared by itself, so the warning never goes quiet where placement is finest [11.X].
 */
export function series(m: Mission, now: number): Sent | null {
  const same = (s: Sent) => (m.placement.jurisdiction ? s.jurisdiction === m.placement.jurisdiction : s.address === m.address);
  return sent().find((s) => !s.withdrawn && same(s) && s.at > now - SERIES_DAYS * 86_400) ?? null;
}

export interface Draft {
  date: string;
  asks: string[];
  /** Counts of the poster's own lines; a line left blank is not counted. */
  counts: { line: string; n: number }[];
}

export type Filed =
  | { ok: true; sent: Sent; kept: boolean }
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
  let to: string[];
  try {
    if (visibility === 'open') {
      const e = buildReport(contact, report, now);
      id = e.id;
      to = operatorRelays();
      if (!(await w.publish(to, e))) return { ok: false, because: 'not-sent', detail: 'No relay took it. Nothing was sent; try again with signal.' };
    } else {
      const inbox = await inboxOf(m.publisher.pubkey, w);
      if (inbox.urls.length === 0) return { ok: false, because: 'not-sent', detail: noInbox(m.publisher.name, inbox) };
      const sealed = buildSealedReport(contact, report, now);
      id = sealed.inner;
      to = inbox.urls;
      if (!(await w.publish(to, sealed.wrap))) {
        return { ok: false, because: 'not-sent', detail: `${m.publisher.name}'s inbox did not take it. Nothing was sent.` };
      }
    }
  } catch (err) {
    return { ok: false, because: 'not-sent', detail: err instanceof Error ? err.message : 'It could not be built.' };
  }

  const s: Sent = {
    id,
    address: m.address,
    title: m.title,
    jurisdiction: m.placement.jurisdiction,
    poster: m.publisher.pubkey,
    date: draft.date,
    at: now,
    visibility,
    relays: to,
    signer: contactPubkey() ?? undefined
  };
  // Sent either way; whether this device could also record it is said, never assumed [11.E].
  const kept = set('wipeable', SENT, [...sent(), s]);
  return { ok: true, sent: s, kept };
}

export type Withdrawal = 'asked' | 'unheard' | 'card' | 'not-open';

/**
 * Ask for an open report to be withdrawn. Relays may honour it or not, and nothing recalls a copy
 * somebody already has — so it changes what is shared from now on, and the screen says exactly
 * that. A sealed report has already reached its poster, so it is not offered. A report signed by a
 * card this device no longer holds cannot be withdrawn from here: a relay drops an event only at
 * its own author's request, and that key is gone [11.E].
 */
export async function withdraw(id: string, now: number, w: Wire = defaultWire): Promise<Withdrawal> {
  const s = sent().find((x) => x.id === id);
  if (!s || s.visibility !== 'open' || s.withdrawn) return 'not-open';
  if (s.signer && s.signer !== contactPubkey()) return 'card';
  const ok = await w.publish(usable([...(s.relays ?? []), ...operatorRelays()]), buildDeletion(ensureContactKey(), id, KIND_REPORT, now));
  // Marked only once a relay took the request: "relays were asked" must be true when it is shown.
  if (ok) set('wipeable', SENT, sent().map((x) => (x.id === id ? { ...x, withdrawn: true } : x)));
  return ok ? 'asked' : 'unheard';
}

/** Every relay a report or a label on one may be on: the poster's, and operators'. */
const everywhere = () => usable([...MISSION_RELAYS, ...operatorRelays()]);

/** Whether a relay that holds each kind of label answered: the poster's on The Record and its mirror, everyone else's on operators'. */
export interface Answered {
  poster: boolean;
  operators: boolean;
}
const heardFrom = (answered: string[]): Answered => {
  const mission = new Set(usable(MISSION_RELAYS));
  const operators = new Set(operatorRelays());
  return { poster: answered.some((u) => mission.has(u)), operators: answered.some((u) => operators.has(u)) };
};

/** The most labels read for one screen, and the most reports: a relay serving thousands is an attack, not a night. */
const LABELS_MAX = 1_000;
export const REPORTS_MAX = 200;
/** The three words a label on a report can say: asked for by name, so a mission's claims do not crowd them out [11.R]. */
const ON_A_REPORT = ['settled', 'witnessed', 'challenged'];

/**
 * The labels on these missions' reports, asked for **by mission, never by report**. Asking a relay
 * for the labels on a list of report ids tells it which reports this device cares about, and for
 * an operator's own that is as good as a name [docs/design/grid.md §1]. Every label on a report
 * names its mission too [spec §5.3], so the mission is enough, and the rest is sorted here.
 */
async function labelsOn(addresses: string[], w: Wire): Promise<{ labels: Event[]; answered: Answered; partial: boolean }> {
  if (addresses.length === 0) return { labels: [], answered: { poster: true, operators: true }, partial: false };
  try {
    const { events, answered } = await w.query(everywhere(), {
      kinds: [KIND_LABEL],
      '#a': addresses,
      '#l': ON_A_REPORT,
      limit: LABELS_MAX
    });
    return { labels: events, answered: heardFrom(answered), partial: events.length >= LABELS_MAX };
  } catch {
    return { labels: [], answered: { poster: false, operators: false }, partial: false };
  }
}

/**
 * What a contact key calls itself: the callsign on its report, or on its card. Self-chosen, so a
 * screen shows it beside the key's own first characters — anybody may call themselves anything,
 * including the poster's name [11.R].
 */
export type Names = Map<string, string>;

async function namesOf(keys: string[], known: Names, w: Wire): Promise<Names> {
  const names = new Map(known);
  const unknown = [...new Set(keys)].filter((k) => !names.has(k) && !isHidden(k));
  if (unknown.length === 0) return names;
  let cards: Event[] = [];
  try {
    cards = (await w.query(everywhere(), { kinds: [KIND_CARD], authors: unknown.slice(0, 100) })).events;
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

const keysIn = (standing: Map<string, Settlement>) =>
  [...standing.values()].flatMap((x) => [...x.challengedBy, ...('by' in x ? [x.by] : [])]);

/**
 * Where each of this device's reports stands, and the names of whoever settled or challenged
 * them. A report whose seven days are over keeps how it settled, so it is not asked for again; one
 * still open is read, and is unknown — never "waiting", never "settled" — when the relays that
 * would hold its labels did not answer.
 */
export async function settlements(
  now: number,
  w: Wire = defaultWire
): Promise<{ standing: Map<string, Settlement>; names: Names; answered: Answered }> {
  const mine = sent().filter((s) => !s.withdrawn);
  const me = contactPubkey();
  const standing = new Map<string, Settlement>();
  for (const s of mine) if (s.final) standing.set(s.id, s.final);
  const open = mine.filter((s) => !s.final);
  if (open.length === 0 || !me) {
    return { standing, names: await namesOf(keysIn(standing), new Map(), w), answered: { poster: true, operators: true } };
  }

  const { labels, answered } = await labelsOn([...new Set(open.map((s) => s.address))], w);
  if (answered.poster && answered.operators) {
    const final = new Map<string, Settlement>();
    for (const s of open) {
      const st = settlementOf({ id: s.id, author: s.signer ?? me, at: s.at }, s.poster, labels, now);
      standing.set(s.id, st);
      if (st.state === 'settled' && now >= s.at + CHALLENGE_WINDOW_SECONDS) final.set(s.id, st);
    }
    if (final.size > 0) set('wipeable', SENT, sent().map((x) => (final.has(x.id) ? { ...x, final: final.get(x.id) } : x)));
  }
  return { standing, names: await namesOf(keysIn(standing), new Map(), w), answered };
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
  /** Which relays answered: a list read from none of them is not an empty list. */
  answered: Answered;
  /** A relay sent as many as were asked for: there may be more than are shown. */
  partial: boolean;
}

/**
 * The open reports on one mission, from every relay they may be on. Each is verified and read
 * against the mission, so an objective it does not have or a line its poster never wrote never
 * reaches a screen; one that tells of nothing this mission asked is not shown at all; one dated
 * more than a day past this device's clock is not shown; and one its author withdrew is not shown,
 * whether or not a relay honoured the request.
 */
export async function reportsOn(m: Mission, now: number, w: Wire = defaultWire): Promise<MissionReports> {
  let raw: Event[] = [];
  let answered: string[] = [];
  try {
    ({ events: raw, answered } = await w.query(everywhere(), { kinds: [KIND_REPORT], '#a': [m.address], limit: REPORTS_MAX }));
  } catch {
    raw = [];
  }
  const latest = now + FUTURE_TOLERANCE_DAYS * 86_400;
  const byId = new Map<string, OnMission>();
  for (const e of raw) {
    if (byId.size >= REPORTS_MAX) break;
    if (byId.has(e.id)) continue;
    const read = readReport(e);
    if (!read || read.report.mission?.address !== m.address || read.at > latest) continue;
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
      deletions = (await w.query(everywhere(), { kinds: [KIND_DELETION], '#e': reports.map((r) => r.id) })).events;
    } catch {
      deletions = [];
    }
    const gone = withdrawnReports(reports, deletions);
    reports = reports.filter((r) => !gone.has(r.id));
  }
  reports.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  const labelled = await labelsOn([m.address], w);
  const known: Names = new Map(reports.map((r) => [r.author, r.report.callsign]));
  known.set(m.publisher.pubkey, m.publisher.name);
  // This device's own label reads under its own callsign, card or no card.
  const me = contactPubkey();
  const callsign = get<string>('accruing', 'callsign');
  if (me && callsign) known.set(me, callsign);
  const heard = heardFrom(answered);
  return {
    reports,
    labels: labelled.labels,
    names: await namesOf(labelled.labels.map((l) => l.pubkey), known, w),
    answered: { poster: heard.poster && labelled.answered.poster, operators: heard.operators && labelled.answered.operators },
    partial: raw.length >= REPORTS_MAX || labelled.partial
  };
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
 * reader names who did. A challenge may come from anybody, before the seven days are up: a late one
 * counts for nothing, so it is not sent. Neither carries text: there is nothing to adjudicate.
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
  if (kind === 'challenged' && now >= r.at + CHALLENGE_WINDOW_SECONDS) return { ok: false, because: 'late' };
  const label = buildReportLabel(ensureContactKey(), kind, { id: r.id, mission: m.address }, now);
  if (!(await w.publish(operatorRelays(), label))) {
    return { ok: false, because: 'not-sent', detail: 'No relay took it. Nothing was sent; try again with signal.' };
  }
  return { ok: true, label };
}
