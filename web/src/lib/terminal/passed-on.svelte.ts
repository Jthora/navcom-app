/**
 * Somebody's `Assist`, passed on by the watch to the others out [core `passed-on`].
 *
 * One current fact, as `overdue.svelte.ts` holds one: the newest replaces the last and nothing
 * accumulates, because a list of what the watch passed on is a feed, and a feed is an obligation
 * to have read it. It arrives silently, and putting it down tells nobody anything.
 *
 * An offer: the screen says who asked and what the watch said, and the only way to take it up is
 * the operator's own question back to the watch [invariant 8].
 */
let text = $state<string | null>(null);
let by = $state<string | null>(null);
let at = $state<number | null>(null);

export const passedOn = {
  get text(): string | null {
    return text;
  },
  /** The holder who passed it on. */
  get by(): string | null {
    return by;
  },
  get at(): number | null {
    return at;
  },

  /** Newest wins: one older than what is held is dropped. */
  heard(said: string | null, holder: string, when: number): void {
    if (!said || (at !== null && when < at)) return;
    text = said;
    by = holder;
    at = when;
  },

  clear(): void {
    text = null;
    by = null;
    at = null;
  }
};
