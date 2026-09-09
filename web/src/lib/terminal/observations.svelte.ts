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

import {
  ANONYMOUS,
  anchorFromRecord,
  buildObservation,
  ObservationError,
  type ObservationMethod,
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
      Math.floor(Date.now() / 1000)
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
