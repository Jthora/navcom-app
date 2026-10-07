import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';
import {
  CHALLENGE_WINDOW_SECONDS,
  ReportError,
  againstMission,
  buildReport,
  buildReportLabel,
  buildSealedReport,
  posterOf,
  readReport,
  settlementOf,
  withdrawnReports,
  type Report
} from '../src/events/report';
import { KIND_REPORT } from '../src/events/kinds';
import { buildDeletion } from '../src/missions/claim';
import type { Mission } from '../src/missions/package';

/**
 * Kind 1912: an operator's own account of their own work [interchange spec §5.2]. Every rule a
 * report keeps is tested on what a hand-rolled client could send, not only on what our builder makes.
 */

const NOW = 1791403200; // 8 Oct 2026, 08:00 UTC
const contact = generateSecretKey();
const posterSecret = generateSecretKey();
const poster = getPublicKey(posterSecret);
const ADDRESS = `30079:${poster}:starcom_mission_package_field-heat_relief-CA-2026-10-02`;
const DESCRIPTOR = 'white male, 30s, red jacket, seen near the corner';

const missionReport = (over: Partial<Report> = {}): Report => ({
  callsign: 'Kestrel',
  date: '2026-10-07',
  mission: {
    address: ADDRESS,
    asks: ['handout:water'],
    counts: [{ line: 'Water and cards handed out: a count', n: 48 }]
  },
  ...over
});

const mission = {
  address: ADDRESS,
  objectives: [{ id: 'handout:water' }, { id: 'check:neighbour' }],
  effect: ['Water and cards handed out: a count']
} as unknown as Mission;

/** Sign whatever a hand-rolled client might, so the reader is tested on it. */
const forge = (content: Record<string, unknown>, tags: string[][]) =>
  finalizeEvent({ kind: KIND_REPORT, created_at: NOW, content: JSON.stringify(content), tags }, contact);

describe('a mission report', () => {
  const e = buildReport(contact, missionReport(), NOW);

  it('names the package and the objectives, in tags, and nothing else', () => {
    expect(e.kind).toBe(KIND_REPORT);
    expect(verifyEvent(e)).toBe(true);
    expect(e.tags).toEqual([
      ['a', ADDRESS],
      ['ask', 'handout:water']
    ]);
  });

  it('carries a callsign, a day, and counts of the poster’s own lines — no time, no place, no words', () => {
    expect(JSON.parse(e.content)).toEqual({
      callsign: 'Kestrel',
      date: '2026-10-07',
      counts: [{ line: 'Water and cards handed out: a count', n: 48 }]
    });
  });

  it('reads back as it was written', () => {
    expect(readReport(e)).toEqual({ id: e.id, author: e.pubkey, report: missionReport(), at: NOW });
  });

  it('knows its poster from the mission it names', () => {
    expect(posterOf(ADDRESS)).toBe(poster);
    expect(posterOf('not a mission')).toBeNull();
  });
});

describe('what a report refuses to say', () => {
  const refuses = (r: Report, why: RegExp) => expect(() => buildReport(contact, r, NOW)).toThrow(why);

  it('a day that has not happened', () => refuses(missionReport({ date: '2026-10-12' }), /not happened/));
  it('a place beside a mission', () => refuses(missionReport({ region: 'clarke-ga' }), /place from the mission/));
  it('a mission report with no objective', () =>
    refuses(missionReport({ mission: { address: ADDRESS, asks: [], counts: [] } }), /objectives/));
  it('a count that is not a whole number', () =>
    refuses(missionReport({ mission: { address: ADDRESS, asks: ['a'], counts: [{ line: 'x', n: 2.5 }] } }), /whole number/));
  it('a recap without the kind of work', () => refuses({ callsign: 'Kestrel', date: '2026-10-07' }, /kind of work/));
  it('work from outside the vocabulary', () =>
    refuses({ callsign: 'Kestrel', date: '2026-10-07', does: ['stakeout'] }, /not a kind of work/));
  it('no callsign', () => {
    expect(() => buildReport(contact, missionReport({ callsign: ' ' }), NOW)).toThrow(ReportError);
  });
});

describe('a description of a person has nowhere to go', () => {
  it('refuses a report carrying a field the contract does not have', () => {
    expect(readReport(forge({ callsign: 'Kestrel', date: '2026-10-07', does: ['supplies'], notes: DESCRIPTOR }, []))).toBeNull();
  });

  it('refuses a report carrying a region tag or a topic tag', () => {
    const content = { callsign: 'Kestrel', date: '2026-10-07', does: ['supplies'] };
    expect(readReport(forge(content, [['g', '9q8y']]))).toBeNull();
    expect(readReport(forge(content, [['t', 'patrol']]))).toBeNull();
  });

  it('drops a count whose line the poster never wrote, so a forged line never reaches a screen', () => {
    const forged = forge(
      { callsign: 'Kestrel', date: '2026-10-07', counts: [{ line: DESCRIPTOR, n: 1 }, { line: 'Water and cards handed out: a count', n: 3 }] },
      [['a', ADDRESS], ['ask', 'handout:water'], ['ask', 'not:an:objective']]
    );
    const read = readReport(forged)!;
    expect(read).not.toBeNull();
    const shown = againstMission(read.report, mission);
    expect(shown.mission!.counts).toEqual([{ line: 'Water and cards handed out: a count', n: 3 }]);
    expect(shown.mission!.asks).toEqual(['handout:water']);
  });

  it('refuses one whose signature does not verify', () => {
    const e = buildReport(contact, missionReport(), NOW);
    expect(readReport({ ...e, content: e.content.replace('48', '480') })).toBeNull();
  });
});

describe('a recap, with no mission', () => {
  it('names the kind of work and may name a region, in the content and never as a tag', () => {
    const e = buildReport(contact, { callsign: 'Kestrel', date: '2026-10-07', does: ['supplies'], region: 'clarke-ga' }, NOW);
    expect(e.tags).toEqual([]);
    expect(JSON.parse(e.content)).toEqual({ callsign: 'Kestrel', date: '2026-10-07', does: ['supplies'], region: 'clarke-ga' });
    expect(readReport(e)?.report.region).toBe('clarke-ga');
  });
});

describe('a report for the poster alone', () => {
  const { wrap, inner } = buildSealedReport(contact, missionReport(), NOW);

  it('goes to the poster the mission names, and shows a relay nothing else', () => {
    expect(wrap.kind).toBe(1059);
    expect(wrap.tags).toEqual([['p', poster]]);
    expect(wrap.pubkey).not.toBe(getPublicKey(contact));
  });

  it('opens, for the poster, to the same report, by the claimant, under the id its labels will name', () => {
    const seal = JSON.parse(nip44.decrypt(wrap.content, nip44.getConversationKey(posterSecret, wrap.pubkey)));
    expect(verifyEvent(seal)).toBe(true);
    const rumor = JSON.parse(nip44.decrypt(seal.content, nip44.getConversationKey(posterSecret, seal.pubkey)));
    expect(rumor.pubkey).toBe(seal.pubkey);
    expect(rumor.id).toBe(inner);
    expect(readReport(rumor, { signed: false })?.report).toEqual(missionReport());
  });

  it('cannot be sealed without a mission, which is where its poster comes from', () => {
    expect(() => buildSealedReport(contact, { callsign: 'Kestrel', date: '2026-10-07', does: ['supplies'] }, NOW)).toThrow(/mission/);
  });
});

describe('where a report stands', () => {
  const report = { id: 'f'.repeat(64), author: getPublicKey(contact), at: NOW };
  const label = (secret: Uint8Array, l: string, at = NOW + 3_600) =>
    finalizeEvent(
      {
        kind: 1985,
        created_at: at,
        content: '',
        tags: [['L', 'navcom.mission'], ['l', l, 'navcom.mission'], ['e', report.id], ['a', ADDRESS]]
      },
      secret
    );

  it('waits seven days for a challenge', () => {
    expect(settlementOf(report, poster, [], NOW + 60)).toEqual({ state: 'pending', until: NOW + CHALLENGE_WINDOW_SECONDS, challengedBy: [] });
  });

  it('is settled by the poster, and only by the poster', () => {
    expect(settlementOf(report, poster, [label(posterSecret, 'settled')], NOW + 7_200)).toMatchObject({ state: 'settled', how: 'poster' });
    expect(settlementOf(report, poster, [label(generateSecretKey(), 'settled')], NOW + 7_200).state).toBe('pending');
  });

  it('is settled by a witness who is not the reporter', () => {
    expect(settlementOf(report, poster, [label(generateSecretKey(), 'witnessed')], NOW + 7_200)).toMatchObject({ state: 'settled', how: 'witness' });
    expect(settlementOf(report, poster, [label(contact, 'witnessed')], NOW + 7_200).state).toBe('pending');
  });

  it('settles by itself after seven days of silence', () => {
    expect(settlementOf(report, poster, [], NOW + CHALLENGE_WINDOW_SECONDS)).toEqual({
      state: 'settled', how: 'silence', at: NOW + CHALLENGE_WINDOW_SECONDS, challengedBy: []
    });
  });

  it('names a challenge and reverses nothing; a late one counts for nothing', () => {
    const challenger = generateSecretKey();
    const s = settlementOf(report, poster, [label(challenger, 'challenged'), label(posterSecret, 'settled')], NOW + 7_200);
    expect(s).toMatchObject({ state: 'settled', how: 'poster', challengedBy: [getPublicKey(challenger)] });
    const late = label(generateSecretKey(), 'challenged', NOW + CHALLENGE_WINDOW_SECONDS + 1);
    expect(settlementOf(report, poster, [late], NOW + CHALLENGE_WINDOW_SECONDS + 2).challengedBy).toEqual([]);
  });

  it('names who settled it, when somebody did', () => {
    const witness = generateSecretKey();
    expect(settlementOf(report, poster, [label(witness, 'witnessed')], NOW + 7_200)).toMatchObject({ how: 'witness', by: getPublicKey(witness) });
    expect(settlementOf(report, poster, [label(posterSecret, 'settled')], NOW + 7_200)).toMatchObject({ how: 'poster', by: poster });
  });

  it('ignores a label whose signature does not verify', () => {
    const forged = { ...label(posterSecret, 'settled'), created_at: NOW + 1 };
    expect(settlementOf(report, poster, [forged], NOW + 7_200).state).toBe('pending');
  });
});

describe('a label on somebody’s report', () => {
  const id = 'e'.repeat(64);
  const signer = generateSecretKey();

  it('names the report and the mission, says one word, and carries no text', () => {
    const l = buildReportLabel(signer, 'challenged', { id, mission: ADDRESS }, NOW);
    expect(verifyEvent(l)).toBe(true);
    expect(l.kind).toBe(1985);
    expect(l.content).toBe('');
    expect(l.tags).toEqual([
      ['L', 'navcom.mission'],
      ['l', 'challenged', 'navcom.mission'],
      ['e', id],
      ['a', ADDRESS]
    ]);
  });

  it('is read by the settlement reader as what it says', () => {
    const report = { id, author: getPublicKey(contact), at: NOW };
    const witnessed = buildReportLabel(signer, 'witnessed', { id, mission: ADDRESS }, NOW + 60);
    expect(settlementOf(report, poster, [witnessed], NOW + 120)).toMatchObject({ state: 'settled', how: 'witness', by: getPublicKey(signer) });
  });

  it('refuses anything that is not a report on a mission', () => {
    expect(() => buildReportLabel(signer, 'stakeout' as never, { id, mission: ADDRESS }, NOW)).toThrow(ReportError);
    expect(() => buildReportLabel(signer, 'witnessed', { id: 'not-an-id', mission: ADDRESS }, NOW)).toThrow(/event id/);
    expect(() => buildReportLabel(signer, 'witnessed', { id, mission: 'somewhere' }, NOW)).toThrow(/mission/);
  });
});

describe('a report its author withdrew', () => {
  const r = buildReport(contact, missionReport(), NOW);
  const mine = [{ id: r.id, author: r.pubkey }];

  it('is gone once its author asks, and not when anybody else does', () => {
    expect(withdrawnReports(mine, [buildDeletion(contact, r.id, KIND_REPORT, NOW + 60)])).toEqual(new Set([r.id]));
    expect(withdrawnReports(mine, [buildDeletion(generateSecretKey(), r.id, KIND_REPORT, NOW + 60)]).size).toBe(0);
  });

  it('stays when the request does not verify', () => {
    const forged = { ...buildDeletion(contact, r.id, KIND_REPORT, NOW + 60), created_at: NOW + 61 };
    expect(withdrawnReports(mine, [forged]).size).toBe(0);
  });
});
