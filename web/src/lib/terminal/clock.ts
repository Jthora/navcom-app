import { STALENESS_MARGIN_DAYS } from '@navcom/core/directory';

/**
 * Whether this device's clock is provably wrong.
 *
 * ## The gap this closes
 *
 * Time is the one untrusted input this system never measured. The discipline for untrusted
 * data is written twice in core — `CLOCK_TOLERANCE_SECONDS` in `watch-state.ts` for an event
 * stamped in our future, and `FUTURE_TOLERANCE_DAYS` in `attestation.ts` for a date that
 * cannot be weighed — and `attestation.ts` says outright that it is "the same reasoning
 * `watch-state.ts` already applies". Both defend against **somebody else's** wrong clock,
 * judged against `now`. Neither measures the ruler.
 *
 * The watch-state check is also the only clock check in the app, so it needs a configured
 * Watchtower to run at all. The operator working Alone — the documented default — had none.
 *
 * ## Why the build stamp is evidence, and what it is evidence of
 *
 * A phone cannot legitimately predate the build it is running. So `now < builtAt` is proof,
 * needing no network, no relay and no permission.
 *
 * It is proof in **one direction only**. A clock running ahead is undetectable this way, and
 * undetectable from received data too: an event stamped in our past is indistinguishable from
 * an event that is simply old. So `behind: false` is *not* a clean bill of health, and nothing
 * built on this may present it as one. It means only that the phone has not proved itself
 * wrong.
 *
 * ## Which wrongness actually hurts
 *
 * Not the spectacular kind. A phone reset to 1970 or 2020 reads every record's
 * `last_verified` as its own future, `ageInDays` returns `Infinity`, and everything renders
 * stale — "call first", the safe answer. **The system already fails safe for a badly wrong
 * clock.**
 *
 * The damage is done by a clock off by days to weeks, which is the ordinary case: a cheap
 * handset that has been off for a week and has not synced since. Against a real 2026-09-01, a
 * record checked 2026-08-18 is 14 days old and reads stale. To a phone that thinks it is
 * 2026-08-25 the same record is 7 days old and reads current, so its hours are shown instead
 * of suppressed. Seven days of drift is all it takes to send somebody to a closed door.
 *
 * And it is worse on the way out than on the way in, because the date an operator's own work
 * carries is taken from this clock with no input from them — `last_verified` on a correction
 * and on a new place, `at` on an endorsement. Behind, and their in-person check loses to the
 * website scrape it was written to fix, because a newer date beats an older one. Ahead, and
 * `FUTURE_TOLERANCE_DAYS` reads it as unverifiable. Either way the reader is defended and the
 * writer is never told, which is how somebody ends up silently outside the attestation model
 * while still doing the work.
 *
 * Deciding what to do about *writing* with an untrusted clock is a separate question with a
 * product judgement in it, and it is deliberately not answered here.
 */

/**
 * How far behind the build a clock may read before it is worth saying so.
 *
 * Tied to the staleness margin rather than picked: that margin exists because a prerendered
 * page outlives its build, and it already absorbs one day of drift in every confidence
 * judgement. A clock inside it changes no answer, so reporting it would be noise on the one
 * screen where noise is least affordable.
 */
export const BEHIND_TOLERANCE_SECONDS = STALENESS_MARGIN_DAYS * 86_400;

export interface ClockRead {
  /**
   * True only when the clock is **provably** behind.
   *
   * False means "has not proved itself wrong", never "verified" — see the note above on why
   * a clock running ahead cannot be seen from here.
   */
  behind: boolean;
  /** How far behind the build, in seconds. Zero unless `behind`. */
  behindSeconds: number;
  /** The same, in whole days, for saying out loud. Zero unless `behind`. */
  behindDays: number;
}

const FINE: ClockRead = { behind: false, behindSeconds: 0, behindDays: 0 };

/**
 * Reads the device clock against the stamp baked into this build.
 *
 * A missing or unparseable stamp returns "not proved wrong" rather than throwing or
 * guessing. Absent evidence is not evidence, and a check that failed closed here would put a
 * warning about the operator's phone on the screen every time a load function changed shape.
 */
export function readClock(builtAt: string | null | undefined, nowMs: number): ClockRead {
  if (!builtAt) return FINE;
  const built = Date.parse(builtAt);
  if (Number.isNaN(built)) return FINE;

  const behindSeconds = Math.floor((built - nowMs) / 1000);
  if (behindSeconds <= BEHIND_TOLERANCE_SECONDS) return FINE;

  return { behind: true, behindSeconds, behindDays: Math.floor(behindSeconds / 86_400) };
}
