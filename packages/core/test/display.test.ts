/**
 * The display rules, as rules rather than as branches.
 *
 * These decide whether somebody walks across a city at 11pm, so what matters is the rule
 * holding — not which line of code happens to enforce it today.
 */

import { describe, expect, it } from 'vitest';
import { displayField } from '../src/directory/display';
import type { ResourceRecord } from '../src/directory/types';

describe('rule 1, as a property rather than as a branch', () => {
  /**
   * *"A volatile value is never shown without its age."*
   *
   * The guard that states this is currently **unreachable**: every `last_verified` that
   * produces a null age also produces `stale` confidence, so rule 2 returns `call-first`
   * first. A test aimed at the branch could not fail without it, and this project deletes
   * tests that pass either way rather than keeping them as decoration [0.R].
   *
   * So the rule is asserted over the output instead. This holds however the rules are
   * arranged internally, and it keeps holding if somebody reorders them — which is the thing
   * a branch test would not have protected.
   */
  const now = new Date('2026-08-22T12:00:00Z');
  const dates = [undefined, '', 'not-a-date', '2026-13-45', '2099-01-01', '2026-08-20', '2019-01-01'];
  const methods = ['in_person', 'phone', 'website', 'secondhand'];

  it('never renders a volatile value without an age, whatever the record says', () => {
    for (const last_verified of dates) {
      for (const method of methods) {
        const record = {
          id: 'r1', name: 'S', type: 'shelter', region: 'x',
          hours: '19:00-07:00', flag: 'ok', verified_by: 'Wren', method, last_verified
        } as unknown as ResourceRecord;

        const shown = displayField(record, 'hours', now);
        if (shown.kind === 'value') {
          // The whole rule, in one line: a value is only ever shown with an age attached.
          expect(shown.age, `hours shown with no age for ${method}/${last_verified}`).not.toBeNull();
        }
      }
    }
  });

  it('renders call-first rather than a bare value when the age cannot be established', () => {
    const record = {
      id: 'r1', name: 'S', type: 'shelter', region: 'x',
      hours: '19:00-07:00', flag: 'ok', verified_by: 'Wren', method: 'in_person',
      last_verified: 'not-a-date'
    } as unknown as ResourceRecord;
    expect(displayField(record, 'hours', now).kind).toBe('call-first');
  });
});
