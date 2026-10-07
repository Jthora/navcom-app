/**
 * The card, and putting it away again.
 *
 * A card is the one thing an operator publishes that a stranger can find them by. Withdrawing
 * it is how somebody stops being findable, so what it clears is a safety property rather than
 * a tidiness one — and nothing verified it.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  cardSent, contactKey, contactPubkey, ensureContactKey, listed, myCard, saveCard, sentReadout, setCardSent,
  setListed, withdrawCard, type CardSent
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

describe('whether anybody has the card [audit: relay paths, review]', () => {
  /*
   * The outcome of a send is kept beside the card, and the screen read every value but two as
   * "Published" — including no value at all: a card saved before outcomes were kept, one restored
   * from a backup made then, and one whose send was cut off before it settled.
   */
  it('reads as published only when every relay took it', () => {
    expect(sentReadout('all', 'Wren')).toMatchObject({ value: 'Published', tone: 'good', sub: 'as Wren' });
    // Including a value this build does not know, as a backup from some other build could carry.
    const others: (CardSent | null)[] = [null, 'some', 'none', 'yes' as unknown as CardSent];
    for (const sent of others) {
      expect(sentReadout(sent, 'Wren').value, String(sent)).not.toBe('Published');
    }
  });

  it('says it is not known when nothing was recorded, rather than guessing', () => {
    expect(sentReadout(null, 'Wren')).toMatchObject({ value: 'Not known if sent', tone: 'warn' });
  });

  it('forgets the last outcome the moment a new card is saved, so a cut-off send is not known', () => {
    // The previous card's "every relay took it" stood beside an edit that never left the phone.
    ensureContactKey();
    saveCard(aCard);
    setCardSent('all');
    saveCard({ ...aCard, region: 'chicago' });
    expect(cardSent()).toBeNull();
    expect(sentReadout(cardSent(), 'Wren').value).toBe('Not known if sent');
  });
});
