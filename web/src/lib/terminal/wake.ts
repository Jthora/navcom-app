/**
 * The words on the screen a repeat page opens [`escalation.spec.md`, *Wake the others*].
 *
 * Somebody who acknowledged an operator is paged again because that operator's phone is still
 * sending. The screen says that in fixed words, and offers one thing: wake the others. Every number
 * in them comes from the page that opened it — when the person acknowledged and when the watch will
 * treat the operator's next attempt as new, where the page said — and where a number is not known
 * the sentence is said without it, never with a guess.
 *
 * **What the watch does next, as built** [review: live hole, phone]. A held acknowledgement stands
 * for `ack_holds_seconds` (30 minutes by default, and a box may set it longer). Until it ends, the
 * executor pages only the person who gave it about that operator, once an interval; *Silence widens*,
 * which would page everyone one interval after a re-page, is decided and not built. These words once
 * said "the watch pages everyone, not sooner than 5 min from now", from the re-page interval's
 * floor, and a person who read that and went back to sleep left the roster unwoken for up to 25
 * minutes more. So without the page saying when, they say only that it may not be soon.
 */

export interface WakeContext {
  /** The operator's attempt the page was about, or null when it named none. */
  attempt: string | null;
  /** When the page arrived, by this phone's clock. Never the basis of a time in the words. */
  pagedAt: number | null;
  /** When this person acknowledged the operator, where the page said. */
  ackedAt: number | null;
  /** When the watch treats the operator's next attempt as new, where the page said. */
  widensAt: number | null;
}

const ID = /^[0-9a-f]{64}$/;

/** A time from the address, if it is a whole number of seconds within two days of now. */
function time(raw: string | null, nowS: number): number | null {
  if (raw === null || !/^\d{1,12}$/.test(raw)) return null;
  const t = Number(raw);
  return Math.abs(t - nowS) <= 172_800 ? t : null;
}

/** What the screen was opened with: the address a repeat page builds (`page-notice.ts`). */
export function wakeFrom(search: string, nowS: number): WakeContext {
  const q = new URLSearchParams(search);
  const attempt = q.get('attempt');
  return {
    attempt: attempt && ID.test(attempt) ? attempt : null,
    pagedAt: time(q.get('paged'), nowS),
    ackedAt: time(q.get('acked'), nowS),
    widensAt: time(q.get('widens'), nowS)
  };
}

/** The two fixed sentences: what happened, and what the watch does next. */
export function wakeWords(ctx: WakeContext, nowS: number): { lead: string; next: string } {
  let lead = 'Distress again from an operator you acknowledged.';
  if (ctx.ackedAt !== null) {
    const ago = Math.max(0, nowS - ctx.ackedAt);
    lead =
      ago < 60
        ? 'Distress again from the operator you acknowledged under a minute ago.'
        : `Distress again from the operator you acknowledged ${Math.round(ago / 60)} min ago.`;
  }

  let next =
    'If their phone keeps sending, you are paged again. The watch may not page everyone until your acknowledgement stops holding.';
  if (ctx.widensAt !== null) {
    const left = Math.ceil((ctx.widensAt - nowS) / 60);
    next =
      left > 0
        ? `If their phone is still sending in ${left} min, the watch treats it as new and pages everyone.`
        : 'If their phone is still sending, the watch treats its next attempt as new and pages everyone.';
  }
  return { lead, next };
}
