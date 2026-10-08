import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey, verifyEvent } from 'nostr-tools/pure';
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
import { readMissionPackage, type Mission } from '../src/missions/package';

/**
 * Kind 1912: an operator's own account of their own work [interchange spec §5.2]. Every rule a
 * report keeps is tested on what a hand-rolled client could send, not only on what our builder makes.
 */

const NOW = 1791403200; // 7 Oct 2026, 20:00 UTC — so '2026-10-07' is the UTC day a report signed now was signed on
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

  /*
   * The poster settles a sealed report in public by the id inside the seal. Unsalted, that id is a
   * hash of a card's key and callsign, a day, the objectives and a second, and a reader holding
   * every card found the author in a tenth of a second [audit 11.S].
   */
  it('names its report by an id nobody can rebuild from the report: the same report sealed twice gets two ids', () => {
    const again = buildSealedReport(contact, missionReport(), NOW);
    expect(again.inner).not.toBe(inner);
    const open = (w: typeof wrap) => {
      const seal = JSON.parse(nip44.decrypt(w.content, nip44.getConversationKey(posterSecret, w.pubkey)));
      return JSON.parse(nip44.decrypt(seal.content, nip44.getConversationKey(posterSecret, seal.pubkey)));
    };
    const rumor = open(wrap);
    expect(JSON.parse(rumor.content).salt).toMatch(/^[0-9a-f]{32}$/);
    // Rebuilt from what a reader can guess, with every field the same but the salt, it is not the id.
    const { salt: _salt, ...guessable } = JSON.parse(rumor.content);
    const guessed = getEventHash({ ...rumor, content: JSON.stringify(guessable) });
    expect(guessed).not.toBe(inner);
  });

  it('carries its salt only inside a seal: an open report with one, or a seal with a bad one, is refused', () => {
    const openOne = buildReport(contact, missionReport(), NOW);
    const salted = finalizeEvent(
      { kind: openOne.kind, created_at: openOne.created_at, tags: openOne.tags, content: JSON.stringify({ ...JSON.parse(openOne.content), salt: 'a'.repeat(32) }) },
      contact
    );
    expect(readReport(salted)).toBeNull();
    const seal = JSON.parse(nip44.decrypt(wrap.content, nip44.getConversationKey(posterSecret, wrap.pubkey)));
    const rumor = JSON.parse(nip44.decrypt(seal.content, nip44.getConversationKey(posterSecret, seal.pubkey)));
    expect(readReport({ ...rumor, content: JSON.stringify({ ...JSON.parse(rumor.content), salt: 'not hex' }) }, { signed: false })).toBeNull();
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

  it('lets the poster’s settlement outrank a witness’s, whichever claims to be first', () => {
    const early = label(generateSecretKey(), 'witnessed', NOW + 60);
    const late = label(posterSecret, 'settled', NOW + 7_200);
    expect(settlementOf(report, poster, [early, late], NOW + 7_300)).toMatchObject({ how: 'poster' });
  });

  it('stops counting challenges the moment it settles by itself, not a second after', () => {
    const at = NOW + CHALLENGE_WINDOW_SECONDS;
    const onTheDeadline = label(generateSecretKey(), 'challenged', at);
    expect(settlementOf(report, poster, [onTheDeadline], at)).toMatchObject({ state: 'settled', how: 'silence', challengedBy: [] });
  });

  it('does not read a label from a clock more than a day ahead', () => {
    const fromTheFuture = label(generateSecretKey(), 'witnessed', NOW + 3 * 86_400);
    expect(settlementOf(report, poster, [fromTheFuture], NOW + 60).state).toBe('pending');
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

describe('repeats in a report', () => {
  it('are refused, never merged: a repeat is a mistake or a way to make a list misbehave', () => {
    const twice = forge({ callsign: 'Kestrel', date: '2026-10-07' }, [['a', ADDRESS], ['ask', 'handout:water'], ['ask', 'handout:water']]);
    expect(readReport(twice)).toBeNull();
    const lines = forge(
      { callsign: 'Kestrel', date: '2026-10-07', counts: [{ line: 'Water and cards handed out: a count', n: 1 }, { line: 'Water and cards handed out: a count', n: 2 }] },
      [['a', ADDRESS], ['ask', 'handout:water']]
    );
    expect(readReport(lines)).toBeNull();
  });

  it('says a count over the limit is over the limit, not that it is not a whole number', () => {
    expect(() => buildReport(contact, missionReport({ mission: { address: ADDRESS, asks: ['a'], counts: [{ line: 'x', n: 100_001 }] } }), NOW)).toThrow(/at most 100,000/);
  });
});

describe('what the second audit of Milestone 11 found', () => {
  const posterLabel = (secret: Uint8Array, word: string, reportId: string, at: number, over: { L?: string; ns?: string; kind?: number } = {}) =>
    finalizeEvent(
      {
        kind: over.kind ?? 1985,
        created_at: at,
        content: '',
        tags: [['L', over.L ?? 'navcom.mission'], ['l', word, over.ns ?? 'navcom.mission'], ['e', reportId], ['a', ADDRESS]]
      },
      secret
    );

  /*
   * Labels are asked for by mission, never by report [11.R], so every label on a mission reaches
   * the reader once per report, and the report's `e` is all that ties a label to its report.
   */
  it('reads a label on one report as saying nothing about another report on the same mission', () => {
    const wrenKey = generateSecretKey();
    const wrens = buildReport(wrenKey, missionReport({ callsign: 'Wren' }), NOW);
    const kestrels = buildReport(contact, missionReport(), NOW);
    const challenger = generateSecretKey();
    const labels = [
      posterLabel(posterSecret, 'settled', wrens.id, NOW + 60),
      posterLabel(generateSecretKey(), 'witnessed', wrens.id, NOW + 60),
      posterLabel(challenger, 'challenged', wrens.id, NOW + 60)
    ];
    const at = NOW + 3_600;
    expect(settlementOf({ id: wrens.id, author: wrens.pubkey, at: NOW }, poster, labels, at)).toMatchObject({
      state: 'settled', how: 'poster', challengedBy: [getPublicKey(challenger)]
    });
    expect(settlementOf({ id: kestrels.id, author: kestrels.pubkey, at: NOW }, poster, labels, at)).toEqual({
      state: 'pending', until: NOW + 604_800, challengedBy: []
    });
  });

  describe('the seven days, as a number of seconds rather than as the constant compared with itself', () => {
    const report = { id: 'f'.repeat(64), author: getPublicKey(contact), at: NOW };
    it('waits until the last second of the seventh day, and settles at the next', () => {
      expect(settlementOf(report, poster, [], NOW + 604_799).state).toBe('pending');
      expect(settlementOf(report, poster, [], NOW + 604_800)).toMatchObject({ state: 'settled', how: 'silence', at: NOW + 604_800 });
    });
    it('reads the poster’s and a witness’s settlement over silence when read after the seven days', () => {
      const day8 = NOW + 8 * 86_400;
      expect(settlementOf(report, poster, [posterLabel(posterSecret, 'settled', report.id, NOW + 3_600)], day8)).toMatchObject({ how: 'poster' });
      expect(settlementOf(report, poster, [posterLabel(generateSecretKey(), 'witnessed', report.id, NOW + 3_600)], day8)).toMatchObject({ how: 'witness' });
    });
  });

  describe('words where a date, a correction, a mission or a region go', () => {
    const recap = { callsign: 'Kestrel', does: ['supplies'] };
    const onMission = (content: Record<string, unknown>, a = ADDRESS) => forge({ callsign: 'Kestrel', ...content }, [['a', a], ['ask', 'handout:water']]);

    it('refuses a date that is not a day, read as a relay served it', () => {
      for (const date of ['2026-02-30', '2026-10-07T23:15', '2026-10-05T23:40 under the bridge', 'by the bridge', '', '1', '2026-10-7']) {
        expect(readReport(JSON.parse(JSON.stringify(onMission({ date })))), date).toBeNull();
        expect(readReport(JSON.parse(JSON.stringify(forge({ ...recap, date }, [])))), date).toBeNull();
      }
      expect(readReport(JSON.parse(JSON.stringify(onMission({ date: '2026-10-05' }))))).not.toBeNull();
    });

    it('refuses words where a correction’s event id goes', () => {
      expect(readReport(forge({ ...recap, date: '2026-10-07', supersedes: DESCRIPTOR }, []))).toBeNull();
      expect(readReport(forge({ ...recap, date: '2026-10-07', supersedes: 'a'.repeat(64) }, []))?.report.supersedes).toBe('a'.repeat(64));
    });

    it('refuses words where a recap’s region goes', () => {
      expect(readReport(forge({ ...recap, date: '2026-10-07', region: DESCRIPTOR }, []))).toBeNull();
      expect(readReport(forge({ ...recap, date: '2026-10-07', region: 'clarke-ga' }, []))?.report.region).toBe('clarke-ga');
    });

    it('refuses words where the mission’s address goes', () => {
      expect(readReport(onMission({ date: '2026-10-07' }, `30079:${poster}:${DESCRIPTOR}`))).toBeNull();
      expect(readReport(onMission({ date: '2026-10-07' }, `30079:${poster}:` + 'd'.repeat(257)))).toBeNull();
      expect(readReport(onMission({ date: '2026-10-07' }, 'somewhere'))).toBeNull();
    });
  });

  /*
   * 11.X moved what a report will be held to into the package reader, so nobody does the work and
   * is refused at the end. That only holds if the two sides agree at each edge.
   */
  describe('a package NavCom shows can always be reported, at every edge, and one past an edge is not shown', () => {
    const secret = generateSecretKey();
    const pub = getPublicKey(secret);
    const registry = { [pub]: { name: 'Edge poster', agent: false } };
    const signed = (d: string, objectives: unknown[], effect: string[]) =>
      finalizeEvent(
        {
          kind: 30079,
          created_at: NOW - 3_600,
          content: JSON.stringify({ name: 'Edges', objectives, metadata: { mechaJono: { format: { effect } } } }),
          tags: [['d', d], ['t', 'starcom_mission_package'], ['t', 'navcom_handoff'], ['t', 'navcom_mission'],
            ['mission_state', 'open'], ['valid_until', String(NOW + 86_400)]]
        },
        secret
      );
    const D = 'd'.repeat(256);
    const ID = 'o'.repeat(200);
    const LINE = 'L'.repeat(200);

    it('the longest d, objective id and effect line a package may carry are what a report can name and count', () => {
      const read = readMissionPackage(signed(D, [{ id: ID, ask: 'x' }], [LINE]), registry);
      if (!read.ok) throw new Error(read.because);
      const r = buildReport(contact, { callsign: 'Kestrel', date: '2026-10-07', mission: { address: read.mission.address, asks: [ID], counts: [{ line: LINE, n: 3 }] } }, NOW);
      const back = readReport(r);
      expect(back).not.toBeNull();
      expect(againstMission(back!.report, read.mission).mission).toEqual({ address: read.mission.address, asks: [ID], counts: [{ line: LINE, n: 3 }] });
    });

    it('one character past any of them, or none at all, and the package is refused before anybody takes part', () => {
      const refused = (e: unknown) => {
        const r = readMissionPackage(e, registry);
        return r.ok ? null : r.because;
      };
      expect(refused(signed(D + 'd', [{ id: 'a', ask: 'x' }], []))).toMatch(/d tag/);
      expect(refused(signed('', [{ id: 'a', ask: 'x' }], []))).toMatch(/d tag/);
      expect(refused(signed('x', [{ id: ID + 'o', ask: 'x' }], []))).toMatch(/report could name/);
      expect(refused(signed('x', [{ id: '', ask: 'x' }], []))).toMatch(/report could name/);
      expect(refused(signed('x', [{ id: 'a', ask: 'x' }], [LINE + 'L']))).toMatch(/longer than a count/);
    });
  });

  /*
   * The reader a poster opens a seal with. A rumor has no signature, so nothing else checks that
   * its tags are lists of strings or that its id is its own — and the id is what the poster's
   * settlement will name.
   */
  describe('a report opened from a seal', () => {
    const { wrap } = buildSealedReport(contact, missionReport(), NOW);
    const seal = JSON.parse(nip44.decrypt(wrap.content, nip44.getConversationKey(posterSecret, wrap.pubkey)));
    const rumor = JSON.parse(nip44.decrypt(seal.content, nip44.getConversationKey(posterSecret, seal.pubkey)));

    it('is refused, not thrown on, when a tag is not a list of strings', () => {
      for (const bad of [null, 'a', [7], ['a', null]]) {
        const odd = { ...rumor, tags: [...rumor.tags, bad] };
        expect(() => readReport(odd, { signed: false })).not.toThrow();
        expect(readReport(odd, { signed: false })).toBeNull();
      }
    });

    it('is refused when its id is not its own, so a poster is never steered into settling somebody else’s report', () => {
      expect(readReport({ ...rumor, id: 'f'.repeat(64) }, { signed: false })).toBeNull();
      expect(readReport(rumor, { signed: false })?.id).toBe(rumor.id);
    });
  });

  describe('every other bound a report keeps, held on what a relay could serve', () => {
    const refusedOnRead = (content: Record<string, unknown>, tags: string[][]) => readReport(JSON.parse(JSON.stringify(forge(content, tags))));
    const asks = (n: number) => Array.from({ length: n }, (_, i) => ['ask', `a${i}`]);
    const counts = (n: number) => Array.from({ length: n }, (_, i) => ({ line: `Line ${i}: a count`, n: 1 }));

    it('a day that has begun somewhere on Earth is allowed, and the day after that is not', () => {
      // NOW is 7 Oct, 20:00 UTC: 8 Oct has begun east of UTC+4, 9 Oct nowhere.
      expect(() => buildReport(contact, missionReport({ date: '2026-10-08' }), NOW)).not.toThrow();
      expect(() => buildReport(contact, missionReport({ date: '2026-10-09' }), NOW)).toThrow(/not happened/);
    });

    it('refuses no honest report of yesterday anywhere from UTC−12 to UTC+14, at any hour [11.X]', () => {
      const midnight = Date.UTC(2026, 9, 7) / 1000;
      for (let h = 0; h < 24; h++) {
        for (let offset = -12; offset <= 14; offset++) {
          const at = midnight + h * 3_600;
          const local = new Date((at + offset * 3_600) * 1000);
          const yesterday = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - 1)).toISOString().slice(0, 10);
          expect(() => buildReport(contact, missionReport({ date: yesterday }), at), `${h}:00 UTC, UTC${offset}`).not.toThrow();
        }
      }
    });

    it('names at most three kinds of work', () => {
      expect(() => buildReport(contact, { callsign: 'K', date: '2026-10-07', does: ['patrol', 'supplies', 'firstaid'] }, NOW)).not.toThrow();
      expect(() => buildReport(contact, { callsign: 'K', date: '2026-10-07', does: ['patrol', 'supplies', 'firstaid', 'transport'] }, NOW)).toThrow(/at most 3/);
    });

    it('names objectives by ids with no space in them, sixteen at most', () => {
      expect(refusedOnRead({ callsign: 'K', date: '2026-10-07' }, [['a', ADDRESS], ['ask', 'a b']])).toBeNull();
      expect(refusedOnRead({ callsign: 'K', date: '2026-10-07' }, [['a', ADDRESS], ...asks(16)])).not.toBeNull();
      expect(refusedOnRead({ callsign: 'K', date: '2026-10-07' }, [['a', ADDRESS], ...asks(17)])).toBeNull();
    });

    it('counts eight lines at most, each a whole number no smaller than nothing, of a line that says something', () => {
      const on = (c: unknown[]) => refusedOnRead({ callsign: 'K', date: '2026-10-07', counts: c }, [['a', ADDRESS], ['ask', 'a']]);
      expect(on(counts(8))).not.toBeNull();
      expect(on(counts(9))).toBeNull();
      expect(on([{ line: 'Water: a count', n: -1 }])).toBeNull();
      expect(on([{ line: '', n: 1 }])).toBeNull();
      expect(on([{ line: '   ', n: 1 }])).toBeNull();
      expect(on([{ line: 'x'.repeat(201), n: 1 }])).toBeNull();
      expect(on([{ line: 'x'.repeat(200), n: 1 }])).not.toBeNull();
    });

    it('refuses, rather than throws on, a count that is not an object', () => {
      const odd = forge({ callsign: 'K', date: '2026-10-07', counts: [null] }, [['a', ADDRESS], ['ask', 'a']]);
      expect(() => readReport(odd)).not.toThrow();
      expect(readReport(odd)).toBeNull();
    });

    it('keeps a callsign to its bound', () => {
      expect(() => buildReport(contact, missionReport({ callsign: 'k'.repeat(48) }), NOW)).not.toThrow();
      expect(() => buildReport(contact, missionReport({ callsign: 'k'.repeat(49) }), NOW)).toThrow(ReportError);
    });

    it('names one mission at most, and carries objectives and counts only with one', () => {
      // With no objective named, two missions would otherwise read as a recap that ignores both.
      expect(refusedOnRead({ callsign: 'K', date: '2026-10-07', does: ['supplies'] }, [['a', ADDRESS], ['a', ADDRESS.replace('heat', 'cold')]])).toBeNull();
      expect(refusedOnRead({ callsign: 'K', date: '2026-10-07' }, [['a', ADDRESS], ['a', ADDRESS.replace('heat', 'cold')], ['ask', 'a']])).toBeNull();
      expect(refusedOnRead({ callsign: 'K', date: '2026-10-07', does: ['supplies'] }, [['ask', 'a']])).toBeNull();
      expect(refusedOnRead({ callsign: 'K', date: '2026-10-07', does: ['supplies'], counts: [] }, [])).toBeNull();
    });

    it('is read against the mission it names, and against no other', () => {
      const elsewhere = { ...mission, address: ADDRESS.replace('heat', 'cold') } as Mission;
      expect(againstMission(missionReport(), elsewhere).mission).toBeUndefined();
    });

    it('reads only kind 1912 as a report', () => {
      const e = finalizeEvent({ kind: 1, created_at: NOW, content: JSON.stringify({ callsign: 'K', date: '2026-10-07', does: ['supplies'] }), tags: [] }, contact);
      expect(readReport(e)).toBeNull();
    });
  });

  describe('every guard the settlement reader keeps behind a query that already filtered', () => {
    const report = { id: 'f'.repeat(64), author: getPublicKey(contact), at: NOW };
    const at = NOW + 3_600;

    it('reads a label dated up to a day past its own clock, and not a second beyond', () => {
      expect(settlementOf(report, poster, [posterLabel(posterSecret, 'settled', report.id, at + 86_400)], at).state).toBe('settled');
      expect(settlementOf(report, poster, [posterLabel(posterSecret, 'settled', report.id, at + 86_401)], at).state).toBe('pending');
    });

    it('reads only a label, in NavCom’s namespace, saying its word in that namespace', () => {
      expect(settlementOf(report, poster, [posterLabel(posterSecret, 'settled', report.id, at, { kind: 1986 })], at).state).toBe('pending');
      expect(settlementOf(report, poster, [posterLabel(posterSecret, 'settled', report.id, at, { L: 'other.namespace' })], at).state).toBe('pending');
      expect(settlementOf(report, poster, [posterLabel(posterSecret, 'settled', report.id, at, { ns: 'other.namespace' })], at).state).toBe('pending');
    });

    it('skips, rather than throws on, a label with a tag that is not a list', () => {
      const odd = { ...posterLabel(posterSecret, 'settled', report.id, at), tags: [null, ['L', 'navcom.mission']] };
      expect(() => settlementOf(report, poster, [odd], at)).not.toThrow();
      expect(settlementOf(report, poster, [odd], at).state).toBe('pending');
    });

    it('counts no challenge from the reporter, and each challenger once', () => {
      expect(settlementOf(report, poster, [posterLabel(contact, 'challenged', report.id, at)], at).challengedBy).toEqual([]);
      const heron = generateSecretKey();
      const twice = [posterLabel(heron, 'challenged', report.id, at), posterLabel(heron, 'challenged', report.id, at + 1)];
      expect(settlementOf(report, poster, twice, at + 2).challengedBy).toEqual([getPublicKey(heron)]);
    });

    it('withdraws only on a deletion request, not on another kind of event naming the report', () => {
      const r = buildReport(contact, missionReport(), NOW);
      const notADeletion = finalizeEvent({ kind: 1, created_at: NOW + 60, content: '', tags: [['e', r.id], ['k', '1912']] }, contact);
      expect(withdrawnReports([{ id: r.id, author: r.pubkey }], [notADeletion]).size).toBe(0);
    });
  });
});
