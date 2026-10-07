/**
 * A report: an operator's own account of their own work [kinds.ts, `KIND_REPORT`].
 *
 * **One kind, two uses.** On its own it is the recap Archangel asked for — a callsign, a day and
 * what kind of work. When it names a mission it is how that work is told to the poster: which of
 * the poster's objectives, and counts of what was handed out [interchange spec §5.2]. The mission
 * is optional, so a recap built to the earlier contract stays valid.
 *
 * **There is nowhere to put a description of a person** [no-free-text.test.ts]. The callsign is the
 * operator's own persona; work is named from a closed vocabulary; objectives by the poster's ids;
 * and a count answers one of the poster's own `effect` lines, verbatim — so the operator types
 * numbers and nothing else. A reader drops any count whose line the package does not carry.
 *
 * **No `g` tag, no `t` tags, no time of day** [docs/design/the-artifact-that-leaves.md P3]. A
 * region-indexed history of who worked where is the record NavCom refuses to build, and the date
 * is a day, never a time. Refused on read too, because a hand-rolled client never calls this
 * builder.
 *
 * **It can be sealed to the poster instead** [docs/design/missions.md §3]. Privacy must not cost
 * recognition: a sealed report still settles, and the poster's label names the sealed report's own
 * id, which tells nobody else who wrote it.
 */
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import { KIND_REPORT } from './kinds.js';
import { DOES, DOES_MAX } from './profile.js';
import { CALLSIGN_MAX, withinLimit } from '../limits.js';
import { isValidIsoDate } from '../directory/iso-date.js';
import { KIND_LABEL, MISSION_NAMESPACE } from '../missions/claim.js';
import { MISSION_PACKAGE_KIND, type Mission } from '../missions/package.js';
import { sealToPoster, type Sealed } from '../missions/seal.js';

/** The content's fields. Anything else is refused, never ignored. */
export const REPORT_FIELDS = ['callsign', 'date', 'does', 'region', 'counts', 'supersedes'] as const;
/** Objectives one report may name. */
export const ASKS_MAX = 16;
/** Count lines one report may carry. */
export const COUNTS_MAX = 8;
/** The most one count may say. A guard against a typo, not a judgement of anybody's night. */
export const COUNT_MAX = 100_000;
/** How long a poster's `effect` line may be, and so how long a counted line may be. */
export const LINE_MAX = 200;

const EVENT_ID = /^[0-9a-f]{64}$/;
const REGION = /^[a-z0-9-]{1,64}$/;
const MISSION_ADDRESS = new RegExp(`^${MISSION_PACKAGE_KIND}:([0-9a-f]{64}):\\S{1,256}$`);
const ASK_ID = /^\S{1,200}$/;
const DOES_IDS = new Set(DOES.map((d) => d.id));

export interface ReportCount {
  /** One of the poster's `effect` lines, verbatim. */
  line: string;
  n: number;
}

export interface Report {
  callsign: string;
  /** The day the work was done, `YYYY-MM-DD`. A day, never a time. */
  date: string;
  /** What kind of work, from the card's closed vocabulary. Required on a recap; at most three. */
  does?: string[];
  /** A region slug, carried in the content and never as a tag. A recap's only; a mission names its own place. */
  region?: string;
  /** The mission this tells of, and what of it was done. */
  mission?: { address: string; asks: string[]; counts: ReportCount[] };
  /** The report this one corrects. Never edits it: both stay, and this one reads as the current account. */
  supersedes?: string;
}

export class ReportError extends Error {}

/** The poster of a mission, from its address: the pubkey between the kind and the `d`. */
export function posterOf(missionAddress: string): string | null {
  return MISSION_ADDRESS.exec(missionAddress)?.[1] ?? null;
}

function checkReport(r: Report, createdAt: number): { content: string; tags: string[][] } {
  if (!withinLimit(r.callsign, CALLSIGN_MAX)) throw new ReportError('A report needs a callsign.');
  if (!isValidIsoDate(r.date)) throw new ReportError('A report needs the day the work was done.');
  const latest = new Date((createdAt + 86_400) * 1000).toISOString().slice(0, 10);
  if (r.date > latest) throw new ReportError('A report cannot tell of a day that has not happened.');
  const does = r.does ?? [];
  if (does.length > DOES_MAX) throw new ReportError(`Name at most ${DOES_MAX} kinds of work.`);
  if (!does.every((d) => DOES_IDS.has(d))) throw new ReportError('That is not a kind of work this can name.');
  if (r.supersedes !== undefined && !EVENT_ID.test(r.supersedes)) {
    throw new ReportError('What this corrects has to be an event id.');
  }

  const content: Record<string, unknown> = { callsign: r.callsign.trim(), date: r.date };
  if (does.length > 0) content['does'] = does;
  if (r.supersedes) content['supersedes'] = r.supersedes;
  const tags: string[][] = [];

  if (r.mission) {
    if (r.region !== undefined) throw new ReportError('A mission report takes its place from the mission.');
    if (!MISSION_ADDRESS.test(r.mission.address)) throw new ReportError('That is not a mission this can name.');
    const asks = r.mission.asks;
    if (asks.length === 0) throw new ReportError('Say which of the mission’s objectives you did.');
    if (asks.length > ASKS_MAX || !asks.every((a) => ASK_ID.test(a))) {
      throw new ReportError('Those are not the mission’s objectives.');
    }
    const counts = r.mission.counts;
    if (counts.length > COUNTS_MAX) throw new ReportError(`Count at most ${COUNTS_MAX} things.`);
    for (const c of counts) {
      if (!withinLimit(c.line, LINE_MAX)) throw new ReportError('A count answers one of the poster’s lines.');
      if (!Number.isInteger(c.n) || c.n < 0 || c.n > COUNT_MAX) throw new ReportError('A count is a whole number.');
    }
    if (counts.length > 0) content['counts'] = counts.map((c) => ({ line: c.line, n: c.n }));
    tags.push(['a', r.mission.address], ...[...new Set(asks)].map((a) => ['ask', a]));
  } else {
    if (does.length === 0) throw new ReportError('Say what kind of work it was.');
    if (r.region !== undefined) {
      if (!REGION.test(r.region)) throw new ReportError('That is not a region.');
      content['region'] = r.region;
    }
  }
  return { content: JSON.stringify(content), tags };
}

/** In the open: signed by the contact key, which signed the operator's card. */
export function buildReport(contactSecret: Uint8Array, r: Report, createdAt: number): Event {
  const { content, tags } = checkReport(r, createdAt);
  return finalizeEvent({ kind: KIND_REPORT, created_at: createdAt, content, tags }, contactSecret);
}

/**
 * For the poster alone: the same report, sealed to the poster the mission names. A recap has no
 * poster, so only a mission report can be sealed.
 */
export function buildSealedReport(contactSecret: Uint8Array, r: Report, createdAt: number): Sealed {
  const poster = r.mission ? posterOf(r.mission.address) : null;
  if (!poster) throw new ReportError('Only a mission report can be sealed, to the mission’s poster.');
  const { content, tags } = checkReport(r, createdAt);
  return sealToPoster(contactSecret, poster, { kind: KIND_REPORT, created_at: createdAt, content, tags });
}

export interface PublishedReport {
  id: string;
  author: string;
  report: Report;
  at: number;
}

/**
 * Read a report a relay served, or one opened from a seal (`signed: false`, since a sealed report
 * is a rumor and its proof is the seal around it). Null for anything malformed or carrying a field
 * or tag the contract does not have — refused, never trimmed.
 */
export function readReport(event: unknown, opts: { signed?: boolean } = {}): PublishedReport | null {
  const e = event as Partial<Event> | null;
  if (!e || e.kind !== KIND_REPORT || typeof e.content !== 'string' || !Array.isArray(e.tags)) return null;
  if (typeof e.id !== 'string' || typeof e.pubkey !== 'string' || typeof e.created_at !== 'number') return null;
  if (opts.signed !== false) {
    const own = {
      id: e.id, pubkey: e.pubkey, created_at: e.created_at, kind: e.kind,
      tags: e.tags, content: e.content, sig: e.sig!
    } as Event;
    if (!verifyEvent(own)) return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(e.content);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  for (const key of Object.keys(c)) if (!(REPORT_FIELDS as readonly string[]).includes(key)) return null;
  for (const t of e.tags) if (t[0] !== 'a' && t[0] !== 'ask') return null;

  const a = e.tags.filter((t) => t[0] === 'a').map((t) => t[1] ?? '');
  const asks = e.tags.filter((t) => t[0] === 'ask').map((t) => t[1] ?? '');
  const report: Report = {
    callsign: typeof c.callsign === 'string' ? c.callsign : '',
    date: typeof c.date === 'string' ? c.date : ''
  };
  if (c.does !== undefined) {
    if (!Array.isArray(c.does) || !c.does.every((d) => typeof d === 'string')) return null;
    report.does = c.does as string[];
  }
  if (c.region !== undefined) {
    if (typeof c.region !== 'string') return null;
    report.region = c.region;
  }
  if (c.supersedes !== undefined) {
    if (typeof c.supersedes !== 'string') return null;
    report.supersedes = c.supersedes;
  }
  if (a.length > 1) return null;
  if (a.length === 1) {
    const counts = c.counts === undefined ? [] : c.counts;
    if (!Array.isArray(counts)) return null;
    if (!counts.every((x) => x && typeof x === 'object' && typeof x.line === 'string' && typeof x.n === 'number')) return null;
    report.mission = { address: a[0]!, asks, counts: counts.map((x) => ({ line: x.line, n: x.n })) };
  } else if (asks.length > 0 || c.counts !== undefined) {
    return null;
  }
  // The same rules the builder keeps, applied to whatever a relay served.
  try {
    checkReport(report, e.created_at);
  } catch {
    return null;
  }
  return { id: e.id, author: e.pubkey, report, at: e.created_at };
}

/**
 * A report read against the mission it names: objectives the mission does not have, and counts
 * of lines the poster never wrote, are dropped. Whatever survives is the poster's own words.
 */
export function againstMission(r: Report, mission: Mission): Report {
  if (!r.mission || r.mission.address !== mission.address) return { ...r, mission: undefined };
  const objectives = new Set(mission.objectives.map((o) => o.id));
  const lines = new Set(mission.effect);
  return {
    ...r,
    mission: {
      address: r.mission.address,
      asks: r.mission.asks.filter((a) => objectives.has(a)),
      counts: r.mission.counts.filter((c) => lines.has(c.line))
    }
  };
}

/** The seven days a report waits for a challenge before it settles by itself [spec §5.3]. */
export const CHALLENGE_WINDOW_SECONDS = 7 * 86_400;

export type Settlement =
  | { state: 'pending'; until: number; challengedBy: string[] }
  | { state: 'settled'; how: 'poster' | 'witness' | 'silence'; at: number; challengedBy: string[] };

/**
 * Where a report stands, from the labels on it [spec §5.3]. **Nothing here adjudicates:** a
 * challenge reverses nothing, and both it and the settlement are shown for the reader to weigh.
 *
 * - `settled` counts only from the mission's poster; `witnessed` from anybody but the reporter.
 *   The first of either settles it, and says how
 * - With neither, it settles by silence once seven days have passed
 * - `challenged` counts from anybody but the reporter, inside the seven days, by their own key
 */
export function settlementOf(
  report: { id: string; author: string; at: number },
  poster: string,
  labels: readonly unknown[],
  now: number
): Settlement {
  const until = report.at + CHALLENGE_WINDOW_SECONDS;
  let settled: { how: 'poster' | 'witness'; at: number } | null = null;
  const challengedBy: string[] = [];
  for (const raw of labels) {
    const l = raw as Partial<Event> | null;
    if (!l || l.kind !== KIND_LABEL || !Array.isArray(l.tags) || typeof l.pubkey !== 'string') continue;
    const own = {
      id: l.id!, pubkey: l.pubkey, created_at: l.created_at!, kind: l.kind,
      tags: l.tags, content: l.content!, sig: l.sig!
    } as Event;
    if (!verifyEvent(own)) continue;
    if (!l.tags.some((t) => t[0] === 'L' && t[1] === MISSION_NAMESPACE)) continue;
    if (!l.tags.some((t) => t[0] === 'e' && t[1] === report.id)) continue;
    const kind = l.tags.find((t) => t[0] === 'l' && t[2] === MISSION_NAMESPACE)?.[1];
    const at = l.created_at!;
    if (kind === 'settled' && l.pubkey === poster) {
      if (!settled || at < settled.at) settled = { how: 'poster', at };
    } else if (kind === 'witnessed' && l.pubkey !== report.author) {
      if (!settled || at < settled.at) settled = { how: 'witness', at };
    } else if (kind === 'challenged' && l.pubkey !== report.author && at <= until) {
      if (!challengedBy.includes(l.pubkey)) challengedBy.push(l.pubkey);
    }
  }
  if (settled) return { state: 'settled', how: settled.how, at: settled.at, challengedBy };
  if (now >= until) return { state: 'settled', how: 'silence', at: until, challengedBy };
  return { state: 'pending', until, challengedBy };
}
