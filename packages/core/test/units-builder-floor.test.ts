import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools/core';
import { generateSecretKey } from 'nostr-tools/pure';
import { MAX_PARENTS, readStatement, signStatement } from '../src/units/statements.js';
import { GovernanceError, buildAct, evaluate, prevFor } from '../src/units/governance.js';
import { DAY, REASON, T0, ledUnit, makeUnit, names, shuffled } from './helpers/units.js';

/**
 * The office builder's phase B0 (drafts/structures/office-builder.md §7 and §12): the floor rules
 * that close weaknesses g1 already has with two offices. F7, one key and one line for endings; F5,
 * removing an office holder's key never shrinks an electorate; and one key per removal act.
 *
 * The first two describes are landed from drafts/structures/units-builder-floor.proposed.test.ts
 * (the office-builder adversary pass, 2026-10-10), with the one change the draft names: under F7's
 * author rule the CO, not a plain member, authors the acts. Both FAILED on g1 as committed before
 * B0, as the draft predicted: the `// before B0:` notes record what that evaluator did. The rest
 * were written with the repair, and those marked "before B0" also failed against it.
 *
 * Five were corrected with the repairs of B0's adversarial pass (test/units-b0-attack.test.ts), each
 * marked "Corrected" with the reason: two concurrent removals by one author now both stand (BREAK 5);
 * a phone no longer names, or builds on, its own act while it waits for a second signature, so the two
 * waiting-admission cases changed (BREAK 2); F7's cost is reached by a stale act that stands on
 * something the vacate did not see (BREAK 2); and a readmitted key takes a holder's place but not its
 * vote (BREAK 6).
 */

const NINE = names(7); // with co and xo, a unit of nine

describe('FLOOR F7: one key cannot aim R4 backwards with a stale vacate', () => {
  // R4 voided an admission or removal that needed an officer if every officer who signed it lost
  // office in a concurrent change. A vacate needs only its holder's key, and concurrency is the
  // signer's choice: a vacate naming an old state is concurrent with everything since.
  it('a seized CO phone reinstates a member the CO removed, and drops one the CO admitted', () => {
    const u = ledUnit(NINE);
    const before = u.tips();
    const rm = u.remove(['m7'], ['co', 'm1'], T0 + 10 * DAY); // the CO authors, m1 co-signs
    const ad = u.admit('n1', ['co', 'm2'], T0 + 11 * DAY); // the CO authors, m2 co-signs
    expect(u.members()).not.toContain('m7');
    expect(u.members()).toContain('n1');

    // A month later, whoever holds the CO's phone vacates, naming the state before both acts.
    const stale = u.vacate('co', 'co', T0 + 40 * DAY, before);

    expect(u.voidReason(rm.id)).toBeUndefined(); // before B0: 'office-ended'
    expect(u.members()).not.toContain('m7'); // before B0: m7 is a member again
    expect(u.voidReason(ad.id)).toBeUndefined(); // before B0: 'office-ended'
    expect(u.members()).toContain('n1'); // before B0: n1 is gone
    // The one-key ending gives way to the two-key acts, and the key that signed it is named.
    expect(u.view().void.find((x) => x.id === stale.id)).toEqual({ id: stale.id, reason: 'ending-crossed', names: [u.key('co')] });
    expect(u.offices()).toMatchObject({ co: 'co', xo: 'xo' });
  });
});

describe('FLOOR F5: removing an office holder\'s key never shrinks an electorate', () => {
  // Any two members may remove an office holder's key. The fill elections then froze an electorate
  // without the removed holders: in g1 that cost two votes; with six built offices in a room of 15
  // it would take the electorate from 15 to 7 and a majority from 8 to 4.
  it('two plain members empty both offices, and the CO fill election still counts the holders removed', () => {
    const u = ledUnit(NINE);
    // Corrected with B0's one key per removal act: the proposed test removed both keys in one act,
    // which is now void. The purge it describes is two acts.
    const both = u.remove(['co', 'xo'], ['m1', 'm2'], T0 + 10 * DAY);
    expect(u.voidReason(both.id)).toBe('not-allowed');
    const rmCo = u.remove(['co'], ['m1', 'm2'], T0 + 10 * DAY + 60);
    const rmXo = u.remove(['xo'], ['m1', 'm2'], T0 + 10 * DAY + 120);
    expect(u.voidReason(rmCo.id)).toBeUndefined(); // allowed, and by units.md §6
    expect(u.voidReason(rmXo.id)).toBeUndefined();
    expect(u.offices()).toMatchObject({ co: null, xo: null });
    const open = u.open('m1', 'co', T0 + 11 * DAY);
    const run = u.view().runs.find((r) => r.id === open.id)!;
    expect(run.electorate).toContain(u.key('co')); // before B0: absent, an electorate of 7
    expect(run.electorate).toContain(u.key('xo'));
    expect([run.m, run.k]).toEqual([9, 5]);
  });
});

// -------------------------------------------------------------------------------------------------
// F7: one key, one line for endings
// -------------------------------------------------------------------------------------------------

describe('F7: whoever holds the power authors the act', () => {
  it('a plain member authoring a door act with the CO only co-signing is not allowed; the CO authoring it is', () => {
    const u = ledUnit(NINE);
    expect(u.voidReason(u.admit('n1', ['m1', 'co'], T0 + DAY).id)).toBe('not-allowed');
    expect(u.voidReason(u.remove(['m7'], ['m1', 'co'], T0 + DAY + 1).id)).toBe('not-allowed');
    expect(u.voidReason(u.admit('n2', ['co', 'm1'], T0 + DAY + 2).id)).toBeUndefined();
    expect(u.voidReason(u.remove(['m7'], ['xo', 'm1'], T0 + DAY + 3).id)).toBeUndefined();
    expect(u.members()).toContain('n2');
    expect(u.members()).not.toContain('n1');
    expect(u.members()).not.toContain('m7');
  });

  it('an office holder\'s key still comes off by any two members other than that holder', () => {
    const u = ledUnit(NINE);
    expect(u.voidReason(u.remove(['xo'], ['m1', 'm2'], T0 + DAY).id)).toBeUndefined();
    expect(u.offices()).toMatchObject({ co: 'co', xo: null });
  });
});

describe('F7: a stale leave is an ending too', () => {
  it('a seized CO phone leaving on an old state undoes nothing the CO did since (before B0: R5 undid all of it)', () => {
    const u = ledUnit(NINE);
    const before = u.tips();
    const rm = u.remove(['m7'], ['co', 'm1'], T0 + 10 * DAY);
    const ad = u.admit('n1', ['co', 'm2'], T0 + 11 * DAY);
    const stale = u.leave('co', T0 + 40 * DAY, before);
    expect(u.voidReason(rm.id)).toBeUndefined(); // before B0: 'removal-wins'
    expect(u.voidReason(ad.id)).toBeUndefined(); // before B0: 'removal-wins'
    expect(u.members()).not.toContain('m7');
    expect(u.members()).toContain('n1');
    expect(u.voidReason(stale.id)).toBe('ending-crossed');
    expect(u.offices().co).toBe('co');
  });

  it('a seized co-signer\'s phone leaving on an old state undoes nothing it co-signed (before B0: R5 undid all of it)', () => {
    const u = ledUnit(NINE);
    const before = u.tips();
    const rm = u.remove(['m7'], ['co', 'm4'], T0 + 10 * DAY);
    const ad = u.admit('n1', ['co', 'm4'], T0 + 11 * DAY);
    const leave = u.leave('m4', T0 + 40 * DAY, before);
    expect(u.voidReason(rm.id)).toBeUndefined(); // before B0: 'removal-wins'
    expect(u.voidReason(ad.id)).toBeUndefined(); // before B0: 'removal-wins'
    expect(u.members()).not.toContain('m7');
    expect(u.members()).toContain('n1');
    // The leave itself stands: m4 authored nothing co-signed, so it ends only m4's own membership.
    expect(u.voidReason(leave.id)).toBeUndefined();
    expect(u.members()).not.toContain('m4');
  });
});

describe('F7: one line for endings', () => {
  it('two concurrent removals authored by one key are two keys each, and both stand', () => {
    // Corrected with the B0 attack repair (B0-BREAK 5): this asserted that both fall, ending-crossed.
    // A co-signed removal carries two keys, and R10 is for endings that carry one. Counted as F7
    // endings, removals let a stale co-signed act by their author and the very member one of them
    // removed void every removal that author made. Neither of these undoes the other: each removes a
    // key the other's signers do not include.
    const u = ledUnit(NINE);
    const h = u.tips();
    const a = u.remove(['m6'], ['co', 'm1'], T0 + 2 * DAY, h);
    const b = u.remove(['m7'], ['co', 'm2'], T0 + 2 * DAY, h);
    expect([u.voidReason(a.id), u.voidReason(b.id)]).toEqual([undefined, undefined]);
    expect(u.members()).not.toContain('m6');
    expect(u.members()).not.toContain('m7');
    // In one line, both stand.
    const w = ledUnit(NINE);
    const c = w.remove(['m6'], ['co', 'm1'], T0 + 2 * DAY);
    const d = w.remove(['m7'], ['co', 'm2'], T0 + 2 * DAY + 1);
    expect([w.voidReason(c.id), w.voidReason(d.id)]).toEqual([undefined, undefined]);
  });

  it('a vacate is not voided by acts its key only co-signed, and those acts still stand', () => {
    const u = ledUnit(NINE);
    const before = u.tips();
    const ad = u.admit('n1', ['co', 'xo'], T0 + 10 * DAY); // the XO co-signs; the CO authors
    const vacate = u.vacate('xo', 'xo', T0 + 40 * DAY, before);
    expect(u.voidReason(vacate.id)).toBeUndefined();
    expect(u.voidReason(ad.id)).toBeUndefined(); // the CO, who authored it, kept office
    expect(u.offices()).toMatchObject({ co: 'co', xo: null });
    expect(u.members()).toContain('n1');
  });

  it('a co-signed act a throwaway key signed cannot void an ending', () => {
    const u = ledUnit(NINE);
    const before = u.tips();
    const vacate = u.vacate('co', 'co', T0 + 5 * DAY);
    // The vacated key authors a stale admission on the old state, co-signed by a key that is no member.
    const ad = u.act('co', { t: 'admit', key: u.key('sock'), callsign: 'SOCK', readmits: null, prev: before }, T0 + 40 * DAY);
    u.loose.push(signStatement(generateSecretKey(), { t: 'sign', unit: u.unit, act: ad.id }, T0 + 40 * DAY));
    expect(u.voidReason(ad.id)).toBe('not-a-member');
    expect(u.voidReason(vacate.id)).toBeUndefined();
    expect(u.offices()).toMatchObject({ co: 'xo', coActing: true });
  });

  it('reads the same whatever order the statements arrive in', () => {
    const u = ledUnit(NINE);
    const before = u.tips();
    u.remove(['m7'], ['co', 'm1'], T0 + 10 * DAY);
    u.admit('n1', ['co', 'm2'], T0 + 11 * DAY);
    u.vacate('co', 'co', T0 + 40 * DAY, before);
    u.leave('m4', T0 + 41 * DAY, before);
    const v = evaluate(u.input(T0 + 400 * DAY));
    expect(v.status).toBe('ok');
    for (let i = 0; i < 8; i++) {
      const w = evaluate({ ...u.input(T0 + 400 * DAY), chain: shuffled(u.chain), loose: shuffled(u.loose), found: shuffled([...u.found]) as [Event, Event] });
      expect(w).toEqual(v);
    }
  });
});

describe('F7: a phone names its own latest authored act, never one it holds back', () => {
  // Corrected with the B0 attack repair (B0-BREAK 2). B0 had a phone name its own act while it waited
  // for a second signature, and gave what was built on it a place to stand without it. Co-signed late,
  // that act landed beneath everything since and changed every electorate frozen there: one late
  // signature undid an election. Now a phone never names an act it holds back, nothing stands on an
  // act still waiting, and a late-completed act is read beside what came after it. R10 does not void
  // an ending for a co-signed act whose ancestry the ending saw, so the honest ending stands.
  it('prevFor keeps the key\'s own latest act within the parent limit', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'].map((c) => c.repeat(64));
    const mine = 'f'.repeat(64);
    expect(prevFor(ids.slice(0, 2), null)).toEqual(ids.slice(0, 2));
    expect(prevFor(ids, mine)).toHaveLength(MAX_PARENTS);
    expect(prevFor(ids, mine)).toContain(mine);
    expect(prevFor([mine, ids[0]!], mine)).toEqual([ids[0]!, mine]);
  });

  it('an honest CO vacates while its own admission waits; the vacate stands, and the admission falls with the office', () => {
    const u = ledUnit(NINE);
    // The CO admits n1 in person; m1's second signature has not reached this phone yet.
    const ad = buildAct({ unit: u.unit, view: u.view(), latest: null, act: { t: 'admit', key: u.key('n1'), callsign: 'N1', readmits: null }, at: T0 + 10 * DAY }, u.sk('co'));
    u.chain.push({ act: ad });
    expect(u.heldReason(ad.id)).toBe('incomplete');
    // The CO's next act does not name it, so it is read now rather than held behind it.
    const vacate = buildAct({ unit: u.unit, view: u.view(), latest: ad.id, act: { t: 'vacate', office: 'co' }, at: T0 + 11 * DAY }, u.sk('co'));
    const read = readStatement(vacate);
    if (!read.ok || read.statement.t !== 'vacate') throw new Error('not a vacate');
    expect(read.statement.prev).not.toContain(ad.id);
    u.chain.push({ act: vacate });
    expect(u.heldReason(vacate.id)).toBeUndefined();
    expect(u.offices()).toMatchObject({ co: 'xo', coActing: true });
    expect(u.view().head).toEqual([vacate.id]);
    // The second signature arrives. The admission is read beside the vacate, which saw everything it
    // stood on, so R10 leaves the vacate alone; the CO's authority ended with it, so R4 ends the
    // admission. The CO admits n1 again, or waits for the signature before stepping down.
    u.loose.push(u.sign('m1', { t: 'sign', unit: u.unit, act: ad.id }, T0 + 12 * DAY));
    expect([u.voidReason(ad.id), u.heldReason(ad.id), u.voidReason(vacate.id)]).toEqual(['office-ended', undefined, undefined]);
    expect(u.members()).not.toContain('n1');
    expect(u.offices()).toMatchObject({ co: 'xo', coActing: true });
  });

  it('a phone that names its own waiting admission anyway waits with it, and both stand once co-signed', () => {
    const u = ledUnit(NINE);
    const ad = buildAct({ unit: u.unit, view: u.view(), latest: null, act: { t: 'admit', key: u.key('n1'), callsign: 'N1', readmits: null }, at: T0 + 10 * DAY }, u.sk('co'));
    u.chain.push({ act: ad });
    // A hand-rolled phone names it: nothing stands on an act still waiting, so the vacate waits too.
    const vacate = u.act('co', { t: 'vacate', office: 'co', prev: [ad.id] }, T0 + 11 * DAY);
    expect(u.heldReason(vacate.id)).toBe('waiting-for-earlier');
    expect(u.offices()).toMatchObject({ co: 'co', xo: 'xo' });
    u.loose.push(u.sign('m1', { t: 'sign', unit: u.unit, act: ad.id }, T0 + 12 * DAY));
    expect([u.voidReason(ad.id), u.voidReason(vacate.id)]).toEqual([undefined, undefined]);
    expect(u.members()).toContain('n1');
    expect(u.offices()).toMatchObject({ co: 'xo', coActing: true });
  });

  it('buildAct refuses a view with no head', () => {
    const u = ledUnit(NINE);
    const refused = evaluate({ ...u.input(T0), code: u.code.replace('.g1.', '.g2.') });
    expect(() => buildAct({ unit: u.unit, view: refused, latest: null, act: { t: 'leave' }, at: T0 }, u.sk('m1'))).toThrow(GovernanceError);
  });
});

describe('F7: what remains (its cost)', () => {
  // office-builder.md §7 F7, "Its cost": a vacated holder's key, later seized, plus one ally can author
  // a stale co-signed act that voids the earlier vacate. What was built only on the vacate falls with
  // it, an election to fill the post included. Two keys where it took one before B0; the remedy is
  // that any two members remove that key.
  it('a vacated CO key and an ally undo the vacate and the fill election built on it, until two members remove the key', () => {
    const u = ledUnit(NINE);
    const before = u.tips();
    const vacate = u.vacate('co', 'co', T0 + 5 * DAY);
    const { result } = u.elect({ office: 'co', opener: 'm1', candidate: 'xo', voters: ['xo', 'm1', 'm2', 'm3', 'm4'], at: T0 + 6 * DAY });
    expect(u.offices()).toMatchObject({ co: 'xo', coActing: false, xo: null });
    // Corrected with the B0 attack repair: a stale act on the very state the vacate names no longer
    // voids it, since the vacate saw everything that act stood on (R10 reads it as earlier on the
    // CO's line), and R4 ends it instead. The cost remains where the stale act also stands on
    // something the vacate never saw: here the ally's own petition, signed on the old state.
    const plain = u.admit('sock0', ['co', 'm7'], T0 + 39 * DAY, { prev: before });
    expect(u.voidReason(plain.id)).toBe('office-ended');
    expect(u.voidReason(vacate.id)).toBeUndefined();
    const seen = u.petition('m7', 'co', 'co', T0 + 40 * DAY, before);
    const sock = u.admit('sock', ['co', 'm7'], T0 + 40 * DAY + 60, { prev: [seen.id] });
    expect(u.voidReason(vacate.id)).toBe('ending-crossed');
    expect(u.voidReason(result.id)).toBe('built-on-void');
    expect(u.offices()).toMatchObject({ co: 'co', xo: 'xo' });
    expect(u.members()).toContain('sock');
    // Two members remove the key on the same old state: what it signed since falls (R5), and the XO
    // acts as CO. The election has to be run again.
    u.remove(['co'], ['m1', 'm2'], T0 + 41 * DAY, before);
    expect(u.voidReason(sock.id)).toBe('removal-wins');
    expect(u.members()).not.toContain('sock');
    expect(u.offices()).toMatchObject({ co: 'xo', coActing: true });
  });
});

// -------------------------------------------------------------------------------------------------
// F5: removed holders still count
// -------------------------------------------------------------------------------------------------

describe('F5: removed holders still count, until their office is filled', () => {
  for (const order of [['co', 'xo'], ['xo', 'co']] as const) {
    it(`removing ${order[0]} then ${order[1]}: the CO fill counts both, and an XO fill opened after it counts whoever left the XO post`, () => {
      const u = ledUnit(NINE);
      u.remove([order[0]], ['m1', 'm2'], T0 + 10 * DAY);
      u.remove([order[1]], ['m1', 'm2'], T0 + 10 * DAY + 60);
      const { open } = u.elect({ office: 'co', opener: 'm3', candidate: 'm3', voters: ['m1', 'm2', 'm3', 'm4', 'm5'], at: T0 + 11 * DAY });
      const coRun = u.view(T0 + 11 * DAY + 100).runs.find((r) => r.id === open.id)!;
      expect(coRun.electorate).toEqual(expect.arrayContaining([u.key('co'), u.key('xo')]));
      expect(coRun.m).toBe(9);
      expect(u.offices().co).toBe('m3');
      const xoOpen = u.open('m4', 'xo', T0 + 12 * DAY);
      const xoRun = u.view().runs.find((r) => r.id === xoOpen.id)!;
      expect(xoRun.electorate).toContain(u.key('xo'));
      expect(xoRun.electorate).not.toContain(u.key('co')); // the CO post it held is filled
      expect(xoRun.m).toBe(8);
    });
  }

  it('a petition counts a removed holder too', () => {
    const u = ledUnit(NINE);
    u.remove(['xo'], ['m1', 'm2'], T0 + 10 * DAY);
    const p = u.petition('m1', 'co', 'co', T0 + 31 * DAY);
    const pv = u.view().petitions.find((x) => x.id === p.id)!;
    expect(pv.electorate).toContain(u.key('xo'));
    expect(pv.electorate).not.toContain(u.key('co'));
    expect(pv.m).toBe(8);
  });

  it('a readmitted holder\'s new key takes the old one\'s place, and the vote stays with the old key until the office is filled', () => {
    // Corrected with the B0 attack repair (B0-BREAK 6): this asserted that the new key takes the old
    // one's vote. Nothing ties the new key to the holder, so two members who name a removed holder
    // could hand that holder's vote to a sock. A readmission never moves a vote, and still never adds
    // one: the new key does not vote while the old key does.
    const u = ledUnit(NINE);
    u.remove(['co'], ['m1', 'm2'], T0 + 10 * DAY);
    const run1 = u.open('m3', 'co', T0 + 11 * DAY);
    u.admit('co2', ['m4', 'm5'], T0 + 12 * DAY, { readmits: 'co' });
    // One key in the holder's place, ever.
    expect(u.voidReason(u.admit('co3', ['m4', 'm6'], T0 + 12 * DAY + 60, { readmits: 'co' }).id)).toBe('not-allowed');
    const run2 = u.open('m6', 'xo', T0 + 13 * DAY);
    const v = u.view();
    const e1 = v.runs.find((r) => r.id === run1.id)!.electorate;
    const e2 = v.runs.find((r) => r.id === run2.id)!.electorate;
    // Opened before the readmission: frozen with the old key, and the new one is not an elector.
    expect(e1).toContain(u.key('co'));
    expect(e1).not.toContain(u.key('co2'));
    // Opened after it, with the CO post still unfilled: the old key still, the same count.
    expect(e2).toContain(u.key('co'));
    expect(e2).not.toContain(u.key('co2'));
    expect([e1.length, e2.length]).toEqual([9, 9]);
    // A checkpoint carries the pairing, so a phone starting from one reads the same electorates.
    expect(v.snapshot!.holding).toEqual([[u.key('co'), ['co'], u.key('co2')]]);
    // The readmitted key may stand, and once the CO post is filled the old key's vote ends and the
    // new key's begins.
    u.vote(run1.id, 'co2', ['co', 'm1', 'm2', 'm3', 'm4'], T0 + 14 * DAY);
    u.result('m3', run1.id, 'co2', T0 + 14 * DAY + 600);
    expect(u.offices().co).toBe('co2');
    expect(u.view().snapshot!.holding).toEqual([]);
  });

  it('a readmitted key votes once its holder\'s office is filled', () => {
    const u = ledUnit(NINE);
    u.remove(['co'], ['m1', 'm2'], T0 + 10 * DAY);
    const run1 = u.open('m3', 'co', T0 + 11 * DAY);
    u.admit('co2', ['m4', 'm5'], T0 + 12 * DAY, { readmits: 'co' });
    u.vote(run1.id, 'm3', ['co', 'm1', 'm2', 'm3', 'm4'], T0 + 13 * DAY);
    u.result('m3', run1.id, 'm3', T0 + 13 * DAY + 600);
    // Removing the CO made the XO acting CO and left the XO post empty; its fill opens now.
    const run2 = u.open('m6', 'xo', T0 + 14 * DAY);
    const e2 = u.view().runs.find((r) => r.id === run2.id)!.electorate;
    expect(e2).toContain(u.key('co2'));
    expect(e2).not.toContain(u.key('co'));
    expect(e2).toHaveLength(9);
  });

  it('a removed holder keeps a place in the room until the office is filled or they are readmitted', () => {
    const u = ledUnit(['m1', 'm2'], { room: 4 });
    u.remove(['xo'], ['m1', 'm2'], T0 + 10 * DAY);
    expect(u.voidReason(u.admit('n1', ['co', 'm1'], T0 + 11 * DAY).id)).toBe('room-full');
    // The readmitted holder takes back the place kept for them.
    const back = u.admit('xo2', ['co', 'm1'], T0 + 12 * DAY, { readmits: 'xo' });
    expect(u.voidReason(back.id)).toBeUndefined();
    expect(u.members()).toEqual(['co', 'm1', 'm2', 'xo2']);

    // Or the office is filled, and the place is free.
    const w = ledUnit(['m1', 'm2'], { room: 4 });
    w.remove(['xo'], ['m1', 'm2'], T0 + 10 * DAY);
    const { open } = w.elect({ office: 'xo', opener: 'm1', candidate: 'm1', voters: ['co', 'm1', 'm2'], at: T0 + 11 * DAY });
    expect(w.view(T0 + 11 * DAY + 100).runs.find((r) => r.id === open.id)!.k).toBe(3); // three of four, the removed XO among them
    expect(w.offices().xo).toBe('m1');
    expect(w.voidReason(w.admit('n1', ['co', 'm2'], T0 + 12 * DAY).id)).toBeUndefined();
  });

  it('decapitate, then elect: two colluders no longer pass a fill election alone in a unit of four', () => {
    // Before B0 the two plain members removed both officers and elected each other with two of two.
    const u = ledUnit(['m1', 'm2'], { room: 4 });
    u.remove(['co'], ['m1', 'm2'], T0 + 10 * DAY);
    u.remove(['xo'], ['m1', 'm2'], T0 + 10 * DAY + 60);
    const open = u.open('m1', 'co', T0 + 11 * DAY);
    u.vote(open.id, 'm1', ['m1', 'm2'], T0 + 11 * DAY + 60);
    const run = u.view().runs.find((r) => r.id === open.id)!;
    expect([run.m, run.k, run.postable]).toEqual([4, 3, null]);
    expect(() => u.result('m2', open.id, 'm1', T0 + 11 * DAY + 600)).toThrow(GovernanceError);
  });
});

// -------------------------------------------------------------------------------------------------
// One key per removal act
// -------------------------------------------------------------------------------------------------

describe('one key per removal act', () => {
  it('a removal naming two keys is void, whoever signs it; each key comes off by its own act', () => {
    const u = ledUnit(NINE);
    const two = u.act('co', { t: 'remove', keys: [u.key('m6'), u.key('m7')].sort(), reason: REASON }, T0 + DAY, { name: 'xo' });
    expect(u.voidReason(two.id)).toBe('not-allowed');
    expect(u.members()).toEqual(expect.arrayContaining(['m6', 'm7']));
    u.remove(['m6'], ['co', 'xo'], T0 + 2 * DAY);
    u.remove(['m7'], ['co', 'xo'], T0 + 2 * DAY + 1);
    expect(u.members()).not.toContain('m6');
    expect(u.members()).not.toContain('m7');
  });

  it('holds in an Any two unit as well', () => {
    const u = makeUnit({ governance: { shape: 'anyTwo' }, room: 8 });
    u.fill(['c', 'd'], ['a', 'b'], T0 + DAY);
    const two = u.act('a', { t: 'remove', keys: [u.key('c'), u.key('d')].sort(), reason: REASON }, T0 + 2 * DAY, { name: 'b' });
    expect(u.voidReason(two.id)).toBe('not-allowed');
    expect(u.members()).toEqual(['a', 'b', 'c', 'd']);
  });
});
