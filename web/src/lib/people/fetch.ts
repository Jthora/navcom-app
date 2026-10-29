/**
 * Asking relays for cards, on a tap and never otherwise [docs/design/groups.md §3, §4].
 *
 * Each ask names what a relay needs and nothing typed: one contact key for a profile's *Fetch
 * newest*, one region for a board, the public label for the roster. What comes back goes into the
 * session's card cache, in memory only. Each closes at the end of stored events.
 */
import type { Event } from 'nostr-tools/core';
import type { Filter } from 'nostr-tools/filter';
import { KIND_CARD, PUBLIC_LABEL } from '@navcom/core/card';
import { isHidden } from '$lib/hidden';
import { relays } from '$lib/terminal/relays';
import { subscribeLive } from '$lib/terminal/subscribe';
import { remember } from './cache.svelte';

/** What an ask found: cards kept, and whether any relay answered at all [invariant 7]. */
export interface Asked {
  cards: number;
  answered: boolean;
}

/** The public roster's cap, as the site's own roster has it: past it, the list is partial and says so. */
export const ROSTER_MAX = 500;

function ask(filter: Filter, max = Infinity): Promise<Asked> {
  const urls = relays();
  if (urls.length === 0) return Promise.resolve({ cards: 0, answered: false });
  return new Promise((resolve) => {
    // By key: two relays, or one holding an older card beside the newest, hand the same person twice.
    const cards = new Set<string>();
    let done = false;
    let sub: { close(): void } | null = null;
    sub = subscribeLive(urls, filter, {
      onevent: (event: Event) => {
        if (cards.size >= max && !cards.has(event.pubkey)) return;
        const card = remember(event);
        if (card) cards.add(card.contact);
      },
      oneose: (answered) => {
        if (done) return;
        done = true;
        // Called before `subscribeLive` returns when nothing can be asked: close once it has.
        queueMicrotask(() => sub?.close());
        resolve({ cards: cards.size, answered: answered > 0 });
      }
    });
  });
}

/**
 * One card, the newest a relay holds for this contact key. The relays learn that this phone asked.
 * A key navcom.app does not display is never asked for, whichever screen asks [groups.md §3].
 */
export const fetchCard = (contact: string): Promise<Asked> =>
  isHidden(contact) ? Promise.resolve({ cards: 0, answered: false }) : ask({ kinds: [KIND_CARD], authors: [contact], limit: 1 });

/** A city's board, as `/terminal/find` asks for it: the region, never a person, never what was typed. */
export const fetchBoard = (region: string) => ask({ kinds: [KIND_CARD], '#d': [region] });

/** The cards listed publicly, capped as the site's roster is. */
export const fetchRoster = () => ask({ kinds: [KIND_CARD], '#l': [PUBLIC_LABEL] }, ROSTER_MAX);
