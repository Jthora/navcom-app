/**
 * What stands in the way of retiring the card's key [docs/design/groups.md §3, *The two honest
 * fixes*].
 *
 * Retiring throws the contact key away, and a claim it signed can then only lapse, a report only
 * stand: nothing could release or withdraw them. So retiring is refused while the key holds a claim,
 * or a report it signed is inside its seven days, and the refusal names each and says when it clears.
 * Withdrawing the card, which keeps the key, is never refused.
 */
import { CHALLENGE_WINDOW_SECONDS } from '@navcom/core';
import { contactPubkey } from './card';
import { get } from './storage';

/**
 * Read straight from this device's storage, the way the landing page's `holding` is, so the card
 * page carries no claims or reports code [boundaries.test.ts]: the fields named here are the ones
 * `Held` and `Sent` keep [$lib/missions/claims, $lib/missions/reports].
 */
type Kept = { title: string; signer?: string };
const claimsKept = () => get<(Kept & { ends: number })[]>('wipeable', 'mission_claims') ?? [];
const reportsKept = () => get<(Kept & { at: number; withdrawn?: boolean })[]>('wipeable', 'mission_reports') ?? [];

export interface Blocker {
  what: 'claim' | 'report';
  title: string;
  /** Unix seconds: when it stops standing in the way. */
  until: number;
}

/** Each claim or report under the card's key that retiring it would strand, soonest to clear first. */
export function retireBlockers(now: number): Blocker[] {
  const key = contactPubkey();
  if (!key) return [];
  const claims = claimsKept()
    .filter((h) => h.ends > now && (h.signer === undefined || h.signer === key))
    .map((h): Blocker => ({ what: 'claim', title: h.title, until: h.ends }));
  const reports = reportsKept()
    .filter((r) => !r.withdrawn && (r.signer === undefined || r.signer === key) && r.at + CHALLENGE_WINDOW_SECONDS > now)
    .map((r): Blocker => ({ what: 'report', title: r.title, until: r.at + CHALLENGE_WINDOW_SECONDS }));
  return [...claims, ...reports].sort((a, b) => a.until - b.until);
}
