/**
 * Whether this page is sending a `Distress`, readable without loading the session.
 *
 * The retry loop lives in this page's memory (`session.svelte.ts`), so reloading the page stops it.
 * The Watch screen offers a reload when a newer build is waiting, and must not offer it while this
 * phone is itself asking for help. It read this from the session, which would have put the whole
 * sign-on, presence and position stack into the Watch screen's download for one boolean.
 *
 * Set only by the session. A page that never loaded the session sends no `Distress`, which is what
 * the false this starts at says.
 */

let distress = $state(false);

export const sending = {
  /** True while the retry loop is alive. It ends on a human, or on the operator. */
  get distress(): boolean {
    return distress;
  }
};

/** The session's, and nobody else's: the one place a `Distress` starts and stops. */
export function setDistressSending(on: boolean): void {
  distress = on;
}
