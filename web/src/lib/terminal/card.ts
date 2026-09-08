/**
 * Your card, and the key that signs it.
 *
 * An operator has none of this by default and is complete without it. Publishing a card is
 * the only thing in this app that creates a permanent public artifact, so it is a deliberate
 * act, reversible only in the honest sense described below.
 *
 * ## The contact key
 *
 * A second keypair, generated the first time a card is published, whose only jobs are to
 * sign the card and to receive invites. It is never a presence recipient and never known to
 * a watch — see `@navcom/core`'s `events/public.ts` for why that separation is what makes a
 * card safe to publish at all.
 *
 * **Withdrawing discards it.** The card stays on whatever relays kept it — nothing can
 * unpublish it, and the screen says so — but it now names a key nobody holds and nobody
 * listens on. Invites sent to it go nowhere. That is the strongest true version of
 * withdrawal, and the app must not imply a stronger one.
 *
 * Accruing tier: a card outlasts a night, and losing it to a panic wipe would mean
 * republishing under a new key while the old one sits there looking live.
 */

import {
  newSecretKey,
  publicKeyOf,
  secretFromHex,
  secretToHex,
  type CardLink,
  type SecretKey,
  type Visibility
} from '@navcom/core';
import { clearField, get, set } from './storage';

const SECRET = 'contact_secret';
const CARD = 'card';
const LISTED = 'card_listed';

export interface MyCard {
  /** A directory region slug. The same coarse unit the public directory uses. */
  region: string;
  /** One line, optional, in the operator's own words. */
  doing?: string;
  /**
   * Whether the card goes onto its region's board.
   *
   * Stored so the choice survives a replace -- an operator who went address-only and then
   * edited their line must not be quietly put back on the board by the edit.
   */
  visibility?: Visibility;
  /** What they say they do. At most `DOES_MAX`, from a closed vocabulary. */
  does?: string[];
  /**
   * Where else they can be found, in rank order.
   *
   * Held here rather than derived from the published event because an operator editing their
   * card offline still has to see what they published.
   */
  links?: CardLink[];
}

/** The contact key, or null for an operator who has never published a card. */
export function contactKey(): SecretKey | null {
  const hex = get<string>('accruing', SECRET);
  if (!hex) return null;
  try {
    return secretFromHex(hex);
  } catch {
    return null;
  }
}

/** The public address on your card. Null when there is no card. */
export function contactPubkey(): string | null {
  const secret = contactKey();
  return secret ? publicKeyOf(secret) : null;
}

/**
 * The contact key, generating one if this is the first card.
 *
 * Separate from `contactKey` so that merely *reading* state can never bring a public
 * identity into existence. Only publishing does that.
 */
export function ensureContactKey(): SecretKey {
  const existing = contactKey();
  if (existing) return existing;
  const secret = newSecretKey();
  set('accruing', SECRET, secretToHex(secret));
  return secret;
}

/** What you have published, or null. */
export function myCard(): MyCard | null {
  return get<MyCard>('accruing', CARD);
}

export function saveCard(card: MyCard): void {
  set('accruing', CARD, card);
}

/**
 * Discards the card and the key that signed it.
 *
 * Also clears `listed`, because being listed as out is meaningless without a card to
 * resolve the name against — and leaving a stale switch on is how somebody ends up
 * publishing under a key they thought they had thrown away.
 */
export function withdrawCard(): void {
  clearField('accruing', SECRET);
  clearField('accruing', CARD);
  clearField('accruing', LISTED);
}

/**
 * Whether to publish *"out tonight"* in your region while signed on.
 *
 * Off unless deliberately turned on, and it requires a card: `listed()` is false without
 * one regardless of what is stored, so the two cannot drift into a state where an operator
 * broadcasts under a key they have discarded.
 */
export function listed(): boolean {
  return myCard() !== null && contactKey() !== null && get<boolean>('accruing', LISTED) === true;
}

export function setListed(on: boolean): void {
  set('accruing', LISTED, on);
}
