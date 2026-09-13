/**
 * Cards navcom.app will not display, by key.
 *
 * ## What this is for, and the only two things it is for
 *
 * NavCom shows other people's words and cannot delete any of them: a card lives on relays
 * nobody here runs. What this project does control is what **its own pages** render, and some
 * of the protections a volunteer project has against a claim about somebody else's content
 * depend on acting once told. So this is that act, and it is narrow on purpose:
 *
 * - `legal-notice` — the card was named in a legal notice sent to whoever maintains navcom.app
 * - `unlawful` — the card's content is unlawful where this site is read: a threat, say, or
 *   somebody's legal name and address published about them
 *
 * ## What it is never for
 *
 * **A dispute between operators.** `declined.md` holds records rather than verdicts, and this
 * does not change that: it is not a moderation queue, not a reputation mechanism, and not a way
 * for one operator to remove another. A claim being wrong, unproven or distasteful does not put
 * a card here — that is what the key print and `/notice/` are for.
 *
 * ## Why an entry carries no reason
 *
 * A written reason is an accusation about a pseudonymous person, published in a public
 * repository, by the one party with no way to check it. The category and the date are the
 * record. The notice itself is kept wherever the maintainer keeps correspondence, not here.
 *
 * ## What it cannot do
 *
 * Relays keep serving the card and other apps keep showing it. A phone that has not updated
 * the app still carries the old list, because the list ships with the build. The screen that
 * would have shown the card says this rather than pretending the card is gone.
 */

export type HiddenBecause = 'legal-notice' | 'unlawful';

export interface HiddenCard {
  /** The contact key that signed the card, as 64 lowercase hex. */
  key: string;
  because: HiddenBecause;
  /** The ISO date navcom.app stopped showing it. */
  on: string;
}

/** Empty is the expected state, and the one this project hopes stays true. */
export const HIDDEN: readonly HiddenCard[] = [];

const ON = new Map(HIDDEN.map((h) => [h.key, h.on] as const));

/** Whether navcom.app's own pages decline to show the card signed by this key. */
export const isHidden = (key: string): boolean => ON.has(key);

/** The date navcom.app stopped showing this card, or null if it shows it. */
export const hiddenOn = (key: string): string | null => ON.get(key) ?? null;
