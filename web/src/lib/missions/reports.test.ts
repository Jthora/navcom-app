import { beforeEach, describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import type { Filter } from 'nostr-tools/filter';
import { buildDeletion, buildReport, buildReportLabel, readMissionPackage, type Mission } from '@navcom/core';
import { clearField, set } from '$lib/terminal/storage';
import { ensureContactKey } from '$lib/terminal/card';
import { takePart, tookPart, type Wire } from './claims';
import { fileReport, labelReport, localDay, reportableDays, reportsOn, sent, settlements, withdraw } from './reports';

/**
 * Reporting from this device: never today, a warning before a series, sealed or open, withdrawn
 * honestly, and settled by what the labels say. The relays are a fake that records what it was
 * given.
 */

const NOW = 1791403200; // 8 Oct 2026, 08:00 UTC
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
    query: async () => answers
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
    expect(await withdraw(r.sent.id, NOW + 60, w)).toBe(true);
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
    const refused: Wire = { publish: async () => false, query: async () => [] };
    expect(await withdraw(r.sent.id, NOW + 60, refused)).toBe(false);
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
    expect(await withdraw(listed.id, NOW + 60, w)).toBe(false);
  });
});

describe('where reports stand', () => {
  it('reads the poster’s settlement from the labels on the report', async () => {
    const { w } = fakeWire();
    const r = await fileReport(mission('a'), draft(localDay(NOW - 86_400)), 'open', NOW, {}, w);
    if (!r.ok) throw new Error('not sent');
    const settled = finalizeEvent(
      {
        kind: 1985,
        created_at: NOW + 3_600,
        content: '',
        tags: [['L', 'navcom.mission'], ['l', 'settled', 'navcom.mission'], ['e', r.sent.id]]
      },
      posterSecret
    );
    const map = await settlements(NOW + 7_200, fakeWire([settled]).w);
    expect(map.standing.get(r.sent.id)).toMatchObject({ state: 'settled', how: 'poster', by: poster });
    const silent = await settlements(NOW + 7_200, fakeWire([]).w);
    expect(silent.standing.get(r.sent.id)).toMatchObject({ state: 'pending' });
  });
});

describe('missions taken part in', () => {
  it('are remembered when a claim is made, so the work can be reported after the claim lapses', async () => {
    const { w } = fakeWire();
    await takePart(mission('a'), 'open', NOW, w);
    expect(tookPart(NOW + 2 * 86_400).map((t) => t.mission.d)).toEqual(['a']);
  });
});

/** A relay that answers each query with what matches it, the way a relay filters. */
function relayOf(events: Event[]) {
  const published: Event[] = [];
  const matches = (e: Event, f: Filter) =>
    (!f.kinds || f.kinds.includes(e.kind)) &&
    (!f.authors || f.authors.includes(e.pubkey)) &&
    (!f['#a'] || e.tags.some((t) => t[0] === 'a' && f['#a']!.includes(t[1]!))) &&
    (!f['#e'] || e.tags.some((t) => t[0] === 'e' && f['#e']!.includes(t[1]!)));
  const w: Wire = {
    publish: async (_urls, event) => {
      published.push(event);
      return true;
    },
    query: async (_urls, f) => [...events, ...published].filter((e) => matches(e, f))
  };
  return { w, published };
}

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
    const read = await reportsOn(m, w);
    expect(read.reports.map((r) => r.id)).toEqual([kept.id]);
    expect(read.reports[0]!.report.mission!.counts).toEqual([{ line: 'Water handed out: a count', n: 9 }]);
    expect(read.names.get(getPublicKey(other))).toBe('Wren');
    expect(read.names.get(getPublicKey(challenger))).toBe('Heron');
  });

  it('does not show one its author withdrew, whatever a relay still serves, and ignores anybody else asking', async () => {
    const r = said();
    const theirs = buildDeletion(other, r.id, 1912, NOW);
    expect((await reportsOn(m, relayOf([r, theirs]).w)).reports).toEqual([]);
    const somebodyElses = buildDeletion(generateSecretKey(), r.id, 1912, NOW);
    expect((await reportsOn(m, relayOf([r, somebodyElses]).w)).reports).toHaveLength(1);
  });

  it('asks relays by mission, never by report, so no relay learns which reports a device cares about', async () => {
    const asked: Filter[] = [];
    const w: Wire = { publish: async () => true, query: async (_u, f) => (asked.push(f), []) };
    await reportsOn(m, w);
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
    const refused: Wire = { publish: async () => false, query: async () => [] };
    expect(await labelReport('challenged', theirs(), m, NOW, refused)).toMatchObject({ ok: false, because: 'not-sent' });
  });
});
