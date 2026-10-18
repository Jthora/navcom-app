import { beforeEach, describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import { MISSION_PUBLISHERS, buildReportLabel, readMissionPackage, sealTargetOf, type Mission, type MissionPublishers, type PublisherKey } from '@navcom/core';
import { set } from '$lib/terminal/storage';
import { nowhereFor, takePart, tookPart, type Wire } from './claims';
import { fileReport, localDay, settlements, stillToReport } from './reports';
import { trustedKey } from './registry-fixture';
import { leakedSentences } from './leaked';

/**
 * The adversary's pass over the key-compromise phase [decided 2026-10-18; interchange spec rev 7]:
 * as the holder of Mecha Jono's old secret, and of its next one if that leaked too. Each `it` is a
 * break — something the decisions say a stolen key may not do, and the code still lets it.
 *
 * No test holds Mecha Jono's secrets, so a stolen key is a test key in the state the decision is
 * about, except where the real registry's own entries are the point.
 */

const pk = getPublicKey;
const secs = (iso: string) => Date.parse(iso) / 1000;
const MECHA_OLD = '6301c4d09a014909e5a48b7d0c9aa859eec18804c2fc87eab4e414aa5a319692';
const MECHA_NEXT = '86f824c3f1e67c60b1dc15ce110648c4de5c3fb879022fbbcc5e8deb720e402c';
const INBOX = 'wss://inbox.example';
const old = generateSecretKey();
const next = generateSecretKey();

const desk = (keys: PublisherKey[]): MissionPublishers => [{ id: 'desk', name: 'Test Desk', agent: true, inbox: [INBOX], keys, next: null }];

function pkg(secret: Uint8Array, d: string, at: number, ends = at + 60 * 86_400): Event {
  return finalizeEvent(
    {
      kind: 30079,
      created_at: at,
      content: JSON.stringify({ name: d, objectives: [{ id: 'handout:water', ask: 'Hand out water.' }] }),
      tags: [
        ['d', d], ['t', 'starcom_mission_package'], ['t', 'navcom_handoff'], ['t', 'navcom_mission'],
        ['mission_state', 'open'], ['valid_until', String(ends)], ['jurisdiction', 'us-ca']
      ]
    },
    secret
  );
}
const read = (registry: MissionPublishers, e: Event): Mission => {
  const r = readMissionPackage(e, registry);
  if (!r.ok) throw new Error(r.because);
  return r.mission;
};
function wire(registry: MissionPublishers, answers: Event[] = []) {
  const out: { urls: string[]; event: Event }[] = [];
  const w: Wire = {
    publish: async (urls, event) => (out.push({ urls, event }), 'took'),
    query: async (urls) => ({ events: answers, answered: urls }),
    publishers: registry
  };
  return { w, out };
}

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

describe('a label signed by a key whose secret leaked, on a report this device sent in the open', () => {
  const AT = secs('2030-01-10T20:00:00Z');
  /** The old key as Mecha Jono's is now: exposed and frozen. */
  const leaked = desk([trustedKey(pk(old), { exposed: '2026-09-28', frozen: { sha256: '0'.repeat(64), confirmed: false } })]);

  async function openReport() {
    const fine = desk([trustedKey(pk(old))]);
    const m = read(fine, pkg(old, 'x', AT - 5 * 86_400));
    const first = wire(fine);
    await takePart(m, 'open', AT - 3 * 86_400, first.w);
    const filed = await fileReport(m, { date: localDay(AT - 86_400), asks: ['handout:water'], counts: [] }, 'open', AT, {}, first.w);
    if (!filed.ok) throw new Error(String(filed.because));
    return { m, id: filed.sent.id };
  }

  it('does not settle it: "witnessed" under the leaked key is one of its labels, and none counts', async () => {
    const { m, id } = await openReport();
    const witnessed = buildReportLabel(old, 'witnessed', { id, mission: m.address }, AT + 3_600);
    const got = (await settlements(AT + 7_200, wire(leaked, [witnessed]).w)).standing.get(id);
    // Today: { state: 'settled', how: 'witness', by: <the leaked key> } — shown on Your missions as
    // "Settled, by a witness, <publisher's name> (<key>, an agent)", and kept as final after 7 days.
    expect(got).toMatchObject({ state: 'pending' });
  });

  it('does not list the leaked key among those who challenged it', async () => {
    const { m, id } = await openReport();
    const challenged = buildReportLabel(old, 'challenged', { id, mission: m.address }, AT + 3_600);
    const got = (await settlements(AT + 7_200, wire(leaked, [challenged]).w)).standing.get(id);
    expect(got?.challengedBy ?? []).not.toContain(pk(old));
  });

  it('does not settle it under a key NavCom does not trust to sign yet either', async () => {
    const { m, id } = await openReport();
    // Mecha Jono's next key today: in the registry, with no start.
    const notYet = desk([trustedKey(pk(old), { exposed: '2026-09-28' }), { pubkey: pk(next), generation: 2, notAfter: '2100-01-01T00:00:00Z' }]);
    const witnessed = buildReportLabel(next, 'witnessed', { id, mission: m.address }, AT + 3_600);
    const got = (await settlements(AT + 7_200, wire(notYet, [witnessed]).w)).standing.get(id);
    expect(got).toMatchObject({ state: 'pending' });
  });
});

describe('a phone that ran an earlier bundle: the missions it took part in, kept in its history', () => {
  const AT = secs('2026-10-20T20:00:00Z');
  /**
   * A mission as an earlier build kept it [claims.ts, `remember`]: the parsed mission, no event and
   * no id, under a key of the real registry. The deployed bundle (3516b7ee) trusted Mecha Jono's
   * next key at once, and every bundle before this one kept anything the old key signed.
   */
  function kept(poster: string, d: string): Mission {
    const stand = generateSecretKey();
    const m = read(desk([trustedKey(pk(stand))]), pkg(stand, d, AT - 5 * 86_400, secs('2099-12-31T00:00:00Z')));
    const { retiring: _r, ...earlier } = m;
    return { ...earlier, address: `30079:${poster}:${d}`, publisher: { pubkey: poster, name: 'Mecha Jono', agent: true } } as Mission;
  }
  const seed = (m: Mission) => set('wipeable', 'mission_history', [{ mission: m, since: AT - 3 * 86_400 }]);
  const draft = { date: localDay(AT - 86_400), asks: ['handout:water'], counts: [] };

  it('does not offer, or send, a report on a mission under the key with no start', async () => {
    const m = kept(MECHA_NEXT, 'planted-under-the-next-key');
    seed(m);
    const t = tookPart(AT).find((x) => x.mission.address === m.address);
    expect(t ? stillToReport(AT, t) : null, 'listed under "To report" on Your missions').toBeNull();
    const { w, out } = wire(MISSION_PUBLISHERS);
    const r = await fileReport(m, draft, 'open', AT, {}, w);
    expect(r.ok, 'an open report on it went to public relays, telling whoever signed it which card did the work').toBe(false);
    expect(out).toEqual([]);
  });

  it('does not offer, or send, a report on an old-key mission that is not on the frozen list', async () => {
    const m = kept(MECHA_OLD, 'planted-under-the-old-key-after-the-leak');
    seed(m);
    const t = tookPart(AT).find((x) => x.mission.address === m.address);
    expect(t ? stillToReport(AT, t) : null, 'listed under "To report" on Your missions').toBeNull();
    const { w, out } = wire(MISSION_PUBLISHERS);
    const r = await fileReport(m, draft, 'open', AT, {}, w);
    expect(r.ok).toBe(false);
    expect(out).toEqual([]);
  });
});

describe('what the screens say about sealing', () => {
  it('Status does not say what was sealed to the new key can be opened with the old one, once sealing resumes', () => {
    // The cut-over release as the build notes describe it: the same code, the next key given its start.
    const switched = desk([trustedKey(pk(old), { exposed: '2026-09-28' }), trustedKey(pk(next), { generation: 2, notBefore: '2030-02-01T00:00:00Z' })]);
    const [line] = leakedSentences(switched);
    // Today: "Sealed claims and reports sent to Test Desk from 6 October can be opened by whoever
    // holds its old key's leaked secret…" — with no end, so it covers everything sealed to the new key.
    expect(line).toMatch(/until 1 February/);
  });

  it('a pause for a key that merely ended is not said to be a leak', () => {
    const lapsed = desk([trustedKey(pk(old), { notAfter: '2030-01-01T00:00:00Z' })]);
    const target = sealTargetOf(pk(old), lapsed, secs('2030-01-10T00:00:00Z'));
    if (target.ok) throw new Error('expected no target');
    // Today: "Sealed sending to Test Desk is paused: its key's secret leaked…", of a key nobody exposed.
    expect(nowhereFor(target, 'Test Desk')).not.toMatch(/leaked/);
  });
});
