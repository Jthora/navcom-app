import { describe, expect, it } from 'vitest';
import {
  buildAnnouncement,
  buildCard,
  buildCorrection,
  buildInvite,
  buildKeyBundle,
  buildPlace,
  buildPublicPresence,
  newSecretKey,
  publicKeyOf,
  readAnnouncement,
  readCard,
  readCorrection,
  readInvite,
  readKeyBundle,
  readPlace,
  readPublicPresence
} from '../src/index.js';

/**
 * Does the signature check actually run?
 *
 * Every reader in this package calls `verifyEvent`, and **nothing in this repository has ever
 * checked that the call does anything.** A search for a test asserting that a forged signature is
 * refused returned nothing across core, the web suite and the browser tests. So the property the
 * entire trust model rests on — *anybody may publish, and a reader can tell who actually did* —
 * has been assumed for the life of the project.
 *
 * It was found the way the other nine were found. A tamper test written as
 * `read({ ...event, sig: 'f'.repeat(128) })` **passed the forgery**: `finalizeEvent` marks an
 * event verified by setting a symbol on the object, and object spread carries that symbol across,
 * so `verifyEvent` returned a cached yes without looking at anything.
 *
 * That is a test artifact rather than a production bug — a relay delivers JSON, which parses into
 * a fresh object with no symbol — but "probably fine, never checked" is the exact thing this
 * project refuses everywhere else, and it was sitting in the one place meant to catch it.
 *
 * ## What this file does
 *
 * Puts every reader through the wire the way a relay delivers it, and asserts three things a
 * forged event must not survive: a signature that is not the signature, an author who did not
 * sign, and content changed after signing.
 */

const AUTHOR = newSecretKey();
const IMPOSTER = newSecretKey();
const NOW = 1_700_000_000;

/** What a relay actually hands a client: JSON, with none of the sender's in-process state. */
const overWire = (event: unknown) => JSON.parse(JSON.stringify(event));

/**
 * One reader, and an event its author genuinely signed.
 *
 * Every kind is listed rather than a representative sample. A reader added later that forgets to
 * verify is exactly the omission this file exists to catch, and a sample would not catch it.
 */
const KINDS: { name: string; event: () => unknown; read: (e: never) => unknown }[] = [
  {
    name: 'announcement',
    event: () =>
      buildAnnouncement(
        AUTHOR,
        { artifact: 'navcom:directory', cid: 'bafybeigpcpp4xcwpt7by6nzklntkjnrprfowzuvng36x7kgw26nzcjipji' },
        NOW
      ),
    read: readAnnouncement as never
  },
  {
    name: 'correction',
    event: () =>
      buildCorrection(
        AUTHOR,
        { record: 'stl-001', verified_by: 'Wren', method: 'in_person', last_verified: '2026-08-24', fields: { hours: '24/7' } },
        NOW
      ),
    read: readCorrection as never
  },
  {
    name: 'place',
    event: () =>
      buildPlace(
        AUTHOR,
        {
          id: '',
          region: 'st-louis',
          name: 'Room In The Inn',
          type: 'shelter',
          address: '705 Drexel St',
          verified_by: 'Wren',
          method: 'in_person',
          last_verified: '2026-08-24'
        },
        NOW
      ),
    read: readPlace as never
  },
  {
    name: 'card',
    event: () => buildCard(AUTHOR, { callsign: 'Wren', region: 'st-louis' }, NOW),
    read: readCard as never
  },
  {
    name: 'public presence',
    event: () => buildPublicPresence(AUTHOR, 'st-louis', NOW),
    read: ((e: never) => readPublicPresence(e, 'st-louis')) as never
  },
  {
    name: 'key bundle',
    event: () => buildKeyBundle(AUTHOR, NOW),
    read: ((e: never) => readKeyBundle(e, publicKeyOf(AUTHOR))) as never
  }
];

describe('a forged signature is refused', () => {
  for (const { name, event, read } of KINDS) {
    it(`${name} — the untampered event still reads, so the round trip is not what rejects it`, () => {
      expect(read(overWire(event()) as never)).not.toBeNull();
    });

    it(`${name} — a signature that is not the signature`, () => {
      const forged = overWire({ ...(event() as object), sig: 'f'.repeat(128) });
      expect(read(forged as never), `${name} accepted a forged signature`).toBeNull();
    });

    it(`${name} — an author who did not sign it`, () => {
      /*
       * The attack that matters most in this system. Provenance by name is the whole model, so an
       * event that keeps a real signature and swaps the claimed author would let anybody publish
       * a correction, a place or a card under somebody else's key.
       */
      const stolen = overWire({ ...(event() as object), pubkey: publicKeyOf(IMPOSTER) });
      expect(read(stolen as never), `${name} accepted a stolen identity`).toBeNull();
    });

    it(`${name} — content changed after signing`, () => {
      const altered = overWire({ ...(event() as object), content: '{"tampered":true}' });
      expect(read(altered as never), `${name} accepted altered content`).toBeNull();
    });
  }
});

describe('an invite, where the outer signature is deliberately not the check', () => {
  /**
   * Written into the generic loop above first, where it failed — and the code was right.
   *
   * An invite is a **wrap**: the outer event is signed by a throwaway key, and the inner event
   * carries the sender's real identity. That outer key is disposable precisely so nothing links
   * one invite to another, which means **its signature attests to nobody and verifying it would
   * prove nothing.** `readInvite` verifies the inner event instead.
   *
   * Recorded here rather than deleted, because to the next reader this looks exactly like a
   * missing check — and the difference between "not verified" and "verified somewhere else, on
   * purpose" is not visible from the call site.
   */
  const invite = () =>
    buildInvite(AUTHOR, publicKeyOf(IMPOSTER), { callsign: 'Wren', note: 'come out tonight' }, NOW);

  it('opens for the recipient it was sealed to', () => {
    const read = readInvite(IMPOSTER, overWire(invite()));
    expect(read?.from).toBe(publicKeyOf(AUTHOR));
    expect(read?.payload.callsign).toBe('Wren');
  });

  it('does not open for anybody else', () => {
    // The confidentiality half. A relay carrying this learns nothing, and neither does a
    // bystander who fetched it.
    expect(readInvite(newSecretKey(), overWire(invite()))).toBeNull();
  });

  it('is refused when the wrap is tampered with, because that breaks the seal', () => {
    // Changing the wrap's author breaks the key agreement, and changing its content breaks the
    // ciphertext. Neither needs a signature check to fail — which is why there is not one.
    expect(readInvite(IMPOSTER, overWire({ ...invite(), pubkey: publicKeyOf(newSecretKey()) }))).toBeNull();
    expect(readInvite(IMPOSTER, overWire({ ...invite(), content: 'not-a-sealed-payload' }))).toBeNull();
  });

  it('reports the sender the inner signature proves, not one the wrap claims', () => {
    /*
     * The property that makes the whole arrangement work: `from` comes from the inner event's
     * pubkey after verifying it, so a wrap cannot assert an identity it does not hold. The outer
     * key is unrelated to the sender by design.
     */
    const wrap = overWire(invite());
    expect(readInvite(IMPOSTER, wrap)?.from).toBe(publicKeyOf(AUTHOR));
    expect(wrap.pubkey).not.toBe(publicKeyOf(AUTHOR));
  });
});
