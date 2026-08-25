/**
 * Places operators added, for the area this device carries.
 *
 * The sibling of `corrections.svelte.ts` and deliberately a separate store, because the two
 * subscribe by different things and conflating them would break the one that matters here.
 * A correction is fetched **by record id** — which works only if the device already has the
 * record. In a region that ships empty there are no ids to ask for, so places are fetched
 * **by region**, and that is the whole reason an operator in Nashville can see anything at
 * all.
 *
 * Everything else follows the correction store's shape on purpose: the same bounded cache,
 * the same coalesced writes, the same unsent queue for a submission made where there is no
 * signal. Those were each written after a real failure, and a parallel store that quietly
 * omitted one would reintroduce it.
 */

import type { Event } from 'nostr-tools/core';
import {
  buildPlace,
  dedupePlaces,
  KIND_PLACE,
  placeId,
  placeToRecord,
  readPlace,
  type Place,
  type PlaceMethod,
  type ResourceRecord
} from '@navcom/core';
import { ensureContactKey } from './card';
import { loadIdentity } from './identity';
import { pool } from './pool';
import { relays } from './relays';
import { get, set } from './storage';

type Stored = Place & { by: string };

const FIELD = 'places';
const PENDING = 'places_unsent';

/**
 * How many added places this device will hold, and how many authors for any one of them.
 *
 * Lower than the correction caps, and the asymmetry is intentional. A correction amends a row
 * that already exists; a place **creates** one, so a flood here does not clutter a record,
 * it fills the screen somebody is reading in the cold with buildings that may not be there.
 *
 * A real metro's published directory is tens of rows. An area with two hundred operator-added
 * places is not a directory that needs a bigger cache — it is one that needs a maintainer,
 * and saying so on the screen is more honest than absorbing it silently.
 */
const MAX_HELD = 200;
const MAX_PER_PLACE = 8;

let held = $state<Record<string, Stored>>({});
let partial = $state(false);
let unsent = $state<Record<string, Event>>({});
let closer: { close(): void } | null = null;

/** Keyed by author and place: one operator's latest word about a building replaces their last. */
const keyOf = (p: Stored) => `${p.by}:${p.id}`;

let writeQueued = false;
function persist(): void {
  if (writeQueued) return;
  writeQueued = true;
  queueMicrotask(() => {
    writeQueued = false;
    set('accruing', FIELD, held);
  });
}

export const places = {
  /** Everything this device knows, deduped to one entry per building. */
  get all(): Stored[] {
    return dedupePlaces(Object.values(held));
  },

  /** As records, so the rest of the directory needs to know nothing about this store. */
  get records(): ResourceRecord[] {
    return this.all.map(placeToRecord);
  },

  /**
   * Whether more places are being published to this area than the device will hold.
   *
   * Said on the screen rather than kept quiet, for the same reason corrections say it: a
   * directory holding a fraction of what was published looks exactly like a directory nobody
   * has added to.
   */
  get partial(): boolean {
    return partial;
  },

  /**
   * Loads what is cached and starts listening for more.
   *
   * Scoped to one region. Asking a relay for every place on the network would pull metros
   * this operator will never walk, on a phone counting bytes — and the region tag exists
   * precisely so that this filter can be narrow without needing record ids first.
   */
  start(region: string): void {
    held = get<Record<string, Stored>>('accruing', FIELD) ?? {};
    unsent = get<Record<string, Event>>('accruing', PENDING) ?? {};

    const urls = relays();
    if (urls.length > 0) void this.flush();
    if (urls.length === 0 || !region) return;

    closer?.close();
    closer = pool().subscribeMany(urls, { kinds: [KIND_PLACE], '#g': [region] }, {
      onevent: (event: Event) => {
        const read = readPlace(event);
        if (!read) return;
        // A relay is free to serve anything; a place for a different metro is not this
        // device's business even if it arrived on this subscription.
        if (read.region !== region) return;

        // Out-of-order delivery is normal. An older assertion must not overwrite the same
        // author's newer one.
        const key = keyOf(read);
        const existing = held[key];
        if (existing && existing.last_verified > read.last_verified) return;

        /*
         * Full: what is here is kept and updated, and new authors are turned away. Refusing
         * the new one rather than evicting an old one means a flood cannot displace a place
         * somebody actually relies on.
         */
        if (!existing) {
          const forPlace = Object.values(held).filter((p) => p.id === read.id).length;
          if (Object.keys(held).length >= MAX_HELD || forPlace >= MAX_PER_PLACE) {
            partial = true;
            return;
          }
        }

        held = { ...held, [key]: read };
        persist();
      }
    });
  },

  /**
   * Adds a place this directory does not have.
   *
   * Signed by the contact key, generated here if absent — the same reasoning as a correction:
   * contributing must not be gated behind having published a card, because the operator with
   * the best local knowledge often has the most reason not to be findable.
   *
   * Throws `PlaceError` for anything the schema refuses, which the caller shows to the
   * operator verbatim. Those messages are written to be read by a person standing outside a
   * building, not by a developer.
   */
  async add(
    region: string,
    draft: { name: string; type: ResourceRecord['type']; address: string; phone?: string; hours?: string; notes?: string },
    method: PlaceMethod = 'in_person'
  ): Promise<string> {
    const urls = relays();
    const callsign = loadIdentity()?.callsign;
    const secret = ensureContactKey();

    const fields: Place['fields'] = {};
    if (draft.phone?.trim()) fields.phone = draft.phone.trim();
    if (draft.hours?.trim()) fields.hours = draft.hours.trim();
    if (draft.notes?.trim()) fields.notes = draft.notes.trim();

    const place: Place = {
      id: '',
      region,
      name: draft.name,
      type: draft.type,
      address: draft.address,
      // `anonymous` is a real author in this schema, not a fallback for a missing one.
      verified_by: callsign ?? 'anonymous',
      method,
      last_verified: new Date().toISOString().slice(0, 10),
      ...(Object.keys(fields).length > 0 ? { fields } : {})
    };

    const event = buildPlace(secret, place, Math.floor(Date.now() / 1000));
    const read = readPlace(event);
    if (read) {
      // Held locally whether or not a relay takes it. An operator who adds a place at a door
      // with no signal must still see it in their own directory tonight.
      held = { ...held, [keyOf(read)]: read };
      persist();
    }

    /*
     * Whether it actually reached anybody — the failure the correction store was fixed for.
     * A submission that is held locally and never retried gives the operator positive
     * evidence it worked, which is worse than a silent failure because it is a disguised one.
     * And it matters most here: the operator standing at a door is the one with the worst
     * signal and the best knowledge.
     */
    const results = urls.length > 0 ? await Promise.allSettled(pool().publish(urls, event)) : [];
    if (!results.some((r) => r.status === 'fulfilled')) {
      unsent = { ...unsent, [event.id]: event };
      set('accruing', PENDING, unsent);
    }

    return placeId(draft.name, draft.address);
  },

  /** Retries everything this operator added that never got out. Called on `start`. */
  async flush(): Promise<void> {
    const urls = relays();
    const queue = Object.values(unsent);
    if (urls.length === 0 || queue.length === 0) return;

    const landed: string[] = [];
    await Promise.all(
      queue.map(async (event) => {
        const results = await Promise.allSettled(pool().publish(urls, event));
        if (results.some((r) => r.status === 'fulfilled')) landed.push(event.id);
      })
    );
    if (landed.length === 0) return;

    unsent = Object.fromEntries(Object.entries(unsent).filter(([id]) => !landed.includes(id)));
    set('accruing', PENDING, unsent);
  },

  /** How many of this operator's own additions have not reached anybody yet. */
  get unsentCount(): number {
    return Object.keys(unsent).length;
  },

  stop(): void {
    closer?.close();
    closer = null;
  }
};
