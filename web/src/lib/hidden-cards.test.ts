/**
 * The hide list reaches every place a card is read, not only the one somebody remembered.
 *
 * `hidden.ts` is expected to be empty, and a filter over an empty list passes every test
 * whether or not it is wired in. So these replace the list with one key and feed real signed
 * cards through the relay subscription each store opens: the area board, the public roster,
 * and a single operator's card.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCard, newSecretKey, publicKeyOf, type SecretKey } from '@navcom/core';

const relay = vi.hoisted(() => ({ handlers: null as null | { onevent: (e: unknown) => void } }));
const hiddenKeys = vi.hoisted(() => new Set<string>());

vi.mock('./hidden', () => ({
  isHidden: (k: string) => hiddenKeys.has(k),
  hiddenOn: (k: string) => (hiddenKeys.has(k) ? '2026-09-12' : null)
}));
vi.mock('./terminal/relays', () => ({ relays: () => ['wss://fake.relay'] }));
vi.mock('./terminal/pq.svelte', () => ({ kemKeys: () => ({}) }));
vi.mock('./terminal/pool', () => ({
  pool: () => ({
    subscribeMany: (_urls: string[], _filter: unknown, handlers: { onevent: (e: unknown) => void }) => {
      relay.handlers = handlers;
      return { close: () => {} };
    },
    publish: () => [Promise.resolve('ok')]
  })
}));

const at = Math.floor(Date.now() / 1000);
const cardFrom = (secret: SecretKey) =>
  buildCard(secret, { callsign: 'Raven', region: 'st-louis', doing: 'Water, Thursdays.' }, at, {
    visibility: 'public'
  });

let hidden: SecretKey;
let shown: SecretKey;

beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  };
  relay.handlers = null;
  hiddenKeys.clear();
  hidden = newSecretKey();
  shown = newSecretKey();
  hiddenKeys.add(publicKeyOf(hidden));
  vi.resetModules();
});

const deliver = (...events: unknown[]) => {
  expect(relay.handlers, 'the store never opened a subscription').not.toBeNull();
  for (const e of events) relay.handlers!.onevent(e);
};

describe('a card navcom.app will not display', () => {
  it('never reaches an area board', async () => {
    const { board } = await import('./terminal/public.svelte');
    board.watch('st-louis');
    deliver(cardFrom(hidden), cardFrom(shown));
    expect(board.entries.map((e) => e.contact)).toEqual([publicKeyOf(shown)]);
  });

  it('never reaches the public roster', async () => {
    const { publicRoster } = await import('./public-roster.svelte');
    publicRoster.start();
    deliver(cardFrom(hidden), cardFrom(shown));
    expect(publicRoster.entries.map((e) => e.contact)).toEqual([publicKeyOf(shown)]);
  });

  it('never loads as a single card, even when asked for by its key', async () => {
    const { profile } = await import('./terminal/public.svelte');
    profile.watch(publicKeyOf(hidden));
    // The page does not ask for a hidden key at all; this is the store refusing it anyway, so a
    // second caller cannot forget to.
    if (relay.handlers) deliver(cardFrom(hidden));
    expect(profile.card).toBeNull();
  });

  it('leaves every other card alone', async () => {
    const { profile } = await import('./terminal/public.svelte');
    profile.watch(publicKeyOf(shown));
    deliver(cardFrom(shown));
    expect(profile.card?.contact).toBe(publicKeyOf(shown));
  });
});
