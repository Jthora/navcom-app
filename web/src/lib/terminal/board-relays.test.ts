/**
 * Holding the watch on relays that misbehave, with the app's own pool [review: relay paths].
 *
 * `board.test.ts` drives the board through a stand-in pool. This runs the real board, the real
 * live subscription and the real `SimplePool` on Node's WebSocket against relays on this machine,
 * because the defect here lived in timing the stand-in only imitates: a relay that answers each
 * subscription and ends it a moment later was, at every reopen, hearing for long enough to have
 * the holder announced on it, so the claim never went stale while nothing on the phone heard a
 * `Distress` for more than a fraction of a second at a time. Nothing here leaves 127.0.0.1.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { WebSocketServer, type WebSocket as Peer } from 'ws';
import type { Event } from 'nostr-tools/core';
import { KIND_WATCH_STATE, newSecretKey, publicKeyOf } from '@navcom/core';

const watch = newSecretKey();
const watchPub = publicKeyOf(watch);
/** The watch's relays, which each test sets to the relay it made. */
let list: string[] = [];

vi.mock('./identity', () => ({
  loadIdentity: () => ({ secretKey: watch, pubkey: watchPub, callsign: 'Wren' })
}));
vi.mock('./config', () => ({ loadConfig: () => ({ watchtower: watchPub, relays: list }) }));
vi.mock('./watch-key', () => ({ watchKey: () => watch, watchPubkey: () => watchPub }));
vi.mock('./relays', () => ({ relays: () => list, watchRelays: () => list }));

/** What a relay does after answering a REQ: nothing more, end the subscription, or drop the connection. */
type After = 'stay' | { closedAfterMs: number } | { dropAfterMs: number };

interface Relay {
  url: string;
  reqs: number[];
  /** Every event published to it. */
  events: Event[];
  close: () => Promise<void>;
}

const made: Relay[] = [];

/** Stores and serves events, answers every REQ with EOSE, and then does what `after` says. */
async function relay(after: After = 'stay'): Promise<Relay> {
  const http = createServer();
  const wss = new WebSocketServer({ noServer: true });
  const tcp = new Set<Socket>();
  const peers = new Set<Peer>();
  const reqs: number[] = [];
  const events: Event[] = [];
  http.on('connection', (socket) => {
    tcp.add(socket);
    socket.on('close', () => tcp.delete(socket));
  });
  http.on('upgrade', (req: IncomingMessage, socket, head) =>
    wss.handleUpgrade(req, socket, head, (peer) => {
      peers.add(peer);
      peer.on('close', () => peers.delete(peer));
      peer.on('message', (raw) => {
        let msg: unknown[];
        try {
          msg = JSON.parse(String(raw)) as unknown[];
        } catch {
          return;
        }
        if (msg[0] === 'EVENT') {
          const event = msg[1] as Event;
          events.push(event);
          return void peer.send(JSON.stringify(['OK', event.id, true, '']));
        }
        if (msg[0] !== 'REQ') return;
        const id = msg[1] as string;
        reqs.push(Date.now());
        peer.send(JSON.stringify(['EOSE', id]));
        if (after === 'stay') return;
        if ('closedAfterMs' in after) {
          setTimeout(() => peer.readyState === 1 && peer.send(JSON.stringify(['CLOSED', id, 'error: subscription ended'])), after.closedAfterMs);
        } else {
          setTimeout(() => peer.terminate(), after.dropAfterMs);
        }
      });
    })
  );
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));
  const { port } = http.address() as AddressInfo;
  const r: Relay = {
    url: `ws://127.0.0.1:${port}`,
    reqs,
    events,
    close: () =>
      new Promise<void>((resolve) => {
        for (const peer of peers) peer.terminate();
        for (const socket of tcp) socket.destroy();
        wss.close();
        http.close(() => resolve());
      })
  };
  made.push(r);
  return r;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await sleep(20);
  }
}

/** The holder's claims a relay received. */
const stationsOn = (r: Relay) =>
  r.events.filter((e) => e.kind === KIND_WATCH_STATE && JSON.parse(e.content).state === 'station');

let board: typeof import('./board.svelte').board;
let pools: typeof import('./pool');

beforeEach(async () => {
  vi.resetModules();
  // Somewhere for "back online" to be said, as a browser has.
  (globalThis as { window?: EventTarget }).window = new EventTarget();
  pools = await import('./pool');
  ({ board } = await import('./board.svelte'));
});

afterEach(async () => {
  board.forget();
  pools.destroyPool();
  delete (globalThis as { window?: EventTarget }).window;
  await Promise.all(made.splice(0).map((r) => r.close()));
});

describe('a holder whose relay answers the board and ends it again a moment later', () => {
  it.each([
    ['ends the subscription 50 ms after answering it', { closedAfterMs: 50 }],
    ['drops the connection 300 ms after answering', { dropAfterMs: 300 }]
  ] as const)('is announced nowhere by a relay that %s', async (_name, after) => {
    const r = await relay(after);
    list = [r.url];
    board.start();
    await until(() => r.reqs.length >= 1, 3_000, 'the board asking');
    await until(() => board.deaf, 3_000, 'the relay ending the subscription');
    await board.takeWatch();
    // It is asked again at about one, three and seven seconds, and answers every time.
    await sleep(8_500);
    expect(r.reqs.length, 'the relay was not asked again: nothing was tested').toBeGreaterThanOrEqual(4);
    expect(stationsOn(r), 'a human announced on a relay this phone hears on for a moment at a time').toEqual([]);
    expect(board.onStation).toBe(true);
    expect(board.announced).toBe(false);
  }, 20_000);

  it('still announces the holder on a relay that answers and stays', async () => {
    const r = await relay();
    list = [r.url];
    board.start();
    await until(() => r.reqs.length >= 1, 3_000, 'the board asking');
    await sleep(200);
    await board.takeWatch();
    await until(() => stationsOn(r).length === 1, 3_000, 'the claim reaching the relay');
    expect(board.announced).toBe(true);
    expect(board.deaf).toBe(false);
  }, 10_000);
});
