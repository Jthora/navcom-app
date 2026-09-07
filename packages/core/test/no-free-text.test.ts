import { describe, expect, it } from 'vitest';
import { generateSecretKey } from 'nostr-tools/pure';
import {
  CorrectionError, PLACE_EXTRAS, PlaceError, buildCorrection, buildPlace, placeId, readCorrection
} from '../src/index.js';

/**
 * The descriptor ban is enforced by there being nowhere to put one.
 *
 * That is the whole mechanism, and it is stronger than a prohibition — a rule against
 * descriptors is unenforceable in free text, which invariant 1 already concedes ("free-text
 * notes can't be enforced, so guide rather than pretend"). A schema that cannot express one
 * needs no enforcement at all.
 *
 * It stops being true the moment one unbounded field is publishable from outside, and `notes`
 * was exactly that: correctable, and offered as a place extra. Verified before it was closed —
 * a correction asserting the string below was accepted and read back intact.
 *
 * No UI ever offered either path, which is why it survived. `readCorrection`'s own note is the
 * answer to that: a hand-rolled client is the ordinary case on an open protocol.
 */
const DESCRIPTOR = 'white male, 30s, red jacket, seen near the corner';

const correction = (fields: Record<string, string>) => ({
  record: 'r1', verified_by: 'Somebody', method: 'in_person' as const,
  last_verified: '2026-09-06', fields
});

describe('free text cannot be published from outside', () => {
  it('refuses a correction carrying notes', () => {
    expect(() =>
      buildCorrection(generateSecretKey(), correction({ notes: DESCRIPTOR }) as never, 0)
    ).toThrow(CorrectionError);
  });

  it('refuses one on read too, not only on build', () => {
    // A hand-rolled client does not call our builder. This is the check that matters.
    const forged = buildCorrection(
      generateSecretKey(), correction({ hours: '24h' }) as never, 0
    );
    const tampered = { ...forged, content: JSON.stringify({
      ...JSON.parse(forged.content), fields: { notes: DESCRIPTOR }
    }) };
    expect(readCorrection(tampered as never)).toBeNull();
  });

  it('refuses a place carrying notes', () => {
    expect(() =>
      buildPlace(generateSecretKey(), {
        id: placeId('X', '1 Main St'), region: 'philadelphia', name: 'X',
        type: 'shelter', address: '1 Main St', verified_by: 'W',
        method: 'in_person', last_verified: '2026-09-06',
        fields: { notes: DESCRIPTOR } as never
      }, 0)
    ).toThrow(PlaceError);
  });

  it('leaves the fields somebody standing outside can actually read', () => {
    expect([...PLACE_EXTRAS].sort()).toEqual(['hours', 'phone']);
  });

  it('still accepts the ordinary correction it always did', () => {
    const ev = buildCorrection(generateSecretKey(), correction({ hours: '24h' }) as never, 0);
    expect(readCorrection(ev)?.fields.hours).toBe('24h');
  });
});
