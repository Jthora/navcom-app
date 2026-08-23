/**
 * The one output channel this app has never used.
 *
 * There is not a single `navigator.vibrate` call in this codebase, and the core interaction on
 * patrol is performed by somebody who should be watching a street rather than a phone. A pulse
 * in a pocket says *that worked* without asking anybody to look down.
 *
 * ## What it may never do
 *
 * **Nothing here fires on arrival.** Not an acknowledgement, not an answer, not a peer going
 * out. The field terminal is silent, and a vibration on an incoming event is an unsolicited
 * interrupt however welcome the news is — a notification wearing a different sleeve. The
 * design roster proposed an `acknowledged` pattern for exactly that and it is **declined**: an
 * ack is the strongest case for it and still the wrong side of the line, because the line is
 * what stops the next twenty cases.
 *
 * So every pulse below is confirmation of a press the operator just made, in the moment they
 * made it. That is input feedback, the same class of thing as a key click.
 *
 * ## Where it stays quiet
 *
 * - **No support.** iOS has none of this, so it is feature-detected and its absence changes
 *   nothing: every state it confirms is also on the screen
 * - **`prefers-reduced-motion`.** A judgement rather than a certainty — the preference is
 *   about movement rather than touch, and there is no stated preference for haptics at all.
 *   Somebody who has asked for less movement is more likely than average to want less buzzing,
 *   and the cost of being wrong is that a pulse they would have liked does not happen
 *
 * There is deliberately no toggle. A toggle exists to stop something you did not ask for, and
 * nothing here happens that an operator did not just press.
 */

/**
 * Milliseconds. Short enough to read as feedback rather than as an alert — a long buzz is what
 * a phone does when somebody else wants something.
 */
const PATTERN = {
  /** The app has your press. Useful with gloves, and in the dark. */
  tap: 12,
  /** A held threshold has fired: the watch is taken, the wipe is done, the Distress is away. */
  committed: 55
} as const;

export type Pulse = keyof typeof PATTERN;

export function pulse(kind: Pulse): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
    return;
  }
  try {
    navigator.vibrate(PATTERN[kind]);
  } catch {
    // A phone that refuses is a phone that stays quiet. Nothing depends on this.
  }
}
