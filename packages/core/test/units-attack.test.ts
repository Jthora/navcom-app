import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools/core';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { addMonthsUTC, readCharter, threeQuartersOf } from '../src/units/charter.js';
import { compactOf, isCallsign, signStatement, type Office } from '../src/units/statements.js';
import {
  buildCheckpoint, electorateDigest, evaluate, resultDigest, snapshotOf
} from '../src/units/governance.js';
import { DAY, LATER, T0, TestUnit, ledUnit, makeUnit, names } from './helpers/units.js';

/**
 * Adversarial review of units/ (branch units-core, bbcd6c48). Every test here is a break: it
 * states what docs/design/units.md, groups.md or the owner's decisions of 2026-10-09 require, and
 * it FAILS against the evaluator as committed. Nothing in src/ was changed.
 *
 * Personas: a hostile member, an infiltrator, a captured CO, a closer choosing what to carry, a
 * phone on an older release, a forged or replayed statement, two halves split for a week, a clock
 * set wrong, and a re-former pulling members from a healthy unit.
 *
 * Severity in each describe: CRITICAL (one member, permanent, defeats a fixed rule everywhere),
 * HIGH (a small coalition defeats a fixed rule), MEDIUM (a rule bends, or a phone misleads),
 * LOW (a label or an edge).
 */

const TE = addMonthsUTC(T0, 12); // the founders' term end
const NINE = names(7); // with co and xo, a unit of nine

/** A secret key whose public key sorts below `below`: a few hundred tries at most. */
function keyBelow(below: string): Uint8Array {
  for (let i = 0; i < 1_000_000; i++) {
    const sk = generateSecretKey();
    if (getPublicKey(sk) < below) return sk;
  }
  throw new Error('no key found');
}

/** A result built by hand, carrying exactly the endorsements given. */
function rawResult(
  u: TestUnit,
  o: { poster: string; run: string; candidate: string; sigs: readonly Event[]; k: number; at: number; prev?: string[] }
): Event {
  const v = u.view(o.at);
  const rv = v.runs.find((r) => r.id === o.run)!;
  const sigs = o.sigs.map(compactOf);
  const cand = u.key(o.candidate);
  const stand = u.loose.find((e) => e.pubkey === cand && e.content.includes(`"stand","${u.unit}","${o.run}"`))!;
  const digest = resultDigest('g1', o.run, rv.office as Office, cand, rv.electorate.length, o.k,
    electorateDigest(rv.electorate), sigs.map((c) => c[0]));
  const e = u.sign(o.poster, {
    t: 'result', unit: u.unit, prev: [...(o.prev ?? v.head)].sort(), run: o.run, candidate: cand, rule: 'g1', digest,
    stand: [stand.created_at, stand.sig], sigs
  }, o.at);
  u.chain.push({ act: e });
  return e;
}

// -------------------------------------------------------------------------------------------------
// CRITICAL
// -------------------------------------------------------------------------------------------------

describe('BREAK 1 (CRITICAL): a stale-prev vote undoes any removal, and every act built after it', () => {
  // R1 voids a removal concurrent with ANY open or petition whose frozen electorate holds the removed
  // key. Concurrency is the attacker's choice: a petition signed today on a prev from before the
  // removal is concurrent with it. R1 runs before R2, so the removed key's own petition survives,
  // and the cascade voids everything that descends only from the removal.
  it('a removed member reinstates themselves with one petition on a pre-removal prev', () => {
    const u = ledUnit(NINE);
    const before = u.tips();
    const rm = u.remove(['m7'], ['co', 'xo'], T0 + 40 * DAY);
    const after = u.admit('n1', ['co', 'm1'], T0 + 41 * DAY); // the unit goes on without m7
    // Weeks later, m7 (already removed) signs a petition against the CO on the old prev.
    u.petition('m7', 'co', 'co', T0 + 60 * DAY, before);
    expect(u.voidReason(rm.id)).toBeUndefined(); // actual: 'vote-protection'
    expect(u.members()).not.toContain('m7'); // actual: m7 is a member again
    expect(u.voidReason(after.id)).toBeUndefined(); // actual: 'built-on-void'
    expect(u.members()).toContain('n1'); // actual: n1's admission is gone
  });

  it('an ally can do it for them, and can repeat it after every re-removal', () => {
    const u = ledUnit(NINE);
    const before = u.tips();
    u.remove(['m7'], ['co', 'xo'], T0 + 40 * DAY);
    u.petition('m6', 'co', 'co', T0 + 45 * DAY, before); // the ally's stale-prev petition
    const again = u.remove(['m7'], ['co', 'xo'], T0 + 46 * DAY); // honest re-removal on the new head
    u.petition('m6', 'xo', 'xo', T0 + 47 * DAY, before); // another stale-prev vote, against the XO
    expect(u.voidReason(again.id)).toBeUndefined(); // actual: 'vote-protection'
    expect(u.members()).not.toContain('m7');
  });
});

describe('BREAK 2 (CRITICAL): any key can replace an act\'s second signer, so a member vetoes their own removal', () => {
  // Of several `sign` statements for one act, the evaluator keeps the smallest pubkey with a valid
  // signature, without asking whether that key is a member. A throwaway key ground to sort low makes
  // every co-signed act (admit, invite, remove) fail 'not-a-member'.
  it('a throwaway co-signature with a small key voids the removal it names', () => {
    const u = ledUnit(NINE);
    const rm = u.remove(['m7'], ['co', 'xo'], T0 + 2 * DAY);
    expect(u.members()).not.toContain('m7'); // the honest removal stands...
    const throwaway = keyBelow(u.key('xo'));
    u.loose.push(signStatement(throwaway, { t: 'sign', unit: u.unit, act: rm.id }, T0 + 2 * DAY + 60));
    expect(u.voidReason(rm.id)).toBeUndefined(); // actual: 'not-a-member'
    expect(u.members()).not.toContain('m7'); // actual: m7 is back
  });

  it('the honest act re-sent with a throwaway co-signature dated next year is held for a year', () => {
    const u = ledUnit(NINE);
    const ad = u.admit('n1', ['co', 'xo'], T0 + 2 * DAY);
    const throwaway = keyBelow(u.key('xo'));
    // A loose future-dated sign is set aside, but one carried beside a copy of the act is not.
    u.chain.push({ act: ad, sign: signStatement(throwaway, { t: 'sign', unit: u.unit, act: ad.id }, T0 + 400 * DAY) });
    const now = T0 + 3 * DAY;
    expect(u.heldReason(ad.id, now)).toBeUndefined(); // actual: 'future-dated'
    expect(u.members(now)).toContain('n1');
  });
});

// -------------------------------------------------------------------------------------------------
// HIGH
// -------------------------------------------------------------------------------------------------

describe('BREAK 3 (HIGH): one signer removes everyone else, with no second signature', () => {
  // `lastOne` (members − removed === 1) waives the second signer at any size, not only in a unit of
  // two. units.md: "never alone"; groups.md: Any two needs "two members other than the one removed,
  // or the one other member in a crew of two".
  it('a captured CO alone empties a unit of nine', () => {
    const u = ledUnit(NINE);
    const purge = u.remove(['xo', ...NINE], ['co'], T0 + 2 * DAY);
    expect(u.voidReason(purge.id) ?? u.heldReason(purge.id)).toBeDefined(); // actual: stands
    expect(u.members()).toHaveLength(9); // actual: ['co']
  });

  it('in an Any two unit of four, one member alone removes the other three', () => {
    const u = makeUnit({ governance: { shape: 'anyTwo' }, room: 8 });
    u.fill(['c', 'd'], ['a', 'b'], T0 + DAY);
    const purge = u.remove(['a', 'b', 'd'], ['c'], T0 + 2 * DAY);
    expect(u.voidReason(purge.id) ?? u.heldReason(purge.id)).toBeDefined(); // actual: stands
    expect(u.members()).toEqual(['a', 'b', 'c', 'd']); // actual: ['c']
  });
});

describe('BREAK 4 (HIGH): a captured CO and one ally kill a recall that already holds its threshold', () => {
  // A removal that descends from the petition is allowed (R1 only looks at concurrency), and only a
  // member may post the recall. units.md: "It passes the moment it holds the threshold" and "Any phone
  // holding it posts". So the subject purges every signer and the threshold never takes effect.
  it('the CO and m7 remove everyone else after the fifth signature; the recall can never be posted', () => {
    const u = ledUnit(NINE);
    const p = u.petition('m1', 'co', 'co', T0 + 31 * DAY);
    u.support(['m2', 'm3', 'm4', 'm5'], p.id, T0 + 32 * DAY);
    expect(u.view().petitions[0]!.postable).toBe(true); // the petition has passed on every honest phone
    u.remove(['xo', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6'], ['co', 'm7'], T0 + 32 * DAY + 3600);
    const r = u.recall('m1', p.id, T0 + 33 * DAY); // m1 holds every signature and posts
    expect(u.voidReason(r.id)).toBeUndefined(); // actual: 'not-a-member'
    expect(u.offices().co).not.toBe('co'); // actual: the CO keeps the office
  });

  it('or the subject removes the leading candidate once the election is open', () => {
    const u = ledUnit(NINE);
    const open = u.open('m1', 'co', TE);
    u.vote(open.id, 'm2', ['xo', 'm1', 'm2', 'm3', 'm4'], TE + 60);
    u.remove(['m2'], ['co', 'm7'], TE + 120); // after the open: R1 does not look
    try { u.result('m3', open.id, 'm2', TE + 600); } catch { /* the view already refuses it */ }
    // units.md: "A removal that crosses an open vote is void if ... it removes one of that vote's electors."
    expect(u.offices().co).toBe('m2'); // actual: 'co' holds over
  });
});

describe('BREAK 5 (HIGH): the old CO and one ally undo a settled election weeks later, checkpoint and all', () => {
  // The coup names the election's open as its prev, so it is concurrent with the result. R1 ignores
  // it (the open is an ancestor), removals apply before results, and everything built on the result
  // falls as built-on-void or removal-wins. A co-signed checkpoint changes nothing in history mode.
  it('removing the winner on prev [open] reverses the result and the new CO\'s first admission', () => {
    const u = ledUnit(NINE);
    const { open, result } = u.elect({ office: 'co', opener: 'm1', candidate: 'm2', voters: ['xo', 'm1', 'm2', 'm3', 'm4'], at: TE, poster: 'm3' });
    expect(u.offices().co).toBe('m2');
    const first = u.admit('n1', ['m2', 'm4'], TE + 10 * DAY);
    const v = u.view();
    const cp = buildCheckpoint({ unit: u.unit, view: v, head: v.head, at: TE + 11 * DAY }, u.sk('m4'));
    u.loose.push(cp, u.sign('m5', { t: 'sign', unit: u.unit, act: cp.id }, TE + 11 * DAY));
    expect(u.view().checkpointDue).toBe(false); // the change of command is checkpointed
    // Two weeks on, the old CO (still CO at the open) and m7 remove the winner on [open].
    u.remove(['m2'], ['co', 'm7'], TE + 25 * DAY, [open.id]);
    expect(u.voidReason(result.id)).toBeUndefined(); // actual: 'not-a-member'
    expect(u.offices().co).toBe('m2'); // actual: 'co'
    expect(u.voidReason(first.id)).toBeUndefined(); // actual: 'removal-wins'
    // And it is silent: the co-signed checkpoint now names a void head, so it is skipped rather than
    // reported. units.md: "A member holding the older chain sees any mismatch."
    expect(u.view().disagreements.length).toBeGreaterThan(0); // actual: 0, checkpointDue false
  });
});

describe('BREAK 6 (HIGH): one member refuses the unit on every phone, for good, with 513 opens', () => {
  // Concurrent opens for one office all stand ("until a result supersedes both"). The snapshot
  // grammar caps runs at 512, so snapshotOfState throws, evaluate() catches it, and every phone reads
  // refused / 'internal' (shown as needs an update). The acts are permanent; no result can be built
  // because the view has no runs.
  it('513 concurrent opens after the term ends', () => {
    const u = ledUnit(NINE);
    const h = u.tips();
    for (let i = 0; i < 513; i++) u.open('m1', 'co', TE + i, h);
    const v = u.view();
    expect(v.reason).toBeUndefined(); // actual: 'internal'
    expect(v.status).toBe('ok'); // actual: 'refused'
    expect(v.offices?.co.holder).toBe(u.key('co'));
  }, 120_000);
});

// -------------------------------------------------------------------------------------------------
// MEDIUM-HIGH
// -------------------------------------------------------------------------------------------------

describe('BREAK 7 (MEDIUM-HIGH): two plain members admit any number of keys by naming one removed leader', () => {
  // units.md: the removed leader "may be re-admitted in person by any two members while that election
  // is open". Nothing ties the new key to the leader, and concurrent readmissions all pass, because
  // `holding` is only cleared when an admission applies. An infiltrator pair can remove the CO's key
  // (two members suffice), open the election, and seat sock puppets without the door.
  it('three concurrent readmissions of the one removed CO all stand', () => {
    const u = ledUnit(NINE);
    u.remove(['co'], ['m1', 'm2'], T0 + 2 * DAY);
    u.open('m3', 'co', T0 + 3 * DAY);
    const h = u.tips();
    for (const s of ['s1', 's2', 's3']) u.admit(s, ['m4', 'm5'], T0 + 4 * DAY, { prev: h, readmits: 'co' });
    const socks = ['s1', 's2', 's3'].filter((s) => u.members().includes(s));
    expect(socks.length).toBeLessThanOrEqual(1); // actual: 3
  });
});

describe('BREAK 8 (MEDIUM-HIGH): re-formers elect themselves to a full term before any invited member can vote', () => {
  // Decision 2: "re-formers act only until members elect". The first election opens at once with the
  // electorate frozen at the two re-formers, so they convert acting posts into a 12-month elected term
  // (cap count 1, no petition for 30 days) while the invitations are still unanswered.
  it('two re-formers, one invitation outstanding, a full term each', () => {
    const u = makeUnit({ reform: true });
    const invite = u.act('co', { t: 'invite', former: u.key('oldC') }, T0 + 60, { name: 'xo' });
    const open = u.open('xo', 'co', T0 + 120);
    u.vote(open.id, 'co', ['co', 'xo'], T0 + 180);
    u.result('xo', open.id, 'co', T0 + 600);
    u.act('newC', {
      t: 'accept', invite: invite.id, callsign: 'CRANE',
      former: compactOf(u.sign('oldC', { t: 'accept-by', unit: u.unit, invite: invite.id, key: u.key('newC') }, T0 + 700))
    }, T0 + 800);
    expect(u.members()).toContain('newC');
    const co = u.view().offices!.co;
    expect(co.acting).toBe(true); // actual: false
    expect(co.term!.n).toBe(0); // actual: 1, a full 12 months
  });
});

// -------------------------------------------------------------------------------------------------
// MEDIUM
// -------------------------------------------------------------------------------------------------

describe('BREAK 9 (MEDIUM): after a week split, the room rule erases both halves\' week, removals included', () => {
  // R4 voids every concurrent admission when together they pass the room. The cascade then voids
  // every act built only on those admissions, so an unrelated removal made in one half is undone.
  it('a removal made in one half, built on that half\'s admissions, is gone after the merge', () => {
    const u = ledUnit(names(8)); // ten members, room 12
    const h = u.tips();
    // Half one: the CO's side.
    const a1 = u.admit('a1', ['co', 'm1'], T0 + 10 * DAY, { prev: h });
    const a2 = u.admit('a2', ['co', 'm2'], T0 + 11 * DAY, { prev: [a1.id] });
    const rm = u.remove(['m8'], ['co', 'm1'], T0 + 12 * DAY, [a2.id]);
    // Half two: the XO's side, the same week.
    const b1 = u.admit('b1', ['xo', 'm5'], T0 + 10 * DAY, { prev: h });
    u.admit('b2', ['xo', 'm6'], T0 + 11 * DAY, { prev: [b1.id] });
    // Some admissions must give way (14 > 12). The removal of m8 has nothing to do with the room.
    expect(u.voidReason(rm.id)).toBeUndefined(); // actual: 'built-on-void'
    expect(u.members()).not.toContain('m8'); // actual: m8 is back
  });
});

describe('BREAK 10 (MEDIUM): re-forming admits keys that were never admitted in person', () => {
  // units.md §9: "Only keys on the old unit's roster can be invited". A re-former's own former key is
  // not checked against the founders' formers, and an invite to a key outside the old roster still
  // admits on a phone that holds the old roster (flagged 'mismatch', never voided).
  it('a re-former invites their own former key and takes a second seat', () => {
    const u = makeUnit({ reform: true });
    const invite = u.act('co', { t: 'invite', former: u.key('oldA') }, T0 + 60, { name: 'xo' });
    u.act('coTwo', {
      t: 'accept', invite: invite.id, callsign: 'SECOND',
      former: compactOf(u.sign('oldA', { t: 'accept-by', unit: u.unit, invite: invite.id, key: u.key('coTwo') }, T0 + 90))
    }, T0 + 120);
    expect(u.members()).not.toContain('coTwo'); // actual: the co holds two of three seats
  });

  it('a sock-puppet key not on the old roster is admitted on a phone holding that roster', () => {
    const u = makeUnit({ reform: true });
    const roster = new Set([u.key('oldA'), u.key('oldB'), u.key('oldC')]);
    const invite = u.act('co', { t: 'invite', former: u.key('sock') }, T0 + 60, { name: 'xo' });
    u.act('newSock', {
      t: 'accept', invite: invite.id, callsign: 'SOCK',
      former: compactOf(u.sign('sock', { t: 'accept-by', unit: u.unit, invite: invite.id, key: u.key('newSock') }, T0 + 90))
    }, T0 + 120);
    const v = u.view(LATER, { formerRoster: roster });
    expect(v.members.map((r) => u.nameOf(r.key))).not.toContain('newSock'); // actual: admitted
  });
});

describe('BREAK 11 (MEDIUM): the CO cap is evaded by swapping posts through two fill elections', () => {
  // A fill resets the cap count to 0, and the cap follows only the cap holder. A CO two terms in steps
  // down a week early, the XO fills the CO post, the old CO fills the XO post, and at the term's end
  // the old CO needs only a majority for a third consecutive term.
  it('a third term by a majority after one week out', () => {
    const capped = { shape: 'led', threshold: 'majority', term: 12, coCap: 'twoThenOut' } as const;
    const u = ledUnit(NINE, { governance: capped });
    const all = ['co', 'xo', ...NINE];
    u.elect({ office: 'co', opener: 'm1', candidate: 'co', voters: all.slice(0, 5), at: TE });
    expect(u.view().offices!.co.capped).toBe(true);
    const t3 = u.view().offices!.co.term!.end;
    u.vacate('co', 'co', t3 - 7 * DAY);
    u.elect({ office: 'co', opener: 'm1', candidate: 'xo', voters: all.slice(2, 7), at: t3 - 6 * DAY });
    u.elect({ office: 'xo', opener: 'm1', candidate: 'co', voters: all.slice(2, 7), at: t3 - 5 * DAY });
    const open = u.open('m1', 'co', t3);
    u.vote(open.id, 'co', all.slice(2, 7), t3 + 60);
    expect(u.view().runs.find((r) => r.id === open.id)!.kCapped).toBe(threeQuartersOf(9)); // actual: null
    try { u.result('m2', open.id, 'co', t3 + 600); } catch { /* refused: needs three-quarters */ }
    expect(u.offices().co).not.toBe('co'); // actual: 'co', for a third consecutive term
  });
});

describe('BREAK 12 (MEDIUM): two plain members flip a phone that holds the whole history onto a forged checkpoint', () => {
  // The docblock: "Where this phone holds the history up to the checkpoint, history wins." A head the
  // phone does not hold (here a made-up id) sends it to anchor mode, which drops the history it does
  // hold and reads offices from the forged snapshot. Any two members can sign one.
  it('a checkpoint naming an unknown head makes m1 CO and m2 XO', () => {
    const u = ledUnit(NINE);
    const v = u.view();
    const real = snapshotOf(v);
    const forged = {
      ...real,
      co: { ...real.co!, holder: u.key('m1') },
      xo: { ...real.xo!, holder: u.key('m2') },
      cap: { holder: u.key('m1'), count: 1 }
    };
    const cp = u.sign('m1', { t: 'checkpoint', unit: u.unit, head: ['ab'.repeat(32)], snapshot: forged }, T0 + 2 * DAY);
    const sign = u.sign('m2', { t: 'sign', unit: u.unit, act: cp.id }, T0 + 2 * DAY);
    const w = evaluate({ ...u.input(LATER), checkpoint: { event: cp, sign, roster: v.members } });
    expect(w.anchored).toBe(false); // actual: true
    expect(w.offices!.co.holder).toBe(u.key('co')); // actual: m1
  });
});

describe('BREAK 13 (MEDIUM): a phone on an older release silently freezes on an act it does not know', () => {
  // An unknown act is dropped "so one member cannot freeze everyone's". But when the unit builds on it
  // (a newer release's act, co-signed by both officers), every later act reads 'waiting-for-earlier'
  // and the status stays 'ok': the old phone shows a stale roster as current, never 'needs an update'.
  it('a co-signed admission built on a newer act type', () => {
    const u = ledUnit(NINE);
    const template = signStatement(u.sk('co'), { t: 'leave', unit: u.unit, prev: u.tips() }, T0 + DAY);
    const content = JSON.parse(template.content);
    content[1] = 'rename'; // groups.md's rename state, which a later release adds
    const newer = finalizeEvent({ kind: template.kind, created_at: template.created_at, tags: [], content: JSON.stringify(content) }, u.sk('co'));
    u.chain.push({ act: newer });
    u.admit('n1', ['co', 'xo'], T0 + 2 * DAY, { prev: [newer.id] });
    expect(u.view().status).toBe('needs-update'); // actual: 'ok', with n1 held as waiting-for-earlier
  });
});

// -------------------------------------------------------------------------------------------------
// LOW
// -------------------------------------------------------------------------------------------------

describe('BREAK 14 (LOW): the closer decides where an equivocator\'s vote counts, and nothing flags it', () => {
  // m3 endorses m6 and then m2 in one run. This phone names m3 and counts m2 at 4 of 5, not postable.
  // A closer carries m3's second endorsement and the result stands with no void and no disagreement.
  it('a result that needs the equivocator\'s signature stands on a phone holding both endorsements', () => {
    const u = ledUnit(NINE);
    const open = u.open('m1', 'co', TE);
    u.stand('m2', open.id, TE + 10);
    u.stand('m6', open.id, TE + 10);
    u.endorse(['m3'], open.id, 'm6', TE + 20);
    const forM2 = u.endorse(['co', 'xo', 'm1', 'm2', 'm3'], open.id, 'm2', TE + 30);
    const v = u.view();
    expect(v.equivocators.map((e) => u.nameOf(e.key))).toEqual(['m3']);
    expect(v.runs[0]!.postable).toBeNull();
    const r = rawResult(u, { poster: 'm1', run: open.id, candidate: 'm2', sigs: forM2, k: 5, at: TE + 600 });
    const w = u.view();
    const flagged = w.void.some((x) => x.id === r.id) || w.disagreements.some((d) => d.id === r.id);
    expect(flagged).toBe(true); // actual: false, and m2 is CO
  });
});

describe('BREAK 15 (LOW): the charter parser calls a newer release\'s code broken, not "needs an update"', () => {
  // "Format and rule first: a later release may give its code any shape at all." The 160-character cap
  // is checked before the rule, and a sixth echelon marker reads off-menu before its letter is looked up.
  it('a g2 code longer than 160 characters', () => {
    const longer = `nu1.g2.${'k'.repeat(170)}`;
    expect(readCharter(longer)).toMatchObject({ ok: false, reason: 'needs-update', field: 'rule' }); // actual: malformed
  });

  it('a sixth echelon marker a later release adds', () => {
    const six = `nu1.g1.m.l.12.m.12.n.w.y.pcbxdk${'i'}.-`;
    expect(readCharter(six)).toMatchObject({ ok: false, reason: 'needs-update', field: 'higher' }); // actual: off-menu
  });
});

describe('BREAK 16 (LOW): a callsign can carry invisible characters, so two members both read "RAVEN"', () => {
  // groups.md shows "two members are called Raven: prints differ" by string equality. Zero-width and
  // directional marks pass isCallsign, so an infiltrator copies a leader's callsign undetected.
  it('zero-width space, right-to-left mark and word joiner', () => {
    expect(isCallsign('RAVEN​')).toBe(false);
    expect(isCallsign('RAVEN‏')).toBe(false);
    expect(isCallsign('RA⁠VEN')).toBe(false);
  });
});

describe('BREAK 17 (LOW): a clock that returns garbage turns the hold-back off', () => {
  // `now` is never checked. NaN (a failed clock read) makes every `t > now + tolerance` false, so a
  // statement dated a year ahead applies at once.
  it('now = NaN applies an election opened a year early', () => {
    const u = ledUnit(NINE);
    u.open('m1', 'co', TE + 365 * DAY);
    const v = evaluate(u.input(Number.NaN));
    expect(v.runs).toEqual([]); // actual: the run is open
  });
});
