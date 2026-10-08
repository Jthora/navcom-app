import { beforeEach, describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import type { Filter } from 'nostr-tools/filter';
import { DEFAULT_RELAYS, MISSION_RELAYS, buildDeletion, buildMissionClaim, buildReport, buildReportLabel, readMissionPackage, type Mission } from '@navcom/core';
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
  reportableDays,
  reportsOn,
  sent,
  settlements,
  stillToReport,
  withdraw
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
      return true;
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
    const refused: Wire = { publish: async () => false, query: async () => ({ events: [], answered: [] }) };
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
      return true;
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
    const w: Wire = { publish: async () => true, query: async (_u, f) => (asked.push(f), { events: [], answered: [] }) };
    await reportsOn(m, NOW, w);
    await fileReport(m, draft(localDay(NOW - 86_400)), 'open', NOW, {}, { ...w, publish: async () => true });
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
    const refused: Wire = { publish: async () => false, query: async () => ({ events: [], answered: [] }) };
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
    const silent: Wire = { publish: async () => true, query: async () => ({ events: [], answered: [] }) };
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
    const file = async (on: Mission, w: Wire, visibility: 'open' | 'sealed' = 'open') => {
      const r = await fileReport(on, draft(localDay(NOW - 86_400)), visibility, NOW, { series: true }, w);
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
        publish: async () => true,
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
      const open = await file(quiet, relay.w);
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
