/**
 * What the watch tells everybody out [core `notice`].
 *
 * One current fact, as `passed-on.svelte.ts` holds one: the newest replaces the last and nothing
 * accumulates, because a list of what the watch said is a feed, and a feed is an obligation to have
 * read it. It arrives silently, shows on every screen while held, and putting it down tells nobody.
 */
let text = $state<string | null>(null);
let by = $state<string | null>(null);
let at = $state<number | null>(null);

export const notice = {
  get text(): string | null {
    return text;
  },
  /** The holder who said it. */
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
