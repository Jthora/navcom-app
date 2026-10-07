/**
 * Live subscriptions and the pool, against real relays on this machine [review: relay paths].
 *
 * The stand-in pools elsewhere behave the way their authors believed nostr-tools does, and the
 * defects these cover lived in the gap between that belief and the library: its stand-in EOSE, its
 * close-reason wrapper, the sockets it abandons, and a pool a burn could not finish. So these run
 * the app's own `pool()` — a real `SimplePool` on Node's WebSocket — against relays that misbehave
 * on purpose. Nothing here leaves 127.0.0.1.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { WebSocketServer, type WebSocket as Peer } from 'ws';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';

/** What a relay does with a REQ: the nth one it has had, counting from 1. */
type Reply = 'eose' | 'silent' | 'drop' | { closed: unknown } | { eoseThenClosed: unknown };

interface Relay {
  url: string;
  /** Every REQ, in arrival order, with when it came. */
  reqs: number[];
  /** Every CLOSE, with when it came. */
  closes: number[];
  /** TCP connections made to it, including ones that never finished their handshake. */
  dials: () => number;
  /** WebSocket connections that finished their handshake and are open now. */
  open: () => number;
  /** Sends an event to every open subscription. */
  send: (event: object) => void;
  close: () => Promise<void>;
}

const relays: Relay[] = [];

async function relay(opts: { reply?: (n: number) => Reply; handshakeMs?: number; neverHandshake?: boolean } = {}): Promise<Relay> {
  const http = createServer();
  const wss = new WebSocketServer({ noServer: true });
  const tcp = new Set<Socket>();
  let dials = 0;
  const peers = new Set<Peer>();
  const subs = new Map<Peer, Set<string>>();
  const reqs: number[] = [];
  const closes: number[] = [];

  http.on('connection', (socket) => {
    dials++;
    tcp.add(socket);
    socket.on('close', () => tcp.delete(socket));
  });
  http.on('upgrade', (req: IncomingMessage, socket, head) => {
    if (opts.neverHandshake) return;
    const finish = () =>
      wss.handleUpgrade(req, socket, head, (peer) => {
        peers.add(peer);
        subs.set(peer, new Set());
        peer.on('close', () => {
          peers.delete(peer);
          subs.delete(peer);
        });
        peer.on('message', (raw) => {
          let msg: unknown[];
          try {
            msg = JSON.parse(String(raw)) as unknown[];
          } catch {
            return;
          }
          const id = msg[1] as string;
          if (msg[0] === 'CLOSE') {
            closes.push(Date.now());
            return void subs.get(peer)?.delete(id);
          }
          if (msg[0] !== 'REQ') return;
          reqs.push(Date.now());
          const how = opts.reply?.(reqs.length) ?? 'eose';
          if (how === 'silent') return void subs.get(peer)?.add(id);
          // The connection goes, as one on a dying cell does.
          if (how === 'drop') return void peer.terminate();
          if (how === 'eose') {
            subs.get(peer)?.add(id);
            return void peer.send(JSON.stringify(['EOSE', id]));
          }
          if ('closed' in how) return void peer.send(JSON.stringify(['CLOSED', id, how.closed]));
          peer.send(JSON.stringify(['EOSE', id]));
          setTimeout(() => peer.send(JSON.stringify(['CLOSED', id, how.eoseThenClosed])), 50);
        });
      });
    if (opts.handshakeMs) setTimeout(finish, opts.handshakeMs);
    else finish();
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));
  const { port } = http.address() as AddressInfo;

  const made: Relay = {
    url: `ws://127.0.0.1:${port}`,
    reqs,
    closes,
    dials: () => dials,
    open: () => peers.size,
    send: (event) => {
      for (const [peer, ids] of subs) for (const id of ids) peer.send(JSON.stringify(['EVENT', id, event]));
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const peer of peers) peer.terminate();
        for (const socket of tcp) socket.destroy();
        wss.close();
        http.close(() => resolve());
      })
  };
  relays.push(made);
  return made;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await sleep(20);
  }
}

const author = generateSecretKey();
const note = () => finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'x' }, author);

/** Fresh modules for every test: a burn is permanent for the pool module that saw it. */
let live: typeof import('./subscribe');
let pools: typeof import('./pool');
const opened: { close(): void }[] = [];

beforeEach(async () => {
  vi.resetModules();
  pools = await import('./pool');
  live = await import('./subscribe');
  // Somewhere for "back online" to be said, as a browser has.
  (globalThis as { window?: EventTarget }).window = new EventTarget();
});

afterEach(async () => {
  for (const o of opened.splice(0)) o.close();
  pools.destroyPool();
  delete (globalThis as { window?: EventTarget }).window;
  await Promise.all(relays.splice(0).map((r) => r.close()));
});

const subscribe = (...args: Parameters<typeof live.subscribeLive>) => {
  const s = live.subscribeLive(...args);
  opened.push(s);
  return s;
};

describe('a relay that takes the subscription and never answers', () => {
  it('is not counted as answering: nostr-tools’ stand-in EOSE is not an answer', async () => {
    // It fires by itself 4.4 seconds after a REQ, and was counted: a hung relay read as one that
    // had answered with nothing, and Find said "None here" when this phone could not ask.
    const hung = await relay({ reply: () => 'silent' });
    const told: number[] = [];
    const s = subscribe([hung.url], { kinds: [1] }, { onevent: () => {}, oneose: (n) => told.push(n) });
    await sleep(6_000);
    expect(told, 'the stand-in EOSE was counted as the relay answering').toEqual([]);
    expect(s.listening()).toEqual([]);
    await until(() => told.length > 0, 8_000, 'a verdict on the silent relay');
    expect(told).toEqual([0]);
  }, 20_000);
});

describe('a relay that closes the subscription with a reason that is not a string', () => {
  // The pool's wrapper calls reason.startsWith(...), which threw on these: the subscription was
  // gone, nothing was told, and it was never asked for again while the screen was open.
  it.each([
    ['null', null],
    ['an empty object', {}]
  ])('is asked again after %s, and what it sends afterwards arrives', async (_name, reason) => {
    const r = await relay({ reply: (n) => (n === 1 ? { eoseThenClosed: reason } : 'eose') });
    const got: string[] = [];
    subscribe([r.url], { kinds: [1] }, { onevent: (e) => got.push(e.id) });
    await until(() => r.reqs.length >= 2, 4_000, 'the subscription asked for again');
    await sleep(100);
    const e = note();
    r.send(e);
    await until(() => got.includes(e.id), 2_000, 'the event after the reopen');
  }, 15_000);
});

describe('a relay that refuses every subscription', () => {
  it('is asked again less and less often, not every second', async () => {
    const refusing = await relay({ reply: () => ({ closed: 'rate-limited: slow down' }) });
    subscribe([refusing.url], { kinds: [1] }, { onevent: () => {} });
    await sleep(8_000);
    // At about 0, 1, 3 and 7 seconds. Every second would be eight or nine.
    expect(refusing.reqs.length, `asked ${refusing.reqs.length} times in 8 seconds`).toBeLessThanOrEqual(5);
    const gaps = refusing.reqs.slice(1).map((t, i) => t - refusing.reqs[i]!);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeGreaterThan(gaps[i - 1]! * 1.5);
  }, 15_000);
});

describe('a wake, for a relay that refuses and for one whose connection goes [review: relay paths]', () => {
  it('asks a relay that refused again at once, and keeps its wait', async () => {
    // A wake started every wait over, so a refusing relay was asked again at one, three and seven
    // seconds each time the phone came back to the screen.
    const refusing = await relay({ reply: () => ({ closed: 'rate-limited: slow down' }) });
    subscribe([refusing.url], { kinds: [1] }, { onevent: () => {} });
    // Asked at about 0, 1 and 3 seconds; the next wait is four.
    await until(() => refusing.reqs.length === 3, 6_000, 'three refusals');
    await sleep(200);
    window.dispatchEvent(new Event('online'));
    await until(() => refusing.reqs.length === 4, 1_000, 'asked again on the wake');
    await sleep(2_500);
    expect(refusing.reqs, 'the wake started the wait over for a relay that refuses').toHaveLength(4);
  }, 15_000);

  it('starts the wait over for a relay whose connection went, since the network may be back', async () => {
    const dropping = await relay({ reply: () => 'drop' });
    subscribe([dropping.url], { kinds: [1] }, { onevent: () => {} });
    await until(() => dropping.reqs.length === 3, 6_000, 'three dropped connections');
    await sleep(200);
    window.dispatchEvent(new Event('online'));
    await until(() => dropping.reqs.length === 4, 1_000, 'asked again on the wake');
    // From one second again, not eight.
    await until(() => dropping.reqs.length === 5, 2_000, 'asked again a second later');
  }, 15_000);
});

describe('which relays a subscription is listening on', () => {
  it('names only the ones that answered and are still open', async () => {
    const fine = await relay();
    const auth = await relay({ reply: () => ({ closed: 'auth-required: members only' }) });
    const hung = await relay({ reply: () => 'silent' });
    const heard: string[][] = [];
    const s = subscribe([fine.url, auth.url, hung.url], { kinds: [1] }, { onevent: () => {}, onlisten: (now) => heard.push(now) });
    await until(() => s.listening().length > 0, 3_000, 'the answering relay listed');
    await sleep(1_500);
    expect(s.listening()).toEqual([fine.url]);
    expect(heard).toEqual([[fine.url]]);
  }, 15_000);
});

describe('a screen that closes before every relay has answered', () => {
  it('is told nothing afterwards', async () => {
    // Closing an unanswered subscription makes nostr-tools report an end-of-answer for it once
    // its connection gives up, and that was passed on: the next area read "no relay answered".
    const stuck = await relay({ neverHandshake: true });
    const told: number[] = [];
    const s = live.subscribeLive([stuck.url], { kinds: [1] }, { onevent: () => {}, oneose: (n) => told.push(n) });
    await sleep(100);
    s.close();
    await sleep(3_600);
    expect(told, 'a closed subscription spoke for the screen that replaced it').toEqual([]);
  }, 10_000);
});

describe('a subscription closed while its relay is still connecting [review: relay paths]', () => {
  it('lets the connection go once it is up, instead of keeping it open for nobody', async () => {
    // nostr-tools closes an idle connection only when an operation on it ends, and nothing had
    // been opened on this one: it stayed up, pinged every 29 seconds, until the page was reloaded.
    // The pool's idle time is shortened here from twenty seconds to one; the path is the same.
    (pools.pool() as unknown as { idleTimeout: number }).idleTimeout = 1_000;
    const slow = await relay({ handshakeMs: 1_000 });
    const s = live.subscribeLive([slow.url], { kinds: [1] }, { onevent: () => {} });
    await sleep(300);
    s.close();
    await until(() => slow.open() === 1, 3_000, 'the handshake finishing');
    await sleep(2_000);
    expect(slow.reqs, 'something was asked for on a connection nobody wanted').toEqual([]);
    expect(slow.open(), 'the connection is still open, for nobody').toBe(0);
    expect((pools.pool() as unknown as { relays: Map<string, unknown> }).relays.size).toBe(0);
  }, 10_000);

  it('leaves it up when another screen has started using it meanwhile', async () => {
    (pools.pool() as unknown as { idleTimeout: number }).idleTimeout = 1_000;
    const slow = await relay({ handshakeMs: 1_000 });
    const left = live.subscribeLive([slow.url], { kinds: [1] }, { onevent: () => {} });
    const other = subscribe([slow.url], { kinds: [2] }, { onevent: () => {} });
    await sleep(300);
    left.close();
    await until(() => other.listening().length === 1, 3_000, 'the other screen answered');
    await sleep(2_000);
    expect(slow.open(), 'a connection in use was closed under the screen using it').toBe(1);
    expect(other.listening()).toEqual([slow.url]);
  }, 10_000);
});

describe('moving a subscription to another list of relays, on the app’s pool [review: relay paths]', () => {
  it('leaves a relay both lists share alone, lets a dropped one go at once, and asks a new one once it is up', async () => {
    const a = await relay();
    const b = await relay();
    const c = await relay({ handshakeMs: 300 });
    const s = subscribe([a.url, b.url], { kinds: [1] }, { onevent: () => {} });
    await until(() => s.listening().length === 2, 3_000, 'both answering');
    const movedAt = Date.now();
    s.follow([b.url, c.url]);
    await until(() => s.listening().includes(c.url), 3_000, 'the new relay answering');
    expect(b.closes, 'a relay on both lists was let go').toEqual([]);
    expect(b.reqs, 'a relay on both lists was asked again').toHaveLength(1);
    expect(a.closes).toHaveLength(1);
    // Let go at once, before the new relay has finished its handshake — so for that long nothing
    // listens on either, as `follow` says.
    expect(a.closes[0]! - movedAt).toBeLessThan(200);
    expect(a.closes[0]!).toBeLessThan(c.reqs[0]!);
    expect([...s.listening()].sort()).toEqual([b.url, c.url].sort());
  }, 10_000);
});

describe('a burn', () => {
  it('ends every subscription for good: nothing reopens, nothing dials', async () => {
    const r = await relay();
    subscribe([r.url], { kinds: [1] }, { onevent: () => {} });
    await until(() => r.reqs.length === 1 && r.open() === 1, 3_000, 'subscribed before the burn');
    // What core's Distress loop holds, from before the burn.
    const held = pools.pool();
    const dials = r.dials();
    const reqs = r.reqs.length;

    pools.destroyPool();
    await sleep(2_500);
    window.dispatchEvent(new Event('online'));
    await sleep(500);

    // After the burn, through any way in.
    const told: number[] = [];
    live.subscribeLive([r.url], { kinds: [1] }, { onevent: () => {}, oneose: (n) => told.push(n) });
    held.subscribeMany([r.url], { kinds: [1] }, { onevent: () => {} });
    const sent = await Promise.allSettled(pools.pool().publish([r.url], note()));
    await sleep(1_500);

    expect(r.reqs.length, 'a burned phone asked a relay for something').toBe(reqs);
    expect(r.dials(), 'a burned phone dialled a relay').toBe(dials);
    expect(r.open(), 'a socket was left open after the burn').toBe(0);
    expect(told).toEqual([0]);
    expect(sent[0]).toMatchObject({ status: 'rejected' });
    expect(String((sent[0] as PromiseRejectedResult).reason)).toMatch(/burned/);
  }, 15_000);
});

/**
 * Runs with this socket class as the platform's, for the app's pool and for nostr-tools' own
 * default alike, and puts both back after.
 */
async function withSocket(Socket: typeof WebSocket, run: () => Promise<void>): Promise<void> {
  const { useWebSocketImplementation } = await import('nostr-tools/pool');
  const Base = globalThis.WebSocket;
  globalThis.WebSocket = Socket;
  useWebSocketImplementation(Socket);
  try {
    vi.resetModules();
    pools = await import('./pool');
    await run();
  } finally {
    globalThis.WebSocket = Base;
    useWebSocketImplementation(Base);
  }
}

describe('a connection nostr-tools gives up on', () => {
  it('is closed when its handshake finishes late, not left open behind it', async () => {
    // A congested cell takes longer than nostr-tools' timeout to finish a handshake. It gave up,
    // never closed the socket, and the browser kept the late connection open: one per reopen.
    const slow = await relay({ handshakeMs: 1_500 });
    await expect(pools.pool().ensureRelay(slow.url, { connectionTimeout: 500 })).rejects.toBeDefined();
    await sleep(2_500);
    expect(slow.open(), 'an abandoned connection is still open').toBe(0);
  }, 10_000);

  it('is closed even when its handshake never finishes', async () => {
    const made: WebSocket[] = [];
    const Recording = class extends globalThis.WebSocket {
      constructor(...args: ConstructorParameters<typeof WebSocket>) {
        super(...args);
        made.push(this);
      }
    };
    await withSocket(Recording, async () => {
      const stuck = await relay({ neverHandshake: true });
      await expect(pools.pool().ensureRelay(stuck.url, { connectionTimeout: 300 })).rejects.toBeDefined();
      expect(made).toHaveLength(1);
      expect(made[0]!.readyState, 'still connecting, held by nobody').toBe(2);
    });
  }, 10_000);

  it('leaves a connection nostr-tools still holds alone', async () => {
    const r = await relay();
    const held = await pools.pool().ensureRelay(r.url, { connectionTimeout: 1_000 });
    await sleep(500);
    expect(held.connected).toBe(true);
    expect(r.open()).toBe(1);
  }, 10_000);

  it('works the same on a stand-in socket whose handlers are plain fields, as the browser tests use', async () => {
    const closed: string[] = [];
    class StandIn extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readyState = 0;
      onopen: ((e: unknown) => void) | null = null;
      onclose: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onmessage: ((e: unknown) => void) | null = null;
      constructor(readonly url: string) {
        super();
        if (url.includes('opens')) {
          setTimeout(() => {
            this.readyState = 1;
            this.onopen?.(new Event('open'));
          }, 0);
        }
      }
      send(): void {}
      close(): void {
        this.readyState = 3;
        closed.push(this.url);
      }
    }
    // Loopback addresses, though the stand-in dials nothing at all.
    await withSocket(StandIn as unknown as typeof WebSocket, async () => {
      const up = await pools.pool().ensureRelay('ws://127.0.0.1:9/opens', { connectionTimeout: 300 });
      expect(up.connected).toBe(true);
      await expect(pools.pool().ensureRelay('ws://127.0.0.1:9/never', { connectionTimeout: 300 })).rejects.toBeDefined();
      await Promise.resolve();
      expect(closed).toEqual(['ws://127.0.0.1:9/never']);
    });
  }, 10_000);
});
