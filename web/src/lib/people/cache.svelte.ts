/**
 * The cards this phone has seen this session, and the handles Com's back stack holds for people
 * [docs/design/groups.md §3].
 *
 * **In memory, never in storage**: a stored cache is a list of whom this phone looked at. Whatever
 * already reads cards fills it — the names on a mission's reports, a profile's own fetch, a city's
 * board or the public roster loaded from Find — and a profile shows what it holds, with when this
 * phone saw it.
 *
 * **A screen that names a person holds a random handle in history, never a key.** Browser history
 * survives a panic wipe and a burn [declined.md, *Protection from someone holding your unlocked
 * phone*], so the key sits here, in a map the wipe clears; a screen reached by Back after a wipe or a
 * reload reads *Not on this phone* and fetches nothing.
 */
import type { Event } from 'nostr-tools/core';
import { MISSION_PUBLISHERS } from '@navcom/core';
import { isAgentCard, readAreas, readCard, type CardArea, type PublishedCard } from '@navcom/core/card';
import { isHidden } from '$lib/hidden';
import { onWipe } from '$lib/terminal/storage';

export interface SeenCard {
  card: PublishedCard;
  /** Where its holder says they are, at the level they chose; none is Earth. */
  areas: CardArea[];
  /** Carries the agent mark [`AGENT_LABEL`], or is signed by a key NavCom ships as an agent's. */
  agent: boolean;
  /** When this phone saw it, in milliseconds. */
  seenAt: number;
}

/** Every key NavCom ships for a publisher it marks as an agent [groups.md §3, *Name*]. */
const AGENT_KEYS = new Set(MISSION_PUBLISHERS.filter((p) => p.agent).flatMap((p) => p.keys.map((k) => k.pubkey)));

const cards = new Map<string, SeenCard>();
const handles = new Map<string, string>();
/** Bumped on every change, for screens to read again. */
let tick = $state(0);

/**
 * Keeps a card this phone was handed, if it is one, is not hidden, and is newer than what is held.
 * Returns it read, or null.
 */
export function remember(event: Event, now = Date.now()): PublishedCard | null {
  const card = readCard(event);
  if (!card || isHidden(card.contact)) return null;
  const was = cards.get(card.contact);
  if (!was || card.at > was.card.at) {
    const agent = isAgentCard(event.tags) || AGENT_KEYS.has(card.contact);
    cards.set(card.contact, { card, areas: readAreas(event.tags, card.card.region), agent, seenAt: now });
    tick += 1;
  }
  return card;
}

/** The newest card seen this session for a contact key, or null. */
export function seen(contact: string): SeenCard | null {
  void tick;
  return cards.get(contact) ?? null;
}

/** Every card seen this session. */
export function seenCards(): SeenCard[] {
  void tick;
  return [...cards.values()];
}

/** The handle a screen naming `contact` keeps in history: random, and meaningful only here. */
export function handleFor(contact: string): string {
  for (const [h, c] of handles) if (c === contact) return h;
  const h = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  handles.set(h, contact);
  return h;
}

/** Who a handle names, or null once a wipe or a reload forgot it. */
export function contactOf(h: string): string | null {
  void tick;
  return handles.get(h) ?? null;
}

onWipe(() => {
  cards.clear();
  handles.clear();
  tick += 1;
});
