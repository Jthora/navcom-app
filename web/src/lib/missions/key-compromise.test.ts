import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import {
  FROZEN_SETS,
  buildReportLabel,
  frozenDigest,
  readMissionPackage,
  type FrozenSet,
  type Mission,
  type MissionPublishers,
  type PublisherKey
} from '@navcom/core';
import { set } from '$lib/terminal/storage';
import { collect } from './collect';
import { refusal, retiringOf, takePart, tookPart, type Wire } from './claims';
import { REPORT_DAYS, STRETCH_DAYS, fileReport, localDay, reportAgain, reportableDays, sent, settlements } from './reports';
import { trustedKey } from './registry-fixture';
import { leakedSentences } from './leaked';
import { leakedLine, secondUtc } from '$lib/components/missions/format';

/**
 * Mecha Jono's exposed key, as this device meets it [decided 2026-10-18; interchange spec rev 7].
 * Every key here is a test key in the state the decision is about — frozen, exposed, not yet
 * trusted, succeeded — since no test holds Mecha Jono's secrets. The browser tests drive the same
 * rules on the built site [e2e/key-compromise.spec.ts].
 */

const pk = getPublicKey;
const secs = (iso: string) => Date.parse(iso) / 1000;
const old = generateSecretKey();
const next = generateSecretKey();
const INBOX = 'wss://inbox.example';

/** A publisher with the keys given, its inbox pinned. */
const desk = (keys: PublisherKey[]): MissionPublishers => [{ id: 'desk', name: 'Test Desk', agent: true, inbox: [INBOX], keys, next: null }];

function pkg(secret: Uint8Array, d: string, at: number, o: { title?: string; state?: string; ends?: number; extra?: string[][] } = {}): Event {
  return finalizeEvent(
    {
      kind: 30079,
      created_at: at,
      content: JSON.stringify({
        name: o.title ?? d,
        objectives: [{ id: 'handout:water', ask: 'Hand out water.' }],
        metadata: { mechaJono: { format: { effect: ['Water handed out: a count'] } } }
      }),
      tags: [
        ['d', d], ['t', 'starcom_mission_package'], ['t', 'navcom_handoff'], ['t', 'navcom_mission'],
        ['mission_state', o.state ?? 'open'], ['valid_until', String(o.ends ?? at + 60 * 86_400)], ['jurisdiction', 'us-ca'],
        ...(o.extra ?? [])
      ]
    },
    secret
  );
}
const titles = (c: ReturnType<typeof collect>) => c.missions.map((m) => m.title).sort();

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

describe('which versions a device keeps, before anything else is asked of them', () => {
  const AT = secs('2026-10-18T12:00:00Z');
  const NOW = new Date(AT * 1000);

  it('ranks a higher generation first at the same d, whatever date the lower one carries', () => {
    const r = desk([trustedKey(pk(old)), trustedKey(pk(next), { generation: 2 })]);
    const c = collect([pkg(next, 'x', AT - 86_400, { title: 'Second generation' }), pkg(old, 'x', AT - 60, { title: 'First, dated later' })], NOW, r);
    expect(titles(c)).toEqual(['Second generation']);
  });

  it('drops a package under a key with no start, and it replaces nothing', () => {
    const r = desk([trustedKey(pk(old)), { pubkey: pk(next), generation: 2, notAfter: '2100-01-01T00:00:00Z' }]);
    const c = collect([pkg(old, 'x', AT - 86_400, { title: 'Genuine' }), pkg(next, 'x', AT - 60, { title: 'Under the key with no start', state: 'closed' })], NOW, r);
    expect(titles(c)).toEqual(['Genuine']);
    expect(c.refused).toEqual([]);
  });

  it('drops a second-generation package dated before its key’s start, though the start has passed', () => {
    const r = desk([trustedKey(pk(old)), trustedKey(pk(next), { generation: 2, notBefore: '2026-10-10T00:00:00Z' })]);
    const c = collect([pkg(old, 'x', secs('2026-10-08T00:00:00Z'), { title: 'First' }), pkg(next, 'x', secs('2026-10-09T00:00:00Z'), { title: 'In the gap' })], NOW, r);
    expect(titles(c)).toEqual(['First']);
  });

  it('shows nothing under a key whose end has passed on the trust clock, whatever date it carries and whatever this device’s clock says', () => {
    const r = desk([trustedKey(pk(old), { notAfter: '2026-10-15T00:00:00Z' })]);
    const early = pkg(old, 'x', secs('2026-10-01T00:00:00Z'), { ends: secs('2026-12-01T00:00:00Z') });
    const phone = new Date('2026-10-02T00:00:00Z');
    expect(collect([early], phone, r).missions).toHaveLength(1);
    // The build was made on 18 October: the phone's clock is floored there.
    expect(collect([early], phone, r, undefined, { at: AT }).missions).toEqual([]);
  });

  describe('a frozen key', () => {
    const listed = pkg(old, 'listed', secs('2026-10-05T00:00:00Z'), { title: 'Listed' });
    const list: FrozenSet = { key: pk(old), taken: '2026-10-18', source: 'a test', packages: [{ id: listed.id, d: 'listed' }] };
    const frozen = (confirmed: boolean, sha256 = frozenDigest(list)) => desk([trustedKey(pk(old), { exposed: '2026-09-28', frozen: { sha256, confirmed } })]);

    it('keeps its list, drops what is not on it, and keeps a version that closes one of the list’s missions', () => {
      const stray = pkg(old, 'stray', secs('2026-10-06T00:00:00Z'), { title: 'Stray' });
      const forged = pkg(old, 'listed', secs('2026-10-06T00:00:00Z'), { title: 'Forged' });
      expect(titles(collect([listed, stray, forged], NOW, frozen(true), undefined, { sets: [list] }))).toEqual(['Listed']);
      const closes = pkg(old, 'listed', secs('2026-10-06T00:00:00Z'), { state: 'closed' });
      expect(collect([listed, closes], NOW, frozen(true), undefined, { sets: [list] }).missions).toEqual([]);
    });

    it('keeps nothing when no list for it is on hand', () => {
      expect(collect([listed], NOW, frozen(true), undefined, { sets: [] }).missions).toEqual([]);
    });

    it('until the list is confirmed, shows a mission on it at its jurisdiction only, and it cannot be taken', () => {
      const placed = pkg(old, 'placed', secs('2026-10-05T00:00:00Z'), { extra: [['geo', 'lat:36.77,lon:-119.41'], ['geo_kind', 'subject_location'], ['geo_precision', '1km']] });
      const mine: FrozenSet = { ...list, packages: [{ id: placed.id, d: 'placed' }] };
      const [m] = collect([placed], NOW, frozen(false, frozenDigest(mine)), undefined, { sets: [mine] }).missions;
      expect(m!.placement).toEqual({ jurisdiction: 'us-ca', point: null });
      expect(m!.retiring).toBe('unconfirmed');
      expect(refusal(m!, AT)).toBe('retiring');
      const [confirmed] = collect([placed], NOW, frozen(true, frozenDigest(mine)), undefined, { sets: [mine] }).missions;
      expect(confirmed!.placement.point).not.toBeNull();
      expect(refusal(confirmed!, AT)).toBeNull();
    });
  });

  it('reads the real heat campaign as Mecha Jono’s, retiring and unconfirmed, and it cannot be taken — signed on or not', () => {
    const [HEAT] = JSON.parse(readFileSync(new URL('../../../../packages/core/test/fixtures/mission-packages.json', import.meta.url), 'utf8'));
    const during = new Date('2026-10-06T20:00:00Z');
    // The fixture predates the pinned set's newer version of the same mission; a set naming it
    // stands in for that version under the shipped key.
    const asCaptured: FrozenSet = { ...FROZEN_SETS[0]!, packages: [{ id: HEAT.id, d: HEAT.tags.find((t: string[]) => t[0] === 'd')[1] }] };
    const [m] = collect([HEAT], during, undefined, undefined, { sets: [asCaptured] }).missions;
    expect(m).toMatchObject({ publisher: { entry: 'mecha-jono', generation: 1 }, retiring: 'unconfirmed' });
    expect(refusal(m!, secs('2026-10-06T20:00:00Z'))).toBe('retiring');
    set('accruing', 'secret', '');
    expect(refusal(m!, secs('2026-10-06T20:00:00Z'))).toBe('retiring');
    // A mission kept by a build from before 2026-10-18 says nothing of it: the registry is asked by key.
    const { retiring: _r, ...kept } = m!;
    expect(retiringOf(kept as Mission)).toBe('unconfirmed');
    // The shipped set names this mission, by a newer version than this 6 October copy.
    const d = HEAT.tags.find((t: string[]) => t[0] === 'd')[1];
    expect(FROZEN_SETS[0]!.packages.map((p) => p.d)).toContain(d);
    expect(FROZEN_SETS[0]!.packages.map((p) => p.id)).not.toContain(HEAT.id);
  });
});

describe('sealed sending, while its only key trusted to sign is exposed', () => {
  /** A wire that records what was sent and asked, under `registry`. */
  function wire(registry: MissionPublishers, answers: Event[] = []) {
    const sentEvents: { urls: string[]; event: Event }[] = [];
    const asked: unknown[] = [];
    const w: Wire = {
      publish: async (urls, event) => (sentEvents.push({ urls, event }), 'took'),
      query: async (urls, f) => (asked.push(f), { events: answers, answered: urls }),
      publishers: registry
    };
    return { w, sentEvents, asked };
  }

  const AT = secs('2030-01-10T20:00:00Z');
  const exposed = desk([trustedKey(pk(old), { exposed: '2026-09-28' })]);
  const read = (registry: MissionPublishers, e: Event) => {
    const r = readMissionPackage(e, registry);
    if (!r.ok) throw new Error(r.because);
    return r.mission;
  };

  it('builds, sends and lists nothing sealed, and says why; the open report goes', async () => {
    const m = read(exposed, pkg(old, 'x', AT - 5 * 86_400));
    const { w, sentEvents, asked } = wire(exposed);
    expect((await takePart(m, 'open', AT - 3 * 86_400, w)).ok).toBe(true);
    const draft = { date: localDay(AT - 86_400), asks: ['handout:water'], counts: [] };
    expect(await fileReport(m, draft, 'sealed', AT, {}, w)).toEqual({
      ok: false,
      because: 'not-sent',
      detail:
        "Sealed sending to Test Desk is paused: its key's secret leaked, so whoever holds it could open anything sealed to it. Nothing is kept on this phone; come back once Test Desk reads under a new key. Nothing was sent."
    });
    expect(sentEvents.map((s) => s.event.kind)).toEqual([1985]);
    expect(asked).toEqual([]);
    expect(sent()).toEqual([]);
    expect((await fileReport(m, draft, 'open', AT, {}, w)).ok).toBe(true);
  });

  it('does not send again a sealed report kept from before, to the key that leaked', async () => {
    const m = read(exposed, pkg(old, 'x', AT - 5 * 86_400));
    const fine = desk([trustedKey(pk(old))]);
    // Sent before the exposure was known, and no relay confirmed it.
    const before = wire(fine);
    before.w.publish = async () => 'unconfirmed' as const;
    await takePart(m, 'open', AT - 3 * 86_400, before.w);
    const r = await fileReport(m, { date: localDay(AT - 86_400), asks: ['handout:water'], counts: [] }, 'sealed', AT, {}, before.w);
    expect(r).toMatchObject({ ok: false, because: 'unconfirmed' });
    const { w, sentEvents } = wire(exposed);
    expect(await reportAgain(sent()[0]!, w)).toEqual({ nowhere: expect.stringMatching(/^No relay confirmed it; it may have arrived\. Sealed sending to Test Desk is paused/) });
    expect(sentEvents).toEqual([]);
  });

  it('counts no settled label a key whose secret leaked signs, and asks nobody for one on a sealed report', async () => {
    const fine = desk([trustedKey(pk(old))]);
    const m = read(fine, pkg(old, 'x', AT - 5 * 86_400));
    const first = wire(fine);
    await takePart(m, 'open', AT - 3 * 86_400, first.w);
    const filed = await fileReport(m, { date: localDay(AT - 86_400), asks: ['handout:water'], counts: [] }, 'sealed', AT, {}, first.w);
    if (!filed.ok) throw new Error(String(filed.because));
    const settled = buildReportLabel(old, 'settled', { id: filed.sent.id, mission: m.address }, AT + 3_600);
    // Before the leak, the poster's word settles it; once its key is marked exposed, it does not.
    expect((await settlements(AT + 7_200, wire(fine, [settled]).w)).standing.get(filed.sent.id)).toMatchObject({ state: 'settled', how: 'poster' });
    const after = wire(exposed, [settled]);
    expect((await settlements(AT + 7_200, after.w)).standing.get(filed.sent.id)).toMatchObject({ state: 'pending' });
    expect(after.asked).toEqual([]);
  });

  /*
   * An earlier build kept a verdict once its seven days were up, and never asked again. One it kept
   * from the old key's label — a witness, or the poster's word, both counted then — would go on
   * showing under the publisher's name on every later build: a copy kept before cannot carry back in
   * what this build refuses [rev 7].
   */
  it('reads again a verdict an earlier build kept from a label under the key that leaked', async () => {
    const fine = desk([trustedKey(pk(old))]);
    const m = read(fine, pkg(old, 'x', AT - 5 * 86_400));
    const first = wire(fine);
    await takePart(m, 'open', AT - 3 * 86_400, first.w);
    const filed = await fileReport(m, { date: localDay(AT - 86_400), asks: ['handout:water'], counts: [] }, 'open', AT, {}, first.w);
    if (!filed.ok) throw new Error(String(filed.because));
    const later = AT + 8 * 86_400;
    const witnessed = buildReportLabel(old, 'witnessed', { id: filed.sent.id, mission: m.address }, AT + 3_600);
    // Kept as final while the key was still trusted, as every build before this one did.
    expect((await settlements(later, wire(fine, [witnessed]).w)).standing.get(filed.sent.id)).toMatchObject({ how: 'witness', by: pk(old) });
    expect(sent()[0]!.final).toMatchObject({ how: 'witness' });
    // Now the key is known to have leaked: the kept verdict is read again, and it settled by silence.
    const after = await settlements(later, wire(desk([trustedKey(pk(old), { exposed: '2026-09-28' })]), [witnessed]).w);
    expect(after.standing.get(filed.sent.id)).toMatchObject({ state: 'settled', how: 'silence', challengedBy: [] });
    expect(sent()[0]!.final).toMatchObject({ how: 'silence' });
  });
});

describe('when sealed sending resumes', () => {
  const S = secs('2030-02-01T00:00:00Z');
  const switched = desk([trustedKey(pk(old), { exposed: '2026-09-28' }), trustedKey(pk(next), { generation: 2, notBefore: '2030-02-01T00:00:00Z' })]);
  const m = (() => {
    const r = readMissionPackage(pkg(old, 'gap', S - 25 * 86_400, { ends: S + 30 * 86_400 }), switched);
    if (!r.ok) throw new Error(r.because);
    return r.mission;
  })();
  const w: Wire = { publish: async () => 'took', query: async (urls) => ({ events: [], answered: urls }), publishers: switched };

  it('reaches back 30 days for a week after the switch, and the usual week after that', async () => {
    expect((await takePart(m, 'open', S - 20 * 86_400, w)).ok).toBe(true);
    const took = tookPart(S + 3 * 86_400, switched).find((t) => t.mission.address === m.address)!;
    const during = reportableDays(S + 3 * 86_400, took, switched);
    expect(during).toHaveLength(23); // from the day it was taken, 20 days before the switch, to yesterday
    expect(during.at(-1)).toBe(localDay(S - 20 * 86_400));
    expect(reportableDays(S + 8 * 86_400, took, switched)).toHaveLength(REPORT_DAYS);
    // While still paused, the usual week.
    expect(reportableDays(S - 86_400, took, switched)).toHaveLength(REPORT_DAYS);
    expect(STRETCH_DAYS).toBe(30);
  });

  it('seals a report on the old key’s mission to the new key, and records which', async () => {
    await takePart(m, 'open', S - 20 * 86_400, w);
    const out: Event[] = [];
    const recording: Wire = { ...w, publish: async (_u, e) => (out.push(e), 'took') };
    const r = await fileReport(m, { date: localDay(S - 15 * 86_400), asks: ['handout:water'], counts: [] }, 'sealed', S + 86_400, {}, recording);
    expect(r.ok).toBe(true);
    expect(out[0]!.tags).toContainEqual(['p', pk(next)]);
    expect(sent()[0]).toMatchObject({ visibility: 'sealed', sealedTo: pk(next) });
  });
});

describe('what this device says of what it sealed to a key that leaked', () => {
  it('says on a report’s row who can open it, what it held and the second it was sent', () => {
    const line = leakedLine('report', 'Mecha Jono', '2026-09-28', secs('2026-10-08T03:14:15Z'));
    expect(line).toBe(
      "Sealed to Mecha Jono's old key. Its secret leaked on 28 September, so whoever holds it can open this report and show others it came from your card. It held your callsign, the day, the mission, the objectives you ticked, your counts and the second you sent it, 8 Oct, 03:14:15 UTC: no place, and nothing else from this phone."
    );
    expect(leakedLine('claim', 'Mecha Jono', '2026-09-28')).toBe(
      "Sealed to Mecha Jono's old key, whose secret leaked on 28 September: whoever holds it can see that your card took part in this mission, and the second you did."
    );
    expect(secondUtc(secs('2026-10-08T03:14:15Z'))).toBe('8 Oct, 03:14:15 UTC');
  });

  it('says it once, generally, on Status, from the registry: from the day sealing began, for Mecha Jono', () => {
    expect(leakedSentences()).toEqual([
      'Sealed claims and reports sent to Mecha Jono from 6 October can be opened by whoever holds its old key’s leaked secret, and shown to come from the card that sent them. Nothing is sealed to that key now.'
    ]);
    expect(leakedSentences(desk([trustedKey(pk(old))]))).toEqual([]);
  });
});
