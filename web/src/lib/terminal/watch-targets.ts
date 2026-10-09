/**
 * Where this phone sends a `Distress` for its watch, and what every *heard on* count is counted
 * against [relay-lists §5, §7].
 *
 * **One function, so the `Distress` loop and the receipt cannot drift.** The receipt says *heard on
 * 2 of 3 relays*; the 3 has to be the relays a `Distress` from this phone would actually go to, or
 * the count is about some other list. Today that is the watch's stored relays this page can reach
 * (`loadConfig`, already `usable()`-normalized, the same strings `subscribeLive` reports), less any
 * `listable()` refuses: The Record and its mirrors, which keep everything they are sent, for good.
 *
 * Phase 4 adds what a list the watch signed adds. Nothing else may: a second source of relays for
 * the watch is how the overdue contact came to be listened for where the watch no longer is.
 *
 * Kept out of `relays.ts` and `watch-relays.ts`: the public roster imports those, and has about a
 * kilobyte left.
 */

import { listable, whyNotListable, type RelayReason } from '@navcom/core';
import { loadConfig } from './config';

/** The watch's relays a `Distress` from this phone goes to; empty with no watch. */
export function watchTargets(): string[] {
  const config = loadConfig();
  return config ? config.relays.filter((url) => listable(url)) : [];
}

/** The watch's relays nothing is sent to, each with core's reason. Empty with no watch. */
export function watchWithheld(): RelayReason[] {
  const config = loadConfig();
  if (!config) return [];
  const out: RelayReason[] = [];
  for (const url of config.relays) {
    const reason = whyNotListable(url);
    if (reason !== null) out.push({ url, reason });
  }
  return out;
}

/**
 * What a `Distress` is handed: {@link watchTargets} first, then the relays it leaves out, so the loop
 * can say why nothing went to each of those.
 *
 * Core refuses exactly what `watchTargets()` leaves out (`whyNotListable`), so what a `Distress` goes
 * to is still `watchTargets()`, and the receipt still counts over it. Handed the targets alone, a
 * watch whose every relay is a mission relay read *no relay took it: ... no relay was given* on every
 * attempt: true that the attempt failed, and silent about why. Called again before every attempt.
 */
export function distressRelays(): string[] {
  return [...watchTargets(), ...watchWithheld().map((w) => w.url)];
}
