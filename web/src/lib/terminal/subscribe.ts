/**
 * A subscription that stays open while the screen that asked for it does.
 *
 * **The pool does not reconnect, and turning that on is not the fix** [audit: relay paths, F19].
 * A subscription on the shared pool ended for good the first time its socket dropped — a network
 * handoff, a lock screen, a tunnel — while its screen went on showing the last thing it heard as
 * if it were current. Status and Watch stay open for hours, so that was the ordinary case.
 * nostr-tools' own reconnect is no answer on its own: on an iPhone the socket reports an error
 * before it closes and the library then skips reconnecting, and where it does reconnect it asks
 * only for events newer than the newest it has seen — a number a single future-dated event moves.
 *
 * So the app does it, the way the escalation executor does on the box: one subscription per
 * relay, each reopened with a fresh filter after a short wait that doubles to thirty seconds, and
 * every closed one reopened at once when the phone comes back online or back to the screen. The
 * same event from two relays, or from a reopened one, reaches the caller once.
 *
 * `oneose` is called once, when every relay has first answered or failed, with how many answered:
 * nobody answering is not nothing there [audit: relay paths, F20].
 */
import type { Event } from 'nostr-tools/core';
import type { Filter } from 'nostr-tools/filter';
import { pool } from './pool';
import { usable } from './relay-url';

export interface LiveParams {
  onevent: (event: Event) => void;
  /** Once, after every relay has first answered or failed: how many of them answered. */
  oneose?: (answered: number) => void;
}

const FIRST_WAIT = 1_000;
const LONGEST_WAIT = 30_000;
/** Ids remembered for dropping repeats: enough for any screen, bounded for a flood. */
const SEEN_MAX = 5_000;

export function subscribeLive(urls: readonly string[], filters: Filter | Filter[], params: LiveParams): { close(): void } {
  const list = Array.isArray(filters) ? filters : [filters];
  const relays = usable(urls);
  let stopped = false;

  const seen = new Set<string>();
  const onevent = (event: Event) => {
    if (stopped || seen.has(event.id)) return;
    seen.add(event.id);
    if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value!);
    params.onevent(event);
  };

  // The first round: every relay answers or fails once, and then the caller is told how many answered.
  const pending = new Set(relays);
  let answered = 0;
  const settled = (url: string, ok: boolean) => {
    if (!pending.delete(url)) return;
    if (ok) answered += 1;
    if (pending.size === 0) params.oneose?.(answered);
  };

  type Live = { token: object | null; sub: { close(): void } | null; wait: number; timer: ReturnType<typeof setTimeout> | null };
  const live = new Map<string, Live>();

  const open = (url: string) => {
    const state = live.get(url)!;
    state.timer = null;
    if (stopped) return;
    const token = {};
    state.token = token;
    // A failed connection ends with its end-of-answer and its close in the same moment; a relay
    // that answered ends with only the first. So the verdict waits a microtask for the second.
    let closed = false;
    const handlers = {
      onevent,
      oneose: () => {
        state.wait = FIRST_WAIT;
        queueMicrotask(() => settled(url, !closed));
      },
      onclose: () => {
        closed = true;
        if (stopped || state.token !== token) return;
        state.sub = null;
        settled(url, false);
        later(url);
      }
    };
    try {
      state.sub =
        list.length === 1
          ? pool().subscribeMany([url], list[0]!, handlers)
          : pool().subscribeMap(list.map((filter) => ({ url, filter })), handlers);
    } catch {
      // An address the pool cannot open fails the same way every time: said once, not retried.
      state.sub = null;
      settled(url, false);
    }
  };

  const later = (url: string) => {
    const state = live.get(url)!;
    if (stopped || state.timer) return;
    const wait = state.wait;
    state.wait = Math.min(wait * 2, LONGEST_WAIT);
    state.timer = setTimeout(() => open(url), wait);
  };

  /** Back online, or back to the screen: anything closed is reopened now, not after its wait. */
  const wake = () => {
    if (stopped || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
    for (const [url, state] of live) {
      if (state.sub) continue;
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;
      state.wait = FIRST_WAIT;
      open(url);
    }
  };
  const win = typeof window !== 'undefined' ? window : null;
  const doc = typeof document !== 'undefined' ? document : null;
  win?.addEventListener('online', wake);
  doc?.addEventListener('visibilitychange', wake);

  for (const url of relays) {
    live.set(url, { token: null, sub: null, wait: FIRST_WAIT, timer: null });
    open(url);
  }
  if (relays.length === 0) params.oneose?.(0);

  return {
    close() {
      stopped = true;
      win?.removeEventListener('online', wake);
      doc?.removeEventListener('visibilitychange', wake);
      for (const state of live.values()) {
        if (state.timer) clearTimeout(state.timer);
        state.token = null;
        try {
          state.sub?.close();
        } catch {
          /* already gone */
        }
        state.sub = null;
      }
    }
  };
}
