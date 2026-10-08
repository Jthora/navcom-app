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
import { randomBytes } from '@noble/hashes/utils';

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

/** How far a wrap's own time is moved back: two days, as NIP-59 asks of its `created_at`. */
const BLUR_SECONDS = 2 * 86_400;
/** A whole number of seconds in [0, BLUR_SECONDS), from the platform's own randomness. */
function blur(): number {
  const [a, b, c, d] = randomBytes(4);
  return (((a! << 24) | (b! << 16) | (c! << 8) | d!) >>> 0) % BLUR_SECONDS;
}

/** When what is inside lapses: its exact end, and the longest it can be from the moment it was made. */
export interface Lapses {
  ends: number;
  within: number;
}

/**
 * The wrap's own time is blurred up to two days back, as NIP-59 asks, so it says nothing of when
 * it was sent.
 *
 * `lapses`, when given, puts a time on the wrap after which a relay may drop it — **worked out from
 * the wrap's own blurred time and nothing else**: that time, plus the blur, plus the longest a lease
 * can run. So it is never before the end inside (made at most two days after the blurred time, ending
 * at most `within` after that), and it says nothing the blurred time does not [audit 11, second grid].
 * The exact end on the outside gave away the second a claim was sent, since a lease ends a day after
 * it, and paired a claim with its release; an end blurred apart from the time beside it still
 * narrowed the two days down to hours for one wrap in sixteen. The exact end is inside, on the label
 * the poster reads. Only a clock that went back between a claim and its release puts the end past
 * that time, and then the end itself is used, so a relay still never drops it early.
 */
export function sealToPoster(contactSecret: Uint8Array, poster: string, event: Unsigned, lapses?: Lapses): Sealed {
  const rumor = createRumor(event, contactSecret);
  const seal = createSeal(rumor, contactSecret, poster);
  const once = generateSecretKey();
  const at = event.created_at - blur();
  const wrap = finalizeEvent(
    {
      kind: KIND_GIFT_WRAP,
      created_at: at,
      content: nip44.encrypt(JSON.stringify(seal), nip44.getConversationKey(once, poster)),
      tags:
        lapses === undefined
          ? [['p', poster]]
          : [['p', poster], ['expiration', String(Math.max(lapses.ends, at + BLUR_SECONDS + lapses.within))]]
    },
    once
  );
  return { wrap, inner: rumor.id };
}
