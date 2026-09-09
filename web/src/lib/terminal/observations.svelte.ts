/**
 * Reporting what you saw.
 *
 * An observation is not a correction, and this file is separate from `corrections.svelte.ts`
 * for the reason `raw-intel.md` §1 gives rather than for tidiness. A correction says what
 * **is** — *"St Pat's closes intake at 20:30"* — and rots, which is why `volatility.ts` decays
 * it. An observation says what somebody **saw** at a moment, and stays true forever.
 *
 * Conflating them produces a system that either forgets its evidence or trusts stale claims.
 * Two objects, two kinds, two lifetimes, and two code paths so the distinction survives
 * somebody editing one of them.
 *
 * ## Signed by the contact key
 *
 * The same key that signs a card and a correction, never the operational one — publishing
 * costs no operational exposure, and an observation is the most public thing an operator
 * files.
 *
 * ## Nothing is queued
 *
 * A correction queues when a relay is unreachable, because a correction is about a door
 * somebody is standing at and the value is still true an hour later. This does not, yet: an
 * observation carries `observed_at` distinct from its publish time, so a late one is still
 * accurate — but a queue that survives a panic wipe is a store of where an operator has been,
 * and that is a design decision rather than a detail. Until it is made, a failed publish is
 * reported and nothing is kept.
 */

import type { Event } from 'nostr-tools/core';
import {
  ANONYMOUS,
  anchorFromRecord,
  buildObservation,
  KIND_OBSERVATION,
  ObservationError,
  readObservation,
  type ObservationMethod,
  type PublishedObservation,
  type ResourceRecord
} from '@navcom/core';
import { contactKey, ensureContactKey } from './card';
import { loadIdentity } from './identity';
import { relays } from './relays';
import { pool } from './pool';

export interface ReportInput {
  record: ResourceRecord;
  tags: string[];
  method: ObservationMethod;
  /** When it was seen, in seconds. Distinct from when this is published. */
  observedAt: number;
  /** Whether to file without a callsign. */
  anonymous: boolean;
}

export type ReportResult =
  | { ok: true; id: string }
  | { ok: false; because: string };

/**
 * Files one observation.
 *
 * Returns a reason rather than throwing, because every failure here is something an operator
 * standing at a door needs to read and act on — a refuge that cannot be anchored, a relay that
 * would not take it, a vocabulary term this build does not know.
 */
export async function report(input: ReportInput): Promise<ReportResult> {
  const identity = loadIdentity();
  if (!identity?.callsign) return { ok: false, because: 'Pick a callsign first.' };

  const urls = relays();
  if (urls.length === 0) return { ok: false, because: 'No relay is configured.' };

  const anchor = anchorFromRecord(input.record);
  if (!anchor.ok) return { ok: false, because: anchor.because };

  // Generated on first use, exactly as a card does -- reporting is the other act that makes
  // an operator public, and it must not quietly mint a public identity for a read.
  const secret = contactKey() ?? ensureContactKey();

  let event;
  try {
    event = buildObservation(
      secret,
      {
        anchor: anchor.anchor,
        observed_at: Math.floor(input.observedAt),
        tags: [...input.tags],
        method: input.method,
        callsign: input.anonymous ? ANONYMOUS : identity.callsign,
        precision: 'area'
      },
      anchor.where,
      Math.floor(Date.now() / 1000),
      anchor.region
    );
  } catch (e) {
    return { ok: false, because: e instanceof ObservationError ? e.message : 'That will not publish.' };
  }

  const results = await Promise.allSettled(pool().publish(urls, event));
  if (!results.some((r) => r.status === 'fulfilled')) {
    // Said plainly. A report that reached nothing must never look like one that landed.
    return { ok: false, because: 'No relay took it. Nothing was published.' };
  }
  return { ok: true, id: event.id };
}

/**
 * What has been reported about the records on screen.
 *
 * ## Live, and not cached
 *
 * The board does not cache and neither does this, for the same reason: relay-sourced social
 * data is re-fetchable, so losing it is not a failure — which rules out the accruing tier —
 * and a local set of timestamped, location-bearing observations is exactly the material
 * `raw-intel.md` §9 wants to shrink, which rules out keeping it around. The directory is
 * cached because it is build-time data an operator needs with no signal; this is not that.
 *
 * The honest cost: **offline shows nothing**, the same as the board offline. An operator with
 * no signal sees the record and its corrections, which are the parts that survive.
 *
 * `reapObservations` in core stays unwired as a result, and deliberately: §9 specifies
 * retention, and the day something does hold observations it will need exactly that function
 * rather than a re-derivation of it.
 *
 * ## One filter, two objects
 *
 * §4 gives an observation a `d` tag carrying its anchor, which is the letter a correction
 * already uses to mean *about this record*. So this asks for the same records the corrections
 * subscription asks for, and a future change could merge them into one round trip.
 */
const MAX_PER_RECORD = 20;

let seenByRecord = $state<Record<string, PublishedObservation[]>>({});
let watching: { close(): void } | null = null;

export const observed = {
  /** What has been reported about one record, newest first. */
  about(recordId: string): PublishedObservation[] {
    return seenByRecord[recordId] ?? [];
  },

  /** Watches a set of records. Safe to call repeatedly; the last call replaces the previous. */
  watch(recordIds: readonly string[]): void {
    const urls = relays();
    if (urls.length === 0 || recordIds.length === 0) return;

    watching?.close();
    seenByRecord = {};

    watching = pool().subscribeMany(
      urls,
      { kinds: [KIND_OBSERVATION], '#d': [...recordIds] },
      {
        onevent: (event: Event) => {
          const read = readObservation(event);
          if (!read) return;
          const id = read.observation.anchor;
          const held = seenByRecord[id] ?? [];
          if (held.some((o) => o.at === read.at && o.author === read.author)) return;
          /*
           * Bounded per record, and newest first.
           *
           * The `d` tag is public, so anybody may file against any record -- the same open
           * door the board has. A record that somebody floods stays readable, and the flood
           * cannot reach the records around it because the bound is per record rather than
           * across the screen.
           */
          /*
           * Ordered by when it was **seen**, not when it was published.
           *
           * `at` is the publish time and `observed_at` is the moment somebody is describing;
           * §3 keeps them separate precisely because they differ. Sorting by `at` put a
           * five-week-old sighting above a two-day-old one whenever a backlog was filed in one
           * go -- which is exactly what filing from the field after a patrol looks like.
           */
          const next = [read, ...held]
            .sort((a, b) => b.observation.observed_at - a.observation.observed_at)
            .slice(0, MAX_PER_RECORD);
          seenByRecord = { ...seenByRecord, [id]: next };
        }
      }
    );
  },

  stop(): void {
    watching?.close();
    watching = null;
  }
};
