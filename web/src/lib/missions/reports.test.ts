import { beforeEach, describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import { readMissionPackage, type Mission } from '@navcom/core';
import { set } from '$lib/terminal/storage';
import { takePart, tookPart, type Wire } from './claims';
import { fileReport, localDay, reportableDays, sent, settlements, withdraw } from './reports';

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
    expect(map.get(r.sent.id)).toMatchObject({ state: 'settled', how: 'poster' });
    const silent = await settlements(NOW + 7_200, fakeWire([]).w);
    expect(silent.get(r.sent.id)).toMatchObject({ state: 'pending' });
  });
});

describe('missions taken part in', () => {
  it('are remembered when a claim is made, so the work can be reported after the claim lapses', async () => {
    const { w } = fakeWire();
    await takePart(mission('a'), 'open', NOW, w);
    expect(tookPart(NOW + 2 * 86_400).map((t) => t.mission.d)).toEqual(['a']);
  });
});
