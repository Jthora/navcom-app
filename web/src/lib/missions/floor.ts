/**
 * The clock this device judges a publisher's keys on [core: missions/trust.ts, `trustClock`].
 *
 * Its own, or the moment this build was made if that is later: a phone cannot legitimately predate
 * the build it runs [built.ts], so a clock set back a month cannot revive a key whose end has
 * passed. Only checks that remove trust read it — a key's window, the frozen list, a date ahead —
 * and never a mission's own end, which stays on the device's clock so a mission is not called over
 * early [invariant 7].
 *
 * Without a build stamp (a test, or a bundle missing the literal), it is the device's clock alone.
 */
import { trustClock } from '@navcom/core';
import { BUILT_AT } from '$lib/built';

/** Unix seconds. */
export function floorNow(deviceMs: number = Date.now()): number {
  return trustClock(deviceMs, BUILT_AT);
}
