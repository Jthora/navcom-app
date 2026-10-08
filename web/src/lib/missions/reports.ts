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
 * state, a date, again and again, is a series somebody can read; the operator decides. Only what
 * anybody can read makes a series: an open report, against this device's open reports. One that
 * was withdrawn still counts — relays were asked to drop it, and copies already taken stay.
 *
 * **A day is reported once.** A day already reported on a mission, and not withdrawn, is not
 * offered again: the same day's work sent twice counts twice wherever settled reports are counted.
 *
 * What was sent is listed here, Wipeable, so it can be seen and withdrawn — a list of what left,
 * never a count of it [C20].
 *
 * **What nobody answered is never read as nothing** [11.E]. Where a report stands is computed only
 * when the relays that hold its labels answered; otherwise it is unknown, and said so.
 */
import type { Event } from 'nostr-tools/core';
import type { Filter } from 'nostr-tools/filter';
import {
  CHALLENGE_WINDOW_SECONDS,
  DEFAULT_RELAYS,
  FUTURE_TOLERANCE_DAYS,
  KIND_CARD,
  KIND_DELETION,
  KIND_LABEL,
  KIND_REPORT,
  MISSION_RELAYS,
  THE_RECORD,
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
  type Published,
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
  /**
   * Set beside `final` when the read it came from heard every relay that holds its labels. A
   * `final` without it was kept by an earlier version — perhaps from no answer at all, which that
   * version read as silence — and is cleared and read again [audit 11, second grid].
   */
  finalWhole?: true;
  /**
   * The signed event, while no relay has confirmed it — for a sealed report, the wrap [audit 11.S,
   * finding 61]. It may have arrived, so it is listed and can be withdrawn like any report, and
   * sending it again sends this same event: one report of the day's work, never two.
   */
  unconfirmed?: Event;
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

/** The days this device reported on a mission and has not withdrawn — one no relay confirmed included, since it may have arrived. */
function reportedDays(address: string): Set<string> {
  return new Set(sent().filter((s) => s.address === address && !s.withdrawn).map((s) => s.date));
}

/**
 * The days a report may tell of: yesterday and the six before it, never today — and, for a mission,
 * only days from when this device took part until the mission ended [11.X], and none it has already
 * reported. A day reported was offered again with nothing to say so, and the same work was sent
 * twice [audit 11.S, finding 52].
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
  const reported = reportedDays(mission.mission.address);
  return days.filter((d) => d >= from && d <= until && !reported.has(d));
}

/**
 * Whether a mission taken part in is still one to report: it has a day inside the week a report
 * may tell of that is not reported yet, or **today is a day the work could be**, which tomorrow is
 * one to report [11.X] — whether or not it has ended since. One taken part in at six and ended at
 * ten went from every screen until midnight, and the panel said there was nothing to report
 * [audit 11.S]. One whose every day is reported is not: "report the work" never emptied
 * [audit 11.S, finding 52].
 *
 * Today counts whenever she first took part, not only when that was today: with yesterday
 * reported, a mission she is still working went from every screen until midnight, and the report
 * screen said every day was reported [audit 11.S, finding 52 — review].
 */
export function stillToReport(now: number, t: TookPart): 'now' | 'tomorrow' | null {
  if (reportableDays(now, t).length > 0) return 'now';
  const today = localDay(now);
  return localDay(t.since) >= today || today <= localDay(t.mission.validUntil) ? 'tomorrow' : null;
}

/**
 * An open report sent for the same place inside the window, if there is one. A mission with no
 * jurisdiction is compared by itself, so the warning never goes quiet where placement is finest [11.X].
 *
 * Withdrawn ones included: the screen that withdraws one says copies already taken stay, and a
 * series somebody already copied is still a series [audit 11, second grid]. Sealed ones are not:
 * only the poster can read one, so it makes no pattern anybody else can — and the warning is asked
 * only of a new open report, for the same reason. Fired after she had already chosen the sealed
 * report, it taught her to tap "Send anyway" [audit 11.S, finding 57].
 *
 * **The one given is still up if any is**, and otherwise the newest: the screen says "you withdrew
 * the last one" of a withdrawn one, and given the oldest, it said so while the newest was live on
 * every relay [audit 11.S, findings 50 and 73 — review].
 */
export function series(m: Mission, now: number): Sent | null {
  const same = (s: Sent) => (m.placement.jurisdiction ? s.jurisdiction === m.placement.jurisdiction : s.address === m.address);
  const near = sent().filter((s) => s.visibility === 'open' && same(s) && s.at > now - SERIES_DAYS * 86_400);
  return near.filter((s) => !s.withdrawn).at(-1) ?? near.at(-1) ?? null;
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
  | { ok: false; because: 'reported'; sent: Sent }
  | { ok: false; because: 'series'; series: Sent }
  | { ok: false; because: 'not-sent'; detail: string }
  /** No relay confirmed it, and it may have arrived: listed, to send again or withdraw [audit 11.S]. */
  | { ok: false; because: 'unconfirmed'; sent: Sent; kept: boolean };

/** A report a relay has now confirmed: nothing left to send again. */
const confirmed = ({ unconfirmed: _event, ...s }: Sent): Sent => s;

/**
 * Send a report. `series: true` is the operator having read the warning and chosen to send anyway.
 *
 * **Recorded before it is sent**, and kept unless every relay refused it: a relay on a congested
 * cell takes it and answers after the wait is over, and "Nothing was sent" then sent the same work
 * twice, the first copy one nobody could withdraw [audit 11.S, finding 61]. That is a record of
 * what may have left, not a queue: nothing here sends it again unless she does.
 */
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
  const already = sent().find((s) => s.address === m.address && s.date === draft.date && !s.withdrawn);
  if (already) return { ok: false, because: 'reported', sent: already };
  const repeat = visibility === 'open' ? series(m, now) : null;
  if (repeat && !opts.series) return { ok: false, because: 'series', series: repeat };

  const report: Report = {
    callsign: get<string>('accruing', 'callsign') ?? '',
    date: draft.date,
    mission: { address: m.address, asks: draft.asks, counts: draft.counts }
  };
  const contact = ensureContactKey();
  let id: string;
  let to: string[];
  let event: Event;
  let refused: string;
  try {
    if (visibility === 'open') {
      event = buildReport(contact, report, now);
      id = event.id;
      to = operatorRelays();
      refused = 'No relay took it. Nothing was sent; try again with signal.';
    } else {
      const inbox = await inboxOf(m.publisher.pubkey, w);
      if (inbox.urls.length === 0) return { ok: false, because: 'not-sent', detail: noInbox(m.publisher.name, inbox) };
      const sealed = buildSealedReport(contact, report, now);
      id = sealed.inner;
      event = sealed.wrap;
      to = inbox.urls;
      refused = `${m.publisher.name}'s inbox did not take it. Nothing was sent.`;
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
    signer: contactPubkey() ?? undefined,
    unconfirmed: event
  };
  // Whether this device could also record it is said, never assumed [11.E].
  const recorded = set('wipeable', SENT, [...sent(), s]);
  const result = await w.publish(to, event);
  if (result === 'refused') {
    if (recorded) set('wipeable', SENT, sent().filter((x) => x.id !== id));
    return { ok: false, because: 'not-sent', detail: refused };
  }
  if (result === 'unconfirmed') return { ok: false, because: 'unconfirmed', sent: s, kept: recorded };
  const list = sent();
  const kept = set('wipeable', SENT, list.some((x) => x.id === id) ? list.map((x) => (x.id === id ? confirmed(x) : x)) : [...list, confirmed(s)]);
  return { ok: true, sent: confirmed(s), kept: recorded && kept };
}

/**
 * Send again a report no relay confirmed: **the same signed event**, so one that did arrive is
 * never joined by a second report of the same work [audit 11.S, finding 61]. Given the report as
 * the screen holds it, so one this device could not record can still be sent again from there. It
 * stays listed whatever comes back: a relay refusing it now says nothing about the first time.
 */
export async function reportAgain(r: Sent, w: Wire = defaultWire): Promise<Published | 'gone'> {
  const s = sent().find((x) => x.id === r.id) ?? r;
  if (!s.unconfirmed || s.withdrawn) return 'gone';
  const result = await w.publish(usable(s.relays ?? operatorRelays()), s.unconfirmed);
  if (result === 'took') set('wipeable', SENT, sent().map((x) => (x.id === s.id ? confirmed(x) : x)));
  return result;
}

export type Withdrawal = 'asked' | 'unheard' | 'unconfirmed' | 'card' | 'not-open';

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
  const result = await w.publish(usable([...(s.relays ?? []), ...operatorRelays()]), buildDeletion(ensureContactKey(), id, KIND_REPORT, now));
  // Marked only once a relay took the request: "relays were asked" must be true when it is shown.
  // A withdrawn report is not sent again, so what was kept to send it goes too.
  if (result === 'took') set('wipeable', SENT, sent().map((x) => (x.id === id ? { ...confirmed(x), withdrawn: true } : x)));
  return result === 'took' ? 'asked' : result === 'unconfirmed' ? 'unconfirmed' : 'unheard';
}

/** Every relay a report or a label on one may be on: the poster's, and operators'. */
const everywhere = () => usable([...MISSION_RELAYS, ...operatorRelays()]);

/** Whether a relay that holds each kind of label answered: the poster's on The Record and its mirror, everyone else's on operators'. */
export interface Answered {
  poster: boolean;
  operators: boolean;
}
/**
 * Where everybody's labels are: the poster's relays, and **the relays every operator writes to** —
 * the shipped ones [spec §5.0]. An operator's own relay, or a watch's, carries this device's traffic
 * and nobody else's, so its answer says nothing about a challenge: counted as one, it let a report
 * settle "unchallenged" while the relays holding the challenge were slow, and kept it so for good
 * [audit 11.S, finding 62].
 */
const posterRelays = () => usable(MISSION_RELAYS);
const everybodysRelays = () => usable(DEFAULT_RELAYS);
/**
 * Where the poster's labels are kept: The Record [spec §5.0]. Its mirror copies it and can fall
 * behind [core: package.ts], so the mirror's answer shows where a report stands, but only The
 * Record's makes a read whole for the poster's word. Requiring the mirror too made one person's Pi
 * a single point of failure for every verdict, and added nothing The Record does not hold
 * [audit 11.S, finding 62 — review].
 */
const recordRelay = () => usable([THE_RECORD]);
const heardFrom = (answered: string[]): Answered => {
  const got = new Set(answered);
  return { poster: posterRelays().some((u) => got.has(u)), operators: everybodysRelays().some((u) => got.has(u)) };
};

/** The most reports read for one screen: a relay serving thousands is an attack, not a night. */
export const REPORTS_MAX = 200;
/**
 * The most labels one read asks a relay for: the cap the default relays put on any one request
 * (strfry's `maxFilterLimit`), so a relay that cuts a request down still sends a full page, and a
 * full page reads as one. Asked for a thousand, such a relay sent five hundred and the read looked
 * whole — a poster's settlement or a challenge could be among those left out, and silence was kept
 * as how the report settled, for good [audit 11, second grid — review].
 */
export const LABELS_PAGE = 500;
/** Pages read on one mission before the rest is called partial: a relay serving thousands is an attack, not a night. */
export const LABELS_PAGES = 4;
/** Missions read at once: a relay lets one connection hold only so many requests open. */
const READS_AT_ONCE = 4;
/** The three words a label on a report can say: asked for by name, so a mission's claims do not crowd them out [11.R]. */
const ON_A_REPORT = ['settled', 'witnessed', 'challenged'];

/**
 * The labels on one mission's reports, asked for **by mission, never by report**. Asking a relay
 * for the labels on a list of report ids tells it which reports this device cares about, and for
 * an operator's own that is as good as a name [docs/design/grid.md §1]. Every label on a report
 * names its mission too [spec §5.3], so the mission is enough, and the rest is sorted here.
 *
 * **A page at a time, newest first.** A page as full as a relay will send may have left some out,
 * so the next starts where the fullest relay's could have stopped: a relay that cut its answer
 * short sent a whole page, so nothing it left out is newer than the page's own last place — not
 * the oldest label any relay sent, which a relay holding only old ones pulls back past all of it.
 * A page with fewer than that proves every relay sent all it had. After `LABELS_PAGES`, or a page
 * that brings nothing new, what is left is called partial — never read as nothing.
 *
 * `poster`, for a mission this device reported on only sealed, asks only for the poster's
 * settlements, and only The Record and its mirror. Nobody else knows a sealed report's id, so nobody
 * else can have labelled it; and the relays operators use carry this device's open traffic and may
 * hold the inbox the seal went to, so asking them would say which mission it was for, and whose
 * [audit 11, second grid — review].
 */
async function labelsOn(
  address: string,
  w: Wire,
  poster?: string
): Promise<{ labels: Event[]; answered: Answered; partial: boolean; whole: boolean }> {
  const urls = poster ? posterRelays() : everywhere();
  const filter: Filter = poster
    ? { kinds: [KIND_LABEL], authors: [poster], '#a': [address], '#l': ['settled'] }
    : { kinds: [KIND_LABEL], '#a': [address], '#l': ON_A_REPORT };
  // Every relay that holds a label this read asks for — The Record for the poster's, the shipped
  // relays for everybody else's: a verdict is kept only when all of them answered.
  const needed = poster ? recordRelay() : [...recordRelay(), ...everybodysRelays()];
  const got = new Map<string, Event>();
  let heard: Answered = { poster: true, operators: true };
  let whole = true;
  let until: number | undefined;
  for (let page = 0; page < LABELS_PAGES; page++) {
    let events: Event[];
    let answered: string[];
    try {
      ({ events, answered } = await w.query(urls, { ...filter, limit: LABELS_PAGE, ...(until === undefined ? {} : { until }) }));
    } catch {
      return { labels: [...got.values()], answered: { poster: false, operators: false }, partial: false, whole: false };
    }
    // A relay that did not answer one page left a hole in the whole read.
    const h = heardFrom(answered);
    heard = { poster: heard.poster && h.poster, operators: heard.operators && h.operators };
    whole &&= needed.every((u) => answered.includes(u));
    let fresh = 0;
    for (const e of events) {
      if (got.has(e.id)) continue;
      got.set(e.id, e);
      fresh += 1;
    }
    if (events.length < LABELS_PAGE) return { labels: [...got.values()], answered: heard, partial: false, whole };
    if (fresh === 0) break;
    until = events.map((e) => e.created_at).sort((a, b) => b - a)[LABELS_PAGE - 1];
  }
  return { labels: [...got.values()], answered: heard, partial: true, whole: false };
}

/** `f` over every item, `n` at a time. */
async function inTurn<T>(items: T[], n: number, f: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(n, queue.length) }, async () => {
      while (queue.length > 0) await f(queue.shift()!);
    })
  );
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
 * Whether a report is this device's own: signed by its card, or sent from here under a card
 * withdrawn since. Matching the current card alone forgot every report filed before a withdrawal —
 * they lost "yours", and this device was offered, and could send, a witness of its own work
 * [audit 11, second grid].
 */
export function isMine(r: { id: string; author: string }): boolean {
  if (r.author === contactPubkey()) return true;
  return sent().some((s) => s.id === r.id || s.signer === r.author);
}

/**
 * Where each of this device's reports stands, and the names of whoever settled or challenged
 * them. A report whose seven days are over keeps how it settled, so it is not asked for again; one
 * still open is read, and is unknown — never "waiting", never "settled" — when the relays that
 * would hold its labels did not answer, **or when more labels were on its mission than this reads**,
 * since the one that decides it may be among those left out. Nothing is kept from such a read.
 *
 * **A verdict is kept only from a read every relay holding its labels answered** — The Record, and
 * the shipped relays operators write to — all of them on every page: one that answered while
 * another was slow showed where the report stood, but froze whatever the slow one held out of it
 * for good [audit 11.S, finding 62]. One kept by an earlier version, which could not tell no
 * signal from silence, is cleared here and read again.
 *
 * A report no relay confirmed is not read: if it never arrived, seven days of silence would settle
 * a report no relay holds. Its screen says it is unconfirmed instead.
 *
 * **One read per mission.** Asked for together, one busy mission — a campaign's thousand
 * settlements, or a stranger's thousand labels, which cost nothing to sign — filled the answer and
 * left every report on every other mission unknown, for good [audit 11, second grid — review].
 *
 * Each report is read under the key that signed it, so a card withdrawn since changes nothing; only
 * one sent before signers were recorded needs the card this device holds now [audit 11, second grid].
 */
export async function settlements(
  now: number,
  w: Wire = defaultWire
): Promise<{
  standing: Map<string, Settlement>;
  names: Names;
  answered: Answered;
  /** Reports on a mission that had more labels than this reads: unknown, and not for want of signal. */
  partial: ReadonlySet<string>;
}> {
  // Kept before a verdict needed a whole read: perhaps from no answer at all [audit 11, second grid].
  if (sent().some((s) => s.final && !s.finalWhole)) {
    set('wipeable', SENT, sent().map(({ final, finalWhole, ...s }) => (final && finalWhole ? { ...s, final, finalWhole } : s)));
  }
  const mine = sent().filter((s) => !s.withdrawn && !s.unconfirmed);
  const me = contactPubkey();
  const standing = new Map<string, Settlement>();
  for (const s of mine) if (s.final) standing.set(s.id, s.final);
  const open = mine.filter((s) => !s.final && (s.signer ?? me));
  const answered: Answered = { poster: true, operators: true };
  const partial = new Set<string>();
  const byMission = new Map<string, Sent[]>();
  for (const s of open) byMission.set(s.address, [...(byMission.get(s.address) ?? []), s]);

  const final = new Map<string, Settlement>();
  await inTurn([...byMission], READS_AT_ONCE, async ([address, reports]) => {
    const sealed = reports.every((s) => s.visibility === 'sealed');
    const read = await labelsOn(address, w, sealed ? reports[0]!.poster : undefined);
    answered.poster &&= read.answered.poster;
    if (!sealed) answered.operators &&= read.answered.operators;
    if (read.partial) {
      for (const s of reports) partial.add(s.id);
      return;
    }
    if (!read.answered.poster || (!sealed && !read.answered.operators)) return;
    for (const s of reports) {
      const st = settlementOf({ id: s.id, author: (s.signer ?? me)!, at: s.at }, s.poster, read.labels, now);
      standing.set(s.id, st);
      if (read.whole && st.state === 'settled' && now >= s.at + CHALLENGE_WINDOW_SECONDS) final.set(s.id, st);
    }
  });
  if (final.size > 0) set('wipeable', SENT, sent().map((x) => (final.has(x.id) ? { ...x, final: final.get(x.id), finalWhole: true as const } : x)));
  return { standing, names: await namesOf(keysIn(standing), new Map(), w), answered, partial };
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
  const labelled = await labelsOn(m.address, w);
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
  /** No relay confirmed it: it may have arrived. A second statement from one card counts once [core: settlementOf], so sending it again is safe. */
  | { ok: false; because: 'unconfirmed' }
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
  if (isMine(r)) return { ok: false, because: 'own' };
  if (kind === 'witnessed' && !tookPart(now).some((t) => t.mission.address === m.address)) {
    return { ok: false, because: 'not-there' };
  }
  if (kind === 'challenged' && now >= r.at + CHALLENGE_WINDOW_SECONDS) return { ok: false, because: 'late' };
  const label = buildReportLabel(ensureContactKey(), kind, { id: r.id, mission: m.address }, now);
  const result = await w.publish(operatorRelays(), label);
  if (result === 'refused') return { ok: false, because: 'not-sent', detail: 'No relay took it. Nothing was sent; try again with signal.' };
  if (result === 'unconfirmed') return { ok: false, because: 'unconfirmed' };
  return { ok: true, label };
}
