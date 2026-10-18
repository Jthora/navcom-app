/**
 * Com's entries, loaded once each and held per entry [groups.md §13].
 *
 * One module slot and one "unloaded" flag used to serve every screen. With a second entry, a
 * missions chunk that failed to arrive would have read as every screen failing, crews and people
 * included, and a crews chunk that arrived would have had nowhere to be held. Held by entry, a
 * failure is that entry's alone.
 *
 * **Asked for once, and never again.** Once a module fails to arrive, the browser keeps the failure
 * and answers every later import of it with the same rejection, fetching nothing: measured on
 * Chromium and WebKit, 2026-10-17. This tried again each time a screen opened, and the docs said so,
 * and no retry ever reached the network. A failed entry says so instead, with a reload beside it
 * [ComScreen]. On Chromium the reload fetches it again. On WebKit it does not: the failure outlives
 * the page, and only a different URL loads [com.md §6], which is open.
 */

import { untrack } from 'svelte';

export type Held<H> = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; Host: H };

export function entryLoader<E extends string, H>(loaders: Record<E, () => Promise<{ Host: H }>>) {
  /** Replaced whole on every change, never mutated: a module's exports are not state to proxy. */
  let held = $state.raw<Partial<Record<E, Held<H>>>>({});
  const asked = new Map<E, Promise<void>>();
  const put = (entry: E, value: Held<H>) => (held = { ...held, [entry]: value });

  return {
    /** Where `entry` stands, read reactively: `undefined` until something has asked for it. */
    held: (entry: E): Held<H> | undefined => held[entry],
    /**
     * Starts `entry` arriving the first time it is asked for, and settles when it is ready or has
     * failed. Never rejects. Untracked, so an effect that asks for an entry does not re-run, and
     * ask again, each time that entry's state changes.
     */
    load: (entry: E): Promise<void> =>
      untrack(() => {
        let arrival = asked.get(entry);
        if (!arrival) {
          put(entry, { status: 'loading' });
          arrival = loaders[entry]().then(
            (m) => void put(entry, { status: 'ready', Host: m.Host }),
            () => void put(entry, { status: 'failed' })
          );
          asked.set(entry, arrival);
        }
        return arrival;
      })
  };
}
