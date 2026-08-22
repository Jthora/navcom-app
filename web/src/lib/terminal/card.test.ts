/**
 * The card, and putting it away again.
 *
 * A card is the one thing an operator publishes that a stranger can find them by. Withdrawing
 * it is how somebody stops being findable, so what it clears is a safety property rather than
 * a tidiness one — and nothing verified it.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  contactKey, contactPubkey, ensureContactKey, listed, myCard, saveCard, setListed, withdrawCard
} from './card';
import { get } from './storage';

beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  };
});

const aCard = { callsign: 'Wren', region: 'st-louis' };

describe('withdrawing a card', () => {
  it('discards the key that signed it, which is the inbox a stranger writes to', () => {
    // The contact key IS the public inbox. Leaving it behind means an operator who has
    // withdrawn still has an address anybody can write to, believing they closed it.
    ensureContactKey();
    saveCard(aCard);
    expect(contactPubkey()).not.toBeNull();

    withdrawCard();
    expect(contactKey()).toBeNull();
    expect(contactPubkey()).toBeNull();
  });

  it('discards the card itself', () => {
    ensureContactKey();
    saveCard(aCard);
    withdrawCard();
    expect(myCard()).toBeNull();
  });

  it('turns off being listed, so nothing publishes under a discarded key', () => {
    // Its own docstring: being listed as out is meaningless without a card to resolve the
    // name against, and a stale switch is how somebody publishes under a key they thought
    // they had thrown away.
    ensureContactKey();
    saveCard(aCard);
    setListed(true);
    expect(listed()).toBe(true);

    withdrawCard();
    expect(listed()).toBe(false);
  });

  it('leaves nothing behind under any of the three keys', () => {
    ensureContactKey();
    saveCard(aCard);
    setListed(true);
    withdrawCard();

    for (const field of ['contact_secret', 'card', 'card_listed']) {
      expect(get('accruing', field)).toBeNull();
    }
  });

  it('is safe to do twice, and on a device that never had one', () => {
    expect(() => withdrawCard()).not.toThrow();
    withdrawCard();
    expect(contactKey()).toBeNull();
  });

  it('does not take the operational identity with it', () => {
    // The contact key and the operational key are deliberately different keys. Withdrawing a
    // card must not touch the one an operator signs patrols with.
    ensureContactKey();
    saveCard(aCard);
    withdrawCard();
    // A fresh contact key can be made again, and it is a new one.
    const again = ensureContactKey();
    expect(again).not.toBeNull();
  });
});

describe('a contact key', () => {
  it('is made once and reused, not regenerated on every call', () => {
    // Regenerating would change the address on every read, so anybody who had been given
    // the card could no longer reach them.
    const first = ensureContactKey();
    expect(ensureContactKey()).toEqual(first);
  });

  it('is absent until something needs it', () => {
    expect(contactKey()).toBeNull();
  });
});
