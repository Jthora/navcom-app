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

  /**
   * Newest wins: one older than what is held is dropped, and so is one dated as what this phone
   * already put down, which the watch tells again to anybody it hears from afterwards. One with no
   * words is the watch clearing it.
   */
  heard(said: string | null, holder: string, when: number): void {
    if (at !== null && (when < at || (when === at && text === null))) return;
    if (!said) {
      if (at === null) return;
      text = null;
      by = null;
      at = when;
      return;
    }
    text = said;
    by = holder;
    at = when;
  },

  /** Put down by the operator: gone from the screen, and not brought back by the same words told again. */
  clear(): void {
    text = null;
    by = null;
  },

  /** Home, or wiped: nothing of tonight's is held. */
  reset(): void {
    text = null;
    by = null;
    at = null;
  }
};
