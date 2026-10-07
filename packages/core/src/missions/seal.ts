/**
 * Sealed to the poster: NIP-44 inside, a NIP-59 gift wrap outside.
 *
 * The event is made an unsigned rumor and sealed by the contact key to the poster, then wrapped by
 * a one-time key — so a relay sees only that somebody wrote to the poster, and the poster can check
 * the wrap, the seal, and that what is inside is the seal-signer's own. Used for anything an
 * operator chooses to tell the poster alone: a claim, its release, a report.
 */
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import * as nip44 from 'nostr-tools/nip44';
import { createRumor, createSeal } from 'nostr-tools/nip59';

/** NIP-59. */
export const KIND_GIFT_WRAP = 1059;

export interface Unsigned {
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
}

export interface Sealed {
  /** The wrap: what goes to the poster's inbox. */
  wrap: Event;
  /** The id of the event inside, which is what the poster's labels will name. */
  inner: string;
}

/**
 * `ends`, when given, rides on the wrap so a relay may drop it after; the wrap's own time is
 * blurred up to two days back, as NIP-59 asks, so it says nothing of when it was sent.
 */
export function sealToPoster(contactSecret: Uint8Array, poster: string, event: Unsigned, ends?: number): Sealed {
  const rumor = createRumor(event, contactSecret);
  const seal = createSeal(rumor, contactSecret, poster);
  const once = generateSecretKey();
  const wrap = finalizeEvent(
    {
      kind: KIND_GIFT_WRAP,
      created_at: event.created_at - Math.floor(Math.random() * 2 * 86_400),
      content: nip44.encrypt(JSON.stringify(seal), nip44.getConversationKey(once, poster)),
      tags: ends === undefined ? [['p', poster]] : [['p', poster], ['expiration', String(ends)]]
    },
    once
  );
  return { wrap, inner: rumor.id };
}
