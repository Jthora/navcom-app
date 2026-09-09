/**
 * Everyone who chose to be on the open web.
 *
 * The surface for `visibility: 'public'`, and the global roster — one subscription, no region,
 * for cards carrying the `navcom:public` label. Every other view in this app asks a relay for
 * one metro; this is the only one that asks for everybody, which is exactly why it is limited
 * to people who opted into being asked about.
 *
 * ## Why this is fetched live and not prerendered
 *
 * Prerendering would make it indexable and readable with scripting off, which is most of what
 * "public" is worth. It would also make the build depend on a stranger's relay answering.
 * `announce.mjs` already takes that dependency and is deliberately tolerant — *"a relay that
 * refuses or times out is recorded and never fails the deploy"* — because a missed
 * announcement harms nobody.
 *
 * A roster is not like that. A relay that times out at build time would publish a page saying
 * **nobody is here**, which is a false statement about people rather than a missing
 * side-effect. So this fetches at read time, and the honest cost is stated on the page: it is
 * not in any search index, and it needs JavaScript.
 *
 * ## Alphabetical, and no count
 *
 * The same refusals the metro board makes. Nothing is ranked, nothing is ordered by activity
 * or recency, and there is no number anywhere — a count invites gaming and tells a reader
 * nothing they can act on. Ordering is by callsign, which rewards nothing.
 */

import type { Event } from 'nostr-tools/core';
import { KIND_CARD, PUBLIC_LABEL, readCard, type PublishedCard } from '@navcom/core';
import { relays } from './terminal/relays';
import { pool } from './terminal/pool';

/**
 * The most cards this will hold.
 *
 * The label is public, so anybody may publish a card claiming it — the same open door the
 * metro board has, without the region tag narrowing who arrives. A partial roster is usable
 * and an unbounded one is neither; existing entries still update, so a flood cannot freeze
 * what is already shown.
 */
const MAX = 500;

let cards = $state<Record<string, PublishedCard>>({});
let loading = $state(false);
let partial = $state(false);
let asked = $state(false);
let closer: { close(): void } | null = null;

export const publicRoster = {
  get entries(): PublishedCard[] {
    return Object.values(cards).sort((a, b) => a.card.callsign.localeCompare(b.card.callsign));
  },
  get loading(): boolean {
    return loading;
  },
  /** Whether more cards are labelled public than this will show. */
  get partial(): boolean {
    return partial;
  },
  /** Whether a relay has been asked at all. Distinguishes "none" from "not looked yet". */
  get asked(): boolean {
    return asked;
  },

  start(): void {
    const urls = relays();
    if (urls.length === 0) return;

    closer?.close();
    cards = {};
    partial = false;
    loading = true;
    asked = true;

    closer = pool().subscribeMany(
      urls,
      // The one query in this app with no region. `l` because a relay indexes only
      // single-letter tags -- see `PUBLIC_LABEL`.
      { kinds: [KIND_CARD], '#l': [PUBLIC_LABEL] },
      {
        onevent: (event: Event) => {
          const read = readCard(event);
          if (!read) return;
          // A relay may serve an older replaceable event after a newer one.
          const existing = cards[read.contact];
          if (existing && existing.at >= read.at) return;
          if (!existing && Object.keys(cards).length >= MAX) {
            partial = true;
            return;
          }
          cards = { ...cards, [read.contact]: read };
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
