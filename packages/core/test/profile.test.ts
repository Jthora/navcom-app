/**
 * Who can find a card, and what its holder says they do.
 *
 * The visibility block is mostly one assertion said several ways: `address` has to be a
 * property of the published event, not a request that some other client honours. So the
 * tests build a real card and run a real board filter over it, rather than checking that a
 * flag was set — a flag would pass while every relay on earth served the card to the board
 * anyway.
 */

import { describe, expect, it } from 'vitest';
import { generateSecretKey } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import {
  buildCard,
  DEFAULT_VISIBILITY,
  PUBLIC_LABEL,
  DOES,
  DOES_MAX,
  doesTags,
  isDoes,
  readCard,
  readDoes,
  readVisibility,
  VISIBILITIES,
  VISIBILITY_CHOICES,
  type Card
} from '../src/index.js';

const contact = generateSecretKey();
const T = 1_755_300_000;
const card: Card = { callsign: 'Raven', region: 'st-louis', doing: 'Water and socks, Thursdays.' };
const overRelay = (event: Event): Event => JSON.parse(JSON.stringify(event)) as Event;

/**
 * The board's subscription, applied by hand.
 *
 * This is the filter `public.svelte.ts` actually sends: one kind, one region, matched on the
 * `#d` tag. Reimplemented here because the assertion that matters is what a *relay* would
 * return, and a relay matches tags — it does not read our types.
 */
const boardWouldServe = (event: Event, region: string): boolean =>
  event.tags.some((t) => t[0] === 'd' && t[1] === region);

describe('address-only is a property of the event, not a request', () => {
  it('a board card matches the board filter', () => {
    const event = overRelay(buildCard(contact, card, T, { visibility: 'board' }));
    expect(boardWouldServe(event, 'st-louis')).toBe(true);
  });

  it('an address-only card cannot match it, because the tag is simply not there', () => {
    const event = overRelay(buildCard(contact, card, T, { visibility: 'address' }));
    expect(boardWouldServe(event, 'st-louis')).toBe(false);
    expect(event.tags.some((t) => t[0] === 'd')).toBe(false);
  });

  it('is still a readable card, fetchable by whoever has the address', () => {
    const read = readCard(overRelay(buildCard(contact, card, T, { visibility: 'address' })));
    expect(read).not.toBeNull();
    expect(read!.card.callsign).toBe('Raven');
    expect(read!.visibility).toBe('address');
  });

  it('still says which metro, because address-only is not secret and must not read as it', () => {
    const read = readCard(overRelay(buildCard(contact, card, T, { visibility: 'address' })));
    expect(read!.card.region).toBe('st-louis');
  });

  it('defaults to the board — publishing at all is the deliberate act', () => {
    const read = readCard(overRelay(buildCard(contact, card, T)));
    expect(read!.visibility).toBe(DEFAULT_VISIBILITY);
    expect(read!.visibility).toBe('board');
  });

  it('reads visibility off the tags rather than off any claim inside the card', () => {
    // A card whose content said one thing and whose tags said another would be a card that
    // lies to its holder about who can see it. There is nowhere for such a claim to live.
    expect(readVisibility([['d', 'st-louis']])).toBe('board');
    expect(readVisibility([['i', 'tiktok:raven', '']])).toBe('address');
    expect(readVisibility([])).toBe('address');
  });

  it('offers exactly the tiers that are true', () => {
    expect(VISIBILITIES).toEqual(['public', 'board', 'address']);
    expect(VISIBILITY_CHOICES.map((c) => c.value)).toEqual([...VISIBILITIES]);
  });

  it('never describes address-only as private, hidden or restricted', () => {
    // There is no account and no gatekeeper, so a relay serves this card to anyone who asks.
    // Any word implying otherwise would be the thing invariant 4 exists to forbid.
    const words = VISIBILITY_CHOICES.map((c) => `${c.label} ${c.audience}`).join(' ');
    /*
     * The affirmative claim is what is forbidden, not the vocabulary. An honest sentence
     * needs the word `secret` in order to deny it, and the first version of this assertion
     * banned the word outright and failed on the copy it was written to protect.
     */
    expect(words).not.toMatch(/\bis (private|hidden|secret)\b/i);
    expect(words).not.toMatch(/keeps? (it|this|your card) (private|hidden|secret)/i);
    expect(words).not.toMatch(/only registered|members only|signed-in only|hidden from/i);
    // And it must say the true thing out loud.
    expect(VISIBILITY_CHOICES.find((c) => c.value === 'address')!.audience).toMatch(
      /still published/i
    );
    expect(VISIBILITY_CHOICES.find((c) => c.value === 'address')!.audience).toMatch(
      /does not make it secret/i
    );
  });
});

describe('public is a superset of the board, not a move', () => {
  it('carries the region tag as well as the label, so a public card is still on its board', () => {
    const event = overRelay(buildCard(contact, card, T, { visibility: 'public' }));
    expect(event.tags).toContainEqual(['d', 'st-louis']);
    expect(event.tags).toContainEqual(['l', PUBLIC_LABEL]);
    expect(boardWouldServe(event, 'st-louis'), 'choosing public must not delist you').toBe(true);
  });

  it('reads back as public rather than as board', () => {
    const read = readCard(overRelay(buildCard(contact, card, T, { visibility: 'public' })));
    expect(read!.visibility).toBe('public');
  });

  it('uses a single-letter tag, because a relay indexes nothing else', () => {
    /*
     * NIP-01: only single-letter tags are queryable. A longer name would force the public
     * roster to download every card on the relay -- including every card whose author chose
     * not to be on it -- and filter locally.
     */
    const event = buildCard(contact, card, T, { visibility: 'public' });
    const label = event.tags.find((t) => t[1] === PUBLIC_LABEL)!;
    expect(label[0]).toHaveLength(1);
    expect(label[0]).toMatch(/^[a-zA-Z]$/);
  });

  it('is namespaced, so it cannot collide with another app’s labels', () => {
    expect(PUBLIC_LABEL).toContain(':');
    expect(PUBLIC_LABEL.startsWith('navcom:')).toBe(true);
  });

  it('leaves board and address unlabelled, so neither is served by a public query', () => {
    for (const v of ['board', 'address'] as const) {
      const event = buildCard(contact, card, T, { visibility: v });
      expect(event.tags.some((t) => t[0] === 'l' && t[1] === PUBLIC_LABEL), v).toBe(false);
    }
  });

  it('still defaults to the board, because being on the open web is a further step', () => {
    expect(DEFAULT_VISIBILITY).toBe('board');
    expect(readCard(overRelay(buildCard(contact, card, T)))!.visibility).toBe('board');
  });
});

describe('what an operator says they do', () => {
  it('rides as ordinary t tags, so a reader that does not care ignores them', () => {
    const event = buildCard(contact, card, T, { does: ['patrol', 'supplies'] });
    expect(event.tags).toContainEqual(['t', 'patrol']);
    expect(event.tags).toContainEqual(['t', 'supplies']);
  });

  it('round-trips in the order it was published', () => {
    const read = readCard(overRelay(buildCard(contact, card, T, { does: ['supplies', 'patrol'] })));
    expect(read!.does).toEqual(['supplies', 'patrol']);
  });

  it('gives a card that says nothing an empty list rather than undefined', () => {
    expect(readCard(overRelay(buildCard(contact, card, T)))!.does).toEqual([]);
  });

  it('drops a term this build does not know, rather than rendering a word it cannot explain', () => {
    const read = readCard(overRelay(buildCard(contact, card, T, { does: ['hero', 'patrol'] })));
    expect(read!.does).toEqual(['patrol']);
  });

  it('drops a duplicate rather than counting it twice', () => {
    expect(readDoes([['t', 'patrol'], ['t', 'patrol']])).toEqual(['patrol']);
  });

  it('is case-insensitive on the way in and lowercase on the way out', () => {
    expect(readDoes([['t', 'PATROL']])).toEqual(['patrol']);
    expect(doesTags(['Patrol'])).toEqual([['t', 'patrol']]);
  });

  it('stops at the cap, so a card cannot claim everything', () => {
    const all = DOES.map((d) => d.id);
    expect(all.length).toBeGreaterThan(DOES_MAX);
    expect(readCard(overRelay(buildCard(contact, card, T, { does: all })))!.does).toHaveLength(DOES_MAX);
  });

  it('never takes the card down with a bad term', () => {
    const read = readCard(overRelay(buildCard(contact, card, T, { does: ['nonsense'] })));
    expect(read).not.toBeNull();
    expect(read!.does).toEqual([]);
  });
});

describe('the vocabulary itself', () => {
  it('has no duplicate ids and no id that could collide with a tag value', () => {
    const ids = DOES.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+$/);
  });

  it('claims no competence anywhere, because nobody checks a card', () => {
    /*
     * The rule this vocabulary is built on. A self-asserted `medic` is an unverified
     * competence claim, and somebody choosing a medic off a roster at 2am is the Medic's
     * kill trigger. Vouching is what a credential is for; a tag cannot do it and must not
     * look like it can.
     */
    const text = DOES.map((d) => `${d.id} ${d.label} ${d.means}`).join(' ');
    expect(text).not.toMatch(/\bmedic\b|\bnurse\b|\bdoctor\b|\bemt\b|\bparamedic\b/i);
    expect(text).not.toMatch(/certified|licensed|qualified|trained professional/i);
    // The one term nearest the line says what it actually means.
    expect(DOES.find((d) => d.id === 'firstaid')!.means).toMatch(/not a claim of training/i);
  });

  it('describes every term, so a picker never shows a bare word', () => {
    for (const d of DOES) {
      expect(d.label.length, d.id).toBeGreaterThan(0);
      expect(d.means.length, d.id).toBeGreaterThan(0);
      expect(d.means.trim().endsWith('.'), `${d.id} should read as a sentence`).toBe(true);
    }
  });

  it('agrees with isDoes about what it contains', () => {
    for (const d of DOES) expect(isDoes(d.id)).toBe(true);
    expect(isDoes('hero')).toBe(false);
  });
});
