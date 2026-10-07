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
 * `destroyPool()` exists for the one case that means it: a burn, where the device is being
 * emptied and nothing should be left talking to anybody.
 */

/** What every connection asked for after a burn is told, and what the screen that asked says. */
const BURNED = 'this phone was burned, and connects to nothing until the page is reloaded';

/**
 * The app's pool, which a burn can finish for good.
 *
 * **A burn used to last one second** [review: relay paths]. `destroyPool()` closed every socket
 * and dropped the pool, and the next caller built a new one: a subscription that outlived its
 * screen reopened through it a second later, to the relays the burned phone had been using, and
 * went on reconnecting for as long as the tab was open. Core's `Distress` listener held the old
 * pool object, which nostr-tools lets connect again after `destroy()`.
 *
 * So the burn is a flag on the pool itself, never cleared. Every way in — a subscription, a
 * publish, or a relay asked for directly — goes through `ensureRelay`, and once burned that
 * refuses before anything is dialled, for whoever holds this object. `subscribe.ts` reads
 * `burned` off the pool it is handed rather than importing a second name from this module, so a
 * test that stands a bare `pool` in for this one still runs it.
 */
class AppPool extends SimplePool {
  burned = false;

  override ensureRelay(...args: Parameters<SimplePool['ensureRelay']>): ReturnType<SimplePool['ensureRelay']> {
    if (this.burned) return Promise.reject(new Error(BURNED));
    return super.ensureRelay(...args);
  }
}

let shared: AppPool | null = null;
let burned = false;

/**
 * The app's relay pool. Created on first use, never per module.
 *
 * Pinged, so a socket that died without closing — a sleeping phone, a network switch — is noticed
 * and closed, which is what lets `subscribe.ts` reopen what it carried [audit: relay paths, F19].
 * Not reconnected by the library: that is done in `subscribe.ts`, with fresh filters.
 *
 * After a burn this is the burned pool, until the page is reloaded: nothing dials from it.
 */
export function pool(): SimplePool {
  if (!shared) {
    const socket = guardedWebSocket();
    // The constructor's types name only two options; the rest reach nostr-tools all the same.
    const options = { enablePing: true, ...(socket ? { websocketImplementation: socket } : {}) };
    shared = new AppPool(options);
    shared.burned = burned;
  }
  return shared;
}

/**
 * Tears every connection down, and keeps them down.
 *
 * For a burn, and nothing else. A wipe keeps the operator working; a burn is the device
 * being emptied, and leaving sockets open to relays afterwards would be a live signal from a
 * phone that is supposed to be finished. **Nothing reconnects afterwards**, through this pool or
 * a new one, until the page is reloaded — see `AppPool`.
 */
export function destroyPool(): void {
  burned = true;
  if (!shared) return;
  shared.burned = true;
  shared.destroy();
}

/**
 * The browser's WebSocket, closed once nostr-tools has let go of it [review: relay paths].
 *
 * nostr-tools gives up on a connection that has not opened within its timeout by setting the
 * socket's handlers back to null, and never closes it. On a congested cell, where a handshake can
 * take longer than three seconds, the handshake then finished on a socket nobody held, and the
 * browser kept it open; every reopen made another, so a phone left on Status collected one idle
 * connection every few seconds per slow relay — radio and memory on the device floor, and in the
 * end refused by a relay that limits connections per address. The box got this guard first
 * (`packages/watchtower/src/shared/nostr-node.ts`); this is the browser's.
 *
 * nostr-tools sets `onopen` straight after it builds a socket and sets it back to null only when it
 * abandons one, so that assignment is the moment to close it — **whether it would have opened later
 * or never**. A socket that opens with nobody holding it is closed too, as on the box.
 *
 * Built on first use rather than at module scope, so prerendering never evaluates `extends`
 * against a WebSocket that is not there.
 */
function guardedWebSocket(): typeof WebSocket | undefined {
  const Base = globalThis.WebSocket;
  if (typeof Base !== 'function') return undefined;
  return class extends Base {
    constructor(...args: ConstructorParameters<typeof WebSocket>) {
      super(...args);
      closeWhenLetGo(this);
    }
  };
}

function closeWhenLetGo(ws: WebSocket): void {
  // The handler as the platform defines it: an accessor on the prototype in a browser, a plain
  // field on the stand-ins the browser tests install.
  let found: PropertyDescriptor | undefined;
  for (let o: object | null = ws; o && !found; o = Object.getPrototypeOf(o)) {
    found = Object.getOwnPropertyDescriptor(o, 'onopen');
  }
  const own = found;
  if (own && ('value' in own || (own.get && own.set))) {
    let value: unknown = 'value' in own ? own.value : undefined;
    let held = false;
    let letGo = false;
    Object.defineProperty(ws, 'onopen', {
      configurable: true,
      enumerable: true,
      get: () => (own.get ? own.get.call(ws) : value),
      set: (handler: unknown) => {
        if (own.set) own.set.call(ws, handler);
        else value = handler;
        if (handler) {
          held = true;
          return;
        }
        if (!held || letGo) return;
        letGo = true;
        // Let go while connecting or open: nobody will read it, and nobody else will close it.
        // A moment later, once nostr-tools has let go of the other handlers too: closing can fire
        // `error` straight away, and its own handler would take this for a fresh failure.
        queueMicrotask(() => {
          if (ws.readyState === 0 || ws.readyState === 1) ws.close();
        });
      }
    });
  }
  // Added before nostr-tools' own handler exists, so it runs first.
  if (typeof ws.addEventListener === 'function') {
    ws.addEventListener('open', () => {
      if (ws.onopen === null) ws.close();
    });
  }
}
