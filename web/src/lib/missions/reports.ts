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
  KIND_LABEL,
  KIND_REPORT,
  MISSION_RELAYS,
  buildDeletion,
  buildReport,
  buildSealedReport,
  settlementOf,
  type Mission,
  type Report,
  type Settlement
} from '@navcom/core';
import { get, set } from '$lib/terminal/storage';
import { contactPubkey, ensureContactKey } from '$lib/terminal/card';
import { relays } from '$lib/terminal/relays';
import { inboxOf, signedOn, wire as defaultWire, type Visibility, type Wire } from './claims';

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

/**
 * Where each report stands. The poster's labels are on The Record and its mirror; a witness's or a
 * challenger's are on operators' relays — so both are read.
 */
export async function settlements(now: number, w: Wire = defaultWire): Promise<Map<string, Settlement>> {
  const mine = sent().filter((s) => !s.withdrawn);
  const me = contactPubkey();
  const out = new Map<string, Settlement>();
  if (mine.length === 0 || !me) return out;
  const urls = [...new Set([...MISSION_RELAYS, ...relays()])];
  let labels: Event[] = [];
  try {
    labels = await w.query(urls, { kinds: [KIND_LABEL], '#e': mine.map((s) => s.id) });
  } catch {
    labels = [];
  }
  for (const s of mine) out.set(s.id, settlementOf({ id: s.id, author: me, at: s.at }, s.poster, labels, now));
  return out;
}
