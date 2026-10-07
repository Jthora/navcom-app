import { SimplePool } from 'nostr-tools/pool';

/**
 * One relay connection per relay, for the whole app.
 *
 * Seven modules used to each construct their own `SimplePool`: the watch, peer presence,
 * key bundles, the board, invites, signals, and the watch-state reader. A pool deduplicates
 * connections *within itself* and knows nothing about the other six, so an operator with one
 * relay configured opened **three sockets to it on the Status screen alone**, and more as
 * they moved through the app.
 *
 * That is not a bundle problem, it is a phone problem: every extra socket is another TCP and
 * TLS handshake, another thing held open in the background, and another connection counted
 * against whatever per-IP limit a volunteer-run relay has set. Relays are strangers doing us
 * a favour, and opening seven connections where one would do is a bad way to treat one.
 *
 * ## Nothing here closes a connection
 *
 * There is no `close(urls)` wrapper on purpose, and calling it on this pool would be a bug:
 * one module deciding it is finished would drop the socket five others are still reading
 * from. Modules close their **subscriptions** — that is what the `closer` returned by
 * `subscribeMany` is for — and the connection stays up for whoever else is using it.
 *
 * `destroy()` exists for the one case that means it: a burn, where the device is being
 * emptied and nothing should be left talking to anybody.
 */

let shared: SimplePool | null = null;

/**
 * The app's relay pool. Created on first use, never per module.
 *
 * Pinged, so a socket that died without closing — a sleeping phone, a network switch — is noticed
 * and closed, which is what lets `subscribe.ts` reopen what it carried [audit: relay paths, F19].
 * Not reconnected by the library: that is done in `subscribe.ts`, with fresh filters.
 */
export function pool(): SimplePool {
  return (shared ??= new SimplePool({ enablePing: true }));
}

/**
 * Tears every connection down.
 *
 * For a burn, and nothing else. A wipe keeps the operator working; a burn is the device
 * being emptied, and leaving sockets open to relays afterwards would be a live signal from a
 * phone that is supposed to be finished.
 */
export function destroyPool(): void {
  shared?.destroy();
  shared = null;
}
