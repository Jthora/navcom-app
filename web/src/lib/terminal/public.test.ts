/**
 * Being findable, and only when you asked to be.
 *
 * A public presence says *"somebody is out in this area"* on a relay anybody can read. The
 * switch that turns it on is the whole consent model for this milestone — the Doxxer is a
 * named adversary here — and the guard that honours it had no test.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { newSecretKey, publicKeyOf } from '@navcom/core';

const me = newSecretKey();

/** What actually reached a relay. */
let published: { kind: number }[] = [];

vi.mock('./identity', () => ({
  loadIdentity: () => ({ secretKey: me, pubkey: publicKeyOf(me), callsign: 'Wren' })
}));
vi.mock('./relays', () => ({ relays: () => ['wss://fake.relay'] }));
vi.mock('./pq.svelte', () => ({ kemKeys: () => ({}) }));
vi.mock('./pool', () => ({
  pool: () => ({
    subscribeMany: () => ({ close: () => {} }),
    publish: (_u: string[], e: { kind: number }) => {
      published.push(e);
      return [Promise.resolve('ok')];
    }
  })
}));

let mod: typeof import('./public.svelte');
let card: typeof import('./card');

beforeEach(async () => {
  published = [];
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  };
  vi.resetModules();
  mod = await import('./public.svelte');
  card = await import('./card');
});

describe('announcing that somebody is out here', () => {
  it('says nothing at all unless the operator asked to be listed', async () => {
    // The switch is the consent. Publishing without it announces an operator's area to a
    // public relay when they never asked to be findable.
    card.ensureContactKey();
    card.saveCard({ region: 'st-louis' });
    // Deliberately not listed.
    await mod.announceListed();
    expect(published).toHaveLength(0);
  });

  it('announces once the operator has switched it on', async () => {
    card.ensureContactKey();
    card.saveCard({ region: 'st-louis' });
    card.setListed(true);

    await mod.announceListed();
    expect(published).toHaveLength(1);
  });

  it('stops announcing the moment it is switched off again', async () => {
    card.ensureContactKey();
    card.saveCard({ region: 'st-louis' });
    card.setListed(true);
    card.setListed(false);

    await mod.announceListed();
    expect(published).toHaveLength(0);
  });

  it('says nothing when the card has been withdrawn, even if listed was left on', async () => {
    // Withdrawing clears `listed` too, and this is the belt to that braces: without a card
    // there is nothing to resolve the name against, so an announcement is noise at best.
    card.ensureContactKey();
    card.saveCard({ region: 'st-louis' });
    card.setListed(true);
    card.withdrawCard();

    await mod.announceListed();
    expect(published).toHaveLength(0);
  });
});

describe('publishing a card', () => {
  it('publishes one when there is a callsign to put on it', async () => {
    await mod.publishCard({ region: 'st-louis' });
    expect(published.length).toBeGreaterThan(0);
  });
  it('refuses without a callsign, rather than publishing a nameless one', async () => {
    // The callsign comes from the identity, deliberately — "one callsign, from the identity,
    // rather than a second public name that could drift" — so no identity means no name to
    // put on a card. Declared last,
    // because doMock replaces a module for everything imported after it.
    vi.doMock('./identity', () => ({ loadIdentity: () => null }));
    vi.resetModules();
    const fresh = await import('./public.svelte');
    await fresh.publishCard({ region: 'st-louis' });
    expect(published).toHaveLength(0);
    vi.doUnmock('./identity');
  });

});
