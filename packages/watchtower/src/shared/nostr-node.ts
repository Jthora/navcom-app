import { SimplePool, useWebSocketImplementation } from "nostr-tools/pool";
import WebSocket from "ws";

let installed = false;

/**
 * `ws`, with one listener on `error` that is never taken away.
 *
 * nostr-tools detaches its own handlers when it gives up on a socket -- `ws.onerror = null`
 * after a connection timeout -- while the socket is still open underneath. A relay that took
 * the TCP connection and never finished the handshake then resets it, `ws` emits `error` with
 * nobody listening, and Node turns that into an uncaught exception: the daemon's handler exits
 * the process. Found in the F05 probes ("UNCAUGHT: socket hang up" from orphaned sockets on a
 * stalled relay). One permanent no-op listener makes that error what it already is, a socket
 * nobody wants any more; nostr-tools' own handlers still fire while it holds them.
 *
 * **And a socket nobody owns is closed when it opens** [review: relay paths]. The same give-up
 * never closes the socket, so a handshake that finished after the three-second timeout -- a
 * congested uplink, an overloaded relay -- left an open connection behind, kept alive by `ws`
 * answering the relay's pings. The listeners retry a slow relay every fifteen seconds, so that was
 * one leaked connection per attempt, and a relay that caps connections per address would in the
 * end refuse the box. nostr-tools sets `onopen` straight after construction and nulls it when it
 * abandons a socket, so a null `onopen` at open is exactly a socket nobody holds. This listener
 * is added first, so it runs before nostr-tools' own.
 */
class NodeWebSocket extends WebSocket {
  constructor(...args: ConstructorParameters<typeof WebSocket>) {
    super(...args);
    this.on("error", () => {});
    this.on("open", () => {
      if (this.onopen === null) this.close();
    });
  }
}

/**
 * nostr-tools' relay/pool code expects a global WebSocket (browser-native
 * there); Node has no such global, so this wires the `ws` package in
 * once per process.
 *
 * Node 22 does have one, which is how four tools shipped without calling this and worked on the
 * machine they were written on [F07]. `engines` says `>=20`, and on Node 20 the pager printed
 * that it was watching while it could not open a single socket. Call `nodePool()` rather than
 * this, so the order cannot be got wrong.
 */
export function installNodeWebSocket(): void {
  if (installed) return;
  useWebSocketImplementation(NodeWebSocket as unknown as typeof globalThis.WebSocket);
  installed = true;
}

export interface NodePoolOptions {
  /**
   * Ping each relay, so a connection that died without a word -- a NAT that forgot it, a router
   * rebooted under it -- is noticed and closed rather than read as open forever. Anything that
   * listens for longer than a command takes to run wants this.
   */
  enablePing?: boolean;
  /**
   * Off by default, and that is deliberate [F04].
   *
   * nostr-tools' reconnect rewrites a subscription's `since` to one past the newest `created_at`
   * it was sent -- by anybody, verified or not -- so a single future-dated event made every
   * listener here deaf after the next reconnect. Its first retry also waits ten seconds, the whole
   * of the CLI's response window. Listeners heal themselves instead (`shared/relay-listener.ts`),
   * with a fresh filter each time.
   */
  enableReconnect?: boolean;
}

/**
 * The one place a node-side `SimplePool` is built.
 *
 * `SimplePool` reads the WebSocket implementation when it is **constructed**, so installing it
 * afterwards does nothing for a pool that already exists. A factory makes the order structural:
 * there is no way to get a pool from here without the socket it needs.
 */
export function nodePool(opts: NodePoolOptions = {}): SimplePool {
  installNodeWebSocket();
  return new SimplePool({ enableReconnect: false, ...opts });
}
