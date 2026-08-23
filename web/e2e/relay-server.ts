import { WebSocketServer, type WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';

/**
 * A real relay, on this machine.
 *
 * `verification.md` lists this under what nothing covers: *"peer presence has never crossed a
 * real relay, and one browser context cannot test two operators meaningfully."* Every
 * two-device test in this suite runs against `ReplayingSocket` — a stub that hands back canned
 * events and never speaks the protocol.
 *
 * ## Why not a public relay
 *
 * `device.ts` already answered that, and it is right: *"that is somebody else's volunteer-run
 * server, it makes results depend on their uptime, and a test that can fail because a stranger
 * rebooted a box is not a test."* Nothing here touches the internet.
 *
 * ## What this does and does not prove
 *
 * It proves the **client's** side is real: an actual WebSocket, `SimplePool` opening and
 * closing subscriptions, `["REQ", …]` with filters the client composed, `["EVENT", …]` frames
 * it signed and serialised, `EOSE`, and events arriving at a second browser context that
 * subscribed independently. All of that is faked by the stub today.
 *
 * It does **not** prove that any particular public relay behaves — their filter handling,
 * rate limits and retention differ, and this deliberately implements NIP-01 plainly. So it
 * closes *"the client has never spoken to a relay"* and leaves *"this works against
 * relay.damus.io"* open, which still needs two phones and a person.
 */

interface Filter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  [tag: string]: unknown;
}

interface Event {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/** NIP-01 filter matching, plainly. Deliberately not clever. */
function matches(filter: Filter, event: Event): boolean {
  if (filter.ids && !filter.ids.includes(event.id)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (typeof filter.since === 'number' && event.created_at < filter.since) return false;
  if (typeof filter.until === 'number' && event.created_at > filter.until) return false;

  for (const [key, want] of Object.entries(filter)) {
    if (!key.startsWith('#') || !Array.isArray(want)) continue;
    const letter = key.slice(1);
    const has = event.tags.filter((t) => t[0] === letter).map((t) => t[1]);
    if (!want.some((w) => has.includes(w as string))) return false;
  }
  return true;
}

export interface LocalRelay {
  url: string;
  /** Everything published to it, in arrival order. */
  received: Event[];
  close(): Promise<void>;
}

export async function startRelay(): Promise<LocalRelay> {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  const stored: Event[] = [];
  /** Open subscriptions, so a later event reaches a subscriber that asked before it existed. */
  const subs = new Map<WebSocket, Map<string, Filter[]>>();

  wss.on('connection', (socket) => {
    subs.set(socket, new Map());

    socket.on('message', (raw) => {
      let msg: unknown[];
      try {
        msg = JSON.parse(String(raw)) as unknown[];
      } catch {
        return;
      }

      if (msg[0] === 'EVENT') {
        const event = msg[1] as Event;
        stored.push(event);
        // Acknowledged, because a client that awaits its own publish hangs without this —
        // the same omission the stubbed socket was fixed for.
        socket.send(JSON.stringify(['OK', event.id, true, '']));

        for (const [peer, theirs] of subs) {
          if (peer.readyState !== peer.OPEN) continue;
          for (const [id, filters] of theirs) {
            if (filters.some((f) => matches(f, event))) {
              peer.send(JSON.stringify(['EVENT', id, event]));
            }
          }
        }
        return;
      }

      if (msg[0] === 'REQ') {
        const id = msg[1] as string;
        const filters = msg.slice(2) as Filter[];
        subs.get(socket)?.set(id, filters);
        for (const event of stored) {
          if (filters.some((f) => matches(f, event))) {
            socket.send(JSON.stringify(['EVENT', id, event]));
          }
        }
        socket.send(JSON.stringify(['EOSE', id]));
        return;
      }

      if (msg[0] === 'CLOSE') subs.get(socket)?.delete(msg[1] as string);
    });

    socket.on('close', () => subs.delete(socket));
  });

  await new Promise<void>((resolve) => wss.once('listening', resolve));
  const { port } = wss.address() as AddressInfo;

  return {
    url: `ws://127.0.0.1:${port}`,
    received: stored,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of subs.keys()) socket.terminate();
        wss.close(() => resolve());
      })
  };
}
