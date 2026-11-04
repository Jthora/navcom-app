import { describe, expect, it } from 'vitest';
import { PLAYS, STALE_AFTER_DAYS } from './playbook';

const steps = PLAYS.flatMap((p) => p.steps.map((s) => ({ play: p.id, ...s })));

describe('the playbook', () => {
  it('every sourced step was read at its source within the last six months, or the build stops', () => {
    // A city's routing that changed, repeated here as if it had not, is the confident wrong guidance
    // this file exists to keep out [invariant 7; community.ts's rule].
    const now = Date.now();
    const stale = steps.filter((s) => s.source && (now - Date.parse(s.source.checked)) / 86_400_000 > STALE_AFTER_DAYS);
    expect(stale.map((s) => `${s.play}: ${s.source!.by}, checked ${s.source!.checked}`)).toEqual([]);
  });

  it('cites its sources at their own addresses, over https, each with the day it was read', () => {
    for (const s of steps.filter((x) => x.source)) {
      expect(s.source!.url).toMatch(/^https:\/\//);
      expect(s.source!.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Date.parse(s.source!.checked)).toBeLessThanOrEqual(Date.now());
    }
  });

  it('never teaches a technique for a person’s body, which is taught by people and never written here', () => {
    // The Medic's kill trigger is confident wrong guidance [CLAUDE.md]. The owner's playbook says what to
    // press and who the city says to call; first aid, cold injury and overdose response are not in it.
    const technique = /\b(cpr|tourniquet|naloxone|narcan|splint|bandage|rewarm\w*|hypotherm\w*|frostbite|chest compressions?|recovery position|dose|dosage|airway)\b/i;
    expect(steps.filter((s) => technique.test(s.say)).map((s) => s.say)).toEqual([]);
  });

  it('has a play for each night the stint brief names first: cold, no signal, a gatekeeper, a rumour', () => {
    expect(PLAYS.map((p) => p.id)).toEqual(expect.arrayContaining(['cold-night', 'no-signal', 'register-first', 'rumour']));
    expect(new Set(PLAYS.map((p) => p.id)).size).toBe(PLAYS.length);
    for (const p of PLAYS) expect(p.steps.length, p.id).toBeGreaterThan(0);
  });
});
