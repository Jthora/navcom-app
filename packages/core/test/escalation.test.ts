/**
 * The seven failure modes from `spec/escalation.spec.md`.
 *
 * The spec calls them "the point of the spec," and they are numbered here to match it so a
 * later reader can check the list is still complete rather than taking anyone's word.
 *
 * Only failure mode 4 is not here: "node down at time of distress → device-local EXHAUSTED
 * message fires" is the one failure the node structurally cannot report about itself, so it
 * is tested on the terminal instead. Named here so its absence reads as a decision.
 */

import { describe, expect, it } from 'vitest';
import {
  acknowledge,
  advanceLadder,
  DEFAULT_WINDOWS,
  ladderReport,
  LadderRegistry,
  startLadder,
  type OnCall
} from '../src/index.js';

const T0 = 1_755_300_000;
const human = (callsign: string) => ({ kind: 'human' as const, callsign });

function oncall(callsign: string, channel: OnCall['channel'] = 'sms', expires = T0 + 3600): OnCall {
  return { author: human(callsign), channel, expires };
}

const start = (over: Partial<Parameters<typeof startLadder>[0]> = {}) =>
  startLadder({
    distressId: 'd1',
    operator: 'a'.repeat(64),
    oncall: [oncall('Wren')],
    hasEmergencyContact: true,
    now: T0,
    ...over
  });

describe('1 — no on-call registered', () => {
  it('goes straight to CONTACT rather than paging nobody for five minutes', () => {
    // Waiting out a window with nobody on the other end is five minutes the operator does
    // not have, and it looks identical to a ladder that is working.
    const ladder = start({ oncall: [] });
    expect(ladder.state).toBe('contact');
    expect(ladder.paged).toEqual([]);
    expect(ladderReport(ladder)).toMatch(/Nobody is on-call/i);
  });

  it('reaches EXHAUSTED and says so plainly', () => {
    const ladder = advanceLadder(start({ oncall: [] }), T0 + 301);
    expect(ladder.state).toBe('exhausted');
    expect(ladderReport(ladder)).toMatch(/Nobody is coming/i);
  });

  it('treats an expired declaration as nobody', () => {
    // A stale declaration is not a reachable person, and the ladder must not page one.
    const ladder = start({ oncall: [oncall('Wren', 'sms', T0 - 1)] });
    expect(ladder.state).toBe('contact');
  });

  it('treats console-open standing alone as nobody [C40]', () => {
    // Someone going to sleep with only a console registered is not on-call, and the roster
    // is empty for paging purposes. Same rule that governs what 10910 publishes.
    const ladder = start({ oncall: [oncall('Oracle', 'console-open')] });
    expect(ladder.state).toBe('contact');
    expect(ladder.paged).toEqual([]);
  });
});

describe('2 — on-call registered, nobody acknowledges', () => {
  it('pages everyone at once, then falls to CONTACT when the window closes', () => {
    // Parallel, not serial: in an emergency you want everyone, and walking a roster wastes
    // the only resource that matters.
    const ladder = start({ oncall: [oncall('Wren'), oncall('Raven'), oncall('Owl')] });
    expect(ladder.state).toBe('paging');
    expect(ladder.paged).toEqual(['Wren', 'Raven', 'Owl']);

    expect(advanceLadder(ladder, T0 + 299).state).toBe('paging');
    const next = advanceLadder(ladder, T0 + 300);
    expect(next.state).toBe('contact');
    expect(ladderReport(next)).toMatch(/No answer from on-call/i);
  });

  it('names who was paged rather than counting them', () => {
    // "2 on-call" tells an operator less than "Wren and Raven", and a number is the thing
    // that invites gaming.
    const ladder = start({ oncall: [oncall('Wren'), oncall('Raven')] });
    expect(ladderReport(ladder)).toBe('Paging Wren, Raven.');
    expect(ladderReport(ladder)).not.toMatch(/\b2\b/);
  });
});

describe('3 — acknowledged, then nothing happens', () => {
  it('stops the ladder, and this is a known limitation rather than a bug', () => {
    // Documented in the spec and restated here so nobody "fixes" it by re-arming the
    // ladder on a timer. Re-arming would mean a missed window escalating on its own, which
    // invariant 3 forbids outright. A human who accepted and then did nothing is a human
    // problem, and the log records who accepted.
    const acked = acknowledge(start(), human('Raven'), T0 + 10);
    expect(acked.state).toBe('acknowledged');
    expect(acked.acknowledgedBy?.callsign).toBe('Raven');

    for (const t of [T0 + 600, T0 + 6000, T0 + 86_400]) {
      expect(advanceLadder(acked, t).state, `still stopped at +${t - T0}s`).toBe('acknowledged');
    }
  });

  it('accepts a late acknowledgement after EXHAUSTED — somebody arriving late is somebody', () => {
    const exhausted = advanceLadder(advanceLadder(start(), T0 + 301), T0 + 700);
    expect(exhausted.state).toBe('exhausted');
    const late = acknowledge(exhausted, human('Raven'), T0 + 900);
    expect(late.state).toBe('acknowledged');
  });
});

describe('5 — operator has no emergency contact', () => {
  it('reaches EXHAUSTED faster, and still reports', () => {
    const ladder = start({ hasEmergencyContact: false });
    expect(ladder.state).toBe('paging');
    const next = advanceLadder(ladder, T0 + 300);
    expect(next.state).toBe('exhausted');
    expect(ladderReport(next)).toMatch(/no emergency contact/i);
  });

  it('is EXHAUSTED immediately when there is nobody at all', () => {
    // Nothing to try. Saying so at once beats ten minutes of windows closing on empty.
    const ladder = start({ oncall: [], hasEmergencyContact: false });
    expect(ladder.state).toBe('exhausted');
    expect(ladderReport(ladder)).toMatch(/Nobody is coming/i);
  });
});

describe('6 — the agent is degraded, hung, or hostile', () => {
  it('cannot affect the ladder, because there is no seam for it to act through', () => {
    // Structural rather than tested-by-scenario: the module takes no callback, no policy
    // object and no health value, so there is nothing an agent could be injected into.
    // This asserts the shape that makes that true.
    expect(startLadder).toHaveLength(1);
    expect(Object.keys(start())).toEqual([
      'distressId',
      'operator',
      'startedAt',
      'state',
      'stateSince',
      'paged',
      'hasEmergencyContact',
      'acknowledgedBy'
    ]);
  });

  it('refuses an acknowledgement from an agent [invariant 5]', () => {
    // An agent is never the sole responder to Distress. An agent ack that stopped the
    // ladder would make it exactly that, while looking on screen like help arriving.
    const ladder = start();
    const attempted = acknowledge(ladder, { kind: 'agent', callsign: 'Mecha Jono' }, T0 + 5);
    expect(attempted.state).toBe('paging');
    expect(attempted.acknowledgedBy).toBeNull();
  });

  it('refuses an acknowledgement from the node itself', () => {
    const attempted = acknowledge(start(), { kind: 'node' }, T0 + 5);
    expect(attempted.state).toBe('paging');
  });
});

describe('7 — duplicate distress', () => {
  it('produces one ladder, not two', () => {
    // The client is REQUIRED to retry an unacknowledged Distress indefinitely, so duplicates
    // are the normal case rather than an edge one. Two ladders would page everyone twice and
    // race each other to report contradictory states to the same operator.
    const registry = new LadderRegistry();
    const input = {
      distressId: 'd1',
      operator: 'a'.repeat(64),
      oncall: [oncall('Wren')],
      hasEmergencyContact: true,
      now: T0
    };

    const first = registry.open(input);
    const second = registry.open({ ...input, now: T0 + 60 });

    expect(first.started).toBe(true);
    expect(second.started).toBe(false);
    expect(registry.all()).toHaveLength(1);
    // The second arrival did not restart the clock, which would have made a retrying phone
    // hold the ladder in PAGING forever.
    expect(second.ladder.stateSince).toBe(T0);
  });

  it('joins a retry from the same operator to the ladder already running', () => {
    /*
     * This used to assert the opposite -- two events, two ladders -- on the reading that a
     * retrying client republishes the same event. **It does not**: `sendDistress` signs a
     * fresh one, with a fresh `created_at` and therefore a fresh id, every attempt. So every
     * retry looked like a new emergency and took a page and a budget unit with it: about
     * forty-eight attempts an hour against a global budget of twenty, which spent the whole
     * hour's paging in twenty-one minutes and left a second, unrelated emergency unable to
     * wake anybody.
     */
    const registry = new LadderRegistry();
    const base = { operator: 'a'.repeat(64), oncall: [oncall('Wren')], hasEmergencyContact: true, now: T0 };
    const first = registry.open({ ...base, distressId: 'd1' });
    const retry = registry.open({ ...base, distressId: 'd2', now: T0 + 80 });

    expect(first.started).toBe(true);
    expect(retry.started, 'a retry started a second ladder, and a second page with it').toBe(false);
    expect(registry.all()).toHaveLength(1);
    // Not restarted: a retrying phone must not hold the ladder in PAGING forever.
    expect(retry.ladder.stateSince).toBe(T0);
  });

  it('and an acknowledgement naming the retry still finds it', () => {
    // Whoever answers names the id they were shown, which after the first attempt is a
    // retry's id and not the ladder's own. Aliased rather than dropped, for exactly this.
    const registry = new LadderRegistry();
    const base = { operator: 'a'.repeat(64), oncall: [oncall('Wren')], hasEmergencyContact: true, now: T0 };
    registry.open({ ...base, distressId: 'd1' });
    registry.open({ ...base, distressId: 'd2', now: T0 + 80 });

    expect(registry.get('d2')?.distressId).toBe('d1');
    expect(registry.acknowledge('d2', human('Raven'), T0 + 100)?.state).toBe('acknowledged');
  });

  it('but a different operator always gets their own ladder', () => {
    // The pair. Joining by operator must never merge two people's emergencies.
    const registry = new LadderRegistry();
    const base = { oncall: [oncall('Wren')], hasEmergencyContact: true, now: T0 };
    registry.open({ ...base, distressId: 'd1', operator: 'a'.repeat(64) });
    registry.open({ ...base, distressId: 'd2', operator: 'b'.repeat(64) });
    expect(registry.all()).toHaveLength(2);
  });

  it('and a terminal ladder does not adopt: a later distress starts fresh', () => {
    /*
     * An operator whose ladder was acknowledged or exhausted, still sending, is somebody
     * whose situation has outlived the last attempt to answer it. Adopting into a finished
     * ladder would be silence.
     */
    const registry = new LadderRegistry();
    const base = { operator: 'a'.repeat(64), oncall: [oncall('Wren')], hasEmergencyContact: true, now: T0 };
    registry.open({ ...base, distressId: 'd1' });
    registry.acknowledge('d1', human('Raven'), T0 + 10);

    const later = registry.open({ ...base, distressId: 'd2', now: T0 + 600 });
    expect(later.started, 'a finished ladder swallowed a new emergency').toBe(true);
    expect(registry.all()).toHaveLength(2);
  });

  it('advances every live ladder and reports only real transitions', () => {
    const registry = new LadderRegistry();
    const base = { oncall: [oncall('Wren')], hasEmergencyContact: true, now: T0 };
    // Two operators, because two ladders now means two people.
    registry.open({ ...base, distressId: 'd1', operator: 'a'.repeat(64) });
    registry.open({ ...base, distressId: 'd2', operator: 'b'.repeat(64) });

    expect(registry.tickAll(T0 + 100)).toHaveLength(0);
    expect(registry.tickAll(T0 + 300).map((l) => l.state)).toEqual(['contact', 'contact']);
    // Idempotent inside the next window: nothing changed, nothing reported.
    expect(registry.tickAll(T0 + 301)).toHaveLength(0);
  });

  it('does not re-report an acknowledged ladder on later ticks', () => {
    const registry = new LadderRegistry();
    registry.open({
      distressId: 'd1', operator: 'a'.repeat(64), oncall: [oncall('Wren')],
      hasEmergencyContact: true, now: T0
    });
    expect(registry.acknowledge('d1', human('Raven'), T0 + 10)?.state).toBe('acknowledged');
    expect(registry.acknowledge('d1', human('Owl'), T0 + 20)).toBeNull();
    expect(registry.tickAll(T0 + 10_000)).toHaveLength(0);
  });
});

describe('the trigger', () => {
  it('has no way to start a ladder from a timer, a window or an assessment', () => {
    // Invariant 3. Escalation is not a decision: receipt of a 20911 runs it, and nothing
    // else can. A ladder requires a distressId, and there is no other constructor.
    const exported = { startLadder, advanceLadder, acknowledge, LadderRegistry };
    for (const [name, fn] of Object.entries(exported)) {
      expect(typeof fn, name).toBe('function');
    }
    // @ts-expect-error a ladder cannot be started without the event that caused it
    expect(() => startLadder({ operator: 'x', oncall: [], hasEmergencyContact: false, now: T0 }))
      .toBeDefined();
  });

  it('uses the windows the spec specifies unless told otherwise', () => {
    expect(DEFAULT_WINDOWS).toEqual({ pagingSeconds: 300, contactSeconds: 300 });
  });
});

describe('a clock that does not move forwards', () => {
  const oncall = [{ author: { kind: 'node' as const, callsign: 'Wren' }, channel: 'sms' as const, expires: 9e9 }];
  const open = (now: number) =>
    startLadder({ distressId: 'x', operator: 'op', oncall, hasEmergencyContact: false, now });
  const windows = { pagingSeconds: 300, contactSeconds: 300 };

  it('does not stall the ladder for the length of the jump', () => {
    // This runs on hardware that may have no battery-backed clock and syncs NTP after boot,
    // so an hour's correction is ordinary. Unhandled, elapsed goes negative and the ladder
    // stops: the operator waits out the whole jump before being told nobody is coming.
    const ladder = open(10_000);
    const corrected = advanceLadder(ladder, 6_400, windows);
    expect(corrected.state).toBe('paging');
    expect(corrected.stateSince).toBe(6_400);

    // One window from the corrected clock, not from the old one.
    expect(advanceLadder(corrected, 6_700, windows).state).toBe('exhausted');
  });

  it('does not report a clock correction as a transition', () => {
    // The operator has no use for hearing about the node's clock, and C42 says a report
    // means the ladder moved.
    const registry = new LadderRegistry();
    registry.open({ distressId: 'x', operator: 'op', oncall, hasEmergencyContact: false, now: 10_000 });
    expect(registry.tickAll(6_400, windows)).toHaveLength(0);
    // But the re-anchor was kept, so the next window is measured from the corrected clock.
    expect(registry.tickAll(6_700, windows).map((l) => l.state)).toEqual(['exhausted']);
  });

  it('leaves an ordinary forward tick alone', () => {
    const ladder = open(10_000);
    expect(advanceLadder(ladder, 10_100, windows)).toBe(ladder);
    expect(advanceLadder(ladder, 10_400, windows).state).toBe('exhausted');
  });
});
