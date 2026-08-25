import { describe, expect, it } from 'vitest';
import {
  buildPlace,
  dedupePlaces,
  isAddedPlace,
  mergeCorrections,
  newSecretKey,
  placeId,
  placeToRecord,
  publicKeyOf,
  readPlace,
  withPlaces,
  type Place,
  type ResourceRecord
} from '../src/index.js';

/**
 * Adding a place the directory does not have.
 *
 * The risk this kind introduces is new and it is the one worth testing hardest: a wrong
 * field sends somebody to the wrong hours, **a wrong place sends somebody to an address that
 * is not there.** So the tests below are weighted toward what is refused rather than what is
 * accepted, and toward the two failure modes that would be invisible from inside — identifier
 * collision, and a merge that depends on delivery order.
 */

const SECRET = newSecretKey();
const OTHER = newSecretKey();
const NOW = new Date('2026-08-23T22:00:00Z');

function place(over: Partial<Place> = {}): Place {
  return {
    id: '',
    region: 'st-louis',
    name: "St Patrick Center",
    type: 'shelter',
    address: '800 N Tucker Blvd',
    verified_by: 'Wren',
    method: 'in_person',
    last_verified: '2026-08-23',
    ...over
  };
}

const roundTrip = (p: Place, secret = SECRET) => readPlace(buildPlace(secret, p, 1_700_000_000));

describe('what a place refuses', () => {
  it('refuses a place nobody went to', () => {
    /*
     * The rule that answers the failure mode. `website` and `secondhand` are perfectly
     * rankable methods everywhere else in this system; here they are refused, because a
     * scraped place belongs in the maintainer's import path where a person reviews it rather
     * than on somebody's screen at 11pm.
     */
    expect(() => buildPlace(SECRET, place({ method: 'website' as never }), 1)).toThrow(/went there|phoned/i);
    expect(() => buildPlace(SECRET, place({ method: 'secondhand' as never }), 1)).toThrow(/went there|phoned/i);
  });

  it('refuses a place with no address, because that is a rumour', () => {
    expect(() => buildPlace(SECRET, place({ address: '   ' }), 1)).toThrow(/walk to/i);
  });

  it('refuses the decisive fields at creation', () => {
    /*
     * A creation form that invited `pets` would collect a guess with an operator's name on
     * it, which is exactly the laundering the directory exists to prevent. They arrive later
     * as corrections, from somebody who asked.
     */
    expect(() => buildPlace(SECRET, place({ fields: { pets: 'yes' } as never }), 1)).toThrow(/not something a new place carries/i);
    expect(() => buildPlace(SECRET, place({ fields: { intake_hours: '19:00' } as never }), 1)).toThrow();
  });

  it('refuses control characters, including the one the identifier separates on', () => {
    expect(() => buildPlace(SECRET, place({ name: 'St Pat\u0000s' }), 1)).toThrow(/control/i);
    expect(() => buildPlace(SECRET, place({ address: '800 N\u001fTucker' }), 1)).toThrow(/control/i);
  });

  it('refuses an id the caller chose', () => {
    // Identity is derived, never asserted — a caller that disagrees computed it from
    // different strings than the ones it is about to publish.
    expect(() => buildPlace(SECRET, place({ id: 'place:deadbeefdeadbeef' }), 1)).toThrow(/derived/i);
  });

  it('refuses an unknown type rather than inventing one', () => {
    expect(() => buildPlace(SECRET, place({ type: 'safehouse' as never }), 1)).toThrow(/type/i);
  });
});

describe('what a relay serves is not trusted', () => {
  it('refuses an event whose d tag disagrees with its payload', () => {
    const event = buildPlace(SECRET, place(), 1_700_000_000);
    const tampered = { ...event, tags: [['d', 'place:0000000000000000'], ...event.tags.slice(1)] };
    expect(readPlace(tampered)).toBeNull();
  });

  it('refuses an event whose region tag disagrees with its payload', () => {
    const event = buildPlace(SECRET, place(), 1_700_000_000);
    const tampered = { ...event, tags: [event.tags[0], ['g', 'nashville']] };
    expect(readPlace(tampered)).toBeNull();
  });

  it('refuses an empty extra rather than letting it become a merge candidate', () => {
    // The exact defect `readCorrection` was fixed for: an empty string is still a string, so
    // it became a candidate, and with a strong method it blanked the field it "corrected".
    const event = buildPlace(SECRET, place(), 1_700_000_000);
    const body = JSON.parse(event.content);
    body.fields = { hours: '   ' };
    expect(readPlace({ ...event, content: JSON.stringify(body) })).toBeNull();
  });

  it('refuses a payload that would not have been buildable', () => {
    const event = buildPlace(SECRET, place(), 1_700_000_000);
    const body = JSON.parse(event.content);
    body.method = 'website';
    expect(readPlace({ ...event, content: JSON.stringify(body) })).toBeNull();
  });

  it('reads back what was written, with the author attached', () => {
    const read = roundTrip(place({ fields: { phone: '314-802-0700' } }));
    expect(read?.name).toBe('St Patrick Center');
    expect(read?.by).toBe(publicKeyOf(SECRET));
    expect(read?.fields?.phone).toBe('314-802-0700');
    expect(read?.id).toBe(placeId('St Patrick Center', '800 N Tucker Blvd'));
  });
});

describe('the identifier', () => {
  it('is the same place however two people typed the whitespace and case', () => {
    expect(placeId('  St Patrick   Center ', '800 n tucker blvd')).toBe(
      placeId('St Patrick Center', '800 N Tucker Blvd')
    );
  });

  it('does not collapse distinct scripts into one slot', () => {
    /*
     * Starcom derived a claim identifier by lowercasing and collapsing punctuation, and it
     * silently merged 北京, Москва and 東京 into a single slot where each overwrote the last.
     * Their own tests structurally could not see it; a second implementation caught it.
     *
     * A collision here hides a building behind another building, on the screen of somebody
     * deciding where to sleep. This is the test that has to keep passing.
     */
    const ids = new Set([
      placeId('北京', '1 Main St'),
      placeId('Москва', '1 Main St'),
      placeId('東京', '1 Main St'),
      placeId('Beijing', '1 Main St')
    ]);
    expect(ids.size).toBe(4);
  });

  it('treats the same characters in different Unicode forms as one place', () => {
    /*
     * One phone's keyboard emits a precomposed U+00E9, another emits e + U+0301. The two
     * strings are visually identical and byte-different. Without NFC that is two rows for one
     * building — the untidy half of the same problem the scripts test guards the dangerous
     * half of.
     */
    const precomposed = 'Caf\u00e9 St Vincent';
    const decomposed = 'Cafe\u0301 St Vincent';
    expect(precomposed).not.toBe(decomposed);
    expect(placeId(precomposed, '1 Main St')).toBe(placeId(decomposed, '1 Main St'));
  });

  it('cannot be confused by moving text across the name/address boundary', () => {
    expect(placeId('ab', 'c')).not.toBe(placeId('a', 'bc'));
  });
});

describe('two operators adding the same building', () => {
  it('produce one row, not two', () => {
    const a = roundTrip(place({ verified_by: 'Wren' }))!;
    const b = roundTrip(place({ verified_by: 'Raven', method: 'phone' }), OTHER)!;
    expect(dedupePlaces([a, b])).toHaveLength(1);
  });

  it('and the stronger method wins, whatever order the relays delivered them in', () => {
    const stood = roundTrip(place({ verified_by: 'Wren', method: 'in_person' }))!;
    const phoned = roundTrip(place({ verified_by: 'Raven', method: 'phone' }), OTHER)!;
    expect(dedupePlaces([phoned, stood])[0]?.verified_by).toBe('Wren');
    expect(dedupePlaces([stood, phoned])[0]?.verified_by).toBe('Wren');
  });

  it('resolves an exact tie identically on every device', () => {
    /*
     * The bug `mergeCorrections` already had once: two devices receiving identical evidence
     * in a different order drew different pictures. Each device drawing its own is the
     * design; drawing a *different* one from the same events is not.
     */
    const a = roundTrip(place({ verified_by: 'Wren' }))!;
    const b = roundTrip(place({ verified_by: 'Raven' }), OTHER)!;
    expect(dedupePlaces([a, b])[0]?.by).toBe(dedupePlaces([b, a])[0]?.by);
  });
});

describe('a place is an ordinary record once it exists', () => {
  const added = () => placeToRecord(roundTrip(place())!);

  it('carries no decisive fields, so they render as unknown rather than as permission', () => {
    const r = added();
    for (const f of ['pets', 'id_required', 'sobriety', 'curfew', 'intake_hours', 'accepts'] as const) {
      expect(r[f], `${f} was invented`).toBeUndefined();
    }
  });

  it('is marked as added rather than published', () => {
    expect(isAddedPlace(added())).toBe(true);
    expect(isAddedPlace({ id: 'stl-001' })).toBe(false);
  });

  it('takes corrections over the top by the existing rules', () => {
    // The whole reason a place becomes a `ResourceRecord`: nothing downstream needs to learn
    // about a second shape, so no second set of merge rules can disagree with the first.
    const base = added();
    const merged = mergeCorrections(
      base,
      [
        {
          record: base.id,
          verified_by: 'Raven',
          method: 'in_person',
          last_verified: '2026-08-24',
          fields: { pets: 'service_only' },
          by: publicKeyOf(OTHER)
        }
      ],
      NOW
    );
    expect(merged.record.pets).toBe('service_only');
    expect(merged.sources.pets?.correction?.verified_by).toBe('Raven');
  });
});

describe('a region that ships empty', () => {
  const published: ResourceRecord[] = [];

  it('shows what operators added', () => {
    const all = withPlaces(published, [roundTrip(place())!]);
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe('St Patrick Center');
  });

  it('never lets an added place shadow a published one', () => {
    /*
     * If a place an operator added later ships in the published directory under the same
     * derived id, the curated row is the one a person stood behind. The operator's assertion
     * does not become a second row for the same building.
     */
    const added = roundTrip(place())!;
    const curated: ResourceRecord = {
      id: added.id,
      region: 'st-louis',
      name: 'St Patrick Center',
      type: 'shelter',
      flag: 'ok'
    } as ResourceRecord;
    const all = withPlaces([curated], [added]);
    expect(all).toHaveLength(1);
    expect(all[0]).toBe(curated);
  });

  it('does not depend on the order places arrived', () => {
    const a = roundTrip(place())!;
    const b = roundTrip(place({ name: 'Biddle House', address: '1212 N 13th St' }))!;
    expect(withPlaces([], [a, b]).map((r) => r.id)).toEqual(withPlaces([], [b, a]).map((r) => r.id));
  });
});
