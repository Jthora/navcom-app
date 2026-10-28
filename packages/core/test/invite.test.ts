/**
 * Pairing at a distance.
 *
 * Two properties carry the weight here, and neither is about cryptography:
 *
 *  1. **Declining sends nothing**, so nobody owes a refusal
 *  2. **The key being offered is proven**, so an invite cannot hand over somebody else's
 */

import { describe, expect, it } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import {
  buildInvite,
  InviteError,
  KIND_INVITE,
  NOTE_MAX,
  readInvite,
  type InvitePayload
} from '../src/index.js';

/** Raven, who published a card. Their contact key is the public address on it. */
const ravenContact = generateSecretKey();
const ravenContactPub = getPublicKey(ravenContact);
const raven = generateSecretKey();
const ravenPub = getPublicKey(raven);

/** Wren, who read the card and wants to pair. */
const wren = generateSecretKey();
const wrenPub = getPublicKey(wren);

const owl = generateSecretKey();

const T = 1_755_300_000;

/**
 * What a relay actually delivers. See the note in `public.test.ts` — `verifyEvent` memoises
 * onto the event object, and a spread copies that, so a tamper test that skips this passes
 * without testing anything.
 */
const overRelay = (event: Event): Event => JSON.parse(JSON.stringify(event)) as Event;
const from = (over: Partial<InvitePayload> = {}): InvitePayload => ({
  callsign: 'Wren',
  note: 'Out most Thursdays around the north side.',
  ...over
});

describe('answering a card', () => {
  it('reaches the contact key and hands over the operational one', () => {
    // The asymmetry that makes a card safe to publish: what goes out is the contact key,
    // what comes back is the working key, and only the sender chose to reveal theirs.
    const event = buildInvite(wren, ravenContactPub, from(), T);
    const read = readInvite(ravenContact, event);
    expect(read?.from).toBe(wrenPub);
    expect(read?.payload.callsign).toBe('Wren');
    expect(read?.payload.note).toContain('Thursdays');
  });

  it('proves the key it offers rather than asserting it', () => {
    // A payload that merely states a pubkey can state anybody's -- and an invite whose key
    // is somebody else's is a way to put a stranger on a screen under a trusted name.
    const event = buildInvite(wren, ravenContactPub, from(), T);
    const forged = overRelay({ ...event, content: event.content.slice(0, -4) + 'AAAA' });
    expect(readInvite(ravenContact, forged)).toBeNull();
  });

  it('shows a relay nothing about who is writing to whom', () => {
    const event = buildInvite(wren, ravenContactPub, from(), T);
    expect(event.pubkey, 'the sender signs the inside, never the outside').not.toBe(wrenPub);
    expect(event.content).not.toContain('Wren');
    expect(event.content).not.toContain(wrenPub);
  });

  it('cannot be read by somebody it was not sent to', () => {
    const event = buildInvite(wren, ravenContactPub, from(), T);
    expect(readInvite(owl, event)).toBeNull();
    // Not even by Raven's operational key. It was addressed to the card, not the person.
    expect(readInvite(raven, event)).toBeNull();
  });

  it('is stored, because an invite has to wait for somebody who is asleep', () => {
    // The one kind here a relay is meant to keep. Everything else is ephemeral on purpose.
    const event = buildInvite(wren, ravenContactPub, from(), T);
    expect(event.kind).toBe(KIND_INVITE);
    expect(KIND_INVITE).toBeGreaterThanOrEqual(1000);
    expect(KIND_INVITE).toBeLessThan(10_000);
  });
});

describe('accepting', () => {
  it('is an invite in the other direction, and completes the pair', () => {
    // One message, not three. Raven now holds Wren's key, and replies with their own to
    // the operational key the first invite carried.
    const asked = readInvite(ravenContact, buildInvite(wren, ravenContactPub, from(), T));
    const back = buildInvite(raven, asked!.from, { callsign: 'Raven' }, T + 60);

    const read = readInvite(wren, back);
    expect(read?.from).toBe(ravenPub);
    expect(read?.payload.callsign).toBe('Raven');
  });

  it('is the only thing that reveals the answering operator\'s key', () => {
    // Raven read the invite and did not reply. Wren has learned nothing at all -- not that
    // it arrived, not that it was read, and not that the contact key is live.
    const event = buildInvite(wren, ravenContactPub, from(), T);
    expect(readInvite(ravenContact, event)).not.toBeNull();
    expect(readInvite(wren, event)?.from).toBeUndefined();
  });
});

describe('declining', () => {
  it('has no message to send, because there is no such function', () => {
    // Somebody who owes a refusal is somebody who accepts to avoid an awkward one. This is
    // the same rule as unpair, which also tells nobody.
    const api = { buildInvite, readInvite } as Record<string, unknown>;
    expect(Object.keys(api)).not.toContain('declineInvite');
    expect(Object.keys(api)).not.toContain('buildDecline');
  });

  it('leaves nothing on the sender\'s side to expire or nag about', () => {
    // buildInvite returns an event and no handle. There is no pending record, so there is
    // nowhere for a "waiting on Raven" line to come from.
    const event = buildInvite(wren, ravenContactPub, from(), T);
    expect(Object.keys(event).sort()).toEqual(
      ['content', 'created_at', 'id', 'kind', 'pubkey', 'sig', 'tags'].sort()
    );
  });
});

describe('what an invite refuses', () => {
  it('refuses one with no callsign', () => {
    expect(() => buildInvite(wren, ravenContactPub, from({ callsign: ' ' }), T)).toThrow(
      InviteError
    );
  });

  it('refuses a note longer than a note', () => {
    expect(() =>
      buildInvite(wren, ravenContactPub, from({ note: 'x'.repeat(NOTE_MAX + 1) }), T)
    ).toThrow(InviteError);
    const event = buildInvite(wren, ravenContactPub, from(), T);
    expect(readInvite(ravenContact, overRelay({ ...event, kind: 1 }))).toBeNull();
  });

  it('returns null rather than throwing on anything malformed', () => {
    const junk = overRelay({ ...buildInvite(wren, ravenContactPub, from(), T), content: 'not-ciphertext' });
    expect(() => readInvite(ravenContact, junk)).not.toThrow();
    expect(readInvite(ravenContact, junk)).toBeNull();
  });
});

describe('an accept that carries the request it answers', () => {
  /*
   * Asking was the asker's consent, so their phone pairs on the answer: but only on an answer that
   * proves it answers *their* request to *that* card. The answer carries the request back, signed by
   * the asker, and only the card's holder could have opened it [journey, 2026-10-28].
   */
  it('names who asked: the asker reads their own signature', () => {
    const asked = readInvite(ravenContact, overRelay(buildInvite(wren, ravenContactPub, from({ note: 'Thursdays' }), T)))!;
    expect(asked.answering).toBeNull();
    const answer = buildInvite(raven, getPublicKey(wren), { callsign: 'Raven', answers: asked.inner }, T + 60);
    const read = readInvite(wren, overRelay(answer))!;
    expect(read.from).toBe(getPublicKey(raven));
    expect(read.answering).toBe(getPublicKey(wren));
  });

  it('names nobody for something that is not a signed invite, and still reads the invite', () => {
    const asked = readInvite(ravenContact, overRelay(buildInvite(wren, ravenContactPub, from(), T)))!;
    const forged = { ...asked.inner, content: JSON.stringify({ callsign: 'Somebody else' }) };
    const read = readInvite(wren, overRelay(buildInvite(raven, getPublicKey(wren), { callsign: 'Raven', answers: forged as Event }, T)))!;
    expect(read.answering).toBeNull();
    expect(read.payload.callsign).toBe('Raven');
    const wrongKind = readInvite(wren, overRelay(buildInvite(raven, getPublicKey(wren), { callsign: 'Raven', answers: { ...asked.inner, kind: 1 } as Event }, T)))!;
    expect(wrongKind.answering).toBeNull();
  });

  it('an answer from a build that does not carry it is an ordinary invite', () => {
    const read = readInvite(wren, overRelay(buildInvite(raven, getPublicKey(wren), { callsign: 'Raven' }, T)))!;
    expect(read.answering).toBeNull();
  });
});
