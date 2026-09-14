/**
 * Cards navcom.app will not display, by key.
 *
 * ## What this is for, and the only reasons it is for
 *
 * NavCom shows other people's words and cannot delete any of them: a card lives on relays
 * nobody here runs. What this project does control is what **its own pages** render, and some
 * of the protections a volunteer project has against a claim about somebody else's content
 * depend on acting once told. So this is that act, and it is narrow on purpose. A card is here
 * only after a notice about it, and only in one of two states:
 *
 * - `confirmed` — a person checked, and the card was named in a legal notice or its content is
 *   unlawful where this site is read: a threat, say, or somebody's legal name and address
 *   published about them
 * - `provisional` — a notice arrived that could not be checked inside the window. Held while it
 *   is, and never for long; see below
 *
 * ## What it is never for
 *
 * **A dispute between operators.** `declined.md` holds records rather than verdicts, and this
 * does not change that: it is not a moderation queue, not a reputation mechanism, and not a way
 * for one operator to remove another. A claim being wrong, unproven or distasteful does not put
 * a card here — and neither does one card impersonating another, which is what the key print
 * settles. A complaint must never be the way the second Raven removes the first.
 *
 * ## Why the category says nothing about what anybody did
 *
 * Everything here is public and stays in git history after an entry is removed. A label reading
 * `unlawful` beside a key would be a permanent accusation about a pseudonymous person, made by the
 * one party who cannot check it — the same reason an entry carries no written reason. So the
 * category records the state of a decision, not a finding about a person. What the notice said is
 * kept wherever the maintainer keeps correspondence, not here.
 *
 * ## Nothing here is permanent, and that is the defence against the list itself
 *
 * A list that lets one person quietly stop showing somebody is the lever an infiltrator would
 * most want, and it is operated by the same hand that maintains everything else. The answer is
 * the one this project gives everywhere: bound the authority rather than trust the holder. So
 * every entry has a window, and outliving it is loud:
 *
 * - **`provisional` stops hiding by itself after 14 days**, on every phone, deploy or no deploy,
 *   unless a person confirms it. A flood of bogus notices buys a fortnight, not a silence
 * - **`confirmed` fails the build after 90 days** until a person re-dates the entry or removes
 *   it. A hide cannot persist because nobody remembered it was there
 *
 * A confirmed entry does not lapse on its own, deliberately: a card named in a real notice that
 * reappeared because the maintainer was away is the failure the notice procedure exists to
 * prevent. The build refusing to ship is the alarm instead.
 *
 * ## What it cannot do
 *
 * Relays keep serving the card and other apps keep showing it. A phone that has not updated
 * the app still carries the old list, because the list ships with the build. Only cards are
 * covered: a place or correction somebody publishes from the field is not. The screens that
 * would have shown the card say this rather than pretending the card is gone.
 */

export type HiddenBecause = 'confirmed' | 'provisional';

export interface HiddenCard {
  /** The contact key that signed the card, as 64 lowercase hex. */
  key: string;
  because: HiddenBecause;
  /** The ISO date the decision was made, or last looked at again. */
  on: string;
}

/** Days an entry may stand before a person has to look at it again. */
export const REVIEW_AFTER_DAYS: Readonly<Record<HiddenBecause, number>> = {
  confirmed: 90,
  provisional: 14
};

/** Empty is the expected state, and the one this project hopes stays true. */
export const HIDDEN: readonly HiddenCard[] = [];

const DAY_MS = 86_400_000;

/** Whether an entry has outlived its window. The build refuses one either way. */
export function isExpired(entry: HiddenCard, now: Date = new Date()): boolean {
  const age = Math.floor((now.getTime() - Date.parse(`${entry.on}T00:00:00Z`)) / DAY_MS);
  return age > REVIEW_AFTER_DAYS[entry.because];
}

/**
 * Whether an entry is still hiding its card right now.
 *
 * A provisional entry past its fortnight has lapsed and hides nothing. A confirmed entry past
 * its window keeps hiding — the build failing is what makes somebody look.
 */
export function stillHides(entry: HiddenCard, now: Date = new Date()): boolean {
  return !(entry.because === 'provisional' && isExpired(entry, now));
}

const BY_KEY = new Map(HIDDEN.map((h) => [h.key, h] as const));

/** Whether navcom.app's own pages decline to show the card signed by this key. */
export function isHidden(key: string, now: Date = new Date()): boolean {
  const entry = BY_KEY.get(key);
  return entry !== undefined && stillHides(entry, now);
}

/** The date navcom.app stopped showing this card, or null if it shows it. */
export function hiddenOn(key: string, now: Date = new Date()): string | null {
  return isHidden(key, now) ? (BY_KEY.get(key) as HiddenCard).on : null;
}
