/**
 * When a keyless pager should wake somebody, and when it should stay quiet.
 *
 * Pure, and separate from every socket and subprocess in this package, because the failure
 * modes here are all about *counting* and none of them are about I/O:
 *
 * - A `Distress` retries until a human answers, so one incident produces a stream of `20911`
 *   events, not one. A pager that fires on each would send fifty pages for one emergency and
 *   train its recipient to swipe them away — which is the exact failure the whole escalation
 *   design is built to avoid
 * - Several relays deliver the same event. That must be one page, not four
 * - But a `Distress` still running twenty minutes later means **nobody answered**, and going
 *   quiet at that point would be the worst possible behaviour
 *
 * So: once per incident, then once per window while it continues.
 */

/** How long after paging for somebody before their continued Distress pages again. */
export const REPAGE_AFTER_SECONDS = 300;

export interface PagerState {
  /** Event ids already seen, so multi-relay delivery is one page. */
  readonly seen: Set<string>;
  /** Unix seconds this operator was last paged for. */
  readonly pagedAt: Map<string, number>;
}

export const emptyState = (): PagerState => ({ seen: new Set(), pagedAt: new Map() });

export interface Sighting {
  /** The event id. Distinct per retry, shared across relays. */
  id: string;
  /** The operator who sent it — on the wire in the clear, since the event is signed. */
  author: string;
  /** Unix seconds. */
  at: number;
}

/**
 * Whether this sighting should wake somebody, mutating state to record the decision.
 *
 * `repageAfter` of `0` would page on every retry and is refused rather than honoured — a
 * configuration that produces alarm fatigue is a configuration that disables the alarm.
 */
export function shouldPage(
  state: PagerState,
  sighting: Sighting,
  now: number,
  repageAfter = REPAGE_AFTER_SECONDS
): boolean {
  // Same event from a second relay. Never a second page.
  if (state.seen.has(sighting.id)) return false;
  state.seen.add(sighting.id);

  // Events arrive out of order and relays replay. Something stamped well in the past is not
  // news, and paging for it would wake somebody about an emergency that is over.
  if (now - sighting.at > repageAfter) return false;

  const last = state.pagedAt.get(sighting.author);
  const window = Math.max(repageAfter, 1);
  if (last !== undefined && now - last < window) return false;

  /*
   * Deliberately **not** recorded here.
   *
   * This used to mark the operator as paged before the command had run, so a failed page — a
   * dead gateway, a missing binary — counted as a delivered one and every real retry from that
   * operator was refused for the next five minutes. The backup pager, whose entire job is
   * redundancy for the one thing that must not fail, went quiet exactly when its first attempt
   * failed. `markPaged` is called by the caller, after the command exits zero.
   */
  return true;
}

/** Records a page that actually went out. Called after the command succeeds, never before. */
export function markPaged(state: PagerState, author: string, now: number): void {
  state.pagedAt.set(author, now);
}

/**
 * Drops what is no longer worth remembering.
 *
 * Called on a timer. Without it a long-running pager accumulates every event id it has ever
 * seen — which is small, but this is meant to run for months on a machine nobody looks at.
 */
export function forgetOld(state: PagerState, now: number, keepSeconds = 3600): void {
  for (const [author, at] of state.pagedAt) {
    if (now - at > keepSeconds) state.pagedAt.delete(author);
  }
  // Event ids carry no timestamp, so they are cleared wholesale once the window they
  // protected has passed. Re-paging for a genuinely old event is prevented by the age check
  // above, so losing the set is safe.
  if (state.seen.size > 10_000) state.seen.clear();
}
