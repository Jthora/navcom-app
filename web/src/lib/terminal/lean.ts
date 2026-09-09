/**
 * Whether to load the heavy thing, decided by the phone rather than by asking.
 *
 * An operator's own profile embed can be tens of megabytes — TikTok's creator frame measured
 * 64 MB across fifteen hosts. On a good connection that is a few seconds and nobody's problem.
 * On a bad one it is the difference between a page and a spinner.
 *
 * ## Why this is detected and not offered
 *
 * The obvious design puts the cost in front of the reader — *"see their latest, 1.3 MB"* — and
 * that was the first version of this. It is the wrong instinct twice over. It makes somebody
 * do arithmetic before they can look at a person's page, and this project already measured
 * what happens when a screen fills with careful sentences: `panel.md` sets a **40-word target
 * for what is read before anything is opened**, and the card screen had grown to 239.
 *
 * The phone already knows. Ask it.
 *
 * ## What counts as lean
 *
 * - **`saveData`** — the operator turned Data Saver on. This is the only signal here that is a
 *   stated preference rather than a measurement, so it is honoured unconditionally
 * - **`effectiveType` of `2g` or `slow-2g`** — the browser's own estimate from recent traffic
 * - **`prefers-reduced-data`** — the OS-level equivalent, which Safari understands even where
 *   `navigator.connection` does not exist
 *
 * ## Absent means fast
 *
 * `navigator.connection` is Chromium-only; Safari and Firefox expose nothing. **The default
 * when nothing is known is to load it**, because assuming a slow connection would downgrade
 * every iPhone permanently on no evidence. A missing signal is not a bad signal.
 */

interface Connection {
  saveData?: boolean;
  effectiveType?: string;
}

/** The narrow slice of `navigator` this reads, so the cast stays in one place. */
type MaybeConnection = Navigator & {
  connection?: Connection;
  mozConnection?: Connection;
  webkitConnection?: Connection;
};

/** Connections on which a multi-megabyte frame is not a few seconds. */
const SLOW = ['slow-2g', '2g'];

/**
 * Whether this device is asking for less.
 *
 * Never throws and never blocks: every branch is a property read, and an environment with no
 * `navigator` at all (prerender) answers `false`, which is the same answer as a fast phone.
 */
export function isLean(): boolean {
  if (typeof navigator === 'undefined') return false;

  const nav = navigator as MaybeConnection;
  const c = nav.connection ?? nav.mozConnection ?? nav.webkitConnection;

  // A stated preference, not a measurement. It outranks everything else here.
  if (c?.saveData === true) return true;
  if (c?.effectiveType && SLOW.includes(c.effectiveType)) return true;

  try {
    return window.matchMedia('(prefers-reduced-data: reduce)').matches;
  } catch {
    // Older engines throw on an unknown media feature rather than reporting no match.
    return false;
  }
}
