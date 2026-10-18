import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools/core';
import { addMonthsUTC } from '../src/units/charter.js';
import { readStatement, type Statement } from '../src/units/statements.js';
import { buildAct, type ActBody } from '../src/units/governance.js';
import { DAY, REASON, T0, TestUnit, ledUnit, names } from './helpers/units.js';

/**
 * Adversarial pass on the office builder's phase B0 (branch units-b0, c908f122): F5, F7 and one key
 * per removal act. Every test here is a break. It states what B0's own claims require (the commit,
 * drafts/structures/office-builder.md §7 and §8, and the governance.ts docblock), and it FAILED
 * against the evaluator as committed. The `// actual:` notes record what that evaluator did. Nothing
 * in src/ was changed.
 *
 * Repaired on units-b0-attack: every break now passes. One line was corrected where the repair
 * showed it wrong, marked "Corrected" with the reason beside it (BREAK 5's last case asserted the
 * break's own effect as a step). What each repair leaves is written down in the governance.ts
 * docblock, under "What it cannot settle".
 *
 * Personas: a seized key, two colluders, a stale prev, a withheld second signature, and a replayed
 * act. Each describe says whether B0 introduced the break or it was already in g1. "Already in g1"
 * was checked by running the same scenario against the parent commit's evaluator (1d8f5cf5): it
 * behaved the same there. B0 claims to close one-key reach-backs, so these are in scope too.
 *
 * Severity: CRITICAL (one key, permanent, undoes settled history on every phone), HIGH (a seized
 * key with its natural ally, or two colluders, defeats a B0 claim), MEDIUM (a rule bends visibly).
 */

const NINE = names(7); // with co and xo, a unit of nine
const TE = addMonthsUTC(T0, 12); // the founders' term end
const FIVE = ['xo', 'm1', 'm2', 'm3', 'm4'];

/** An act built as an honest phone builds it: on the view's head and the key's own latest act. */
function authored(u: TestUnit, name: string, latest: string | null, act: ActBody, at: number, cosigner?: string): Event {
  const e = buildAct({ unit: u.unit, view: u.view(), latest, act, at }, u.sk(name));
  const sign = cosigner ? u.sign(cosigner, { t: 'sign', unit: u.unit, act: e.id }, at) : undefined;
  u.chain.push(sign ? { act: e, sign } : { act: e });
  return e;
}

/**
 * The same act re-signed by `poster` on another `prev`: every field but the parents is copied, so a
 * result carries the same endorsements, stand and digest. With `sort`, the time is stepped until the
 * new id sorts below or above the original's, which a poster can do in a couple of tries.
 */
function replay(u: TestUnit, poster: string, e: Event, prev: readonly string[], at: number, sort?: 'below' | 'above'): Event {
  const r = readStatement(e);
  if (!r.ok) throw new Error('not a statement');
  for (let t = at; t < at + 10_000; t++) {
    const again = u.sign(poster, { ...r.statement, prev: [...prev].sort() } as Statement, t);
    if (sort === undefined || (again.id < e.id) === (sort === 'below')) {
      u.chain.push({ act: again });
      return again;
    }
  }
  throw new Error('no id found');
}

// -------------------------------------------------------------------------------------------------
// CRITICAL
// -------------------------------------------------------------------------------------------------

describe('B0-BREAK 1 (CRITICAL, already in g1): one key replays a settled result, and elections and removals since are undone', () => {
  // A second copy of a settled result, re-signed on its open's own state, is valid by ancestry: the
  // run is open there, and the poster is a member there. It is concurrent with everything since.
  // Any member or elector can post it, and the endorsements it carries are already public. The rules
  // that read results (R2, R3) then treat the copy as if it were a new result.
  it('R3: two members remove the elected CO; the CO posts its own result again on [open] and is back', () => {
    const u = ledUnit(NINE);
    const { open, result } = u.elect({ office: 'co', opener: 'm1', candidate: 'm2', voters: FIVE, at: TE, poster: 'm3' });
    expect(u.offices().co).toBe('m2');
    // Two months on, two members remove the CO's key (units.md §6), and the XO acts as CO.
    const rm = u.remove(['m2'], ['m3', 'm4'], TE + 60 * DAY);
    expect(u.members()).not.toContain('m2');
    expect(u.offices()).toMatchObject({ co: 'xo', coActing: true });
    // The removed CO, alone, re-signs its own election's result on the open's state.
    replay(u, 'm2', result, [open.id], TE + 61 * DAY);
    expect(u.voidReason(rm.id)).toBeUndefined(); // actual: 'vote-protection'
    expect(u.members()).not.toContain('m2'); // actual: m2 is a member again
    expect(u.offices().co).not.toBe('m2'); // actual: 'm2', CO again
  });

  it('R2: any member replays last term\'s result, the election since is void, and its honest electors are named two-faced', () => {
    const u = ledUnit(NINE);
    const first = u.elect({ office: 'co', opener: 'm1', candidate: 'm2', voters: FIVE, at: TE });
    const te2 = u.view().offices!.co.term!.end;
    const second = u.elect({ office: 'co', opener: 'm1', candidate: 'm3', voters: FIVE, at: te2 });
    expect(u.offices().co).toBe('m3');
    // A month into m3's term, m6 re-signs the term-two result on its open's state.
    replay(u, 'm6', first.result, [first.open.id], te2 + 31 * DAY, 'above');
    expect(u.voidReason(second.result.id)).toBeUndefined(); // actual: 'crossed-results'
    expect(u.offices().co).toBe('m3'); // actual: 'm2' holds over
    expect(u.view().equivocators).toEqual([]); // actual: all five electors, in both runs
  });

  it('with the copy\'s id ground below the original\'s, the original falls too and the founders hold office again', () => {
    // The docblock: "a ground id never decides who is in". The copy is void (crossed) and closes the
    // run contested; placed before the original by id, it leaves the original 'run-not-open'.
    const u = ledUnit(NINE);
    const first = u.elect({ office: 'co', opener: 'm1', candidate: 'm2', voters: FIVE, at: TE });
    const te2 = u.view().offices!.co.term!.end;
    u.elect({ office: 'co', opener: 'm1', candidate: 'm3', voters: FIVE, at: te2 });
    replay(u, 'm6', first.result, [first.open.id], te2 + 31 * DAY, 'below');
    expect(u.voidReason(first.result.id)).toBeUndefined(); // actual: 'run-not-open'
    expect(u.offices().co).toBe('m3'); // actual: 'co', the founder, two terms on
  });
});

describe('B0-BREAK 2 (CRITICAL, introduced by B0): a second signature released after an election undoes the election', () => {
  // B0: an act waiting for its second signature gives its children a place to stand, and prevFor makes
  // its author name it, so everything the unit does afterwards descends from it, read without it.
  // Once ANY key that was a member at the act's own state co-signs it, however late, it takes effect
  // at that old position. Every electorate frozen since changes, and every result posted since fails
  // its digest. A waiting act cannot be withdrawn, and an honest phone that signs late does the same.
  // Before B0 its children waited with it, so nothing settled could rest on it.
  it('an in-person admission co-signed a month after the term-end election voids the result', () => {
    const u = ledUnit(NINE);
    // The CO admits n1 in person; m5's phone, which was to co-sign, never did.
    const pending = authored(u, 'co', null, { t: 'admit', key: u.key('n1'), callsign: 'N1', readmits: null }, T0 + 10 * DAY);
    expect(u.heldReason(pending.id)).toBe('incomplete');
    // The CO goes on, naming its own latest act as B0 requires: the unit builds on it from now on.
    authored(u, 'co', pending.id, { t: 'remove', keys: [u.key('m5')], reason: REASON }, T0 + 11 * DAY, 'xo');
    expect(u.members()).not.toContain('m5');
    // At the term's end the unit elects m2, settled on every phone.
    const { result } = u.elect({ office: 'co', opener: 'm1', candidate: 'm2', voters: FIVE, at: TE });
    expect(u.offices().co).toBe('m2');
    // A month later m5, removed since but a member at the admission's own state, signs it.
    u.loose.push(u.sign('m5', { t: 'sign', unit: u.unit, act: pending.id }, TE + 30 * DAY));
    expect(u.voidReason(result.id)).toBeUndefined(); // actual: 'digest-mismatch'
    expect(u.offices().co).toBe('m2'); // actual: 'co' holds over
  });

  it('a removal nobody would co-sign, completed after its target won office, takes the office back', () => {
    const u = ledUnit(NINE);
    // The CO moves to remove m7; m1 refuses to co-sign, and the CO lets it drop.
    const pending = authored(u, 'co', null, { t: 'remove', keys: [u.key('m7')], reason: REASON }, T0 + 10 * DAY);
    authored(u, 'co', pending.id, { t: 'admit', key: u.key('n1'), callsign: 'N1', readmits: null }, T0 + 11 * DAY, 'xo');
    expect(u.members()).toContain('m7');
    // The unit elects m7 CO at the term's end.
    const { result } = u.elect({ office: 'co', opener: 'm1', candidate: 'm7', voters: ['xo', 'm1', 'm2', 'm3', 'm4', 'm5'], at: TE });
    expect(u.offices().co).toBe('m7');
    // Months later one key that was a member back then completes the old removal.
    u.loose.push(u.sign('m6', { t: 'sign', unit: u.unit, act: pending.id }, TE + 90 * DAY));
    expect(u.voidReason(result.id)).toBeUndefined(); // actual: 'digest-mismatch'
    expect(u.offices().co).toBe('m7'); // actual: 'co', the founder, holds over
    expect(u.members()).toContain('m7'); // actual: m7 is removed, as of ten months ago
  });
});

describe('B0-BREAK 3 (CRITICAL, already in g1): whoever opened a vote can void it after it settles', () => {
  // R1 voids all of one key's concurrent opens for one office, and concurrent petitions against one
  // holder, which stops one member flooding the runs (attack-suite BREAK 6). Concurrency is the
  // signer's choice: a second open on a state from before the first is concurrent with it, so both
  // fall, with the result or recall built on the first and everything built on that.
  it('the opener opens again on an old state, and the election and the new CO\'s first admission are void', () => {
    const u = ledUnit(NINE);
    const before = u.tips();
    const { result } = u.elect({ office: 'co', opener: 'm1', candidate: 'm2', voters: FIVE, at: TE });
    const ad = u.admit('n1', ['m2', 'm3'], TE + 10 * DAY); // the new CO keeps the door
    expect(u.members()).toContain('n1');
    u.open('m1', 'co', TE + 40 * DAY, before);
    expect(u.voidReason(result.id)).toBeUndefined(); // actual: 'built-on-void'
    expect(u.offices().co).toBe('m2'); // actual: 'co' holds over
    expect(u.voidReason(ad.id)).toBeUndefined(); // actual: 'built-on-void'
  });

  it('the petitioner petitions again on an old state, and the recall is void', () => {
    const u = ledUnit(NINE);
    const before = u.tips();
    const p = u.petition('m1', 'co', 'co', T0 + 31 * DAY);
    u.support(['m2', 'm3', 'm4', 'm5'], p.id, T0 + 32 * DAY);
    const r = u.recall('m2', p.id, T0 + 33 * DAY);
    expect(u.offices().co).toBe('xo');
    u.petition('m1', 'co', 'co', T0 + 60 * DAY, before);
    expect(u.voidReason(r.id)).toBeUndefined(); // actual: 'built-on-void'
    expect(u.offices().co).toBe('xo'); // actual: 'co', the recalled CO, back
  });
});

// -------------------------------------------------------------------------------------------------
// HIGH
// -------------------------------------------------------------------------------------------------

describe('B0-BREAK 4 (HIGH, already in g1): one key undoes the door acts the CO made while an election ran', () => {
  // B0's commit: "one key can no longer undo a month of door acts". R4 voids an admission or removal
  // whose officer signer lost office by a concurrent result. The CO holds over until the result, and
  // keeps the door meanwhile. A copy of the settled result on [open] (as in BREAK 1) is concurrent
  // with every one of those acts, so R4 voids them all. One key posts it, at any time. The same
  // happens if the result itself is posted on [open], as attack-suite BREAK 4's corrected case does:
  // whether a week of door acts stands is the poster's choice of prev.
  it('an admission and a removal made in the election week fall a month after the result', () => {
    const u = ledUnit(NINE);
    const open = u.open('m1', 'co', TE);
    u.vote(open.id, 'm2', FIVE, TE + 60);
    const ad = u.admit('n1', ['co', 'm5'], TE + 2 * DAY);
    const rm = u.remove(['m7'], ['co', 'm6'], TE + 3 * DAY);
    const settled = u.result('m3', open.id, 'm2', TE + 4 * DAY); // on the head, after both
    expect(u.offices().co).toBe('m2');
    expect(u.members()).toContain('n1');
    expect(u.members()).not.toContain('m7');
    replay(u, 'm4', settled, [open.id], TE + 34 * DAY);
    expect(u.voidReason(ad.id)).toBeUndefined(); // actual: 'office-ended'
    expect(u.members()).toContain('n1'); // actual: n1 is gone
    expect(u.voidReason(rm.id)).toBeUndefined(); // actual: 'office-ended'
    expect(u.members()).not.toContain('m7'); // actual: m7 is back
  });
});

describe('B0-BREAK 5 (HIGH, introduced by B0): a seized CO key and the member it removed undo every removal the CO authored', () => {
  // F7's author rule puts every removal of a plain member on the CO's (or XO's) line, and R10 voids
  // an ending whose author authored a co-signed act concurrent with it. R10 cannot tell which of the
  // two is stale: a co-signed act signed today on an old state voids every honest ending since. The
  // second key can be the removed member, a member on that old state. F7's stated cost is "the
  // attacker plus one ally ... voids the earlier vacate". Here it is every removal at once, the ally
  // is the person removed, and the honest CO is the key named.
  it('a stale co-signed removal voids two honest removals and itself, and both removed members return', () => {
    const u = ledUnit(NINE);
    const before = u.tips();
    const rm6 = u.remove(['m6'], ['co', 'm1'], T0 + 10 * DAY);
    const rm7 = u.remove(['m7'], ['co', 'm2'], T0 + 11 * DAY);
    u.admit('n1', ['co', 'm3'], T0 + 12 * DAY);
    // A month on: the CO's seized key authors, m7 co-signs, naming the state before either removal.
    u.remove(['m5'], ['co', 'm7'], T0 + 40 * DAY, before);
    expect(u.voidReason(rm6.id)).toBeUndefined(); // actual: 'ending-crossed', the honest CO named
    expect(u.voidReason(rm7.id)).toBeUndefined(); // actual: 'ending-crossed'
    expect(u.members()).not.toContain('m6'); // actual: back
    expect(u.members()).not.toContain('m7'); // actual: back
  });

  it('it works after the CO is voted out, with an act R4 voids: R10 counts a co-signed act no later rule lets stand', () => {
    const u = ledUnit(NINE);
    const before = u.tips();
    const rm7 = u.remove(['m7'], ['co', 'm1'], T0 + 10 * DAY);
    u.elect({ office: 'co', opener: 'm1', candidate: 'm2', voters: FIVE, at: TE });
    expect(u.offices().co).toBe('m2');
    // The ex-CO's key and m7 admit a sock on the old state. R4 voids it: an old CO cannot act as CO
    // on a state from before. It never takes effect, and it still undoes the removal.
    const poison = u.admit('sock', ['co', 'm7'], TE + 30 * DAY, { prev: before });
    expect(u.voidReason(poison.id)).toBe('office-ended');
    expect(u.members()).not.toContain('sock');
    expect(u.voidReason(rm7.id)).toBeUndefined(); // actual: 'ending-crossed'
    expect(u.members()).not.toContain('m7'); // actual: back
  });

  it('the remedy F7 names, any two members removing that key, restores nothing', () => {
    const u = ledUnit(NINE);
    const before = u.tips();
    const rm7 = u.remove(['m7'], ['co', 'm1'], T0 + 10 * DAY);
    const poison = u.remove(['m5'], ['co', 'm7'], T0 + 40 * DAY, before);
    // Corrected with the repair: this line asserted the break itself as a step (m7 back after the
    // poison). The poison is now two keys like any removal and is left to R5, which voids it because
    // its second signer is the member removed beside it, so m7 never comes back and the remedy below
    // has nothing to restore. The test still runs the remedy and checks it changes nothing.
    expect(u.voidReason(poison.id)).toBe('removal-wins');
    expect(u.members()).not.toContain('m7');
    // Two members remove the seized CO key on the current head.
    u.remove(['co'], ['m1', 'm2'], T0 + 41 * DAY);
    expect(u.members()).not.toContain('co');
    expect(u.voidReason(rm7.id)).toBeUndefined(); // actual: 'ending-crossed'
    expect(u.members()).not.toContain('m7'); // actual: still back
  });
});

describe('B0-BREAK 6 (HIGH, introduced by B0): a sock "readmission" takes a removed holder\'s F5 vote and seat', () => {
  // F5: "When the holder is readmitted, the new key replaces the old one." Nothing ties the new key
  // to the holder (attack-suite BREAK 7 only stopped it happening twice at once). Before B0 a sock
  // readmission added one member. Now it also deletes the removed holder's vote and seat, so the
  // electoral gain F5 was written to remove comes back with one more step.
  it('decapitate, readmit a sock, then elect: two colluders take the CO post in a unit of four', () => {
    const u = ledUnit(['m1', 'm2'], { room: 4 });
    u.remove(['xo'], ['m1', 'm2'], T0 + 10 * DAY);
    u.open('m1', 'xo', T0 + 10 * DAY + 60);
    const sock = u.admit('sock', ['m1', 'm2'], T0 + 10 * DAY + 120, { readmits: 'xo' });
    expect(u.voidReason(sock.id)).toBeUndefined(); // any two may let a removed leader back in
    u.remove(['co'], ['m1', 'm2'], T0 + 10 * DAY + 180);
    const open = u.open('m1', 'co', T0 + 11 * DAY);
    u.vote(open.id, 'm1', ['m1', 'm2', 'sock'], T0 + 11 * DAY + 60);
    const run = u.view().runs.find((r) => r.id === open.id)!;
    expect(run.electorate).toContain(u.key('xo')); // actual: absent, the sock counted in its place
    try { u.result('m2', open.id, 'm1', T0 + 11 * DAY + 600); } catch { /* refused */ }
    expect(u.offices().co).not.toBe('m1'); // actual: 'm1', three of four
  });

  it('the CO and one ally remove the XO and strip its fill vote, no open election needed', () => {
    // office-builder.md §8 row 3: "F5 (the door-keeper still votes in the fill)".
    const u = ledUnit(NINE);
    u.remove(['xo'], ['co', 'm1'], T0 + 10 * DAY);
    u.admit('sock', ['co', 'm1'], T0 + 10 * DAY + 60, { readmits: 'xo' });
    const open = u.open('m1', 'xo', T0 + 11 * DAY);
    const run = u.view().runs.find((r) => r.id === open.id)!;
    expect(run.electorate).toContain(u.key('xo')); // actual: absent
    expect(run.electorate).not.toContain(u.key('sock')); // actual: the sock votes in the XO's place
  });
});

// -------------------------------------------------------------------------------------------------
// MEDIUM
// -------------------------------------------------------------------------------------------------

describe('B0-BREAK 7 (MEDIUM, already in g1): the member removed and one ally split the unit from an old state', () => {
  // R0: two concurrent removals each removing a signer of the other split the unit, and neither stands
  // until a phone chooses which to follow. A counter-removal signed today on a state from before the
  // removal is concurrent with it. Any two members may remove the CO's key, the member removed is a
  // member there, and F7 does not narrow it, because the counter-remover has authored nothing.
  // Every phone reads 'split' and loses everything since until a person chooses a side.
  it('a stale removal of the CO by m7 and m6 splits the unit over m7\'s settled removal', () => {
    const u = ledUnit(NINE);
    const before = u.tips();
    const rm = u.remove(['m7'], ['co', 'm1'], T0 + 10 * DAY);
    const ad = u.admit('n1', ['co', 'm2'], T0 + 11 * DAY);
    u.remove(['co'], ['m7', 'm6'], T0 + 40 * DAY, before);
    expect(u.view().status).toBe('ok'); // actual: 'split'
    expect(u.voidReason(rm.id)).toBeUndefined(); // actual: 'split'
    expect(u.voidReason(ad.id)).toBeUndefined(); // actual: 'built-on-void'
    expect(u.members()).not.toContain('m7'); // actual: back
  });
});
