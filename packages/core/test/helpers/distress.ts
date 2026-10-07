/**
 * What the `Distress` tests share [G3 phase 1]: real pools that reach loopback and nothing else,
 * relays on 127.0.0.1, a phone's `Distress` left running, the watch's answer, and the stand-in pools
 * the older tests use.
 *
 * The real relays are `packages/watchtower/test/helpers/local-relay.ts`, imported and never edited,
 * and small servers below for what it cannot do. What a listener counts as "answered" is how
 * nostr-tools behaves on a socket, and a fake models only what somebody believed about that.
 *
 * Nothing leaves this machine: every pool here dials through a socket that refuses any address but
 * loopback, so even a loop that tried to reach The Record reaches nothing.
 */
import type { AddressInfo } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import { seal } from '../../src/crypto/envelope';
import { watchtowerAt } from '../../src/crypto/group';
import { KIND_DISTRESS, KIND_RESPONSE } from '../../src/events/kinds';
import { sendDistressUntilAcknowledged, type DistressOptions, type DistressPhase } from '../../src/transport';
import { startRelay, type LocalRelay } from '../../../watchtower/test/helpers/local-relay.js';

export { eventually, type LocalRelay } from '../../../watchtower/test/helpers/local-relay.js';

export const OPERATOR = generateSecretKey();
export const OUR_PUBKEY = getPublicKey(OPERATOR);
export const WATCH = generateSecretKey();
export const WATCH_PUBKEY = getPublicKey(WATCH);
export const AREA = { position: null, area: 'north side' };

const relays: LocalRelay[] = [];
const servers: { close(): Promise<void> }[] = [];
const pools: SimplePool[] = [];
const aborts: AbortController[] = [];

/** Stands every `Distress` down and closes every pool, relay and server. Each file's `afterEach`. */
export async function cleanup(): Promise<void> {
  for (const a of aborts.splice(0)) a.abort();
  for (const p of pools.splice(0)) p.destroy();
  await Promise.all([...relays.splice(0).map((r) => r.close()), ...servers.splice(0).map((s) => s.close())]);
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A real pool whose sockets reach loopback and nothing else, with every address it dialled and when.
 *
 * Anything else gets a socket that fails at once, as an unreachable relay's does. `ws` is given a
 * permanent `error` listener, as the box's sockets are: nostr-tools lets go of a socket it has given
 * up on, and a reset arriving after that is nobody's error.
 */
export function guardedPool() {
  const dialled: string[] = [];
  const dials: { url: string; at: number }[] = [];
  const Socket = Object.assign(
    function (url: string | URL) {
      const address = String(url);
      dialled.push(address);
      dials.push({ url: address, at: Date.now() });
      if (/^ws:\/\/127\.0\.0\.1:\d+(\/|$)/.test(address)) {
        const ws = new WebSocket(address);
        ws.on('error', () => {});
        return ws;
      }
      const refused: Record<string, unknown> = {
        readyState: 3,
        send() {},
        close() {},
        onopen: null,
        onerror: null,
        onclose: null,
        onmessage: null
      };
      setTimeout(() => (refused.onerror as ((e: unknown) => void) | null)?.({}), 0);
      return refused;
    },
    { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }
  );
  const pool = new SimplePool({ websocketImplementation: Socket } as never);
  pools.push(pool);
  return { pool, dialled, dials };
}

export async function relay(): Promise<LocalRelay> {
  const r = await startRelay();
  relays.push(r);
  return r;
}

export async function server(onConnection: (ws: WebSocket) => void, options: { verifyClient?: unknown } = {}) {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0, ...options } as never);
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
  wss.on('connection', (ws: WebSocket) => {
    ws.on('error', () => {});
    onConnection(ws);
  });
  const { port } = wss.address() as AddressInfo;
  const s = {
    url: `ws://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of wss.clients) c.terminate();
        wss.close(() => resolve());
      })
  };
  servers.push(s);
  return s;
}

/** A relay that takes every connection and drops it at once, as one behind a failing proxy does. */
export const droppingRelay = () => server((ws) => ws.terminate());

/** A relay that answers a subscription at once and says OK to an event only after `ms`. */
export async function slowRelay(ms: number) {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const s = await server((ws) => {
    ws.on('message', (data) => {
      let msg: unknown[];
      try {
        msg = JSON.parse(String(data)) as unknown[];
      } catch {
        return;
      }
      if (msg[0] === 'REQ') ws.send(JSON.stringify(['EOSE', msg[1]]));
      if (msg[0] === 'EVENT') {
        const id = (msg[1] as { id: string }).id;
        const t = setTimeout(() => {
          timers.delete(t);
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(['OK', id, true, '']));
        }, ms);
        timers.add(t);
      }
    });
  });
  servers.push({ close: async () => timers.forEach((t) => clearTimeout(t)) });
  return s;
}

/**
 * A relay whose WebSocket handshake is answered only after `ms`: a relay slow to connect, as one on a
 * congested cell is. It ends every subscription's stored events at once, takes every event, and
 * records each request and event with when it arrived; `deliver` sends an event to every open
 * subscription, as a relay does with one somebody else published.
 */
export async function slowHandshakeRelay(ms: number) {
  const reqs: { at: number; sub: string }[] = [];
  const events: { at: number; event: Event }[] = [];
  const open = new Map<WebSocket, Set<string>>();
  const pending = new Set<ReturnType<typeof setTimeout>>();
  const s = await server(
    (ws) => {
      open.set(ws, new Set());
      ws.on('close', () => open.delete(ws));
      ws.on('message', (data) => {
        let msg: unknown[];
        try {
          msg = JSON.parse(String(data)) as unknown[];
        } catch {
          return;
        }
        if (msg[0] === 'REQ') {
          reqs.push({ at: Date.now(), sub: String(msg[1]) });
          open.get(ws)?.add(String(msg[1]));
          ws.send(JSON.stringify(['EOSE', msg[1]]));
        } else if (msg[0] === 'CLOSE') {
          open.get(ws)?.delete(String(msg[1]));
        } else if (msg[0] === 'EVENT') {
          const event = msg[1] as Event;
          events.push({ at: Date.now(), event });
          ws.send(JSON.stringify(['OK', event.id, true, '']));
        }
      });
    },
    {
      verifyClient: (_info: unknown, done: (ok: boolean) => void) => {
        const t = setTimeout(() => {
          pending.delete(t);
          done(true);
        }, ms);
        pending.add(t);
      }
    }
  );
  servers.push({ close: async () => pending.forEach((t) => clearTimeout(t)) });
  return {
    url: s.url,
    reqs,
    events,
    /** Open subscriptions right now. */
    subscriptions: () => [...open.values()].reduce((n, subs) => n + subs.size, 0),
    deliver(event: Event) {
      for (const [ws, subs] of open) for (const sub of subs) ws.send(JSON.stringify(['EVENT', sub, event]));
    }
  };
}

type Said<K extends DistressPhase['phase']> = Extract<DistressPhase, { phase: K }> & { at: number };

/** A phone's `Distress`, left running, with every phase, when it was said, and when the loop ended. */
export function distress(pool: SimplePool, given: readonly string[] | (() => readonly string[]), opts: DistressOptions = {}) {
  const controller = new AbortController();
  aborts.push(controller);
  const phases: (DistressPhase & { at: number })[] = [];
  const started = Date.now();
  let endedAt: number | null = null;
  const done = sendDistressUntilAcknowledged(pool, given, OPERATOR, OUR_PUBKEY, watchtowerAt(WATCH_PUBKEY), AREA, {
    ackWindowMs: 400,
    backoffMs: 200,
    maxBackoffMs: 200,
    signal: controller.signal,
    ...opts,
    onPhase: (p) => {
      phases.push({ ...p, at: Date.now() - started });
      opts.onPhase?.(p);
    }
  }).then(
    (r: unknown) => {
      endedAt = Date.now();
      return r;
    },
    (e: unknown) => {
      endedAt = Date.now();
      return e;
    }
  );
  const said = <K extends DistressPhase['phase']>(name: K): Said<K>[] =>
    phases.filter((p) => p.phase === name) as Said<K>[];
  return { controller, phases, done, said, endedAt: () => endedAt, names: () => phases.map((p) => p.phase) };
}

/** The watch's answer to these ids, signed and sealed as the executor would. A person's, unless told. */
export function answer(ids: string[], kind: 'human' | 'agent' | 'node' = 'human'): Event {
  return finalizeEvent(
    {
      kind: KIND_RESPONSE,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', OUR_PUBKEY], ...ids.map((id) => ['e', id])],
      content: seal(WATCH, OUR_PUBKEY, {
        type: 'ack',
        responder: { kind, callsign: kind === 'human' ? 'Wren' : 'watchtower' },
        text: kind === 'human' ? 'Wren is responding.' : 'Holding.',
        provenance: null
      })
    },
    WATCH
  );
}

export const distresses = (r: LocalRelay) => r.published.filter((e) => e.kind === KIND_DISTRESS);

/* -------------------------------------------------------------------------------------------- */

/**
 * Pools that cannot hand over their relays -- the stand-ins the older tests use -- keep their own
 * path: subscribed through `subscribeMany`, and counted once its `oneose` fires, as nostr-tools'
 * pool fires it on a relay's EOSE.
 */
export function manyPool(opts: {
  eose: boolean;
  publish?: (url: string) => Promise<string>;
  /** Instead of an end-of-stored-events: what the relay does with each subscription. */
  onSubscribe?: (url: string, params: ManyParams, n: number) => void;
}) {
  const subscribed: string[] = [];
  const published: string[] = [];
  return {
    subscribed,
    published,
    publish(urls: string[]) {
      published.push(...urls);
      return urls.map((u) => (opts.publish ? opts.publish(u) : Promise.resolve('')));
    },
    subscribeMany(urls: string[], _f: unknown, params: ManyParams) {
      subscribed.push(...urls);
      if (opts.onSubscribe) opts.onSubscribe(urls[0]!, params, subscribed.length);
      else if (opts.eose) queueMicrotask(() => params.oneose?.());
      return { close() {} };
    },
    close() {}
  };
}

export interface ManyParams {
  onevent?: (event: Event) => void;
  oneose?: () => void;
  onclose?: (reason: unknown) => void;
}

/**
 * A `Distress` on a stand-in pool for `attempts` attempts, then stood down, with every phase.
 * The backoff is a real wait of `gapMs`, so every relay's answer arrives before the next attempt.
 */
export async function briefly(
  pool: unknown,
  given: readonly string[] | (() => readonly string[]),
  attempts: number,
  opts: DistressOptions = {},
  gapMs = 20
) {
  const controller = new AbortController();
  const phases: DistressPhase[] = [];
  let slept = 0;
  await sendDistressUntilAcknowledged(pool as SimplePool, given, OPERATOR, OUR_PUBKEY, watchtowerAt(WATCH_PUBKEY), AREA, {
    ackWindowMs: 5,
    ...opts,
    sleep: async () => {
      await new Promise((r) => setTimeout(r, gapMs));
      if (++slept >= attempts) controller.abort();
    },
    signal: controller.signal,
    onPhase: (p) => {
      phases.push(p);
      opts.onPhase?.(p);
    }
  }).catch(() => {});
  return phases;
}
