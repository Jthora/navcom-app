import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Event } from 'nostr-tools/core';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { addMonthsUTC, charterCode, threeQuartersOf, thresholdOf } from '../src/units/charter.js';
import { compactOf, readStatement, signStatement, type Found, type Office } from '../src/units/statements.js';
import {
  GOVERNANCE_CLOCK_TOLERANCE_SECONDS, GovernanceError, buildCheckpoint, electorateDigest, evaluate,
  resultDigest, rosterDigest, snapshotOf, type UnitView
} from '../src/units/governance.js';
import { DAY, LATER, T0, TestUnit, ledUnit, makeUnit, names, shuffled } from './helpers/units.js';

/**
 * The governance evaluator, against the adversarial cases governance §2 and units.md §7 and §8
 * name, failure paths first. Every scenario signs real statements with real keys.
 */

const TE = addMonthsUTC(T0, 12); // the founders' term end
const NINE = names(7); // with co and xo, a unit of nine

/** A result built by hand: what a forked or mistaken phone might post. */
function rawResult(
  u: TestUnit,
  o: {
    poster: string; run: string; candidate: string; sigs: readonly Event[]; k: number; at: number;
    office?: Office; electorate?: string[]; m?: number; rule?: string; prev?: string[]; stand?: Event;
  }
): Event {
  const v = u.view(o.at);
  const rv = v.runs.find((r) => r.id === o.run);
  const electorate = o.electorate ?? rv!.electorate;
  const office = o.office ?? rv!.office;
  const sigs = o.sigs.map(compactOf);
  const cand = u.key(o.candidate);
  const stand = o.stand ?? u.loose.find((e) => e.pubkey === cand && e.content.includes(`"stand","${u.unit}","${o.run}"`))!;
  const rule = o.rule ?? 'g1';
  const digest = resultDigest(rule, o.run, office, cand, o.m ?? electorate.length, o.k, electorateDigest(electorate), sigs.map((c) => c[0]));
  const e = u.sign(o.poster, {
    t: 'result', unit: u.unit, prev: [...(o.prev ?? v.head)].sort(), run: o.run, candidate: cand, rule, digest,
    stand: [stand.created_at, stand.sig], sigs
  }, o.at);
  u.chain.push({ act: e });
  return e;
}

/** A recall built by hand. */
function rawRecall(u: TestUnit, o: { poster: string; petition: string; sigs: readonly Event[]; k: number; at: number; prev?: string[] }): Event {
  const v = u.view(o.at);
  const pv = v.petitions.find((p) => p.id === o.petition)!;
  const sigs = o.sigs.map(compactOf);
  const digest = resultDigest('g1', o.petition, pv.office, pv.subject, pv.m, o.k, electorateDigest(pv.electorate), [pv.opener, ...sigs.map((c) => c[0])]);
  const e = u.sign(o.poster, { t: 'recall', unit: u.unit, prev: [...(o.prev ?? v.head)].sort(), petition: o.petition, rule: 'g1', digest, sigs }, o.at);
  u.chain.push({ act: e });
  return e;
}

/** The founding statement inside a founding event. */
function foundOf(e: Event): Found {
  const r = readStatement(e);
  if (!r.ok || r.statement.t !== 'found') throw new Error('not a founding statement');
  return r.statement;
}

/** The parts of a view that say who is in and who holds what. */
const unitOf = (v: UnitView) => ({ members: v.members, offices: v.offices, status: v.status });

describe('A1: silence counts as no', () => {
  it('four of eight never recall in a unit of nine under a majority', () => {
    const u = ledUnit(NINE);
    const p = u.petition('m1', 'co', 'co', T0 + 31 * DAY);
    const supports = u.support(['m2', 'm3', 'm4'], p.id, T0 + 32 * DAY);
    const pv = u.view().petitions[0]!;
    expect([pv.m, pv.k, pv.count, pv.postable]).toEqual([8, 5, 4, false]);
    expect(() => u.recall('m1', p.id, T0 + 33 * DAY)).toThrow(GovernanceError);
    const r = rawRecall(u, { poster: 'm1', petition: p.id, sigs: supports, k: 5, at: T0 + 33 * DAY });
    expect(u.voidReason(r.id)).toBe('wrong-count');
    expect(u.offices().co).toBe('co');
  });

  it('nothing lapses: a day later and ten years later read the same', () => {
    const u = ledUnit(NINE);
    const p = u.petition('m1', 'co', 'co', T0 + 31 * DAY);
    u.support(['m2', 'm3', 'm4'], p.id, T0 + 32 * DAY);
    const latest = T0 + 32 * DAY + 3;
    const a = u.view(latest + DAY);
    const b = u.view(latest + 3650 * DAY);
    expect(b).toEqual(a);
    expect(a.offices!.co.term!.end).toBe(TE);
    // The term has ended ten years on, and still the incumbent holds over.
    expect(u.offices(latest + 3650 * DAY)).toMatchObject({ co: 'co', xo: 'xo' });
  });
});

describe('A2: ballots cast cannot be counted', () => {
  it('three of four cast is not a recall against an electorate of eight', () => {
    const u = ledUnit(NINE);
    const p = u.petition('m1', 'co', 'co', T0 + 31 * DAY);
    const supports = u.support(['m2', 'm3'], p.id, T0 + 32 * DAY);
    // A phone counting ballots cast would call 3 of 4 a pass, with k = 3.
    const r = rawRecall(u, { poster: 'm1', petition: p.id, sigs: supports, k: 3, at: T0 + 33 * DAY });
    expect(u.voidReason(r.id)).toBe('digest-mismatch');
    expect(u.view().disagreements).toEqual([{ id: r.id, what: 'result' }]);
    expect(u.offices().co).toBe('co');
  });

  it('a result whose digest claims k = 3 is void, and a disagreement', () => {
    const u = ledUnit(NINE);
    const open = u.open('m1', 'co', TE);
    u.vote(open.id, 'm2', ['m1', 'm2', 'm3'], TE + 60);
    const sigs = u.loose.filter((e) => e.content.includes('"endorse"'));
    const r = rawResult(u, { poster: 'm1', run: open.id, candidate: 'm2', sigs, k: 3, at: TE + 600 });
    expect(u.voidReason(r.id)).toBe('digest-mismatch');
    expect(u.view().disagreements).toEqual([{ id: r.id, what: 'result' }]);
    expect(u.offices().co).toBe('co');
  });
});

describe('A3: the closer cannot leave anything out', () => {
  const setup = () => {
    const u = ledUnit(NINE);
    const open = u.open('m1', 'co', TE);
    u.vote(open.id, 'm2', ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'], TE + 60);
    const sigs = u.loose.filter((e) => e.content.includes('"endorse"'));
    return { u, open, sigs };
  };

  it('fewer than k, or more', () => {
    const { u, open, sigs } = setup();
    expect(u.voidReason(rawResult(u, { poster: 'm1', run: open.id, candidate: 'm2', sigs: sigs.slice(0, 4), k: 5, at: TE + 600 }).id)).toBe('wrong-count');
    const { u: u2, open: o2, sigs: s2 } = setup();
    expect(u2.voidReason(rawResult(u2, { poster: 'm1', run: o2.id, candidate: 'm2', sigs: s2, k: 5, at: TE + 600 }).id)).toBe('wrong-count');
  });

  it('a signature from somebody admitted after the vote opened', () => {
    const { u, open, sigs } = setup();
    u.admit('late', ['co', 'xo'], TE + 100);
    const late = u.endorse(['late'], open.id, 'm2', TE + 200);
    const r = rawResult(u, { poster: 'm1', run: open.id, candidate: 'm2', sigs: [...sigs.slice(0, 4), ...late], k: 5, at: TE + 600 });
    expect(u.voidReason(r.id)).toBe('not-an-elector');
  });

  it('a poster who is not a member', () => {
    const { u, open, sigs } = setup();
    const r = rawResult(u, { poster: 'stranger', run: open.id, candidate: 'm2', sigs: sigs.slice(0, 5), k: 5, at: TE + 600 });
    expect(u.voidReason(r.id)).toBe('not-a-member');
  });

  it('and with exactly k from the electorate, it stands', () => {
    const { u, open } = setup();
    u.result('m3', open.id, 'm2', TE + 600);
    expect(u.offices().co).toBe('m2');
  });
});

describe('A4: phones that hold different signatures agree on the unit', () => {
  it('different tallies, the same offices and members', () => {
    const u = ledUnit(NINE);
    const open = u.open('m1', 'co', TE);
    u.vote(open.id, 'm2', ['m1', 'm3', 'm4'], TE + 60);
    const all = u.view();
    const fewer = u.view(LATER, { loose: u.loose.slice(0, 2) });
    expect(all.runs[0]!.tallies).not.toEqual(fewer.runs[0]!.tallies);
    expect(unitOf(fewer)).toEqual(unitOf(all));
  });

  it('monotone: if some endorsements can post a result, so can every superset of them', () => {
    for (let trial = 0; trial < 6; trial++) {
      const u = ledUnit(NINE);
      const open = u.open('m1', 'co', TE);
      const candidates = ['m1', 'm2'];
      for (const c of candidates) u.stand(c, open.id, TE + 10);
      const voters = shuffled(['co', 'xo', ...NINE]);
      // Honest electors: each endorses one candidate once.
      for (const [i, voter] of voters.entries()) u.endorse([voter], open.id, candidates[Math.random() < 0.7 ? 0 : 1]!, TE + 100 + i);
      const stands = u.loose.slice(0, 2);
      const endorsements = u.loose.slice(2);
      let prior: string | null = null;
      const order = shuffled(endorsements);
      for (let n = 0; n <= order.length; n++) {
        const postable = u.view(LATER, { loose: [...stands, ...order.slice(0, n)] }).runs[0]!.postable;
        if (prior !== null) expect(postable).toBe(prior);
        prior = postable ?? prior;
      }
    }
  }, 60_000);

  it('losing a tenth of the signatures never makes a false pass', () => {
    for (let trial = 0; trial < 20; trial++) {
      const u = ledUnit(NINE);
      const open = u.open('m1', 'co', TE);
      u.stand('m1', open.id, TE + 10);
      u.stand('m2', open.id, TE + 10);
      const voters = ['co', 'xo', ...NINE];
      for (const [i, voter] of voters.entries()) u.endorse([voter], open.id, i % 2 ? 'm1' : 'm2', TE + 100 + i);
      const full = u.view().runs[0]!.postable;
      const kept = u.loose.filter((e) => !e.content.includes('"endorse"') || Math.random() > 0.1);
      const fewer = u.view(LATER, { loose: kept }).runs[0]!.postable;
      if (fewer !== null) expect(fewer).toBe(full);
    }
  }, 60_000);
});

describe('A5: equivocation', () => {
  it('an elector who endorses two candidates is named and counted for neither', () => {
    const u = ledUnit(NINE);
    const open = u.open('m1', 'co', TE);
    u.vote(open.id, 'm2', ['m3', 'm4'], TE + 60);
    u.vote(open.id, 'm5', ['m6'], TE + 60);
    const twice = u.endorse(['m4'], open.id, 'm5', TE + 300);
    const v = u.view();
    expect(v.equivocators).toEqual([{ key: u.key('m4'), run: open.id, evidence: expect.arrayContaining([twice[0]!.id]) }]);
    const t = Object.fromEntries(v.runs[0]!.tallies.map((x) => [u.nameOf(x.candidate), x.count]));
    expect(t).toEqual({ m2: 1, m5: 1 });
  });

  it('two crossing results naming two winners: both void, the incumbent holds over, the overlap named', () => {
    const u = ledUnit(NINE);
    const open = u.open('m1', 'co', TE);
    u.vote(open.id, 'm2', ['co', 'xo', 'm1', 'm3', 'm4'], TE + 60);
    u.vote(open.id, 'm5', ['m3', 'm4', 'm5', 'm6', 'm7'], TE + 60);
    const ends = (c: string) => u.loose.filter((e) => e.content.includes('"endorse"') && e.content.includes(u.key(c)));
    const head = u.view().head;
    const electorate = u.view().runs[0]!.electorate;
    const a = rawResult(u, { poster: 'm1', run: open.id, candidate: 'm2', sigs: ends('m2'), k: 5, at: TE + 600, prev: head, electorate, office: 'co' });
    const b = rawResult(u, { poster: 'm6', run: open.id, candidate: 'm5', sigs: ends('m5'), k: 5, at: TE + 600, prev: head, electorate, office: 'co' });
    const v = u.view();
    expect(u.voidReason(a.id)).toBe('crossed-results');
    expect(u.voidReason(b.id)).toBe('crossed-results');
    expect(v.void.find((x) => x.id === a.id)!.names).toEqual([u.key('m3'), u.key('m4')].sort());
    expect(v.equivocators.map((e) => e.key).sort()).toEqual([u.key('m3'), u.key('m4')].sort());
    expect(u.offices().co).toBe('co');
    // The run closed contested and the office is electable again.
    expect(v.runs).toEqual([]);
    const again = u.open('m7', 'co', TE + DAY, [a.id, b.id, ...v.head].filter((x, i, xs) => xs.indexOf(x) === i).slice(0, 4));
    expect(u.voidReason(again.id)).toBeUndefined();
    expect(u.view().runs.map((r) => r.id)).toEqual([again.id]);
  });

  it('with eight electors and a majority, one equivocator cannot make two winners (2k - m = 2)', () => {
    const u = ledUnit(names(6)); // a unit of eight
    expect(2 * thresholdOf(8, 'majority') - 8).toBe(2);
    const open = u.open('m1', 'co', TE);
    u.vote(open.id, 'm1', ['co', 'xo', 'm1', 'm2', 'm6'], TE + 60);
    u.vote(open.id, 'm3', ['m3', 'm4', 'm5', 'm6'], TE + 60); // m6 signs both
    const v = u.view();
    const t = Object.fromEntries(v.runs[0]!.tallies.map((x) => [u.nameOf(x.candidate), x.count]));
    expect(t).toEqual({ m1: 4, m3: 3 });
    expect(v.runs[0]!.postable).toBeNull();
    // Even counting the equivocator for both, m3 has 4 of the 5 a result needs.
    const ends = u.loose.filter((e) => e.content.includes('"endorse"') && e.content.includes(u.key('m3')));
    expect(ends).toHaveLength(4);
  });

  it('a second result for a closed run is void, and the electors in both are named', () => {
    const u = ledUnit(NINE);
    const open = u.open('m1', 'co', TE);
    u.vote(open.id, 'm2', ['co', 'xo', 'm1', 'm3', 'm4'], TE + 60);
    const first = u.result('m1', open.id, 'm2', TE + 600);
    u.vote(open.id, 'm5', ['m4', 'm5', 'm6', 'm7', 'm3'], TE + 650);
    const ends = u.loose.filter((e) => e.content.includes('"endorse"') && e.content.includes(u.key('m5')));
    const second = rawResult(u, {
      poster: 'm6', run: open.id, candidate: 'm5', sigs: ends, k: 5, at: TE + 700, office: 'co',
      electorate: u.view(TE + 700).members.map((r) => r.key)
    });
    expect(u.voidReason(second.id)).toBe('run-not-open');
    expect(u.offices().co).toBe('m2');
    const named = u.view().equivocators.filter((e) => e.evidence.includes(second.id)).map((e) => e.key).sort();
    expect(named).toEqual([u.key('m3'), u.key('m4')].sort());
    expect(first.id).not.toBe(second.id);
  });
});

describe('A6: a removal racing a recall', () => {
  // Revised with the units-core-attack repair. These first three asserted that a vote voids a
  // concurrent removal. That chain is act for act the one in units-attack BREAK 1, where a removed
  // member's own petition, signed weeks later on a pre-removal prev, undid their removal and
  // everything built on it: concurrency is chosen by whoever names the older prev, so no rule can
  // void the removal here and keep it there without trusting a claimed time. Now neither undoes the
  // other, and the removal cannot touch the vote: the petition stands, its frozen electorate keeps
  // the removed key, that key's signature still counts, and any elector may post the recall.
  const setup = () => {
    const u = ledUnit(NINE);
    const h = u.tips();
    const p = u.petition('m1', 'co', 'co', T0 + 31 * DAY, h);
    return { u, h, p };
  };

  it('the CO and an ally remove the opener on the same prev: both stand, and the petition still passes', () => {
    const { u, h, p } = setup();
    const r = u.remove(['m1'], ['co', 'm2'], T0 + 31 * DAY + 60, h);
    expect(u.voidReason(r.id)).toBeUndefined();
    expect(u.voidReason(p.id)).toBeUndefined();
    expect(u.members()).not.toContain('m1');
    const pv = u.view().petitions[0]!;
    expect(pv.id).toBe(p.id);
    expect(pv.electorate).toContain(u.key('m1'));
    expect(pv.count).toBe(1); // the removed opener still counts
    u.support(['m3', 'm4', 'm5', 'm6'], p.id, T0 + 32 * DAY);
    u.recall('m3', p.id, T0 + 33 * DAY);
    expect(u.offices().co).toBe('xo');
  });

  it('the same when built on an intermediate act concurrent with the petition', () => {
    const { u, h, p } = setup();
    const mid = u.admit('n1', ['xo', 'm3'], T0 + 31 * DAY, { prev: h });
    const r = u.remove(['m1'], ['co', 'm2'], T0 + 31 * DAY + 60, [mid.id]);
    expect(u.voidReason(r.id)).toBeUndefined();
    expect(u.view().petitions.map((x) => x.id)).toEqual([p.id]);
    expect(u.view().petitions[0]!.electorate).toContain(u.key('m1'));
  });

  it('a concurrent removal the subject signed stands, and changes nothing about the vote', () => {
    const { u, h, p } = setup();
    const r = u.remove(['m5'], ['xo', 'co'], T0 + 31 * DAY + 60, h);
    expect(u.voidReason(r.id)).toBeUndefined();
    u.support(['m2', 'm3', 'm4', 'm5'], p.id, T0 + 32 * DAY); // m5, removed, still signs and counts
    expect(u.view().petitions[0]!.count).toBe(5);
    u.recall('m5', p.id, T0 + 33 * DAY); // and, as an elector, may post it
    expect(u.offices().co).toBe('xo');
  });

  it('a removal that descends from the petition stands, and the removed elector still counts', () => {
    const { u, p } = setup();
    u.support(['m2', 'm3', 'm4', 'm5'], p.id, T0 + 32 * DAY);
    const r = u.remove(['m5'], ['xo', 'm6'], T0 + 33 * DAY);
    expect(u.voidReason(r.id)).toBeUndefined();
    expect(u.members()).not.toContain('m5');
    expect(u.view().petitions[0]!.count).toBe(5);
    u.recall('m2', p.id, T0 + 34 * DAY);
    expect(u.offices()).toMatchObject({ co: 'xo', xo: null });
  });
});

describe('A7: stale-prev attacks', () => {
  it('an act by a removed key on a pre-removal prev is void, however its id is ground', () => {
    const u = ledUnit(NINE);
    const h = u.tips();
    u.remove(['m5'], ['co', 'xo'], T0 + 2 * DAY, h);
    const attacks: Event[] = [];
    for (let i = 0; i < 12; i++) attacks.push(u.admit(`x${i}`, ['m5', 'xo'], T0 + 2 * DAY + i, { prev: h }));
    const v = u.view();
    for (const a of attacks) expect(u.voidReason(a.id)).toBe('removal-wins');
    expect(u.members()).not.toContain('m5');
    expect(u.members().some((n) => /^x\d/.test(n))).toBe(false);

    // The same story with every attack's id ground differently, handed over shuffled: the unit
    // reads the same.
    const ground = ledUnit(NINE);
    const h2 = ground.tips();
    ground.remove(['m5'], ['co', 'xo'], T0 + 2 * DAY, h2);
    for (let i = 0; i < 12; i++) ground.admit(`x${i}`, ['m5', 'xo'], T0 + 3 * DAY + 7 * i, { prev: h2 });
    ground.chain = shuffled(ground.chain);
    expect(ground.members()).toEqual(u.members());
    expect(ground.offices()).toEqual(u.offices());
    expect(v.status).toBe('ok');
  });

  it('a stale-prev duplicate petition by the incumbent’s ally stands beside the real one', () => {
    const u = ledUnit(NINE);
    const stale = u.tips();
    u.admit('n1', ['co', 'xo'], T0 + 2 * DAY);
    const real = u.petition('m1', 'co', 'co', T0 + 31 * DAY);
    const sham = u.petition('m2', 'co', 'co', T0 + 31 * DAY + 5, stale);
    expect(u.voidReason(real.id)).toBeUndefined();
    expect(u.voidReason(sham.id)).toBeUndefined();
    expect(u.view().petitions.map((p) => p.id).sort()).toEqual([real.id, sham.id].sort());
    u.support(['m3', 'm4', 'm5', 'm6'], real.id, T0 + 32 * DAY);
    u.recall('m3', real.id, T0 + 33 * DAY);
    expect(u.offices().co).toBe('xo');
  });
});

describe('A8: a mutual removal splits the unit', () => {
  const setup = () => {
    const u = ledUnit(['m1', 'm2', 'm3']);
    const h = u.tips();
    const a = u.remove(['xo'], ['co', 'm1'], T0 + 2 * DAY, h);
    const b = u.remove(['co'], ['xo', 'm2'], T0 + 2 * DAY, h);
    return { u, a, b };
  };

  it('reads split, with both sides, until this phone follows one', () => {
    const { u, a, b } = setup();
    const v = u.view();
    expect(v.status).toBe('split');
    expect(v.splits!.map((s) => s.via).sort()).toEqual([a.id, b.id].sort());
    expect(u.members()).toContain('co');
    expect(u.members()).toContain('xo');
  });

  it('following one voids the other and everything built on it', () => {
    const { u, a, b } = setup();
    const after = u.act('xo', { t: 'leave', prev: [b.id] }, T0 + 3 * DAY);
    const v = u.view(LATER, { follow: a.id });
    expect(v.status).toBe('ok');
    expect(v.void.find((x) => x.id === b.id)!.reason).toBe('split-not-followed');
    expect(v.void.find((x) => x.id === after.id)!.reason).toBe('split-not-followed');
    expect(v.members.map((r) => u.nameOf(r.key))).not.toContain('xo');
    expect(v.offices!.co.holder).toBe(u.key('co'));
  });
});

describe('A9: removal wins', () => {
  it('an admission co-signed by a key removed concurrently is void, and what the admitted did after', () => {
    const u = ledUnit(NINE);
    const h = u.tips();
    const rm = u.remove(['m1'], ['co', 'xo'], T0 + 2 * DAY, h);
    const ad = u.admit('n1', ['xo', 'm1'], T0 + 2 * DAY, { prev: h });
    const later = u.act('n1', { t: 'leave', prev: [ad.id] }, T0 + 3 * DAY);
    expect(u.voidReason(ad.id)).toBe('removal-wins');
    expect(u.voidReason(later.id)).toBe('built-on-void');
    expect(u.members()).not.toContain('n1');
    // An act naming the void tip and a valid one is not voided by the void tip.
    const both = u.admit('n2', ['co', 'm2'], T0 + 4 * DAY, { prev: [ad.id, rm.id] });
    expect(u.voidReason(both.id)).toBeUndefined();
    expect(u.members()).toContain('n2');
  });
});

describe('A10: clocks', () => {
  it('holds a statement from the future, and what is built on it, and drops nothing', () => {
    const u = ledUnit(NINE);
    const now = TE;
    const open = u.open('m1', 'co', now + DAY);
    const child = u.act('m2', { t: 'petition', office: 'xo', subject: u.key('xo'), reason: '0'.repeat(64), prev: [open.id] }, now - 10);
    let v = u.view(now);
    expect(v.held).toEqual([{ id: open.id, reason: 'future-dated' }, { id: child.id, reason: 'waiting-for-earlier' }].sort((a, b) => (a.id < b.id ? -1 : 1)));
    expect(v.runs).toEqual([]);
    v = u.view(now + DAY + 61);
    expect(v.held).toEqual([]);
    expect(v.runs.map((r) => r.id)).toEqual([open.id]);
  });

  it('a phone a day slow only waits; a day fast changes nothing', () => {
    const u = ledUnit(NINE);
    const open = u.open('m1', 'co', TE);
    const right = u.view(TE + 60);
    expect(u.view(TE + 60 - DAY).runs).toEqual([]);
    expect(u.view(TE + 60 + DAY)).toEqual(right);
    expect(right.runs.map((r) => r.id)).toEqual([open.id]);
    expect(GOVERNANCE_CLOCK_TOLERANCE_SECONDS).toBe(120);
  });

  it('an election cannot open before the term ends', () => {
    const u = ledUnit(NINE);
    expect(u.voidReason(u.open('m1', 'co', TE - 1).id)).toBe('not-electable');
    expect(u.voidReason(u.open('m1', 'co', TE).id)).toBeUndefined();
  });

  it('a petition opens on day 31, not day 30', () => {
    const u = ledUnit(NINE);
    expect(u.voidReason(u.petition('m1', 'co', 'co', T0 + 30 * DAY - 1).id)).toBe('too-early');
    expect(u.voidReason(u.petition('m1', 'co', 'co', T0 + 30 * DAY).id)).toBeUndefined();
  });

  it('a signature dated before its vote opened does not count; one eleven months later does', () => {
    const u = ledUnit(NINE);
    const p = u.petition('m1', 'co', 'co', T0 + 31 * DAY);
    u.support(['m2'], p.id, T0 + 31 * DAY - 10);
    u.support(['m3'], p.id, T0 + 31 * DAY + 330 * DAY);
    expect(u.view().petitions[0]!.count).toBe(2);
    const open = u.open('m1', 'co', TE);
    u.stand('m2', open.id, TE + 1);
    const early = u.endorse(['m3'], open.id, 'm2', TE - 100);
    u.endorse(['m4'], open.id, 'm2', TE + 10);
    expect(u.view().runs[0]!.tallies).toEqual([{ candidate: u.key('m2'), count: 1, stood: true }]);
    const more = u.endorse(['m5', 'm6', 'm7', 'm1'], open.id, 'm2', TE + 20);
    const r = rawResult(u, { poster: 'm1', run: open.id, candidate: 'm2', sigs: [...early, ...more], k: 5, at: TE + 600 });
    expect(u.voidReason(r.id)).toBe('too-early');
  });

  it('never reads the clock', () => {
    const u = ledUnit(NINE);
    u.elect({ office: 'co', opener: 'm1', candidate: 'm2', voters: ['m1', 'm3', 'm4', 'm5', 'm6'], at: TE });
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('the evaluator read the clock');
    });
    try {
      const v = evaluate(u.input(LATER));
      expect(v.status).toBe('ok');
      expect(v.offices!.co.holder).toBe(u.key('m2'));
    } finally {
      spy.mockRestore();
    }
  });

  it('has no Date.now() or argument-less new Date() anywhere in units/', () => {
    const dir = fileURLToPath(new URL('../src/units/', import.meta.url));
    for (const f of readdirSync(dir)) {
      const src = readFileSync(dir + f, 'utf8');
      expect(src, f).not.toMatch(/Date\.now\(\)/);
      expect(src, f).not.toMatch(/new Date\(\s*\)/);
    }
  });
});

describe('A11: succession', () => {
  it('has no successor field and no appointment', () => {
    const u = ledUnit(NINE);
    // Only founding and a result set the XO: a result without k signatures is not one.
    const open = u.open('co', 'xo', TE);
    u.vote(open.id, 'm1', ['co'], TE + 60);
    const r = rawResult(u, { poster: 'co', run: open.id, candidate: 'm1', sigs: u.loose.filter((e) => e.content.includes('"endorse"')), k: 1, at: TE + 600 });
    expect(u.voidReason(r.id)).toBe('digest-mismatch');
    expect(u.offices().xo).toBe('xo');
  });

  it('a CO who steps down leaves the XO acting and the XO post vacant, and both elections may open', () => {
    const u = ledUnit(NINE);
    u.vacate('co', 'co', T0 + 5 * DAY);
    expect(u.offices()).toEqual({ co: 'xo', xo: null, coActing: true, xoActing: false });
    const a = u.open('m1', 'co', T0 + 6 * DAY);
    const b = u.open('m2', 'xo', T0 + 6 * DAY + 1);
    expect(u.voidReason(a.id)).toBeUndefined();
    expect(u.voidReason(b.id)).toBeUndefined();
    expect(u.view().runs.map((x) => x.office).sort()).toEqual(['co', 'xo']);
  });

  it('a leader’s key comes off only by two members other than that leader', () => {
    const u = ledUnit(NINE);
    expect(u.voidReason(u.remove(['co'], ['co', 'm1'], T0 + DAY).id)).toBe('not-allowed');
    const ok = u.remove(['co'], ['m1', 'm2'], T0 + 2 * DAY);
    expect(u.voidReason(ok.id)).toBeUndefined();
    expect(u.offices()).toEqual({ co: 'xo', xo: null, coActing: true, xoActing: false });
  });

  it('a removed leader may be re-admitted by any two while that election is open, stand, and not vote', () => {
    const u = ledUnit(NINE);
    u.remove(['co'], ['m1', 'm2'], T0 + 2 * DAY);
    const open = u.open('m3', 'co', T0 + 3 * DAY);
    const back = u.admit('co2', ['m4', 'm5'], T0 + 4 * DAY, { readmits: 'co' });
    expect(u.voidReason(back.id)).toBeUndefined();
    expect(u.view().runs[0]!.electorate).not.toContain(u.key('co2'));
    u.vote(open.id, 'co2', ['m1', 'm2', 'm3', 'm4', 'm5'], T0 + 5 * DAY);
    u.result('m1', open.id, 'co2', T0 + 6 * DAY);
    expect(u.offices()).toMatchObject({ co: 'co2', coActing: false });
    // The run has closed: the same admission now needs a position holder.
    const late = u.admit('co3', ['m6', 'm7'], T0 + 7 * DAY, { readmits: 'co' });
    expect(u.voidReason(late.id)).toBe('not-allowed');
    const right = u.admit('co3', ['co2', 'm7'], T0 + 8 * DAY, { readmits: 'co' });
    expect(u.voidReason(right.id)).toBeUndefined();
    // And the removed key itself never comes back.
    expect(u.voidReason(u.act('m6', { t: 'admit', key: u.key('co'), callsign: 'CO', readmits: null }, T0 + 9 * DAY, { name: 'co2' }).id)).toBe('was-removed');
  });
});

describe('A12: terms', () => {
  it('the founders hold the first term only, and hold over until a result', () => {
    const u = ledUnit(NINE);
    const v = u.view();
    expect(v.offices!.co.term).toEqual({ n: 1, start: T0, end: TE });
    expect(v.offices!.xo.term).toEqual({ n: 1, start: T0, end: TE });
    expect(u.offices(TE + 3650 * DAY)).toMatchObject({ co: 'co', xo: 'xo' });
    const { result } = u.elect({ office: 'co', opener: 'm1', candidate: 'co', voters: ['co', 'xo', 'm1', 'm2', 'm3'], at: TE + DAY });
    const t = u.view().offices!.co.term!;
    expect(t.n).toBe(2);
    expect(t.end).toBe(addMonthsUTC(t.start, 12));
    expect(t.start).toBeGreaterThanOrEqual(TE + DAY);
    expect(u.voidReason(result.id)).toBeUndefined();
  });

  it('a 24-month term ends 24 calendar months on', () => {
    const u = ledUnit(NINE, { governance: { shape: 'led', threshold: 'majority', term: 24, coCap: 'none' } });
    expect(u.view().offices!.co.term!.end).toBe(addMonthsUTC(T0, 24));
  });

  it('a vacancy filler serves out the remainder of the term', () => {
    const u = ledUnit(NINE);
    u.vacate('xo', 'xo', T0 + 40 * DAY);
    u.elect({ office: 'xo', opener: 'm1', candidate: 'm4', voters: ['co', 'm1', 'm2', 'm3', 'm5'], at: T0 + 41 * DAY });
    const xo = u.view().offices!.xo;
    expect(u.nameOf(xo.holder)).toBe('m4');
    expect(xo.term).toEqual({ n: 1, start: T0, end: TE });
  });
});

describe('A13: recall', () => {
  const recalled = () => {
    const u = ledUnit(NINE);
    const p = u.petition('m1', 'co', 'co', T0 + 31 * DAY);
    u.support(['m2', 'm3', 'm4', 'm5'], p.id, T0 + 32 * DAY);
    const r = u.recall('m2', p.id, T0 + 33 * DAY);
    return { u, p, r };
  };

  it('passes the moment the opener and k - 1 supports are carried; the XO serves as CO', () => {
    const { u, r } = recalled();
    expect(u.voidReason(r.id)).toBeUndefined();
    expect(u.offices()).toEqual({ co: 'xo', xo: null, coActing: false, xoActing: false });
    expect(u.view().offices!.co.term).toEqual({ n: 1, start: T0, end: TE });
    expect(u.members()).toContain('co');
  });

  it('the XO post is electable at once, and the recalled CO may stand for it', () => {
    const { u } = recalled();
    u.elect({ office: 'xo', opener: 'm6', candidate: 'co', voters: ['co', 'm6', 'm7', 'm1', 'xo'], at: T0 + 34 * DAY });
    expect(u.offices().xo).toBe('co');
  });

  it('for the rest of the term the recalled officer cannot remove a petition signer; next term they can', () => {
    const { u } = recalled();
    const blocked = u.remove(['m3'], ['xo', 'co'], T0 + 35 * DAY);
    expect(u.voidReason(blocked.id)).toBe('recalled-signer');
    expect(u.voidReason(u.remove(['m7'], ['xo', 'co'], T0 + 36 * DAY).id)).toBeUndefined();
    u.elect({ office: 'co', opener: 'm1', candidate: 'xo', voters: ['xo', 'm1', 'm2', 'm3', 'm4'], at: TE });
    expect(u.view().offices!.co.term!.n).toBe(2);
    expect(u.voidReason(u.remove(['m3'], ['xo', 'co'], TE + DAY).id)).toBeUndefined();
  });

  it('one petition per holder per term', () => {
    const u = ledUnit(NINE);
    u.petition('m1', 'co', 'co', T0 + 31 * DAY);
    expect(u.voidReason(u.petition('m2', 'co', 'co', T0 + 40 * DAY).id)).toBe('already-petitioned');
  });
});

describe('A14: the CO cap, two then out', () => {
  const capped = { shape: 'led', threshold: 'majority', term: 12, coCap: 'twoThenOut' } as const;
  const all = ['co', 'xo', ...NINE];

  it('a third consecutive term needs three-quarters; anybody else a majority', () => {
    const u = ledUnit(NINE, { governance: capped });
    const t2 = TE;
    u.elect({ office: 'co', opener: 'm1', candidate: 'co', voters: all.slice(0, 5), at: t2 });
    expect(u.view().offices!.co.capped).toBe(true);
    const t3 = u.view().offices!.co.term!.end;
    const open = u.open('m1', 'co', t3);
    u.vote(open.id, 'co', all.slice(0, 6), t3 + 60);
    const run = u.view().runs[0]!;
    expect([run.k, run.kCapped, run.cappedKeys.map(u.nameOf)]).toEqual([5, threeQuartersOf(9), ['co']]);
    expect(threeQuartersOf(9)).toBe(7);
    const majority = rawResult(u, {
      poster: 'm1', run: open.id, candidate: 'co', k: 5, at: t3 + 600,
      sigs: u.loose.filter((e) => e.content.includes('"endorse"') && e.content.includes(open.id)).slice(0, 5)
    });
    expect(u.voidReason(majority.id)).toBe('digest-mismatch');
    u.endorse(['m5'], open.id, 'co', t3 + 900);
    u.result('m2', open.id, 'co', t3 + 1000);
    expect(u.offices().co).toBe('co');
  });

  it('another candidate in the same run needs only a majority', () => {
    const u = ledUnit(NINE, { governance: capped });
    u.elect({ office: 'co', opener: 'm1', candidate: 'co', voters: all.slice(0, 5), at: TE });
    const t3 = u.view().offices!.co.term!.end;
    u.elect({ office: 'co', opener: 'm1', candidate: 'm2', voters: all.slice(2, 7), at: t3 });
    expect(u.offices().co).toBe('m2');
  });

  it('with no cap a majority always suffices', () => {
    const u = ledUnit(NINE);
    let end = TE;
    for (let i = 0; i < 3; i++) {
      u.elect({ office: 'co', opener: 'm1', candidate: 'co', voters: all.slice(0, 5), at: end });
      end = u.view().offices!.co.term!.end;
      expect(u.view().offices!.co.capped).toBe(false);
    }
    expect(u.view().offices!.co.term!.n).toBe(4);
  });

  it('the XO is re-elected four times by a majority, never capped', () => {
    const u = ledUnit(NINE, { governance: capped });
    let end = TE;
    for (let i = 0; i < 4; i++) {
      u.elect({ office: 'xo', opener: 'm1', candidate: 'xo', voters: all.slice(0, 5), at: end });
      end = u.view().offices!.xo.term!.end;
    }
    expect(u.offices().xo).toBe('xo');
    expect(u.view().offices!.xo.term!.n).toBe(5);
  });
});

describe('A15: consent and the electorate', () => {
  it('nobody wins an office they did not stand for', () => {
    const u = ledUnit(NINE);
    const open = u.open('m1', 'co', TE);
    u.endorse(['co', 'xo', 'm1', 'm2', 'm3'], open.id, 'm4', TE + 60);
    const notStood = u.sign('m4', { t: 'stand', unit: u.unit, run: '0'.repeat(64) }, TE + 30);
    const r = rawResult(u, { poster: 'm1', run: open.id, candidate: 'm4', k: 5, at: TE + 600, stand: notStood,
      sigs: u.loose.filter((e) => e.content.includes('"endorse"')) });
    expect(u.voidReason(r.id)).toBe('no-stand');
    expect(u.view().runs[0]!.postable).toBeNull();
  });

  it('a candidate who is not a member at the result cannot win', () => {
    const u = ledUnit(NINE);
    const open = u.open('m1', 'co', TE);
    u.vote(open.id, 'm7', ['co', 'xo', 'm1', 'm2', 'm3'], TE + 60);
    u.leave('m7', TE + 100);
    const r = rawResult(u, { poster: 'm1', run: open.id, candidate: 'm7', k: 5, at: TE + 600,
      sigs: u.loose.filter((e) => e.content.includes('"endorse"')) });
    expect(u.voidReason(r.id)).toBe('not-a-member');
  });

  it('admitted after the open: no vote. Removed after the open: still counts', () => {
    const u = ledUnit(NINE);
    const open = u.open('m1', 'co', TE);
    u.admit('late', ['co', 'xo'], TE + 10);
    u.remove(['m7'], ['co', 'xo'], TE + 20);
    u.vote(open.id, 'm2', ['late', 'm7', 'm1', 'm3', 'm4', 'm5'], TE + 60);
    const run = u.view().runs[0]!;
    expect(run.electorate).not.toContain(u.key('late'));
    expect(run.electorate).toContain(u.key('m7'));
    expect(run.tallies[0]!.count).toBe(5);
    u.result('m1', open.id, 'm2', TE + 600);
    expect(u.offices().co).toBe('m2');
  });

  it('a unit of two: one signature recalls, from an electorate of one', () => {
    const u = makeUnit({ room: 4 });
    const p = u.petition('xo', 'co', 'co', T0 + 31 * DAY);
    const pv = u.view().petitions[0]!;
    expect([pv.m, pv.k, pv.postable]).toEqual([1, 1, true]);
    u.recall('xo', p.id, T0 + 32 * DAY);
    expect(u.offices()).toEqual({ co: 'xo', xo: null, coActing: false, xoActing: false });
  });
});

describe('A16: the door and the room', () => {
  it('command keeps the door, never alone', () => {
    const u = ledUnit(NINE);
    expect(u.voidReason(u.admit('n1', ['m1', 'm2'], T0 + DAY).id)).toBe('not-allowed');
    expect(u.heldReason(u.admit('n2', ['co'], T0 + DAY + 1).id)).toBe('incomplete');
    expect(u.voidReason(u.admit('n3', ['co', 'xo'], T0 + DAY + 2).id)).toBeUndefined();
    expect(u.members()).toContain('n3');
    expect(u.members()).not.toContain('n1');
    expect(u.members()).not.toContain('n2');
  });

  it('a second signature that arrives on its own completes the act it names', () => {
    const u = ledUnit(NINE);
    const a = u.admit('n1', ['co'], T0 + DAY);
    expect(u.heldReason(a.id)).toBe('incomplete');
    u.loose.push(u.sign('m1', { t: 'sign', unit: u.unit, act: a.id }, T0 + DAY + 60));
    expect(u.heldReason(a.id)).toBeUndefined();
    expect(u.members()).toContain('n1');
    expect(u.view().members.find((r) => r.key === u.key('n1'))!.by).toEqual([u.key('co'), u.key('m1')].sort());
  });

  it('the room is never passed, alone or together', () => {
    const u = ledUnit(['m1', 'm2'], { room: 4 });
    const full = u.admit('n1', ['co', 'xo'], T0 + DAY);
    expect(u.voidReason(full.id)).toBe('room-full');
    const v = makeUnit({ room: 4 });
    const h = v.tips();
    const a = v.admit('p', ['co', 'xo'], T0 + DAY, { prev: h });
    const b = v.admit('q', ['xo', 'co'], T0 + DAY, { prev: h });
    expect(v.members().sort()).toEqual(['co', 'p', 'q', 'xo']);
    const w = ledUnit(['m1'], { room: 4 });
    const g = w.tips();
    const c = w.admit('p', ['co', 'xo'], T0 + DAY, { prev: g });
    const d = w.admit('q', ['xo', 'co'], T0 + DAY, { prev: g });
    expect(w.voidReason(c.id)).toBe('crossed-admissions');
    expect(w.voidReason(d.id)).toBe('crossed-admissions');
    expect([a.id, b.id].every((id) => v.voidReason(id) === undefined)).toBe(true);
  });

  it('one key admitted twice at once under two callsigns is void both times', () => {
    const u = ledUnit(['m1']);
    const h = u.tips();
    const a = u.admit('p', ['co', 'xo'], T0 + DAY, { prev: h, callsign: 'PIKE' });
    const b = u.admit('p', ['xo', 'm1'], T0 + DAY, { prev: h, callsign: 'PERCH' });
    expect(u.voidReason(a.id)).toBe('crossed-admissions');
    expect(u.voidReason(b.id)).toBe('crossed-admissions');
  });

  it('a removed key is never re-admitted', () => {
    const u = ledUnit(NINE);
    u.remove(['m1'], ['co', 'm2'], T0 + DAY);
    expect(u.voidReason(u.admit('m1', ['co', 'xo'], T0 + 2 * DAY).id)).toBe('was-removed');
  });

  it('removing an ordinary member needs a position holder', () => {
    const u = ledUnit(NINE);
    expect(u.voidReason(u.remove(['m1'], ['m2', 'm3'], T0 + DAY).id)).toBe('not-allowed');
    expect(u.voidReason(u.remove(['m1'], ['xo', 'm3'], T0 + 2 * DAY).id)).toBeUndefined();
  });

  it('in a unit of two, either removes the other alone', () => {
    const u = makeUnit({ room: 4 });
    const r = u.remove(['co'], ['xo'], T0 + DAY);
    expect(u.voidReason(r.id)).toBeUndefined();
    expect(u.members()).toEqual(['xo']);
    expect(u.offices()).toEqual({ co: 'xo', xo: null, coActing: true, xoActing: false });
  });
});

describe('A17: re-forming with lineage', () => {
  it('re-formers act with no term, and the first election opens once somebody invited has accepted', () => {
    const u = makeUnit({ reform: true });
    const v = u.view();
    expect(v.status).toBe('ok');
    expect(u.offices()).toEqual({ co: 'co', xo: 'xo', coActing: true, xoActing: true });
    expect(v.offices!.co.term).toEqual({ n: 0, start: T0, end: T0 });
    // Revised with the units-core-attack repair (BREAK 8): this test opened the first election with
    // the two re-formers as its whole electorate, which turned acting posts into a full elected term
    // before any member could vote (decision 2: "re-formers act only until members elect"). The
    // election still needs no term to end; it waits only for somebody invited to accept.
    expect(u.voidReason(u.open('xo', 'co', T0 + 30).id)).toBe('not-electable');
    const invite = u.act('co', { t: 'invite', former: u.key('oldC') }, T0 + 40, { name: 'xo' });
    u.act('newC', {
      t: 'accept', invite: invite.id, callsign: 'CRANE',
      former: compactOf(u.sign('oldC', { t: 'accept-by', unit: u.unit, invite: invite.id, key: u.key('newC') }, T0 + 50))
    }, T0 + 55);
    const open = u.open('xo', 'co', T0 + 60);
    expect(u.voidReason(open.id)).toBeUndefined();
    expect(u.view().runs[0]!.electorate).toHaveLength(3);
    u.vote(open.id, 'co', ['co', 'xo'], T0 + 120);
    u.result('xo', open.id, 'co', T0 + 600);
    expect(u.view().offices!.co).toMatchObject({ acting: false, term: { n: 1 } });
    expect(v.lineage).toEqual({ from: u.charter.lineage, former: 'not-held' });
  });

  it('a wrong former signature, or one former key for both, refuses the unit', () => {
    const u = makeUnit({ reform: true });
    const [fa, fb] = u.found;
    const forged = u.sign('co', { ...foundOf(fa), former: [u.key('oldA'), T0, 'f'.repeat(128)] }, T0);
    expect(evaluate({ ...u.input(LATER), found: [forged, fb] }).reason).toBe('founding');
    const same = u.sign('xo', {
      ...foundOf(fb),
      former: compactOf(u.sign('oldA', { t: 'refound-by', unit: u.unit, lineage: u.charter.lineage!, key: u.key('xo') }, T0))
    }, T0);
    expect(evaluate({ ...u.input(LATER), found: [fa, same] }).reason).toBe('founding');
  });

  it('invite and accept admit a former member with a fresh key', () => {
    const u = makeUnit({ reform: true });
    const invite = u.act('co', { t: 'invite', former: u.key('oldC') }, T0 + 60, { name: 'xo' });
    const accept = u.act('newC', {
      t: 'accept', invite: invite.id, callsign: 'CRANE',
      former: compactOf(u.sign('oldC', { t: 'accept-by', unit: u.unit, invite: invite.id, key: u.key('newC') }, T0 + 90))
    }, T0 + 120);
    expect(u.voidReason(accept.id)).toBeUndefined();
    expect(u.members()).toContain('newC');
    expect(u.view().members.find((r) => r.key === u.key('newC'))!.how).toBe('re-formed');
    const roster = new Set([u.key('oldA'), u.key('oldB'), u.key('oldC')]);
    expect(u.view(LATER, { formerRoster: roster }).lineage!.former).toBe('checked');
    const without = u.view(LATER, { formerRoster: new Set([u.key('oldA'), u.key('oldB')]) });
    expect(without.lineage!.former).toBe('mismatch');
    // A phone holding the old roster refuses an invitation to a key not on it (units-attack BREAK 10);
    // a phone that never held the roster cannot check, and admits.
    expect(without.members.map((r) => u.nameOf(r.key))).not.toContain('newC');
    expect(without.void.find((x) => x.id === invite.id)!.reason).toBe('not-on-old-roster');
    expect(u.members()).toContain('newC');
  });

  it('accept without an invite, with the wrong former key, or in a unit that was not re-formed, is void', () => {
    const u = makeUnit({ reform: true });
    const invite = u.act('co', { t: 'invite', former: u.key('oldC') }, T0 + 60, { name: 'xo' });
    const wrong = u.act('newD', {
      t: 'accept', invite: invite.id, callsign: 'DACE',
      former: compactOf(u.sign('oldD', { t: 'accept-by', unit: u.unit, invite: invite.id, key: u.key('newD') }, T0 + 90))
    }, T0 + 120);
    expect(u.voidReason(wrong.id)).toBe('bad-former-signature');
    const none = u.act('newE', {
      t: 'accept', invite: '1'.repeat(64), callsign: 'EEL',
      former: compactOf(u.sign('oldC', { t: 'accept-by', unit: u.unit, invite: '1'.repeat(64), key: u.key('newE') }, T0 + 90))
    }, T0 + 130);
    expect(u.voidReason(none.id) ?? u.heldReason(none.id)).toBeDefined();
    expect(u.members()).not.toContain('newE');

    const plain = ledUnit(NINE);
    const inv = plain.act('co', { t: 'invite', former: plain.key('oldC') }, T0 + 2 * DAY, { name: 'xo' });
    expect(plain.voidReason(inv.id)).toBe('not-allowed');
  });
});

describe('A18: rule codes this release does not know', () => {
  it('a g2 charter freezes governance on this phone', () => {
    const u = ledUnit(NINE);
    const v = evaluate({ ...u.input(LATER), code: u.code.replace('.g1.', '.g2.') });
    expect(v.status).toBe('needs-update');
    expect(v.field).toBe('rule');
    expect(v.offices).toBeNull();
  });

  it('an unknown act in a g1 chain is dropped, and governance goes on', () => {
    const u = ledUnit(NINE);
    const junk = signStatement(u.sk('m1'), { t: 'leave', unit: u.unit, prev: u.tips() }, T0 + DAY);
    const content = JSON.parse(junk.content);
    content[1] = 'appoint';
    const odd = finalizeEvent({ kind: junk.kind, created_at: junk.created_at, tags: [], content: JSON.stringify(content) }, u.sk('m1'));
    u.chain.push({ act: odd });
    expect(u.voidReason(odd.id)).toBe('unknown-act');
    u.vacate('xo', 'xo', T0 + 2 * DAY);
    expect(u.offices().xo).toBeNull();
  });

  it('a result under rule g2 is void, and a disagreement', () => {
    const u = ledUnit(NINE);
    const open = u.open('m1', 'co', TE);
    u.vote(open.id, 'm2', ['co', 'xo', 'm1', 'm3', 'm4'], TE + 60);
    const r = rawResult(u, { poster: 'm1', run: open.id, candidate: 'm2', rule: 'g2', k: 5, at: TE + 600,
      sigs: u.loose.filter((e) => e.content.includes('"endorse"')) });
    expect(u.voidReason(r.id)).toBe('unknown-rule');
    expect(u.view().disagreements).toEqual([{ id: r.id, what: 'result' }]);
  });
});

describe('A19: founding equivocation', () => {
  it('a founder who signs a second founding for the unit refuses it, named', () => {
    const u = ledUnit(NINE);
    const otherCode = charterCode({ ...u.charter, room: 8 });
    const second = u.sign('xo', { t: 'found', unit: u.unit, code: otherCode, role: 'xo', other: u.key('co'), callsign: 'XO', former: null }, T0);
    u.loose.push(second);
    const v = u.view();
    expect(v.status).toBe('refused');
    expect(v.reason).toBe('founding-equivocation');
    expect(v.names).toEqual([u.key('xo')]);
  });

  it('refuses founding statements that do not pair', () => {
    const u = ledUnit(NINE);
    expect(evaluate({ ...u.input(LATER), found: [u.found[0], u.found[0]] }).reason).toBe('founding');
    expect(evaluate({ ...u.input(LATER), code: charterCode({ ...u.charter, room: 8 }) }).reason).toBe('founding');
  });

  it('a named higher at founding is refused', () => {
    const u = ledUnit(NINE);
    const named = charterCode({ ...u.charter, higher: { ...u.charter.higher, under: ['platoon'] } });
    expect(evaluate({ ...u.input(LATER), code: named }).reason).toBe('named-higher');
  });
});

describe('A20: checkpoints', () => {
  it('is due after every change of command, until two members co-sign one', () => {
    const u = ledUnit(NINE);
    expect(u.view().checkpointDue).toBe(false);
    u.vacate('xo', 'xo', T0 + DAY);
    const v = u.view();
    expect(v.checkpointDue).toBe(true);
    const cp = buildCheckpoint({ unit: u.unit, view: v, head: v.head, at: T0 + 2 * DAY }, u.sk('co'));
    u.loose.push(cp);
    expect(u.view().checkpointDue).toBe(true); // one signer is not a checkpoint
    u.loose.push(u.sign('m1', { t: 'sign', unit: u.unit, act: cp.id }, T0 + 2 * DAY));
    expect(u.view().checkpointDue).toBe(false);
    expect((readStatement(cp) as { statement: { snapshot: unknown } }).statement.snapshot).toEqual(snapshotOf(v));
  });

  it('a wrong count of consecutive terms is a disagreement', () => {
    const u = ledUnit(NINE);
    u.vacate('xo', 'xo', T0 + DAY);
    const v = u.view();
    const lie = { ...snapshotOf(v), cap: { holder: u.key('co'), count: 3 } };
    const cp = u.sign('co', { t: 'checkpoint', unit: u.unit, head: v.head, snapshot: lie }, T0 + 2 * DAY);
    u.loose.push(cp, u.sign('m1', { t: 'sign', unit: u.unit, act: cp.id }, T0 + 2 * DAY));
    const w = u.view();
    expect(w.disagreements).toEqual([{ id: cp.id, what: 'checkpoint' }]);
    expect(w.checkpointDue).toBe(true);
  });

  it('a phone anchored on a checkpoint reads the unit as the full history does', () => {
    const u = ledUnit(NINE);
    u.vacate('co', 'co', T0 + DAY);
    u.remove(['m7'], ['xo', 'm1'], T0 + 2 * DAY);
    const p = u.petition('m1', 'co', 'xo', T0 + 40 * DAY);
    u.support(['m2'], p.id, T0 + 41 * DAY);
    const v = u.view();
    const cp = buildCheckpoint({ unit: u.unit, view: v, head: v.head, at: T0 + 42 * DAY }, u.sk('m1'));
    const sign = u.sign('m2', { t: 'sign', unit: u.unit, act: cp.id }, T0 + 42 * DAY);
    const before = u.chain.length;
    u.elect({ office: 'xo', opener: 'm2', candidate: 'm3', voters: ['m1', 'm2', 'm3', 'm4', 'm5'], at: T0 + 43 * DAY });
    u.support(['m3', 'm4', 'm5'], p.id, T0 + 44 * DAY);
    u.recall('m4', p.id, T0 + 45 * DAY);
    u.admit('n1', ['m3', 'm6'], T0 + 46 * DAY);
    const full = u.view();
    const joiner = evaluate({
      ...u.input(LATER),
      chain: u.chain.slice(before),
      checkpoint: { event: cp, sign, roster: v.members }
    });
    expect(joiner.anchored).toBe(true);
    expect(joiner.status).toBe('ok');
    expect(joiner.members.map((r) => [r.key, r.callsign])).toEqual(full.members.map((r) => [r.key, r.callsign]));
    expect(joiner.offices).toEqual(full.offices);
    expect(joiner.snapshot).toEqual(full.snapshot);
    expect(u.offices()).toMatchObject({ co: 'm3', xo: null });
  });

  it('a single signer, or roster rows that do not match, are not an anchor', () => {
    const u = ledUnit(NINE);
    const v = u.view();
    const cp = buildCheckpoint({ unit: u.unit, view: v, head: v.head, at: T0 + 2 * DAY }, u.sk('m1'));
    const self = u.sign('m1', { t: 'sign', unit: u.unit, act: cp.id }, T0 + 2 * DAY);
    const a = evaluate({ ...u.input(LATER), chain: [], checkpoint: { event: cp, sign: self, roster: v.members } });
    expect(a.anchored).toBe(false);
    expect(a.void.find((x) => x.id === cp.id)!.reason).toBe('not-an-anchor');
    const sign = u.sign('m2', { t: 'sign', unit: u.unit, act: cp.id }, T0 + 2 * DAY);
    const rows = v.members.map((r, i) => (i === 0 ? { ...r, callsign: 'SOMEONE ELSE' } : r));
    const b = evaluate({ ...u.input(LATER), chain: [], checkpoint: { event: cp, sign, roster: rows } });
    expect(b.anchored).toBe(false);
    expect(rosterDigest(rows)).not.toBe(snapshotOf(v).roster);
  });
});

describe('A21: Any two', () => {
  const anyTwo = { shape: 'anyTwo' } as const;

  it('has no offices, so no office act stands', () => {
    const u = makeUnit({ governance: anyTwo, room: 8 });
    u.fill(['c', 'd'], ['a', 'b'], T0 + DAY);
    expect(u.view().offices).toBeNull();
    for (const e of [
      u.open('a', 'co', TE),
      u.petition('a', 'co', 'b', T0 + 40 * DAY),
      u.vacate('a', 'co', T0 + 41 * DAY)
    ]) {
      expect(u.voidReason(e.id)).toBe('no-offices');
    }
  });

  it('any two admit, and any two others remove', () => {
    const u = makeUnit({ governance: anyTwo, room: 8 });
    u.admit('c', ['a', 'b'], T0 + DAY);
    u.admit('d', ['c', 'b'], T0 + DAY + 1);
    expect(u.members()).toEqual(['a', 'b', 'c', 'd']);
    expect(u.voidReason(u.remove(['a'], ['c', 'd'], T0 + 2 * DAY).id)).toBeUndefined();
    expect(u.members()).toEqual(['b', 'c', 'd']);
  });

  it('in a unit of two, either removes the other', () => {
    const u = makeUnit({ governance: anyTwo, room: 4 });
    u.remove(['a'], ['b'], T0 + DAY);
    expect(u.members()).toEqual(['b']);
  });
});

describe('A22: repairs made alongside the units-core-attack breaks', () => {
  /** A secret key whose public key sorts below `below`. */
  const keyBelow = (below: string): Uint8Array => {
    for (;;) {
      const sk = generateSecretKey();
      if (getPublicKey(sk) < below) return sk;
    }
  };

  it('a throwaway signature on a checkpoint does not displace the member who co-signed it', () => {
    // The same flaw as BREAK 2, on checkpoints: the smallest signer was kept without asking whether
    // it was a member, so one stray signature hid a valid checkpoint.
    const u = ledUnit(NINE);
    u.vacate('xo', 'xo', T0 + DAY);
    const v = u.view();
    const cp = buildCheckpoint({ unit: u.unit, view: v, head: v.head, at: T0 + 2 * DAY }, u.sk('co'));
    u.loose.push(cp, u.sign('m1', { t: 'sign', unit: u.unit, act: cp.id }, T0 + 2 * DAY));
    expect(u.view().checkpointDue).toBe(false);
    u.loose.push(signStatement(keyBelow(u.key('m1')), { t: 'sign', unit: u.unit, act: cp.id }, T0 + 2 * DAY + 60));
    expect(u.view().checkpointDue).toBe(false);
  });

  it('a recalled CO cannot act as CO on a state from before the recall', () => {
    const u = ledUnit(NINE);
    const p = u.petition('m1', 'co', 'co', T0 + 31 * DAY);
    u.support(['m2', 'm3', 'm4', 'm5'], p.id, T0 + 32 * DAY);
    const before = u.tips();
    u.recall('m2', p.id, T0 + 33 * DAY);
    expect(u.offices().co).toBe('xo');
    // The recalled CO and an ally remove a petition signer, naming the state before the recall.
    const r = u.remove(['m3'], ['co', 'm7'], T0 + 34 * DAY, before);
    expect(u.voidReason(r.id)).toBe('office-ended');
    expect(u.members()).toContain('m3');
  });

  it('the CO cap holds through the term out, a vacancy filled in it included', () => {
    const capped = { shape: 'led', threshold: 'majority', term: 12, coCap: 'twoThenOut' } as const;
    const u = ledUnit(NINE, { governance: capped });
    const all = ['co', 'xo', ...NINE];
    u.elect({ office: 'co', opener: 'm1', candidate: 'co', voters: all.slice(0, 5), at: TE }); // a second term
    const t3 = u.view().offices!.co.term!.end;
    u.elect({ office: 'co', opener: 'm1', candidate: 'm2', voters: all.slice(2, 7), at: t3 }); // co sits out
    u.vacate('m2', 'co', t3 + 10 * DAY);
    const open = u.open('m1', 'co', t3 + 11 * DAY);
    u.vote(open.id, 'co', all.slice(2, 7), t3 + 11 * DAY + 60);
    const run = u.view().runs.find((r) => r.id === open.id)!;
    expect(run.kind).toBe('fill');
    expect(run.cappedKeys.map(u.nameOf)).toEqual(['co']);
    expect(run.postable).toBeNull(); // five of nine is a majority, not three-quarters
  });

  it('a clock that cannot be read refuses the unit, and shows nothing as current', () => {
    const u = ledUnit(NINE);
    for (const now of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const v = evaluate(u.input(now));
      expect([v.status, v.reason, v.members, v.offices]).toEqual(['refused', 'clock', [], null]);
    }
  });

  it('an act with two valid second signers stands while either of them remains', () => {
    const u = ledUnit(NINE);
    const h = u.tips();
    const ad = u.admit('n1', ['co', 'm1'], T0 + 2 * DAY, { prev: h });
    u.loose.push(u.sign('m2', { t: 'sign', unit: u.unit, act: ad.id }, T0 + 2 * DAY + 60));
    u.remove(['m1'], ['xo', 'm3'], T0 + 2 * DAY, h);
    expect(u.voidReason(ad.id)).toBeUndefined();
    expect(u.members()).toContain('n1');
    const w = ledUnit(NINE);
    const g = w.tips();
    const bd = w.admit('n1', ['co', 'm1'], T0 + 2 * DAY, { prev: g });
    w.loose.push(w.sign('m2', { t: 'sign', unit: w.unit, act: bd.id }, T0 + 2 * DAY + 60));
    w.remove(['m1', 'm2'], ['xo', 'm3'], T0 + 2 * DAY, g);
    expect(w.voidReason(bd.id)).toBe('removal-wins');
  });

  it('after a split week, what a member admitted in one half did falls with their admission', () => {
    const u = ledUnit(names(8));
    const h = u.tips();
    const a1 = u.admit('a1', ['co', 'm1'], T0 + 10 * DAY, { prev: h });
    const a2 = u.admit('a2', ['co', 'm2'], T0 + 11 * DAY, { prev: [a1.id] });
    const b1 = u.admit('b1', ['xo', 'm5'], T0 + 10 * DAY, { prev: h });
    u.admit('b2', ['xo', 'm6'], T0 + 11 * DAY, { prev: [b1.id] });
    const later = u.act('a1', { t: 'leave', prev: [a2.id] }, T0 + 12 * DAY);
    expect(u.voidReason(a1.id)).toBe('crossed-admissions');
    expect(u.voidReason(later.id)).toBe('built-on-void');
    expect(u.members()).toHaveLength(10);
  });

  it('one key building alone on its own unknown act changes nothing', () => {
    const u = ledUnit(NINE);
    const template = signStatement(u.sk('m1'), { t: 'leave', unit: u.unit, prev: u.tips() }, T0 + DAY);
    const content = JSON.parse(template.content);
    content[1] = 'rename';
    const newer = finalizeEvent({ kind: template.kind, created_at: template.created_at, tags: [], content: JSON.stringify(content) }, u.sk('m1'));
    u.chain.push({ act: newer });
    u.act('m1', { t: 'leave', prev: [newer.id] }, T0 + 2 * DAY);
    expect(u.view().status).toBe('ok');
  });
});

describe('determinism', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads the same whatever order the statements arrive in', () => {
    const u = ledUnit(NINE);
    const h = u.tips();
    u.petition('m1', 'co', 'co', T0 + 31 * DAY, h);
    u.remove(['m1'], ['co', 'm2'], T0 + 31 * DAY + 60, h);
    u.vacate('xo', 'xo', T0 + 32 * DAY);
    u.admit('n1', ['co', 'm3'], T0 + 33 * DAY);
    const v = u.view();
    for (let i = 0; i < 10; i++) {
      const w = evaluate({ ...u.input(LATER), chain: shuffled(u.chain), loose: shuffled(u.loose), found: shuffled([...u.found]) as [Event, Event] });
      expect(w).toEqual(v);
    }
  });

  it('never throws on garbage, and sets it aside', () => {
    const u = ledUnit(NINE);
    const v = evaluate({ ...u.input(LATER), chain: [...u.chain, { act: { id: 'x' } as never }, null as never], loose: [7 as never, { ...u.chain[0]!.act, sig: '0'.repeat(128) }] });
    expect(v.status).toBe('ok');
    expect(v.members).toHaveLength(9);
  });
});

