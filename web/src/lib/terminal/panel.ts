/**
 * The rules the panel components are built out of.
 *
 * Extracted rather than written inside components for one reason: **a rule that is argued for
 * in prose and enforced by nothing executable is the single most common finding in this
 * project's audits.** The doctrine in `docs/design/panel.md` says a readout fits in five words
 * and that a countdown must be correct without animation. Both of those are decisions with a
 * right answer, so both live here where a test can hold them.
 *
 * Nothing in this file knows about the DOM.
 */

/**
 * Rule 2. A state readout fits in five words or fewer.
 *
 * If it will not fit it is not a state, it is an explanation, and explanations live one layer
 * down behind `Why`.
 */
export const READOUT_WORD_LIMIT = 5;

/** Words, as a person counts them: runs of non-space containing at least one letter or digit. */
export function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/**
 * Whether a readout breaks rule 2.
 *
 * Deliberately not a throw. A copy edit that trips this must not take a screen down at 2am —
 * the component marks itself instead, and a browser test asserts that no screen anywhere
 * renders a marked one. That is the same shape as every other rule here: checked against the
 * built artifact rather than trusted.
 */
export function isOverlong(value: string): boolean {
  return wordCount(value) > READOUT_WORD_LIMIT;
}

export interface WindowState {
  /** 0 at the moment it was sent, 1 when the window has run out. */
  fraction: number;
  /** Seconds left, floored at zero. */
  remaining: number;
  expired: boolean;
  /**
   * What to feed a CSS `animation-delay`, in seconds, so an animation that runs for the whole
   * window resumes at the right point.
   *
   * A negative delay starts an animation part-way through. That is what lets a countdown be
   * **one CSS keyframe seeded once from a real timestamp** rather than a `setInterval`
   * repainting a number every second for the whole night.
   */
  delay: number;
}

/**
 * Where a signal is within its response window.
 *
 * Windows are real and normative — `RESPONSE_WINDOW` in the core carries them, surfaced to the
 * operator rather than hidden. This turns one into something a bar can be drawn from.
 */
export function windowState(sentAt: number, windowSeconds: number, now: number): WindowState {
  const elapsed = Math.max(0, now - sentAt);
  const total = Math.max(1, windowSeconds);
  const fraction = Math.min(1, elapsed / total);
  return {
    fraction,
    remaining: Math.max(0, Math.round(total - elapsed)),
    expired: elapsed >= total,
    delay: -Math.min(elapsed, total)
  };
}

/**
 * How far a Distress has climbed, on a scale that never completes.
 *
 * `RESPONSE_WINDOW` has exactly one null in it and it is `distress`. A Distress has no window:
 * it does not expire, and it stays until a human ends it. So this must never reach 1 — a bar
 * that completes says *this resolves itself shortly*, and a Distress that appears to resolve
 * itself is the silent failure invariant 2 exists to forbid.
 *
 * The curve approaches the end and never arrives, which is the honest shape: it keeps growing
 * for as long as nobody has answered, and there is no finish line to reach.
 */
export function elapsedState(since: number, now: number): { fraction: number; seconds: number } {
  const seconds = Math.max(0, now - since);
  /*
   * Half of what is left, every REFERENCE seconds, against an explicit ceiling.
   *
   * The ceiling is not decoration and it is not caution. Written as `1 - 0.5^(s/REF)` this
   * reaches **exactly 1** after about a day, because `0.5^288` underflows to zero in a double
   * — so a Distress nobody answered overnight rendered as a completed bar, which is the one
   * thing this function exists to prevent. Caught by the test, not by reading.
   *
   * Multiplying by a ceiling makes the asymptote a stated fact rather than a property of
   * floating point: there is always visible room left, at any elapsed time expressible.
   */
  const REFERENCE = 300;
  const CEILING = 0.94;
  return { fraction: CEILING * (1 - Math.pow(0.5, seconds / REFERENCE)), seconds };
}

/** "41s", "2m 41s", "1h 04m". Terse, and it lines up in a column. */
export function elapsedLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/**
 * The tones a readout may take, and nothing else.
 *
 * `alarm` is rule 7 — sealed. It belongs to `Distress` and to a watch state that is lying
 * about itself, and nothing else on any screen may borrow it. Overdue is `warn`, which rises
 * and is amber; it never alarms, because alarm fatigue destroys the one mechanism where
 * failure means somebody is hurt.
 */
export type Tone = 'neutral' | 'good' | 'warn' | 'cold' | 'alarm';
