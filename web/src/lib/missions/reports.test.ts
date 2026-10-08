import { beforeEach, describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import type { Filter } from 'nostr-tools/filter';
import { DEFAULT_RELAYS, KIND_LABEL, MISSION_RELAYS, THE_RECORD, buildDeletion, buildMissionClaim, buildReport, buildReportLabel, readMissionPackage, type Mission } from '@navcom/core';
import { clearField, set } from '$lib/terminal/storage';
import { ensureContactKey, withdrawCard } from '$lib/terminal/card';
import { takePart, tookPart, type Wire } from './claims';
import {
  LABELS_PAGE,
  LABELS_PAGES,
  REPORTS_MAX,
  fileReport,
  isMine,
  labelReport,
  localDay,
  reportAgain,
  reportableDays,
  reportsOn,
  sent,
  settlements,
  stillToReport,
  withdraw,
  type Sent
} from './reports';
import { standingOf } from '$lib/components/missions/format';

/**
 * Reporting from this device: never today, a warning before a series, sealed or open, withdrawn
 * honestly, and settled by what the labels say. The relays are a fake that records what it was
 * given.
 */

const NOW = 1791403200; // 7 Oct 2026, 20:00 UTC
const posterSecret = generateSecretKey();
const poster = getPublicKey(posterSecret);
const publishers = { [poster]: { name: 'Test Poster', agent: true } };

function mission(d: string, jurisdiction = 'us-ca'): Mission {
  const e = finalizeEvent(
    {
      kind: 30079,
      created_at: NOW - 86_400,
      content: JSON.stringify({
        name: `Mission ${d}`,
        objectives: [{ id: 'handout:water', ask: 'Hand out water.' }],
        metadata: { mechaJono: { format: { effect: ['Water handed out: a count'] } } }
      }),
      tags: [
        ['d', d], ['t', 'starcom_mission_package'], ['t', 'navcom_handoff'], ['t', 'navcom_mission'],
        ['mission_state', 'open'], ['valid_until', String(NOW + 10 * 86_400)], ['jurisdiction', jurisdiction]
      ]
    },
    posterSecret
  );
  const r = readMissionPackage(e, publishers);
  if (!r.ok) throw new Error(r.because);
  return r.mission;
}

function fakeWire(answers: Event[] = []) {
  const sentEvents: { urls: string[]; event: Event }[] = [];
  const w: Wire = {
    publish: async (urls, event) => {
      sentEvents.push({ urls, event });
      return 'took' as const;
    },
    query: async (urls) => ({ events: answers, answered: urls })
  };
  return { w, sentEvents };
}

const draft = (date: string) => ({ date, asks: ['handout:water'], counts: [{ line: 'Water handed out: a count', n: 12 }] });

beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  };
  set('accruing', 'secret', 'ab'.repeat(32));
  set('accruing', 'callsign', 'Kestrel');
});

describe('which days a report may tell of', () => {
  it('offers yesterday and the six days before it, and never today', () => {
    const days = reportableDays(NOW);
    expect(days).toHaveLength(7);
    expect(days).not.toContain(localDay(NOW));
    expect(days[0]).toBe(localDay(NOW - 86_400));
  });

  it('refuses a report of today, and holds nothing back to send later', async () => {
    const { w, sentEvents } = fakeWire();
    const r = await fileReport(mission('a'), draft(localDay(NOW)), 'open', NOW, {}, w);
    expect(r).toEqual({ ok: false, because: 'today' });
    expect(sentEvents).toEqual([]);
    expect(sent()).toEqual([]);
  });
});

describe('a report in the open', () => {
  it('goes to the operator’s relays naming the mission and the objectives, and is listed', async () => {
    const { w, sentEvents } = fakeWire();
    const r = await fileReport(mission('a'), draft(localDay(NOW - 86_400)), 'open', NOW, {}, w);
    expect(r.ok).toBe(true);
    expect(sentEvents).toHaveLength(1);
    const e = sentEvents[0]!.event;
    expect(e.kind).toBe(1912);
    expect(e.tags.map((t) => t[0])).toEqual(['a', 'ask']);
    expect(JSON.parse(e.content)).toMatchObject({ callsign: 'Kestrel', counts: [{ line: 'Water handed out: a count', n: 12 }] });
    expect(sent()).toEqual([expect.objectContaining({ id: e.id, visibility: 'open', jurisdiction: 'us-ca' })]);
  });

  it('is withdrawn by a deletion request naming a report, and says so locally', async () => {
    const { w, sentEvents } = fakeWire();
    const r = await fileReport(mission('a'), draft(localDay(NOW - 86_400)), 'open', NOW, {}, w);
    if (!r.ok) throw new Error('not sent');
    expect(await withdraw(r.sent.id, NOW + 60, w)).toBe('asked');
    const deletion = sentEvents.at(-1)!.event;
    expect(deletion.kind).toBe(5);
    expect(deletion.tags).toEqual([
      ['e', r.sent.id],
      ['k', '1912']
    ]);
    expect(sent()[0]!.withdrawn).toBe(true);
  });

  it('is not marked withdrawn when no relay took the request', async () => {
    const { w } = fakeWire();
    const r = await fileReport(mission('a'), draft(localDay(NOW - 86_400)), 'open', NOW, {}, w);
    if (!r.ok) throw new Error('not sent');
    const refused: Wire = { publish: async () => 'refused', query: async () => ({ events: [], answered: [] }) };
    expect(await withdraw(r.sent.id, NOW + 60, refused)).toBe('unheard');
    expect(sent()[0]!.withdrawn).toBeUndefined();
  });
});

describe('a series in one place', () => {
  it('is warned about inside a week, and sent only when the operator chooses to', async () => {
    const { w } = fakeWire();
    await fileReport(mission('a'), draft(localDay(NOW - 86_400)), 'open', NOW, {}, w);
    const second = await fileReport(mission('b'), draft(localDay(NOW - 86_400)), 'open', NOW + 3_600, {}, w);
    expect(second).toMatchObject({ ok: false, because: 'series' });
    const anyway = await fileReport(mission('b'), draft(localDay(NOW - 86_400)), 'open', NOW + 3_600, { series: true }, w);
    expect(anyway.ok).toBe(true);
  });

  it('is not warned about somewhere else', async () => {
    const { w } = fakeWire();
    await fileReport(mission('a', 'us-ca'), draft(localDay(NOW - 86_400)), 'open', NOW, {}, w);
    expect((await fileReport(mission('b', 'us-tx'), draft(localDay(NOW - 86_400)), 'open', NOW, {}, w)).ok).toBe(true);
  });
});

describe('a report for the poster alone', () => {
  it('goes sealed to the poster’s own inbox, listed under the id the poster’s labels will name', async () => {
    const inbox = finalizeEvent({ kind: 10050, created_at: NOW, content: '', tags: [['relay', 'wss://inbox.example']] }, posterSecret);
    const { w, sentEvents } = fakeWire([inbox]);
    const r = await fileReport(mission('a'), draft(localDay(NOW - 86_400)), 'sealed', NOW, {}, w);
    expect(r.ok).toBe(true);
    expect(sentEvents[0]!.urls).toEqual(['wss://inbox.example']);
    expect(sentEvents[0]!.event.kind).toBe(1059);
    const listed = sent()[0]!;
    expect(listed.visibility).toBe('sealed');
    expect(listed.id).not.toBe(sentEvents[0]!.event.id);
    // Already with its poster: nothing to withdraw, and nothing is pretended.
    expect(await withdraw(listed.id, NOW + 60, w)).toBe('not-open');
  });
});

describe('where reports stand', () => {
  it('reads the poster’s settlement from the labels on the report', async () => {
    const m = mission('a');
    const r = await fileReport(m, draft(localDay(NOW - 86_400)), 'open', NOW, {}, fakeWire().w);
    if (!r.ok) throw new Error('not sent');
    // As the poster's own builder makes it: naming the report and the mission [spec §5.3].
    const settled = buildReportLabel(posterSecret, 'settled', { id: r.sent.id, mission: m.address }, NOW + 3_600);
    const map = await settlements(NOW + 7_200, relayOf([settled]).w);
    expect(map.standing.get(r.sent.id)).toMatchObject({ state: 'settled', how: 'poster', by: poster });
    const silent = await settlements(NOW + 7_200, relayOf([]).w);
    expect(silent.standing.get(r.sent.id)).toMatchObject({ state: 'pending' });
  });

  it('never finds a label that names only the report, so the report waits, as the spec says [spec §5.3]', async () => {
    const r = await fileReport(mission('a'), draft(localDay(NOW - 86_400)), 'open', NOW, {}, fakeWire().w);
    if (!r.ok) throw new Error('not sent');
    const reportOnly = finalizeEvent(
      { kind: 1985, created_at: NOW + 3_600, content: '', tags: [['L', 'navcom.mission'], ['l', 'settled', 'navcom.mission'], ['e', r.sent.id]] },
      posterSecret
    );
    expect((await settlements(NOW + 7_200, relayOf([reportOnly]).w)).standing.get(r.sent.id)).toMatchObject({ state: 'pending' });
  });
});

describe('missions taken part in', () => {
  it('are remembered when a claim is made, so the work can be reported after the claim lapses', async () => {
    const { w } = fakeWire();
    await takePart(mission('a'), 'open', NOW, w);
    expect(tookPart(NOW + 2 * 86_400).map((t) => t.mission.d)).toEqual(['a']);
  });
});

/**
 * A relay that answers each query with what matches it, the way a relay filters [NIP-01]: by kind,
 * author and id, by every single-letter tag the filter names, by `since` and `until`, and at most
 * `limit` of them, newest first. A fake that ignored `#l` and `limit` could not tell the
 * by-mission-and-by-word read from a read of everything, nor show one mission's claims crowding out
 * its reports' labels [audit 11].
 *
 * `cap` is the most it sends for any one request, whatever `limit` asked: strfry's
 * `maxFilterLimit`, 500 on the relays NavCom ships with. A fake that always honoured `limit` could
 * not show a relay sending less than it was asked for [audit 11, second grid — review].
 */
function relayOf(events: Event[], answered?: (urls: string[]) => string[], cap = Infinity) {
  const published: Event[] = [];
  const queries: { urls: string[]; filter: Filter }[] = [];
  const w: Wire = {
    publish: async (_urls, event) => {
      published.push(event);
      return 'took' as const;
    },
    query: async (urls, f) => {
      queries.push({ urls, filter: f });
      return { events: served([...events, ...published], f, cap), answered: answered ? answered(urls) : urls };
    }
  };
  return { w, published, queries };
}

const matches = (e: Event, f: Filter) =>
  (!f.kinds || f.kinds.includes(e.kind)) &&
  (!f.authors || f.authors.includes(e.pubkey)) &&
  (!f.ids || f.ids.includes(e.id)) &&
  (f.since === undefined || e.created_at >= f.since) &&
  (f.until === undefined || e.created_at <= f.until) &&
  Object.entries(f).every(
    ([k, v]) => !/^#[a-zA-Z]$/.test(k) || e.tags.some((t) => t[0] === k.slice(1) && (v as string[]).includes(t[1]!))
  );
/** What one relay holding `events` sends for `f`: newest first, at most the smaller of `limit` and `cap`. */
const served = (events: Event[], f: Filter, cap = Infinity) => {
  const all = events.filter((e) => matches(e, f)).sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
  return all.slice(0, Math.min(f.limit ?? Infinity, cap));
};

describe('other operators’ reports on a mission', () => {
  const m = mission('a');
  const other = generateSecretKey();
  const said = (over: Partial<{ asks: string[]; counts: { line: string; n: number }[] }> = {}) =>
    buildReport(other, { callsign: 'Wren', date: localDay(NOW - 86_400), mission: { address: m.address, asks: ['handout:water'], counts: [], ...over } }, NOW - 3_600);

  it('shows each in the poster’s words, drops what the poster never asked, and names who labelled it', async () => {
    const kept = said({ counts: [{ line: 'Water handed out: a count', n: 9 }, { line: 'a description of somebody', n: 1 }] });
    const nothingAsked = buildReport(generateSecretKey(), { callsign: 'Other', date: localDay(NOW - 86_400), mission: { address: m.address, asks: ['not:an:objective'], counts: [] } }, NOW - 3_600);
    const challenger = generateSecretKey();
    const card = finalizeEvent({ kind: 10911, created_at: NOW - 86_400, content: JSON.stringify({ callsign: 'Heron', region: 'us-ca' }), tags: [] }, challenger);
    const challenge = buildReportLabel(challenger, 'challenged', { id: kept.id, mission: m.address }, NOW - 60);
    const { w } = relayOf([kept, nothingAsked, challenge, card]);
    const read = await reportsOn(m, NOW, w);
    expect(read.reports.map((r) => r.id)).toEqual([kept.id]);
    expect(read.reports[0]!.report.mission!.counts).toEqual([{ line: 'Water handed out: a count', n: 9 }]);
    expect(read.names.get(getPublicKey(other))).toBe('Wren');
    expect(read.names.get(getPublicKey(challenger))).toBe('Heron');
  });

  it('does not show one its author withdrew, whatever a relay still serves, and ignores anybody else asking', async () => {
    const r = said();
    const theirs = buildDeletion(other, r.id, 1912, NOW);
    expect((await reportsOn(m, NOW, relayOf([r, theirs]).w)).reports).toEqual([]);
    const somebodyElses = buildDeletion(generateSecretKey(), r.id, 1912, NOW);
    expect((await reportsOn(m, NOW, relayOf([r, somebodyElses]).w)).reports).toHaveLength(1);
  });

  it('asks relays by mission, never by report, so no relay learns which reports a device cares about', async () => {
    const asked: Filter[] = [];
    const w: Wire = { publish: async () => 'took', query: async (_u, f) => (asked.push(f), { events: [], answered: [] }) };
    await reportsOn(m, NOW, w);
    await fileReport(m, draft(localDay(NOW - 86_400)), 'open', NOW, {}, { ...w, publish: async () => 'took' });
    await settlements(NOW + 60, w);
    const labelQueries = asked.filter((f) => f.kinds?.includes(1985));
    expect(labelQueries.length).toBeGreaterThan(0);
    for (const f of labelQueries) {
      expect(f['#a']).toEqual([m.address]);
      expect(f['#e']).toBeUndefined();
    }
  });
});

describe('witnessing and challenging somebody’s report', () => {
  const m = mission('a');
  const other = generateSecretKey();
  const theirs = () => {
    const e = buildReport(other, { callsign: 'Wren', date: localDay(NOW - 86_400), mission: { address: m.address, asks: ['handout:water'], counts: [] } }, NOW - 3_600);
    return { id: e.id, author: e.pubkey, at: e.created_at, report: { callsign: 'Wren', date: localDay(NOW - 86_400) } };
  };

  it('lets somebody who took part say they were there, under their own card, naming the report and the mission', async () => {
    const { w, published } = relayOf([]);
    expect(await labelReport('witnessed', theirs(), m, NOW, w)).toEqual({ ok: false, because: 'not-there' });
    await takePart(m, 'open', NOW - 7_200, w);
    const r = await labelReport('witnessed', theirs(), m, NOW, w);
    expect(r.ok).toBe(true);
    const label = published.at(-1)!;
    expect(label.tags).toEqual([
      ['L', 'navcom.mission'],
      ['l', 'witnessed', 'navcom.mission'],
      ['e', theirs().id],
      ['a', m.address]
    ]);
    expect(label.content).toBe('');
  });

  it('lets anybody challenge inside the seven days, and sends nothing after, when it would count for nothing', async () => {
    const { w } = relayOf([]);
    expect((await labelReport('challenged', theirs(), m, NOW, w)).ok).toBe(true);
    expect(await labelReport('challenged', theirs(), m, NOW - 3_600 + 7 * 86_400 + 1, w)).toEqual({ ok: false, because: 'late' });
  });

  it('never labels the operator’s own report, and asks for sign-on first', async () => {
    const mine = buildReport(ensureContactKey(), { callsign: 'Kestrel', date: localDay(NOW - 86_400), mission: { address: m.address, asks: ['handout:water'], counts: [] } }, NOW - 3_600);
    const own = { id: mine.id, author: mine.pubkey, at: mine.created_at, report: { callsign: 'Kestrel', date: localDay(NOW - 86_400) } };
    expect(await labelReport('challenged', own, m, NOW, relayOf([]).w)).toEqual({ ok: false, because: 'own' });
    clearField('accruing', 'secret');
    expect(await labelReport('challenged', theirs(), m, NOW, relayOf([]).w)).toEqual({ ok: false, because: 'signed-out' });
  });

  it('says so when no relay took it', async () => {
    const refused: Wire = { publish: async () => 'refused', query: async () => ({ events: [], answered: [] }) };
    expect(await labelReport('challenged', theirs(), m, NOW, refused)).toMatchObject({ ok: false, because: 'not-sent' });
  });
});

describe('what the audit of Milestone 11 found', () => {
  it('offers seven distinct days on the nights the clocks change, and never today as yesterday [11.X]', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      // The night after the clocks went back, the night they went back, and the night after they went forward.
      for (const at of ['2026-11-02T23:30:00-05:00', '2026-11-01T23:30:00-05:00', '2026-03-09T00:30:00-04:00']) {
        const now = Math.floor(new Date(at).getTime() / 1000);
        const days = reportableDays(now);
        expect(new Set(days).size, at).toBe(7);
        expect(days, at).not.toContain(localDay(now));
        const d = new Date(now * 1000);
        expect(days[0], at).toBe(localDay(Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12).getTime() / 1000)));
      }
    } finally {
      process.env.TZ = tz;
    }
  });

  it('offers only the days the work could have been: after taking part, before the mission ended [11.X]', () => {
    const m = { ...mission('a'), validUntil: NOW - 3 * 86_400 };
    const days = reportableDays(NOW, { mission: m, since: NOW - 5 * 86_400 });
    expect(days).toEqual([localDay(NOW - 3 * 86_400), localDay(NOW - 4 * 86_400), localDay(NOW - 5 * 86_400)]);
  });

  it('warns of a series for a mission with no jurisdiction, by the mission itself [11.X]', async () => {
    const { w } = fakeWire();
    const nowhere = mission('n', 'not a code');
    expect(nowhere.placement.jurisdiction).toBeNull();
    await fileReport(nowhere, draft(localDay(NOW - 86_400)), 'open', NOW, {}, w);
    expect(await fileReport(nowhere, draft(localDay(NOW - 2 * 86_400)), 'open', NOW + 60, {}, w)).toMatchObject({ ok: false, because: 'series' });
  });

  it('calls where a report stands unknown when the relays that hold its labels did not answer [11.E]', async () => {
    const { w } = fakeWire();
    await fileReport(mission('a'), draft(localDay(NOW - 86_400)), 'open', NOW, {}, w);
    const silent: Wire = { publish: async () => 'took', query: async () => ({ events: [], answered: [] }) };
    // Eight days on, silence would have settled it — but nobody answered, so nothing is claimed.
    const after = await settlements(NOW + 8 * 86_400, silent);
    expect(after.standing.size).toBe(0);
    expect(after.answered).toEqual({ poster: false, operators: false });
  });

  it('says when a report was sent but this device could not record it [11.E]', async () => {
    const { w } = fakeWire();
    const write = localStorage.setItem;
    localStorage.setItem = (k: string, v: string) => {
      if (k === 'navcom.wipeable') throw new DOMException('full', 'QuotaExceededError');
      write(k, v);
    };
    const r = await fileReport(mission('a'), draft(localDay(NOW - 86_400)), 'open', NOW, {}, w);
    localStorage.setItem = write;
    expect(r).toMatchObject({ ok: true, kept: false });
  });

  it('never says a challenge would stop a settlement, because it stops nothing [11.E]', () => {
    const named = new Map([['k'.repeat(64), 'Heron']]);
    const waiting = standingOf({ state: 'pending', until: NOW, challengedBy: ['k'.repeat(64)] }, named);
    expect(waiting.sub).not.toMatch(/unless/);
    expect(waiting.sub).toContain('challenged by Heron (kkkkkkkk)');
    const silent = standingOf({ state: 'settled', how: 'silence', at: NOW, challengedBy: ['k'.repeat(64)] }, named);
    expect(silent.sub).not.toMatch(/unchallenged/);
  });
});

describe('what the second audit of Milestone 11 found', () => {
  const m = mission('a');
  const other = generateSecretKey();
  const theirs = (at = NOW - 3_600, callsign = 'Wren', key = other) =>
    buildReport(key, { callsign, date: localDay(NOW - 86_400), mission: { address: m.address, asks: ['handout:water'], counts: [] } }, at);
  const onMission = (e: Event) => ({ id: e.id, author: e.pubkey, at: e.created_at, report: { callsign: 'Wren', date: localDay(NOW - 86_400) } });
  /** Labels on a report nobody here wrote, one a second: more than every page this reads holds. */
  const stranger = generateSecretKey();
  const floodOf = (address: string, word: 'challenged' | 'witnessed' = 'challenged') =>
    Array.from({ length: LABELS_PAGES * LABELS_PAGE + 1 }, (_, i) =>
      buildReportLabel(stranger, word, { id: 'e'.repeat(64), mission: address }, NOW + 60 + i)
    );
  const flood = floodOf(m.address);
  const ownRelays = (urls: string[]) => set('accruing', 'relays_own', urls);

  describe('half an answer', () => {
    const fileOne = async () => {
      const r = await fileReport(m, draft(localDay(NOW - 86_400)), 'open', NOW, {}, fakeWire().w);
      if (!r.ok) throw new Error('not sent');
      return r.sent.id;
    };
    const only = (keep: (u: string) => boolean) => (urls: string[]) => urls.filter(keep);
    const posters = new Set<string>(MISSION_RELAYS);

    it('is unknown when only the poster’s relays answered, or only operators’', async () => {
      const id = await fileOne();
      const posterOnly = await settlements(NOW + 8 * 86_400, relayOf([], only((u) => posters.has(u))).w);
      expect(posterOnly.answered).toEqual({ poster: true, operators: false });
      expect(posterOnly.standing.has(id)).toBe(false);
      const operatorsOnly = await settlements(NOW + 8 * 86_400, relayOf([], only((u) => !posters.has(u))).w);
      expect(operatorsOnly.answered).toEqual({ poster: false, operators: true });
      expect(operatorsOnly.standing.has(id)).toBe(false);
      expect(sent()[0]!.final).toBeUndefined();
    });

    it('is unknown, and kept as nothing, when its mission has more labels than this reads', async () => {
      const id = await fileOne();
      const read = await settlements(NOW + 8 * 86_400, relayOf(flood).w);
      expect(read.standing.has(id)).toBe(false);
      expect(read.partial.has(id)).toBe(true);
      expect(sent()[0]!.final).toBeUndefined();
    });
  });

  describe('where reports stand, read mission by mission [review]', () => {
    const quiet = mission('quiet', 'us-ca');
    const busy = mission('busy', 'us-tx');
    const file = async (on: Mission, w: Wire, visibility: 'open' | 'sealed' = 'open', day = localDay(NOW - 86_400)) => {
      const r = await fileReport(on, draft(day), visibility, NOW, { series: true }, w);
      if (!r.ok) throw new Error('not sent');
      return r.sent.id;
    };

    /*
     * Asked for together, one busy mission filled the answer, and every report on every other mission
     * read "Unknown · did not answer; try again with signal" for good: true of none of them. A
     * stranger's labels cost nothing to sign, and a real campaign makes as many with nobody attacking.
     */
    it('a busy mission cannot leave a report on a quiet one unknown, though its poster settled it', async () => {
      const relay = relayOf(floodOf(busy.address, 'witnessed'));
      const onQuiet = await file(quiet, relay.w);
      const onBusy = await file(busy, relay.w);
      relay.published.push(buildReportLabel(posterSecret, 'settled', { id: onQuiet, mission: quiet.address }, NOW + 3_600));
      const read = await settlements(NOW + 7_200, relay.w);
      expect(read.standing.get(onQuiet)).toMatchObject({ state: 'settled', how: 'poster', by: poster });
      expect(read.standing.has(onBusy)).toBe(false);
      expect([...read.partial]).toEqual([onBusy]);
    });

    /*
     * The relays NavCom ships with send at most 500 for one request, whatever it asks for. Asked for
     * a thousand and sent five hundred, the read looked whole: the poster's settlement, older than
     * the rest, was left out, and on day 8 silence was kept as final.
     */
    it('reads past a relay that sends less than it was asked for, and keeps the poster’s word, not silence', async () => {
      const relay = relayOf([], undefined, 500);
      const id = await file(quiet, relay.w);
      relay.published.push(buildReportLabel(posterSecret, 'settled', { id, mission: quiet.address }, NOW + 3_600));
      for (let i = 0; i < 600; i++) relay.published.push(buildReportLabel(stranger, 'witnessed', { id: 'f'.repeat(64), mission: quiet.address }, NOW + 7_200 + i));
      const read = await settlements(NOW + 8 * 86_400, relay.w);
      expect(read.standing.get(id)).toMatchObject({ state: 'settled', how: 'poster' });
      expect(sent()[0]!.final).toMatchObject({ how: 'poster' });
    });

    it('reads a campaign with more labels than one request holds, rather than calling it unknown', async () => {
      const relay = relayOf([]);
      const id = await file(quiet, relay.w);
      relay.published.push(buildReportLabel(posterSecret, 'settled', { id, mission: quiet.address }, NOW + 3_600));
      for (let i = 0; i < 1_200; i++) relay.published.push(buildReportLabel(posterSecret, 'settled', { id: 'f'.repeat(64), mission: quiet.address }, NOW + 7_200 + i));
      const read = await settlements(NOW + 8 * 86_400, relay.w);
      expect(read.standing.get(id)).toMatchObject({ state: 'settled', how: 'poster' });
      expect(read.partial.size).toBe(0);
    });

    /*
     * Each relay cuts its own answer short, so the next page must start where the fullest one could
     * have stopped, not at the oldest label any relay sent: a relay holding only old labels pulled
     * that back past everything the busy one left out.
     */
    it('starts each page where a relay that cut its answer short could have stopped, not at the oldest label sent', async () => {
      const busyRelay: Event[] = [];
      const oldRelay: Event[] = [];
      const relay = relayOf([]);
      const id = await file(quiet, relay.w);
      for (let i = 0; i < 600; i++) busyRelay.push(buildReportLabel(stranger, 'witnessed', { id: 'f'.repeat(64), mission: quiet.address }, NOW + 10_000 + i));
      busyRelay.push(buildReportLabel(posterSecret, 'settled', { id, mission: quiet.address }, NOW + 10_050));
      for (let i = 0; i < 300; i++) oldRelay.push(buildReportLabel(stranger, 'witnessed', { id: 'f'.repeat(64), mission: quiet.address }, NOW + 1_000 + i));
      const w: Wire = {
        publish: async () => 'took',
        query: async (urls, f) => {
          const byId = new Map<string, Event>();
          for (const e of served(busyRelay, f, 500)) byId.set(e.id, e);
          for (const e of served(oldRelay, f, 500)) byId.set(e.id, e);
          return { events: [...byId.values()], answered: urls };
        }
      };
      const read = await settlements(NOW + 8 * 86_400, w);
      expect(read.standing.get(id)).toMatchObject({ state: 'settled', how: 'poster' });
    });

    it('calls a mission unknown when a page cannot move on — as many labels in one second as a relay sends', async () => {
      const relay = relayOf([], undefined, 500);
      const id = await file(quiet, relay.w);
      relay.published.push(buildReportLabel(posterSecret, 'settled', { id, mission: quiet.address }, NOW + 3_600));
      for (let i = 0; i < 600; i++) relay.published.push(buildReportLabel(generateSecretKey(), 'witnessed', { id: 'f'.repeat(64), mission: quiet.address }, NOW + 7_200));
      const read = await settlements(NOW + 8 * 86_400, relay.w);
      expect(read.standing.has(id)).toBe(false);
      expect(read.partial.has(id)).toBe(true);
      expect(sent()[0]!.final).toBeUndefined();
    });

    it('calls a mission unknown when a relay that holds its labels answered one page and not the next', async () => {
      const relay = relayOf([]);
      const id = await file(quiet, relay.w);
      for (let i = 0; i < 600; i++) relay.published.push(buildReportLabel(stranger, 'witnessed', { id: 'f'.repeat(64), mission: quiet.address }, NOW + 7_200 + i));
      const posters = new Set<string>(MISSION_RELAYS);
      // The poster's relays answer the second page and not the first.
      const w: Wire = { ...relay.w, query: async (urls, f) => {
        const heard = await relay.w.query(urls, f);
        return { ...heard, answered: f.until === undefined ? urls.filter((u) => !posters.has(u)) : urls };
      } };
      const read = await settlements(NOW + 8 * 86_400, w);
      expect(read.answered.poster).toBe(false);
      expect(read.standing.has(id)).toBe(false);
      expect(sent()[0]!.final).toBeUndefined();
    });

    /*
     * Nobody but the poster knows a sealed report's id, so nobody else can have labelled it. Asking
     * operators' relays for labels on its mission — among them the inbox the seal went to, over the
     * connection this device's open traffic uses — said which mission it was for, and that it was
     * this device's [what-leaves.md].
     */
    it('asks where a sealed report stands only of the poster’s own relays, and only for the poster’s word', async () => {
      const inbox = finalizeEvent({ kind: 10050, created_at: NOW, content: '', tags: [['relay', 'wss://nos.lol']] }, posterSecret);
      const relay = relayOf([inbox]);
      await file(quiet, relay.w, 'sealed');
      const id = sent()[0]!.id;
      relay.published.push(buildReportLabel(posterSecret, 'settled', { id, mission: quiet.address }, NOW + 3_600));
      const read = await settlements(NOW + 7_200, relay.w);
      expect(read.standing.get(id)).toMatchObject({ state: 'settled', how: 'poster', by: poster });
      const asked = relay.queries.filter((q) => q.filter.kinds?.includes(1985));
      expect(asked.length).toBeGreaterThan(0);
      for (const q of asked) {
        expect(q.urls.every((u) => (MISSION_RELAYS as readonly string[]).includes(u)), q.urls.join(' ')).toBe(true);
        expect(q.filter.authors).toEqual([poster]);
      }
    });

    it('still asks operators’ relays about a mission this device also reported on in the open', async () => {
      const inbox = finalizeEvent({ kind: 10050, created_at: NOW, content: '', tags: [['relay', 'wss://nos.lol']] }, posterSecret);
      const relay = relayOf([inbox]);
      await file(quiet, relay.w, 'sealed');
      // Another day's work: a day already reported is not reported again [audit 11.S, finding 52].
      const open = await file(quiet, relay.w, 'open', localDay(NOW - 2 * 86_400));
      const heron = generateSecretKey();
      relay.published.push(buildReportLabel(heron, 'challenged', { id: open, mission: quiet.address }, NOW + 3_600));
      const read = await settlements(NOW + 7_200, relay.w);
      expect(read.standing.get(open)).toMatchObject({ state: 'pending', challengedBy: [getPublicKey(heron)] });
    });
  });

  describe('a mission that ended tonight', () => {
    /*
     * Taken part in at six, ended at ten: until midnight it went from every screen, and the panel
     * said there was nothing to report — though tomorrow is its first day to report, as it is for
     * every mission taken part in today [audit 11.S, finding 64].
     */
    it('is still one to report, from tomorrow, between its end and midnight', () => {
      const day = new Date(NOW * 1000);
      const at = (h: number) => Math.floor(new Date(day.getFullYear(), day.getMonth(), day.getDate(), h).getTime() / 1000);
      const t = { mission: { ...mission('a'), validUntil: at(22) }, since: at(18) };
      expect(stillToReport(at(19), t)).toBe('tomorrow');
      expect(stillToReport(at(23), t)).toBe('tomorrow');
      expect(reportableDays(at(23) + 13 * 3_600, t)).toEqual([localDay(at(18))]);
    });
  });

  describe('a report filed under a card since withdrawn', () => {
    it('is still read as this device’s own: where it stands is asked for, and it cannot be witnessed from here', async () => {
      await takePart(m, 'open', NOW - 7_200, fakeWire().w);
      const relay = relayOf([]);
      const r = await fileReport(m, draft(localDay(NOW - 86_400)), 'open', NOW, {}, relay.w);
      if (!r.ok) throw new Error('not sent');
      const mine = relay.published.find((e) => e.id === r.sent.id)!;
      withdrawCard();
      const read = await settlements(NOW + 3_600, relay.w);
      expect(read.standing.get(r.sent.id)).toMatchObject({ state: 'pending' });
      expect(isMine(onMission(mine))).toBe(true);
      expect(await labelReport('witnessed', onMission(mine), m, NOW + 3_600, relay.w)).toEqual({ ok: false, because: 'own' });
      expect(isMine(onMission(theirs()))).toBe(false);
    });

    it('cannot be withdrawn from here, and nothing is sent or marked [11.E]', async () => {
      const { w, sentEvents } = fakeWire();
      const r = await fileReport(m, draft(localDay(NOW - 86_400)), 'open', NOW, {}, w);
      if (!r.ok) throw new Error('not sent');
      withdrawCard();
      const before = sentEvents.length;
      expect(await withdraw(r.sent.id, NOW + 60, w)).toBe('card');
      expect(sentEvents.length).toBe(before);
      expect(sent()[0]!.withdrawn).toBeUndefined();
    });
  });

  describe('the series warning', () => {
    it('counts a report that was withdrawn, since copies already taken stay', async () => {
      const { w } = fakeWire();
      const r = await fileReport(mission('a'), draft(localDay(NOW - 86_400)), 'open', NOW, {}, w);
      if (!r.ok) throw new Error('not sent');
      expect(await withdraw(r.sent.id, NOW + 60, w)).toBe('asked');
      expect(await fileReport(mission('b'), draft(localDay(NOW - 86_400)), 'open', NOW + 120, {}, w)).toMatchObject({ ok: false, because: 'series' });
    });

    it('looks back seven days: a report six days ago warns, one eight days ago does not', async () => {
      const { w } = fakeWire();
      await fileReport(mission('a'), draft(localDay(NOW - 86_400)), 'open', NOW, {}, w);
      const six = NOW + 6 * 86_400;
      expect(await fileReport(mission('b'), draft(localDay(six - 86_400)), 'open', six, {}, w)).toMatchObject({ because: 'series' });
      const eight = NOW + 8 * 86_400;
      expect((await fileReport(mission('b'), draft(localDay(eight - 86_400)), 'open', eight, {}, w)).ok).toBe(true);
    });

    it('looks back seven days to the second: one sent 604,799 seconds ago warns, one sent 604,800 ago does not [review]', async () => {
      const { w } = fakeWire();
      await fileReport(mission('a'), draft(localDay(NOW - 86_400)), 'open', NOW, {}, w);
      const inside = NOW + 604_799;
      expect(await fileReport(mission('b'), draft(localDay(inside - 86_400)), 'open', inside, {}, w)).toMatchObject({ because: 'series' });
      const over = NOW + 604_800;
      expect((await fileReport(mission('b'), draft(localDay(over - 86_400)), 'open', over, {}, w)).ok).toBe(true);
    });
  });

  it('sends an open report, a witness, a challenge and a withdrawal where posters read, beside a watch and an operator’s own relays [11.E]', async () => {
    ownRelays(['wss://own.example']);
    set('accruing', 'watchtower', 'f'.repeat(64));
    set('accruing', 'relays', ['wss://watch.example']);
    const { w, sentEvents } = fakeWire();
    await takePart(m, 'open', NOW - 7_200, w);
    const r = await fileReport(m, draft(localDay(NOW - 86_400)), 'open', NOW, {}, w);
    if (!r.ok) throw new Error('not sent');
    expect((await labelReport('witnessed', onMission(theirs()), m, NOW, w)).ok).toBe(true);
    expect((await labelReport('challenged', onMission(theirs(NOW - 60, 'Heron', generateSecretKey())), m, NOW, w)).ok).toBe(true);
    expect(await withdraw(r.sent.id, NOW + 60, w)).toBe('asked');
    const kinds = sentEvents.map((s) => s.event.kind);
    expect(kinds.filter((k) => k === 1912)).toHaveLength(1);
    expect(kinds.filter((k) => k === 1985).length).toBeGreaterThanOrEqual(3);
    expect(kinds.filter((k) => k === 5)).toHaveLength(1);
    for (const s of sentEvents) expect(s.urls).toEqual(expect.arrayContaining(['wss://own.example', 'wss://watch.example', ...DEFAULT_RELAYS]));
  });

  it('sends a report’s withdrawal where the report went, after the relay list has changed [11.E]', async () => {
    ownRelays(['wss://old.example']);
    const { w, sentEvents } = fakeWire();
    const r = await fileReport(m, draft(localDay(NOW - 86_400)), 'open', NOW, {}, w);
    if (!r.ok) throw new Error('not sent');
    ownRelays(['wss://new.example']);
    await withdraw(r.sent.id, NOW + 60, w);
    expect(sentEvents.at(-1)!.event.kind).toBe(5);
    expect(sentEvents.at(-1)!.urls).toContain('wss://old.example');
  });

  describe('reading a busy mission', () => {
    it('finds a report’s challenge though the mission has more claims than a relay will send [11.R]', async () => {
      const report = theirs();
      const heron = generateSecretKey();
      const challenge = buildReportLabel(heron, 'challenged', { id: report.id, mission: m.address }, NOW - 60);
      const claimer = generateSecretKey();
      const claims = Array.from({ length: 1_000 }, (_, i) => buildMissionClaim(claimer, 'claimed', m.address, NOW + 86_400, NOW + i));
      const read = await reportsOn(m, NOW + 1_000, relayOf([report, challenge, ...claims]).w);
      expect(read.labels.map((l) => l.id)).toContain(challenge.id);
    });

    it('says there may be more when a relay sent as many labels, or as many reports, as were asked for', async () => {
      expect((await reportsOn(m, NOW + 2_000, relayOf([theirs(), ...flood]).w)).partial).toBe(true);
      const many = Array.from({ length: REPORTS_MAX }, (_, i) => theirs(NOW - 7_200 + i, 'Wren', generateSecretKey()));
      expect((await reportsOn(m, NOW, relayOf(many).w)).partial).toBe(true);
      expect((await reportsOn(m, NOW, relayOf([theirs()]).w)).partial).toBe(false);
    });
  });

  it('shows newest first, and not a report dated more than a day past this device’s clock', async () => {
    const older = theirs(NOW - 7_200, 'Older', generateSecretKey());
    const newer = theirs(NOW - 3_600, 'Newer', generateSecretKey());
    const ahead = theirs(NOW + 86_401, 'Ahead', generateSecretKey());
    const justInside = theirs(NOW + 86_400, 'Inside', generateSecretKey());
    const read = await reportsOn(m, NOW, relayOf([older, ahead, newer, justInside]).w);
    expect(read.reports.map((r) => r.report.callsign)).toEqual(['Inside', 'Newer', 'Older']);
  });

  it('names a labeller by their newest card, and the poster by the name it is registered under', async () => {
    const report = theirs();
    const heron = generateSecretKey();
    const card = (callsign: string, at: number) => finalizeEvent({ kind: 10911, created_at: at, content: JSON.stringify({ callsign, region: 'us-ca' }), tags: [] }, heron);
    const labels = [
      buildReportLabel(heron, 'challenged', { id: report.id, mission: m.address }, NOW - 60),
      buildReportLabel(posterSecret, 'settled', { id: report.id, mission: m.address }, NOW - 60)
    ];
    const read = await reportsOn(m, NOW, relayOf([report, ...labels, card('Heron', NOW - 86_400), card('Old name', NOW - 2 * 86_400)]).w);
    expect(read.names.get(getPublicKey(heron))).toBe('Heron');
    expect(read.names.get(poster)).toBe('Test Poster');
  });

  it('sends a challenge in the last second of the seven days, and refuses one once they are over', async () => {
    const r = onMission(theirs());
    const { w } = relayOf([]);
    expect(await labelReport('challenged', r, m, r.at + 604_800, w)).toEqual({ ok: false, because: 'late' });
    expect((await labelReport('challenged', r, m, r.at + 604_799, w)).ok).toBe(true);
  });

  it('asks for sign-on before sending a report, and sends nothing', async () => {
    clearField('accruing', 'secret');
    const { w, sentEvents } = fakeWire();
    expect(await fileReport(m, draft(localDay(NOW - 86_400)), 'open', NOW, {}, w)).toEqual({ ok: false, because: 'signed-out' });
    expect(sentEvents).toEqual([]);
  });

  it('says how a report settled, never merging the poster’s word, a witness’s and silence [economy.md §7]', () => {
    const k = 'k'.repeat(64);
    const names = new Map([[k, 'Heron']]);
    expect(standingOf({ state: 'settled', how: 'poster', by: k, at: NOW, challengedBy: [] }, names).sub).toBe('by the poster, Heron (kkkkkkkk)');
    expect(standingOf({ state: 'settled', how: 'witness', by: k, at: NOW, challengedBy: [] }, names).sub).toBe('by a witness, Heron (kkkkkkkk)');
    expect(standingOf({ state: 'settled', how: 'silence', at: NOW, challengedBy: [] }, names).sub).toBe('unchallenged for seven days');
  });
});


describe('what the second audit left open', () => {
  const m = mission('left-open');
  const inbox = finalizeEvent({ kind: 10050, created_at: NOW, content: '', tags: [['relay', 'wss://inbox.example']] }, posterSecret);
  const day = (n: number) => localDay(NOW - n * 86_400);

  describe('a day already reported [audit 11.S, finding 52]', () => {
    /*
     * The Quartermaster reported socks for Tuesday, and "To report" still said "report the work";
     * opened again, it offered Tuesday with no mark, and "Send anyway" put a second report of the
     * same day's work on the relays, counted twice wherever settled reports are counted.
     */
    it('is not offered again, and a mission whose every day is reported is not one to report', async () => {
      const t = { mission: m, since: NOW - 3 * 86_400 };
      expect(reportableDays(NOW, t)).toEqual([day(1), day(2), day(3)]);
      const { w } = fakeWire();
      for (const n of [1, 2, 3]) expect((await fileReport(m, draft(day(n)), 'open', NOW, { series: true }, w)).ok).toBe(true);
      expect(reportableDays(NOW, t)).toEqual([]);
      // Still running: today is the next day to report, from tomorrow — never "report the work" now.
      expect(stillToReport(NOW, t)).toBe('tomorrow');
      // Over, and every day of it reported: nothing is left.
      expect(stillToReport(NOW, { ...t, mission: { ...m, validUntil: NOW - 86_400 } })).toBeNull();
    });

    it('is refused if sent again from a screen opened before, and nothing leaves', async () => {
      const { w, sentEvents } = fakeWire([inbox]);
      expect((await fileReport(m, draft(day(1)), 'open', NOW, {}, w)).ok).toBe(true);
      const before = sentEvents.length;
      for (const visibility of ['open', 'sealed'] as const) {
        expect(await fileReport(m, draft(day(1)), visibility, NOW + 60, { series: true }, w)).toMatchObject({ ok: false, because: 'reported' });
      }
      expect(sentEvents.length).toBe(before);
      expect(sent()).toHaveLength(1);
    });

    it('is offered again once its report is withdrawn', async () => {
      const t = { mission: m, since: NOW - 2 * 86_400 };
      const { w } = fakeWire();
      const r = await fileReport(m, draft(day(2)), 'open', NOW, {}, w);
      if (!r.ok) throw new Error('not sent');
      expect(reportableDays(NOW, t)).toEqual([day(1)]);
      expect(await withdraw(r.sent.id, NOW + 60, w)).toBe('asked');
      expect(reportableDays(NOW, t)).toEqual([day(1), day(2)]);
    });

    /*
     * She took part in a week-long drive yesterday evening and reported yesterday this morning. For
     * the rest of the day the mission was on no screen, and the report screen said every day was
     * reported — though today's work is one to report tomorrow [review].
     */
    it('leaves a mission she is still working one to report from tomorrow, once yesterday is reported', async () => {
      const today = new Date(NOW * 1000);
      const at = (days: number, h: number) =>
        Math.floor(new Date(today.getFullYear(), today.getMonth(), today.getDate() + days, h).getTime() / 1000);
      const since = at(-1, 20);
      expect((await fileReport(m, draft(localDay(since)), 'open', at(0, 9), {}, fakeWire().w)).ok).toBe(true);
      const running = { mission: { ...m, validUntil: at(3, 12) }, since };
      const endedTonight = { mission: { ...m, validUntil: at(0, 21) }, since };
      const endedYesterday = { mission: { ...m, validUntil: at(-1, 23) }, since };
      const late = at(0, 22);
      expect(reportableDays(late, running)).toEqual([]);
      expect(stillToReport(late, running)).toBe('tomorrow');
      expect(stillToReport(late, endedTonight)).toBe('tomorrow');
      // Its last day reported and over: nothing is left, and it says so.
      expect(stillToReport(late, endedYesterday)).toBeNull();
      // From midnight, today's work is the day to report.
      expect(stillToReport(at(1, 9), running)).toBe('now');
      expect(reportableDays(at(1, 9), endedTonight)).toEqual([localDay(late)]);
    });
  });

  describe('the series warning [audit 11.S and 11.I, findings 50, 57 and 73]', () => {
    /*
     * Only the poster reads a sealed report, so it makes no pattern anybody else can. Warned after
     * she had already chosen the sealed one, she learned to tap "Send anyway".
     */
    it('is asked only of an open report, and only against open ones', async () => {
      const { w } = fakeWire([inbox]);
      expect((await fileReport(mission('o1'), draft(day(1)), 'open', NOW, {}, w)).ok).toBe(true);
      expect((await fileReport(mission('s1'), draft(day(1)), 'sealed', NOW + 60, {}, w)).ok).toBe(true);
      clearField('wipeable', 'mission_reports');
      expect((await fileReport(mission('s2'), draft(day(1)), 'sealed', NOW, {}, w)).ok).toBe(true);
      expect((await fileReport(mission('o2'), draft(day(1)), 'open', NOW + 60, {}, w)).ok).toBe(true);
      // And still of an open one after an open one, withdrawn or not: copies already taken stay.
      expect(await fileReport(mission('o3'), draft(day(1)), 'open', NOW + 120, {}, w)).toMatchObject({ ok: false, because: 'series' });
      expect(await withdraw(sent().find((s) => s.visibility === 'open')!.id, NOW + 180, w)).toBe('asked');
      expect(await fileReport(mission('o3'), draft(day(1)), 'open', NOW + 240, {}, w)).toMatchObject({ ok: false, because: 'series' });
    });

    /*
     * Monday's report withdrawn, Tuesday's sent anyway and left up: on Wednesday the warning said
     * "you withdrew the last one" of Monday's, while Tuesday's was live on every relay [review].
     */
    it('names one still up when there is one, so a live report is never called withdrawn', async () => {
      const { w } = fakeWire();
      const file = async (d: string, at: number, series = false) => {
        const r = await fileReport(mission(d), draft(day(1)), 'open', at, { series }, w);
        if (!r.ok) throw new Error(`not sent: ${r.because}`);
        return r.sent.id;
      };
      const warned = (r: Awaited<ReturnType<typeof fileReport>>) => (!r.ok && r.because === 'series' ? r.series : null);
      const monday = await file('mon', NOW);
      expect(await withdraw(monday, NOW + 60, w)).toBe('asked');
      const tuesday = await file('tue', NOW + 120, true);
      const wednesday = warned(await fileReport(mission('wed'), draft(day(1)), 'open', NOW + 240, {}, w));
      expect(wednesday).toMatchObject({ id: tuesday });
      expect(wednesday!.withdrawn).toBeUndefined();
      // The older one up and the newer withdrawn: still the one up.
      clearField('wipeable', 'mission_reports');
      const up = await file('up', NOW);
      expect(await withdraw(await file('down', NOW + 60, true), NOW + 120, w)).toBe('asked');
      expect(warned(await fileReport(mission('next'), draft(day(1)), 'open', NOW + 180, {}, w))).toMatchObject({ id: up });
      // Every one withdrawn: the newest, and then it is said.
      expect(await withdraw(up, NOW + 240, w)).toBe('asked');
      expect(warned(await fileReport(mission('next'), draft(day(1)), 'open', NOW + 300, {}, w))).toMatchObject({ withdrawn: true });
    });
  });

  describe('a report no relay confirmed [audit 11.S, finding 61]', () => {
    /** Relays that answer as told, one answer per publish, and record every event they were sent. */
    function answering(...answers: ('took' | 'refused' | 'unconfirmed')[]) {
      const sentEvents: Event[] = [];
      const w: Wire = {
        publish: async (_urls, event) => {
          sentEvents.push(event);
          return answers.shift() ?? 'took';
        },
        query: async (urls) => ({ events: [inbox], answered: urls })
      };
      return { w, sentEvents };
    }

    /*
     * On a congested cell the relay took it and its answer came after the wait was over. The screen
     * said "Nothing was sent", the retry signed a second report of the same work under a new id, and
     * the first was a permanent public record this phone could never withdraw.
     */
    it('is said to have maybe arrived, kept, and sent again as the same event — never a second report', async () => {
      const { w, sentEvents } = answering('unconfirmed', 'took');
      const r = await fileReport(m, draft(day(1)), 'open', NOW, {}, w);
      expect(r).toMatchObject({ ok: false, because: 'unconfirmed', kept: true });
      const listed = sent();
      expect(listed).toHaveLength(1);
      expect(listed[0]!.unconfirmed?.id).toBe(sentEvents[0]!.id);
      // Not offered again, and not sent again under a new id.
      expect(reportableDays(NOW, { mission: m, since: NOW - 86_400 })).toEqual([]);
      expect(await fileReport(m, draft(day(1)), 'open', NOW + 60, { series: true }, w)).toMatchObject({ because: 'reported' });
      expect(await reportAgain(listed[0]!, w)).toBe('took');
      expect(sentEvents.map((e) => e.id)).toEqual([listed[0]!.id, listed[0]!.id]);
      expect(sent()[0]!.unconfirmed).toBeUndefined();
    });

    it('is sent again as the same sealed wrap, though this device could not record it', async () => {
      const { w, sentEvents } = answering('unconfirmed', 'took');
      const write = localStorage.setItem;
      localStorage.setItem = (k: string, v: string) => {
        if (k === 'navcom.wipeable') throw new DOMException('full', 'QuotaExceededError');
        write(k, v);
      };
      const r = await fileReport(m, draft(day(1)), 'sealed', NOW, {}, w);
      localStorage.setItem = write;
      if (r.ok || r.because !== 'unconfirmed') throw new Error(`expected unconfirmed, got ${JSON.stringify(r)}`);
      expect(r.kept).toBe(false);
      expect(await reportAgain(r.sent, w)).toBe('took');
      expect(sentEvents.map((e) => e.id)).toEqual([sentEvents[0]!.id, sentEvents[0]!.id]);
    });

    it('stays listed when sending it again is refused: a refusal now says nothing about the first time', async () => {
      const { w } = answering('unconfirmed', 'refused');
      await fileReport(m, draft(day(1)), 'open', NOW, {}, w);
      expect(await reportAgain(sent()[0]!, w)).toBe('refused');
      expect(sent()[0]!.unconfirmed).toBeDefined();
    });

    it('can be withdrawn, and then is not sent again', async () => {
      const { w } = answering('unconfirmed', 'took');
      await fileReport(m, draft(day(1)), 'open', NOW, {}, w);
      const s = sent()[0]!;
      expect(await withdraw(s.id, NOW + 60, w)).toBe('asked');
      expect(sent()[0]).toMatchObject({ withdrawn: true });
      expect(sent()[0]!.unconfirmed).toBeUndefined();
      expect(await reportAgain(s, w)).toBe('gone');
    });

    it('is never settled by silence: if it never arrived, nobody could have challenged it', async () => {
      const { w } = answering('unconfirmed');
      await fileReport(m, draft(day(1)), 'open', NOW, {}, w);
      const after = await settlements(NOW + 8 * 86_400, relayOf([]).w);
      expect(after.standing.size).toBe(0);
      expect(sent()[0]!.final).toBeUndefined();
    });

    it('says nothing was sent only when every relay refused it, and keeps nothing then', async () => {
      const { w } = answering('refused');
      expect(await fileReport(m, draft(day(1)), 'open', NOW, {}, w)).toEqual({
        ok: false,
        because: 'not-sent',
        detail: expect.stringMatching(/Nothing was sent/)
      });
      expect(sent()).toEqual([]);
      expect(reportableDays(NOW, { mission: m, since: NOW - 86_400 })).toEqual([day(1)]);
    });

    it('a withdrawal no relay confirmed is not called asked, nor refused', async () => {
      const { w } = answering('took', 'unconfirmed');
      const r = await fileReport(m, draft(day(1)), 'open', NOW, {}, w);
      if (!r.ok) throw new Error('not sent');
      expect(await withdraw(r.sent.id, NOW + 60, w)).toBe('unconfirmed');
      expect(sent()[0]!.withdrawn).toBeUndefined();
    });

    it('a witness or a challenge no relay confirmed is said to have maybe arrived', async () => {
      const { w } = answering('unconfirmed');
      const theirs = buildReport(generateSecretKey(), { callsign: 'Wren', date: day(1), mission: { address: m.address, asks: ['handout:water'], counts: [] } }, NOW - 3_600);
      const on = { id: theirs.id, author: theirs.pubkey, at: theirs.created_at, report: { callsign: 'Wren', date: day(1) } };
      expect(await labelReport('challenged', on, m, NOW, w)).toEqual({ ok: false, because: 'unconfirmed' });
    });
  });

  describe('a verdict is kept only from a whole read [audit 11.S, finding 62; audit 11, findings 45 and 58]', () => {
    const own = 'wss://own.example';
    const nos = DEFAULT_RELAYS[1]!;
    const fileOne = async () => {
      const r = await fileReport(m, draft(day(1)), 'open', NOW, {}, fakeWire().w);
      if (!r.ok) throw new Error('not sent');
      return r.sent.id;
    };
    /** Relays where everybody's labels are on `holding` only, answering when `answering` says so. */
    const relays = (labels: Event[], answering: (u: string) => boolean, holding: (u: string) => boolean = () => true): Wire => ({
      publish: async () => 'took',
      query: async (urls, f) => {
        const heard = urls.filter(answering);
        return { events: heard.some(holding) ? served(labels, f) : [], answered: heard };
      }
    });

    /*
     * Her own relay answered, the shipped relays where everybody writes did not, and her report read
     * "Settled · unchallenged" — and was kept so — though her own relay carries nobody's labels.
     */
    it('counts no operator’s labels as heard from an operator’s own relay', async () => {
      set('accruing', 'relays_own', [own]);
      const id = await fileOne();
      const heron = generateSecretKey();
      const challenge = buildReportLabel(heron, 'challenged', { id, mission: m.address }, NOW + 3_600);
      const shipped = (u: string) => (DEFAULT_RELAYS as readonly string[]).includes(u);
      // The challenge is where everybody writes, and those relays are slow; hers and the poster's answer.
      const read = await settlements(NOW + 8 * 86_400, relays([challenge], (u) => !shipped(u), shipped));
      expect(read.answered.operators).toBe(false);
      expect(read.standing.has(id)).toBe(false);
      expect(sent()[0]!.final).toBeUndefined();
    });

    /*
     * One shipped relay answered while the one holding the challenge was slow: the report reads as
     * far as was heard, but nothing is kept — and the next read, with every relay answering, finds it.
     */
    it('shows a read one slow relay was missing from, keeps nothing from it, and finds the challenge the next day', async () => {
      const id = await fileOne();
      const heron = generateSecretKey();
      const challenge = buildReportLabel(heron, 'challenged', { id, mission: m.address }, NOW + 3_600);
      const slow = await settlements(NOW + 8 * 86_400, relays([challenge], (u) => u !== nos, (u) => u === nos));
      expect(slow.standing.get(id)).toMatchObject({ state: 'settled', how: 'silence', challengedBy: [] });
      expect(sent()[0]!.final).toBeUndefined();
      const whole = await settlements(NOW + 9 * 86_400, relays([challenge], () => true, (u) => u === nos));
      expect(whole.standing.get(id)).toMatchObject({ state: 'settled', how: 'silence', challengedBy: [getPublicKey(heron)] });
      expect(sent()[0]!.final).toMatchObject({ challengedBy: [getPublicKey(heron)] });
      expect(sent()[0]!.finalWhole).toBe(true);
    });

    /*
     * An earlier version read no signal as silence and kept "Settled · unchallenged" for good, with
     * the challenge on every relay. What it kept is cleared and read again.
     */
    it('clears a verdict an earlier version kept, and reads the report again', async () => {
      const id = await fileOne();
      const keptBefore: Sent = { ...sent()[0]!, final: { state: 'settled', how: 'silence', at: NOW + 7 * 86_400, challengedBy: [] } };
      set('wipeable', 'mission_reports', [keptBefore]);
      const heron = generateSecretKey();
      const challenge = buildReportLabel(heron, 'challenged', { id, mission: m.address }, NOW + 3_600);
      const offline = await settlements(NOW + 9 * 86_400, relays([challenge], () => false));
      expect(offline.standing.has(id)).toBe(false);
      expect(sent()[0]!.final).toBeUndefined();
      const read = await settlements(NOW + 9 * 86_400, relays([challenge], () => true));
      expect(read.standing.get(id)).toMatchObject({ challengedBy: [getPublicKey(heron)] });
      expect(sent()[0]).toMatchObject({ final: { challengedBy: [getPublicKey(heron)] }, finalWhole: true });
    });

    /*
     * The mirror copies The Record and can fall behind: its answer shows where a report stands, but
     * only The Record's makes the poster's word whole [spec §5.0]. Requiring both made one person's
     * Pi, down for a few weeks, stop every verdict and re-read every report on every open [review].
     */
    it('keeps a sealed report’s verdict once The Record answered, and not from its mirror alone', async () => {
      await fileReport(m, draft(day(1)), 'sealed', NOW, {}, fakeWire([inbox]).w);
      const id = sent()[0]!.id;
      const settled = buildReportLabel(posterSecret, 'settled', { id, mission: m.address }, NOW + 3_600);
      const mirror = await settlements(NOW + 8 * 86_400, relays([settled], (u) => u === MISSION_RELAYS[1]));
      expect(mirror.standing.get(id)).toMatchObject({ how: 'poster' });
      expect(sent()[0]!.final).toBeUndefined();
      await settlements(NOW + 8 * 86_400, relays([settled], (u) => u === THE_RECORD));
      expect(sent()[0]).toMatchObject({ final: { how: 'poster' }, finalWhole: true });
    });

    it('keeps an open report’s verdict once The Record and the shipped relays answered: never without The Record, never waiting on the mirror', async () => {
      const id = await fileOne();
      const noRecord = await settlements(NOW + 8 * 86_400, relays([], (u) => u !== THE_RECORD));
      expect(noRecord.standing.get(id)).toMatchObject({ state: 'settled', how: 'silence' });
      expect(sent()[0]!.final).toBeUndefined();
      const noMirror = await settlements(NOW + 8 * 86_400, relays([], (u) => u !== MISSION_RELAYS[1]));
      expect(noMirror.standing.get(id)).toMatchObject({ state: 'settled', how: 'silence' });
      expect(sent()[0]).toMatchObject({ final: { how: 'silence' }, finalWhole: true });
    });

    /*
     * The other half of clearing what an earlier version kept: a verdict this version kept from a
     * whole read stands, offline, and is not asked for again. Cleared on every load, every settled
     * report would read Unknown with no signal and be read again on every open [review].
     */
    it('keeps a verdict from a whole read, and shows it offline without asking for it again', async () => {
      const id = await fileOne();
      await settlements(NOW + 8 * 86_400, relays([], () => true));
      const kept = sent()[0]!.final;
      expect(kept).toMatchObject({ state: 'settled', how: 'silence' });
      let asked = 0;
      const offline: Wire = {
        publish: async () => 'took',
        query: async (_urls, f) => {
          if (f.kinds?.includes(KIND_LABEL)) asked += 1;
          return { events: [], answered: [] };
        }
      };
      const later = await settlements(NOW + 9 * 86_400, offline);
      expect(later.standing.get(id)).toEqual(kept);
      expect(sent()[0]).toMatchObject({ final: kept, finalWhole: true });
      expect(asked).toBe(0);
    });
  });
});
