/**
 * The public board for one region: who has a card there, and who is out tonight.
 *
 * This is the fix for cold start. Everything else in this app assumes you already know
 * somebody — you scanned their code, or a watch vouched for them — and the operator this
 * project is actually built around is the one who knows nobody.
 *
 * ## What this is not
 *
 * It is a **bulletin board people pin themselves to**, not a directory of operators the app
 * assembles. Nothing here is derived, suggested, ranked, or inferred from who knows whom:
 *
 * - Every entry exists because that operator published it about themselves
 * - No ordering by activity, proximity, recency of patrol, or anything else that would
 *   reward being visible. Alphabetical, which rewards nothing
 * - **No count.** The board names who is out, or it says nothing. A number invites gaming
 *   and tells a reader nothing they can act on
 * - Nobody appears here by being paired with somebody, and pairing never publishes anything
 */

import type { Event } from 'nostr-tools/core';
import {
  buildCard,
  buildPublicPresence,
  KIND_CARD,
  KIND_PUBLIC_PRESENCE,
  readCard,
  readPublicPresence,
  type PublishedCard
} from '@navcom/core';
import { contactKey, ensureContactKey, listed, myCard, saveCard, type MyCard } from './card';
import { loadIdentity } from './identity';
import { relays } from './relays';
import { address } from './funding';
import { pool } from './pool';

/**
 * How often *"out tonight"* is republished.
 *
 * Longer than the peer heartbeat, because nothing depends on it. A peer's phone uses
 * presence to tell somebody they are past their time; this only makes a name appear on a
 * public board, and a slower beat means less traffic from an operator's phone all night.
 */
export const LISTED_BEAT_SECONDS = 300;

/** After this long with nothing heard, a name comes off the board. Not marked stale — off. */
const OUT_FOR_SECONDS = LISTED_BEAT_SECONDS * 3;

export interface BoardEntry {
  contact: string;
  callsign: string;
  doing?: string;
  /** A string to copy. Never an amount, and never a total. */
  lightning?: string;
  /** Whether this operator is publishing *"out tonight"* right now. */
  out: boolean;
}

/**
 * The most cards one region's board will hold.
 *
 * Far more operators than any real metro has published, and small enough that a phone can
 * still draw the screen. See the intake below for why a public board needs a bound at all.
 */
const MAX_CARDS = 200;

let cards = $state<Record<string, PublishedCard>>({});
let outNow = $state<Record<string, number>>({});
let loading = $state(false);
/** Whether more cards are being published to this region than the board will show. */
let partial = $state(false);
let closer: { close(): void } | null = null;
let beat: ReturnType<typeof setInterval> | null = null;

export const board = {
  /**
   * Everybody with a card in this region, alphabetically.
   *
   * Alphabetical rather than by anything meaningful, deliberately. Sorting the out-tonight
   * operators to the top would make being listed the way to be seen, which is the first
   * step toward a network where visibility is a currency.
   */
  /**
   * Whether this board is showing everything it was offered.
   *
   * Said on the screen rather than kept quiet: a list that silently stops at two hundred
   * looks like a complete list of two hundred people, and somebody looking for one
   * particular operator would conclude they are not there.
   */
  get partial(): boolean {
    return partial;
  },

  get entries(): BoardEntry[] {
    const live = Math.floor(Date.now() / 1000) - OUT_FOR_SECONDS;
    return Object.values(cards)
      .map((c) => ({
        contact: c.contact,
        callsign: c.card.callsign,
        doing: c.card.doing,
        lightning: c.card.lightning,
        out: (outNow[c.contact] ?? 0) >= live
      }))
      .sort((a, b) => a.callsign.localeCompare(b.callsign));
  },

  get loading(): boolean {
    return loading;
  },

  /** Watches one region. Safe to call repeatedly; switching regions replaces the last. */
  watch(region: string): void {
    const urls = relays();
    if (urls.length === 0) return;

    closer?.close();
    cards = {};
    outNow = {};
    loading = true;

    closer = pool().subscribeMany(
      urls,
      // One filter, not two: both kinds are tagged with the region, so a single
      // subscription fetches the board and who is on it in one round trip.
      { kinds: [KIND_CARD, KIND_PUBLIC_PRESENCE], '#d': [region] },
      {
        onevent: (event: Event) => {
          if (event.kind === KIND_CARD) {
            const read = readCard(event);
            if (!read) return;
            // Replaceable, but relays deliver what they have. An older card must not
            // overwrite a newer one and show somebody a name they have since changed.
            const existing = cards[read.contact];
            if (existing && existing.at >= read.at) return;

            /*
             * Bounded, like the pairing inbox, and for a sharper reason.
             *
             * The region tag is **public** — that is the whole point of a board — so anybody
             * may publish a card into somebody else's area, and each arrival copied the
             * whole map. It is the same quadratic intake the invite list had, on the screen
             * with the wider door.
             *
             * A partial board is a usable board; an unbounded one is neither. Existing
             * entries still update, so a flood cannot freeze what is already shown.
             */
            if (!existing && Object.keys(cards).length >= MAX_CARDS) {
              partial = true;
              return;
            }
            cards = { ...cards, [read.contact]: read };
            return;
          }
          const who = readPublicPresence(event, region);
          if (!who) return;
          if ((outNow[who] ?? 0) >= event.created_at) return;
          // Same door, same bound. Somebody already listed can still update.
          if (!(who in outNow) && Object.keys(outNow).length >= MAX_CARDS) return;
          outNow = { ...outNow, [who]: event.created_at };
        },
        oneose: () => {
          loading = false;
        }
      }
    );
  },

  stop(): void {
    closer?.close();
    closer = null;
    loading = false;
  }
};

/**
 * Publishes or replaces your card.
 *
 * Generates the contact key on first use — which is the moment an operator stops being
 * invisible, and the only moment it happens.
 */
export async function publishCard(card: MyCard): Promise<void> {
  const identity = loadIdentity();
  const urls = relays();
  if (!identity?.callsign || urls.length === 0) return;

  const secret = ensureContactKey();
  const event = buildCard(
    secret,
    // One callsign, from the identity, rather than a second public name that could drift
    // from the one peers already know.
    {
      callsign: identity.callsign,
      region: card.region,
      doing: card.doing,
      // Only if the operator set one. Being supportable and being findable are separate
      // choices, and publishing a card must not quietly enable the other.
      ...(address() ? { lightning: address()! } : {})
    },
    Math.floor(Date.now() / 1000),
    // Beside the content rather than inside it -- see `events/links.ts` for why that is the
    // difference between an addition and every older client dropping this operator.
    { visibility: card.visibility, does: card.does, links: card.links }
  );
  saveCard(card);
  await Promise.allSettled(pool().publish(urls, event));
}

/**
 * Publishes *"out tonight"*, if the operator asked to be listed and has a card.
 *
 * Called on sign-on and on a slow beat. Silently does nothing otherwise, which is the
 * correct behaviour for a switch that is off — there is nothing to report about not
 * publishing something.
 */
export async function announceListed(): Promise<void> {
  if (!listed()) return;
  const secret = contactKey();
  const card = myCard();
  const urls = relays();
  if (!secret || !card || urls.length === 0) return;

  const event = buildPublicPresence(secret, card.region, Math.floor(Date.now() / 1000));
  await Promise.allSettled(pool().publish(urls, event));
}

/**
 * Republishes on a beat while out.
 *
 * There is no matching "no longer out" message and there does not need to be: the entry
 * ages off the board by itself within `OUT_FOR_SECONDS`. Standing down therefore removes
 * you by omission, and a phone that dies removes you the same way — which is the right
 * behaviour, since a public board saying somebody is out has no business outliving the
 * evidence for it.
 */
export function beatListed(): void {
  if (beat) clearInterval(beat);
  beat = setInterval(() => void announceListed(), LISTED_BEAT_SECONDS * 1000);
}

export function stopListed(): void {
  if (beat) clearInterval(beat);
  beat = null;
}
