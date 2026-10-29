/**
 * The session card cache and the asks that fill it [docs/design/groups.md §3, §4].
 *
 * The rules here are about what leaves the phone and what stays on it: a hidden key is never asked
 * for, an ask names a key, a city or the public label and nothing else, and a person is named in
 * history by a handle that means nothing once a wipe has run. What is written to storage is checked
 * against the built site instead [e2e/people.spec.ts].
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from 'nostr-tools/core';
import { KIND_CARD, buildCard, newSecretKey, publicKeyOf } from '@navcom/core';

const h = vi.hoisted(() => ({
  hidden: new Set<string>(),
  /** Every filter an ask sent, in order. */
  asked: [] as unknown[],
  /** What the relay hands back to any ask. */
  canned: [] as Event[],
  wipe: null as null | (() => void)
}));

vi.mock('$lib/hidden', () => ({ isHidden: (key: string) => h.hidden.has(key) }));
vi.mock('$lib/terminal/relays', () => ({ relays: () => ['wss://r'] }));
vi.mock('$lib/terminal/storage', () => ({ onWipe: (f: () => void) => void (h.wipe = f) }));
vi.mock('$lib/terminal/subscribe', () => ({
  subscribeLive: (
    _urls: string[],
    filter: unknown,
    on: { onevent: (e: Event) => void; oneose: (answered: number) => void }
  ) => {
    h.asked.push(filter);
    for (const e of h.canned) on.onevent(e);
    on.oneose(1);
    return { close() {} };
  }
}));

const { fetchBoard, fetchCard } = await import('./fetch');
const { contactOf, handleFor, seen } = await import('./cache.svelte');

const REGION = 'st-louis';
function card(callsign: string, at: number, secret = newSecretKey()) {
  return { event: buildCard(secret, { callsign, region: REGION }, at, { visibility: 'board' }), contact: publicKeyOf(secret), secret };
}

beforeEach(() => {
  h.hidden.clear();
  h.asked.length = 0;
  h.canned = [];
  h.wipe?.();
});

describe('asking relays for cards', () => {
  it('never asks for a key navcom.app does not display', async () => {
    const { contact } = card('Raven', 1_800_000_000);
    h.hidden.add(contact);
    expect(await fetchCard(contact)).toEqual({ cards: 0, answered: false });
    expect(h.asked).toEqual([]);
  });

  it('asks for one card by its key, and names nothing else', async () => {
    const { contact } = card('Raven', 1_800_000_000);
    await fetchCard(contact);
    expect(h.asked).toEqual([{ kinds: [KIND_CARD], authors: [contact], limit: 1 }]);
  });

  it('asks for a board by its city alone', async () => {
    await fetchBoard(REGION);
    expect(h.asked).toEqual([{ kinds: [KIND_CARD], '#d': [REGION] }]);
  });
});

describe('the session card cache', () => {
  it('keeps the newest card for each key, and never a hidden one', async () => {
    const raven = card('Raven', 1_800_000_000);
    const older = card('Raven-old', 1_799_000_000, raven.secret);
    const hidden = card('Crow', 1_800_000_000);
    h.hidden.add(hidden.contact);
    h.canned = [raven.event, older.event, hidden.event];

    expect(await fetchBoard(REGION)).toEqual({ cards: 1, answered: true });
    expect(seen(raven.contact)?.card.card.callsign).toBe('Raven');
    expect(seen(hidden.contact)).toBeNull();
  });

  it('names a person by a random handle, and forgets both on a wipe', async () => {
    const raven = card('Raven', 1_800_000_000);
    h.canned = [raven.event];
    await fetchCard(raven.contact);

    const handle = handleFor(raven.contact);
    expect(handle).toMatch(/^[0-9a-f]{16}$/);
    expect(raven.contact.includes(handle)).toBe(false);
    expect(handleFor(raven.contact)).toBe(handle);
    expect(contactOf(handle)).toBe(raven.contact);

    h.wipe?.();
    expect(contactOf(handle)).toBeNull();
    expect(seen(raven.contact)).toBeNull();
  });
});
