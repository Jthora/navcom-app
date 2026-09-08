import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import type { SecretKey } from '../crypto/keys.js';
import { KIND_CARD, KIND_PUBLIC_PRESENCE } from './kinds.js';
import { CALLSIGN_MAX, withinLimit } from '../limits.js';
import { linkTags, readLinks, type CardLink } from './links.js';

/**
 * An operator's public face — the card, and *"I am out tonight."*
 *
 * Everything else in this system is addressed to somebody. This file is the one place an
 * operator can choose to be a public artifact, and the whole design of it is about keeping
 * that choice from costing them anything they did not agree to.
 *
 * ## The contact key, and why it is not the operational key
 *
 * The obvious implementation signs a card with the operator's own key. It is also how you
 * quietly undo peer presence.
 *
 * Presence events are `p`-tagged to their recipient **in plaintext** — that tag is how a
 * relay knows where to route them, and it cannot be encrypted. That is fine while an
 * operational pubkey is known only to people who scanned it in person. Publish that same
 * key on a card and it stops being fine: anyone watching a public relay can now count the
 * events addressed to it, and learn when this operator is out, roughly how many peers they
 * have, and what nights they work. `presence.ts` spends a throwaway key per message to
 * prevent exactly that, and one public card would hand it all back.
 *
 * So a card is signed by a **contact key**: a second keypair whose only jobs are to sign
 * the public artifacts here and to receive invites. It is never a presence recipient, never
 * a signal author, and never known to the watch.
 *
 * Two consequences worth stating plainly, because they are the point:
 *
 * - Being findable costs an operator **no operational exposure**. The public key and the
 *   working key are different keys, and nothing links them but the operator's own say-so
 * - Withdrawing means **discarding the contact key**. The published card survives on
 *   whatever relays kept it — nothing can unpublish it — but it now names a key nobody
 *   holds and nobody listens on. That is an honest withdrawal rather than a promised one
 *
 * ## What a card may contain
 *
 * A callsign, a region, and a line about what you do. The allowlist in `CARD_FIELDS` is
 * enforced on read, so a card carrying anything else is refused rather than partially
 * accepted — including, specifically, a position at any precision. There is no setting
 * that publishes a position, and this is the file where somebody would add one.
 *
 * Normative source: docs/spec/signals.spec.md
 */

/** Exactly what a card may carry. A card with any other field is refused, not trimmed. */
export const CARD_FIELDS = ['callsign', 'region', 'doing', 'lightning'] as const;

export interface Card {
  /** Never a legal name [invariant 8]. */
  callsign: string;
  /**
   * A directory region slug — the same coarse unit the public directory is organised by.
   *
   * A metro, never a neighbourhood and never an address. The granularity is borrowed
   * rather than invented so there is no second, finer place-taxonomy to be tempted by.
   */
  region: string;
  /** One line, in the operator's own words. Optional, and often the most useful part. */
  doing?: string;
  /**
   * A Lightning address, so support can reach somebody working under a persona.
   *
   * **A string, and nothing more.** This project holds no custody, no keys, no amounts and
   * no payment handling — a seized phone yields an address, not a financial trail, and
   * NavCom can never help with a payment problem because it never sees one.
   *
   * Widening the card's field allowlist is done deliberately here rather than casually. The
   * allowlist exists to keep a *position* off a public artifact, and a payment address is
   * not one: it says where money can arrive, never where a person is.
   *
   * There are no totals anywhere, ever [`product/funding.md`]. Money is a stronger status
   * signal than any badge, and a visible total would rebuild the leaderboard this project
   * deliberately refused.
   */
  lightning?: string;
}

/**
 * Whether a string is a Lightning address — `name@domain`, the LUD-16 shape.
 *
 * Checked so a typo is caught while the operator is looking at it rather than when somebody
 * tries to send them something and it silently fails. It is **not** checked against the
 * network: resolving it would mean this app making a request about somebody's money, which
 * is exactly the surface it refuses to have.
 */
export function isLightningAddress(value: string): boolean {
  const v = value.trim().toLowerCase();
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(v) && v.length <= 120;
}

/** The most a card may say. Long enough for a sentence, short enough not to be a profile. */
export const DOING_MAX = 140;

export class CardError extends Error {}

/**
 * Builds a card, signed by the contact key.
 *
 * Replaceable: publishing again replaces it, so an operator has one card rather than a
 * history of cards.
 */
export function buildCard(
  contactSecret: SecretKey,
  card: Card,
  createdAt: number,
  /**
   * Where else this operator can be found, in rank order.
   *
   * A separate argument rather than a field on `Card`, because `Card` is exactly what gets
   * serialised into `content` and the allowlist there must stay closed. Links ride in tags
   * -- see `links.ts` for why that is the difference between an addition and an outage.
   */
  links: readonly CardLink[] = []
): Event {
  const callsign = card.callsign.trim();
  if (!withinLimit(callsign, CALLSIGN_MAX)) {
    throw new CardError(`A card needs a callsign of ${CALLSIGN_MAX} characters or fewer.`);
  }
  if (!/^[a-z0-9-]+$/.test(card.region)) throw new CardError('A card needs a region.');

  const doing = card.doing?.trim();
  if (doing && doing.length > DOING_MAX) {
    throw new CardError(`Keep it to ${DOING_MAX} characters.`);
  }

  const content: Card = { callsign, region: card.region };
  if (doing) content.doing = doing;
  if (card.lightning) {
    if (!isLightningAddress(card.lightning)) throw new CardError('That is not a Lightning address.');
    content.lightning = card.lightning.trim().toLowerCase();
  }

  return finalizeEvent(
    {
      kind: KIND_CARD,
      created_at: createdAt,
      // Unencrypted, and tagged by region so a client can ask one relay for one metro
      // rather than pulling every card on the network to filter locally.
      tags: [['d', card.region], ...linkTags(links)],
      content: JSON.stringify(content)
    },
    contactSecret
  );
}

export interface PublishedCard {
  /** The contact key that signed it. What an invite is addressed to. */
  contact: string;
  card: Card;
  /**
   * Where else they say they can be found, in the order they published.
   *
   * Empty for every card written before this existed, and for every operator who chose not
   * to say -- which is the default and is not an incomplete card. **Each one is a claim**:
   * a handle here means the holder of this contact key typed it, and nothing more, unless
   * it carries a proof that a reader has actually checked.
   */
  links: CardLink[];
  at: number;
}

/**
 * Reads a card, or returns null.
 *
 * Null rather than throwing, for the same reason as everywhere else: a relay serves
 * whatever it likes and one bad card must not empty a screen.
 */
export function readCard(event: Event): PublishedCard | null {
  if (event.kind !== KIND_CARD) return null;
  if (!verifyEvent(event)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(event.content);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;

  // Refused, not trimmed. A card carrying a field this version does not know about is a
  // card written by something with a different idea of what a card is -- and the field
  // somebody will eventually try to add here is a coordinate.
  for (const key of Object.keys(c)) {
    if (!(CARD_FIELDS as readonly string[]).includes(key)) return null;
  }

  if (!withinLimit(c.callsign, CALLSIGN_MAX)) return null;
  if (typeof c.region !== 'string' || !/^[a-z0-9-]+$/.test(c.region)) return null;
  if (c.doing !== undefined && (typeof c.doing !== 'string' || c.doing.length > DOING_MAX)) {
    return null;
  }

  if (c.lightning !== undefined && (typeof c.lightning !== 'string' || !isLightningAddress(c.lightning))) {
    return null;
  }

  const card: Card = { callsign: c.callsign.trim(), region: c.region };
  if (c.doing) card.doing = c.doing;
  if (c.lightning) card.lightning = String(c.lightning);
  // Never null and never throwing: a malformed link is dropped, and one of those must not
  // cost an operator their place on a board.
  return { contact: event.pubkey, card, links: readLinks(event.tags), at: event.created_at };
}

/**
 * *"Raven is out tonight."*
 *
 * A name and a region. **Not a count, not a pin, and not a duration** — a count invites
 * gaming and tells a reader nothing, a pin is the thing no setting may ever publish, and a
 * duration is a schedule.
 *
 * Ephemeral, so nobody accumulates a record of which nights an operator works. It exists so
 * that somebody opening the app in a city can see the network is real and in use, which is
 * a genuine need met here in the cheapest honest way.
 */
export function buildPublicPresence(
  contactSecret: SecretKey,
  region: string,
  createdAt: number
): Event {
  return finalizeEvent(
    {
      kind: KIND_PUBLIC_PRESENCE,
      created_at: createdAt,
      tags: [['d', region]],
      // Deliberately empty. The callsign is not repeated here -- a reader resolves this
      // against the card the same key signed, so there is exactly one place a callsign
      // lives and no way for the two to disagree.
      content: ''
    },
    contactSecret
  );
}

/** The contact key of somebody out in this region, or null. */
export function readPublicPresence(event: Event, region: string): string | null {
  if (event.kind !== KIND_PUBLIC_PRESENCE) return null;
  if (event.content !== '') return null;
  if (event.tags.find((t) => t[0] === 'd')?.[1] !== region) return null;
  if (!verifyEvent(event)) return null;
  return event.pubkey;
}
