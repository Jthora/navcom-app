import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools/core';
import { addMonthsUTC } from '../src/units/charter.js';
import { readStatement, type Statement } from '../src/units/statements.js';
import { buildAct, evaluate } from '../src/units/governance.js';
import { DAY, LATER, REASON, T0, TestUnit, ledUnit, names, shuffled } from './helpers/units.js';

/**
 * The repairs of test/units-b0-attack.test.ts, from the side an attacker would try next: what each
 * repair must not open, and what it leaves, written down rather than silent. The governance.ts
 * docblock says why each rule is shaped as it is.
 */

const NINE = names(7); // with co and xo, a unit of nine
const TE = addMonthsUTC(T0, 12); // the founders' term end
const FIVE = ['xo', 'm1', 'm2', 'm3', 'm4'];

/** The same act re-signed by `poster` on another `prev`: a copy of a vote carries its signatures. */
function copy(u: TestUnit, poster: string, e: Event, prev: readonly string[], at: number): Event {
  const r = readStatement(e);
  if (!r.ok) throw new Error('not a statement');
  const again = u.sign(poster, { ...r.statement, prev: [...prev].sort() } as Statement, at);
  u.chain.push({ act: again });
  return again;
}

/** An act built as an honest phone builds it, on the view's head, waiting for its second signature. */
function waiting(u: TestUnit, at: number, act: Parameters<typeof buildAct>[0]['act']): Event {
  const e = buildAct({ unit: u.unit, view: u.view(), latest: null, act, at }, u.sk('co'));
  u.chain.push({ act: e });
  return e;
}

const sameInAnyOrder = (u: TestUnit) => {
  const v = u.view();
  for (let i = 0; i < 6; i++) {
    const w = evaluate({ ...u.input(LATER), chain: shuffled(u.chain), loose: shuffled(u.loose), found: shuffled([...u.found]) as [Event, Event] });
    expect(w).toEqual(v);
  }
};

describe('B0 repairs: what they must not open', () => {
  it('BREAK 4: a deposed CO and the ally who co-signed its stale act cannot keep it by re-posting the result on it', () => {
    // A copy of a result vouches for the door acts it was built on, since its poster saw them before
    // the change. A key never vouches for an act it signed itself, or the deposed CO and its ally
    // could re-post the result on every stale act they make and keep the door after losing it.
    const u = ledUnit(NINE);
    const { open, result } = u.elect({ office: 'co', opener: 'm1', candidate: 'm2', voters: FIVE, at: TE, poster: 'm3' });
    const stale = u.admit('sock', ['co', 'm7'], TE + 30 * DAY, { prev: [open.id] });
    expect(u.voidReason(stale.id)).toBe('office-ended');
    copy(u, 'm7', result, [stale.id], TE + 31 * DAY);
    copy(u, 'co', result, [stale.id], TE + 32 * DAY);
    expect(u.voidReason(stale.id)).toBe('office-ended');
    expect(u.members()).not.toContain('sock');
    expect(u.offices().co).toBe('m2');
    sameInAnyOrder(u);
  });

  it('BREAK 2: a late second signature back-dated to before the election changes nothing either', () => {
    // What decides is where the act stands in the chain, never the date its second signer writes.
    const u = ledUnit(NINE);
    const pending = waiting(u, T0 + 10 * DAY, { t: 'remove', keys: [u.key('m7')], reason: REASON });
    const ad = buildAct({ unit: u.unit, view: u.view(), latest: pending.id, act: { t: 'admit', key: u.key('n1'), callsign: 'N1', readmits: null }, at: T0 + 11 * DAY }, u.sk('co'));
    u.chain.push({ act: ad, sign: u.sign('xo', { t: 'sign', unit: u.unit, act: ad.id }, T0 + 11 * DAY) });
    const { result } = u.elect({ office: 'co', opener: 'm1', candidate: 'm7', voters: ['xo', 'm1', 'm2', 'm3', 'm4', 'm5'], at: TE });
    u.loose.push(u.sign('m6', { t: 'sign', unit: u.unit, act: pending.id }, T0 + 10 * DAY + 60));
    expect(u.voidReason(result.id)).toBeUndefined();
    expect(u.voidReason(pending.id)).toBe('vote-protection');
    expect(u.offices().co).toBe('m7');
    expect(u.members()).toContain('m7');
    sameInAnyOrder(u);
  });

  it('BREAK 2: a phone that names its own waiting act waits alone, and the election held meanwhile stands', () => {
    const u = ledUnit(NINE);
    const pending = waiting(u, T0 + 10 * DAY, { t: 'admit', key: u.key('n1'), callsign: 'N1', readmits: null });
    // A hand-rolled phone names it anyway: its act waits with it, and the unit goes on without both.
    const next = u.act('co', { t: 'remove', keys: [u.key('m5')], reason: REASON, prev: [pending.id] }, T0 + 11 * DAY, { name: 'xo' });
    expect(u.heldReason(next.id)).toBe('waiting-for-earlier');
    expect(u.members()).toContain('m5');
    const { result } = u.elect({ office: 'co', opener: 'm1', candidate: 'm2', voters: FIVE, at: TE });
    u.loose.push(u.sign('m5', { t: 'sign', unit: u.unit, act: pending.id }, TE + 30 * DAY));
    // Both now stand beside the election. The admission needed the CO's authority, which the result
    // ended (R4); the removal was co-signed by the XO, who kept office, so it stands.
    expect(u.voidReason(result.id)).toBeUndefined();
    expect(u.offices().co).toBe('m2');
    expect([u.voidReason(pending.id), u.voidReason(next.id)]).toEqual(['office-ended', undefined]);
    sameInAnyOrder(u);
  });

  it('BREAK 3: a run that has not settled still gives way to its opener\'s second open', () => {
    // R1 keeps its first purpose: one member cannot fill every phone with runs.
    const u = ledUnit(NINE);
    const before = u.tips();
    const first = u.open('m1', 'co', TE);
    const second = u.open('m1', 'co', TE + 1, before);
    expect([u.voidReason(first.id), u.voidReason(second.id)]).toEqual(['crossed-opens', 'crossed-opens']);
  });

  it('BREAK 6: one key in a removed holder\'s place, and it opens no petition while the old key votes', () => {
    const u = ledUnit(NINE);
    u.remove(['xo'], ['m1', 'm2'], T0 + 10 * DAY);
    u.open('m3', 'xo', T0 + 11 * DAY);
    const back = u.admit('xo2', ['m4', 'm5'], T0 + 12 * DAY, { readmits: 'xo' });
    expect(u.voidReason(back.id)).toBeUndefined();
    expect(u.voidReason(u.admit('xo3', ['co', 'm6'], T0 + 12 * DAY + 60, { readmits: 'xo' }).id)).toBe('not-allowed');
    // The opener's is a petition's first signature, so a key that does not vote opens none.
    expect(u.voidReason(u.petition('xo2', 'co', 'co', T0 + 40 * DAY).id)).toBe('not-an-elector');
    const p = u.petition('m1', 'co', 'co', T0 + 40 * DAY + 60);
    const pv = u.view().petitions.find((x) => x.id === p.id)!;
    expect(pv.electorate).toContain(u.key('xo'));
    expect(pv.electorate).not.toContain(u.key('xo2'));
    sameInAnyOrder(u);
  });

  it('BREAK 1: a removal of the winner made knowing the result stands, however the copy\'s id is ground', () => {
    for (const poster of ['m2', 'm6']) {
      const u = ledUnit(NINE);
      const { open, result } = u.elect({ office: 'co', opener: 'm1', candidate: 'm2', voters: FIVE, at: TE, poster: 'm3' });
      const rm = u.remove(['m2'], ['m3', 'm4'], TE + 60 * DAY);
      for (let i = 0; i < 4; i++) copy(u, poster, result, [open.id], TE + 61 * DAY + i);
      expect(u.voidReason(rm.id)).toBeUndefined();
      expect(u.members()).not.toContain('m2');
      expect(u.offices()).toMatchObject({ co: 'xo', coActing: true });
      expect(u.view().equivocators).toEqual([]);
      sameInAnyOrder(u);
    }
  });

  it('BREAK 7: a side somebody else built on wins, and reads the same in any order', () => {
    const u = ledUnit(NINE);
    const before = u.tips();
    const rm = u.remove(['m7'], ['co', 'm1'], T0 + 10 * DAY);
    u.admit('n1', ['co', 'm2'], T0 + 11 * DAY);
    const counter = u.remove(['co'], ['m7', 'm6'], T0 + 40 * DAY, before);
    expect([u.view().status, u.voidReason(rm.id), u.voidReason(counter.id)]).toEqual(['ok', undefined, 'removal-wins']);
    sameInAnyOrder(u);
  });
});

describe('B0 repairs: what remains', () => {
  it('BREAK 4: where the result\'s own poster signed a door act, a copy on the open still ends it, until a member who did not re-posts on it', () => {
    // The price of a key never vouching for its own act: the CO posting the result that unseats it
    // vouches for none of its own election-week door acts. Any member who signed none of them can
    // post a copy on them, and they stand again.
    const u = ledUnit(NINE);
    const open = u.open('m1', 'co', TE);
    u.vote(open.id, 'm2', FIVE, TE + 60);
    const ad = u.admit('n1', ['co', 'm5'], TE + 2 * DAY);
    const settled = u.result('co', open.id, 'm2', TE + 4 * DAY);
    copy(u, 'm4', settled, [open.id], TE + 34 * DAY);
    expect(u.voidReason(ad.id)).toBe('office-ended');
    copy(u, 'm3', settled, [ad.id], TE + 35 * DAY);
    expect(u.voidReason(ad.id)).toBeUndefined();
    expect(u.members()).toContain('n1');
  });

  it('BREAK 4: a third key re-posting the result keeps a deposed CO\'s stale act', () => {
    // Three keys where it took two: the deposed CO, its co-signer, and a poster who signed neither.
    const u = ledUnit(NINE);
    const { open, result } = u.elect({ office: 'co', opener: 'm1', candidate: 'm2', voters: FIVE, at: TE, poster: 'm3' });
    const stale = u.admit('sock', ['co', 'm7'], TE + 30 * DAY, { prev: [open.id] });
    copy(u, 'm6', result, [stale.id], TE + 31 * DAY);
    expect(u.voidReason(stale.id)).toBeUndefined();
    expect(u.members()).toContain('sock');
  });

  it('BREAK 7: with a third colluder building on the stale side, the unit still splits', () => {
    const u = ledUnit(NINE);
    const before = u.tips();
    const rm = u.remove(['m7'], ['co', 'm1'], T0 + 10 * DAY);
    u.admit('n1', ['co', 'm2'], T0 + 11 * DAY);
    const counter = u.remove(['co'], ['m7', 'm6'], T0 + 40 * DAY, before);
    u.open('m5', 'xo', T0 + 41 * DAY, [counter.id]);
    expect([u.view().status, u.voidReason(rm.id), u.voidReason(counter.id)]).toEqual(['split', 'split', 'split']);
    // A person following the side the unit went on with resolves it, as before.
    expect(u.view(LATER, { follow: rm.id }).status).toBe('ok');
  });

  it('BREAK 2: a seized key\'s stale vacate on exactly the state of its holder\'s only door act since ends that one act', () => {
    // The price of R10 reading an act the ending saw all of as earlier on its author's line, which an
    // honest vacate made while its own admission waits needs (or a late signature would void the
    // vacate and the fill election built on it). Once the holder has authored a second co-signed act,
    // the stale vacate falls instead, as in FLOOR F7.
    const u = ledUnit(NINE);
    const before = u.tips();
    const rm = u.remove(['m7'], ['co', 'm1'], T0 + 10 * DAY);
    const stale = u.vacate('co', 'co', T0 + 40 * DAY, before);
    expect([u.voidReason(rm.id), u.voidReason(stale.id)]).toEqual(['office-ended', undefined]);
    u.admit('n1', ['co', 'm2'], T0 + 11 * DAY, { prev: [rm.id] });
    expect([u.voidReason(rm.id), u.voidReason(stale.id)]).toEqual([undefined, 'ending-crossed']);
  });

  it('BREAK 2: a late second signature still completes its act beside what came after it, R5 included', () => {
    // The co-signed act stands where its author put it, concurrent with everything since, so the
    // crossing rules read it like any concurrent act: here removal wins over the admission its target
    // co-signed meanwhile. Pre-B0 behaved the same; it is the reach-back named in the docblock.
    const u = ledUnit(NINE);
    const pending = waiting(u, T0 + 10 * DAY, { t: 'remove', keys: [u.key('m7')], reason: REASON });
    const ad = u.admit('n1', ['co', 'm7'], T0 + 12 * DAY);
    u.loose.push(u.sign('m6', { t: 'sign', unit: u.unit, act: pending.id }, T0 + 40 * DAY));
    expect([u.voidReason(pending.id), u.voidReason(ad.id)]).toEqual([undefined, 'removal-wins']);
    expect(u.members()).not.toContain('m7');
  });
});
