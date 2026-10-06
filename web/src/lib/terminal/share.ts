/**
 * Handing the artifact to the phone, which is the act it was built for.
 *
 * [`propagation.md`](../../../../docs/product/propagation.md) §2 describes a scrubbed, well-made
 * recap *"designed to be posted publicly"*, and `contribution.ts` builds exactly that. Then the
 * only way out of the app was the clipboard: the operator copied the text, left, found an app, and
 * pasted. **The careful part was finished and the act it exists for was one tap away and missing.**
 *
 * ## Text, and nothing else
 *
 * No `url`, ever. The Web Share API would happily carry one, and a link back to navcom.app
 * travelling with every recap is precisely the *"no call to action, no download link, no referral
 * code"* that §2 refuses — propagation here is supposed to be the artifact being good, not a
 * tracking tail. No `title` either: it becomes an email subject on some targets, which is one more
 * place for a call to action to grow.
 *
 * ## Cancelling is not failing
 *
 * A share sheet the operator dismisses rejects with `AbortError`. That is somebody changing their
 * mind, and reporting it as a failure would teach them the feature is broken when it did exactly
 * what they asked. Only a real refusal says anything, and the clipboard is still right there.
 *
 * ## Why this is not in the screen
 *
 * The outcome has four cases and three of them are silent, which is the kind of thing a screen
 * gets subtly wrong. Here it is one function with a test per case.
 */

/** What became of the attempt. Three of the four are nothing to say. */
export type ShareOutcome =
  /** The sheet opened and the operator sent it somewhere. */
  | 'shared'
  /** The sheet opened and they dismissed it. Not a failure. */
  | 'cancelled'
  /** This browser has no share sheet, so the control should not have been offered. */
  | 'unsupported'
  /** The sheet refused the payload or the platform blocked it. The one case worth printing. */
  | 'refused';

/**
 * Whether to offer the control at all.
 *
 * Called after mount rather than during render: there is no `navigator` while these pages are
 * prerendered, and a control that appears only after hydration is better than one whose markup
 * disagrees with itself.
 */
export function canShareText(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  // `canShare` exists where files are supported and is the honest test when it does. Some
  // implementations ship `share` without it, which is still a usable text share.
  if (typeof navigator.canShare === 'function') return navigator.canShare({ text: 'x' });
  return true;
}

/** Hands the text to the phone. Never throws. */
export async function shareText(text: string): Promise<ShareOutcome> {
  if (!canShareText()) return 'unsupported';
  try {
    await navigator.share({ text });
    return 'shared';
  } catch (err: unknown) {
    // `AbortError` is the documented name for a dismissed sheet. Some older WebKit builds throw
    // a bare `Error` whose message is the only clue, which is why the message is checked too.
    const name = (err as { name?: string } | null)?.name ?? '';
    const message = String((err as { message?: string } | null)?.message ?? '');
    if (name === 'AbortError' || /abort|cancel/i.test(message)) return 'cancelled';
    return 'refused';
  }
}
