/**
 * Where an operator says they are, on their card [events/area.ts; owner, 2026-10-27]: Earth unless they
 * choose, and then one place on each of two ladders, at the level they chose.
 */
import { describe, expect, it } from 'vitest';
import { generateSecretKey } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import { CardError, EARTH, buildCard, buildPublicPresence, readAreas, readCard, type Card, type CardArea } from '../src/index.js';

const contact = generateSecretKey();
const T = 1_755_300_000;
const overRelay = (event: Event): Event => JSON.parse(JSON.stringify(event)) as Event;
const card = (over: Partial<Card> = {}): Card => ({ callsign: 'Raven', region: EARTH, ...over });
const tagsOf = (e: Event, name: string) => e.tags.filter((t) => t[0] === name);

const SECTOR: CardArea = { level: 'sector', id: 'zone:east-african-rift/sector:afar', name: 'Afar Sector' };
const MISSOURI: CardArea = { level: 'province', id: 'us-mo', name: 'Missouri' };

describe('a card that names nowhere finer than Earth', () => {
  it('is a card, readable by any build, its region the word Earth', () => {
    const read = readCard(overRelay(buildCard(contact, card(), T, { visibility: 'address' })));
    expect(read?.card.region).toBe(EARTH);
    expect(readAreas([], EARTH)).toEqual([]);
  });

  it('is on no board: there is no board called Earth, and asking for one is refused, not quietly changed', () => {
    const address = buildCard(contact, card(), T, { visibility: 'address' });
    expect(tagsOf(address, 'd')).toEqual([]);
    expect(() => buildCard(contact, card(), T, { visibility: 'board' })).toThrow(CardError);
    // Anyone, anywhere is navcom.app's own list, by its label, and still no board.
    const open = buildCard(contact, card(), T, { visibility: 'public' });
    expect(tagsOf(open, 'd')).toEqual([]);
    expect(readCard(overRelay(open))?.visibility).toBe('public');
  });
});

describe('a card that names a place', () => {
  it('carries one place on each ladder beside its content, which stays as every build reads it', () => {
    const e = buildCard(contact, card(), T, { visibility: 'address', areas: [MISSOURI, SECTOR] });
    expect(tagsOf(e, 'area')).toEqual([
      ['area', 'province', 'us-mo', 'Missouri'],
      ['area', 'sector', 'zone:east-african-rift/sector:afar', 'Afar Sector']
    ]);
    expect(JSON.parse(e.content)).toEqual({ callsign: 'Raven', region: EARTH });
    expect(readAreas(overRelay(e).tags, EARTH)).toEqual([MISSOURI, SECTOR]);
  });

  it('names its city as its region, and only its region, and so may be on its board', () => {
    const city: CardArea = { level: 'city', id: 'st-louis', name: 'St. Louis metro' };
    const e = buildCard(contact, card({ region: 'st-louis' }), T, { visibility: 'board', areas: [city] });
    expect(tagsOf(e, 'd')).toEqual([['d', 'st-louis']]);
    expect(readAreas(e.tags, 'st-louis')).toEqual([city]);
    expect(() => buildCard(contact, card({ region: 'st-louis' }), T, { areas: [{ level: 'city', id: 'chicago', name: null }] })).toThrow(CardError);
  });

  it('refuses two places on one ladder, a level it does not know, and an id not in its level’s form', () => {
    const two = [MISSOURI, { level: 'nation', id: 'us', name: null } as CardArea];
    expect(() => buildCard(contact, card(), T, { visibility: 'address', areas: two })).toThrow(CardError);
    expect(() => buildCard(contact, card(), T, { visibility: 'address', areas: [{ level: 'street', id: 'x', name: null } as unknown as CardArea] })).toThrow(CardError);
    expect(() => buildCard(contact, card(), T, { visibility: 'address', areas: [{ level: 'zone', id: 'East African Rift', name: null }] })).toThrow(CardError);
    expect(() => buildCard(contact, card(), T, { visibility: 'address', areas: [{ level: 'nation', id: 'usa', name: null }] })).toThrow(CardError);
  });

  it('reads what another client wrote as claims: the first on each ladder, never a city but its own region, and never the card', () => {
    const tags = [
      ['area', 'nation', 'us', 'United States'],
      ['area', 'province', 'us-mo', 'Missouri'],
      ['area', 'street', 'main-st'],
      ['area', 'zone', 'not a zone'],
      ['area', 'zone', 'zone:pacific-ring-of-fire', 'Pacific Ring of Fire Zone'],
      ['area', 'sector', 'zone:x/sector:y']
    ];
    expect(readAreas(tags, EARTH)).toEqual([
      { level: 'nation', id: 'us', name: 'United States' },
      { level: 'zone', id: 'zone:pacific-ring-of-fire', name: 'Pacific Ring of Fire Zone' }
    ]);
    expect(readAreas([['area', 'city', 'chicago']], EARTH)).toEqual([]);
    // A name is one line, and one too long to be a name is dropped, never cut.
    expect(readAreas([['area', 'nation', 'us', 'United‮\nStates']], EARTH)[0]?.name).toBe('United States');
    expect(readAreas([['area', 'nation', 'us', 'x'.repeat(81)]], EARTH)[0]?.name).toBeNull();
  });

  it('reads a card from before these tags as naming its region as its city, as it always did', () => {
    expect(readAreas([['d', 'st-louis']], 'st-louis')).toEqual([{ level: 'city', id: 'st-louis', name: null }]);
    expect(readAreas([['area', 'zone', 'zone:a']], 'st-louis')).toEqual([
      { level: 'city', id: 'st-louis', name: null },
      { level: 'zone', id: 'zone:a', name: null }
    ]);
  });
});

describe('out tonight', () => {
  it('is said on a city’s board, and Earth has none', () => {
    expect(() => buildPublicPresence(contact, EARTH, T)).toThrow(CardError);
    expect(tagsOf(buildPublicPresence(contact, 'st-louis', T), 'd')).toEqual([['d', 'st-louis']]);
  });
});
