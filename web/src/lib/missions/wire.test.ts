/**
 * The missions' own wire, through the app's real pool, against relays on this machine that answer,
 * refuse, drop, hang and say nothing [audit 11, second grid].
 *
 * Every other missions test stands a fake `Wire` in, and the fakes said "nobody answered" with an
 * empty list — which the real wire never did. nostr-tools reports a failed connection, a refusal
 * and a dropped socket each as an end-of-answer just before the close, and the wire counted that
 * as an answer: offline, a challenged report read "Settled · unchallenged" and was kept so for
 * good. These run the real thing. Nothing here leaves 127.0.0.1: any other address is sent to a
 * port nothing listens on, which is what no signal looks like from here.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { WebSocketServer, type WebSocket as Peer } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import { readMissionPackage, type Mission } from '@navcom/core';
import { set } from '$lib/terminal/storage';

/** No signal: anything not on this machine is dialled at a port nothing listens on. */
const Base = globalThis.WebSocket;
globalThis.WebSocket = class extends Base {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(String(url).startsWith('ws://127.0.0.1:') ? url : 'ws://127.0.0.1:1', protocols);
  }
} as typeof WebSocket;

const { wire, inboxOf } = await import('./claims');
const { fileReport, localDay, sent, settlements } = await import('./reports');

type Reply = 'eose' | 'closed' | 'drop' | 'silent';

const servers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const close of servers) await close();
  globalThis.WebSocket = Base;
});

async function relay(reply: Reply | 'never-handshake', events: Event[] = []): Promise<string> {
  const http = createServer();
  const wss = new WebSocketServer({ noServer: true });
  const tcp = new Set<Socket>();
  const peers = new Set<Peer>();
  http.on('connection', (s) => {
    tcp.add(s);
    s.on('close', () => tcp.delete(s));
  });
  http.on('upgrade', (req: IncomingMessage, socket, head) => {
    if (reply === 'never-handshake') return;
    wss.handleUpgrade(req, socket, head, (peer) => {
      peers.add(peer);
      peer.on('close', () => peers.delete(peer));
      peer.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as unknown[];
        if (msg[0] !== 'REQ') return;
        const id = msg[1] as string;
        if (reply === 'drop') return void peer.terminate();
        if (reply === 'closed') return void peer.send(JSON.stringify(['CLOSED', id, 'auth-required: sign in']));
        if (reply === 'silent') return;
        for (const e of events) peer.send(JSON.stringify(['EVENT', id, e]));
        peer.send(JSON.stringify(['EOSE', id]));
      });
    });
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));
  servers.push(
    () =>
      new Promise<void>((resolve) => {
        for (const p of peers) p.terminate();
        for (const s of tcp) s.destroy();
        wss.close();
        http.close(() => resolve());
      })
  );
  return `ws://127.0.0.1:${(http.address() as AddressInfo).port}`;
}

beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  };
  set('accruing', 'secret', 'ab'.repeat(32));
  set('accruing', 'callsign', 'Kestrel');
});

describe('which relays the real wire says answered', () => {
  it('counts a relay that finished answering, and none that refused, dropped, never opened or said nothing', async () => {
    const posterSecret = generateSecretKey();
    const list = finalizeEvent({ kind: 10050, created_at: 1791300000, content: '', tags: [['relay', 'wss://inbox.example']] }, posterSecret);
    const answers = await relay('eose', [list]);
    const refuses = await relay('closed');
    const drops = await relay('drop');
    const hangs = await relay('never-handshake');
    const silent = await relay('silent');
    const heard = await wire.query([answers, refuses, drops, hangs, silent, 'wss://record.example'], { kinds: [10050] });
    expect(heard.answered).toEqual([answers]);
    expect(heard.events.map((e) => e.id)).toEqual([list.id]);
  }, 20_000);

  it('says nobody answered when no relay could be reached, so a sealed claim says so rather than blaming the poster', async () => {
    const refuses = await relay('closed');
    const heard = await wire.query([refuses, 'wss://nos.example'], { kinds: [10050] });
    expect(heard.answered).toEqual([]);
    const inbox = await inboxOf('a'.repeat(64), wire);
    expect(inbox).toEqual({ urls: [], answered: false });
  }, 20_000);
});

describe('a report read with no signal', () => {
  const NOW = 1791403200; // 7 Oct 2026, 20:00 UTC
  const posterSecret = generateSecretKey();
  const publishers = { [getPublicKey(posterSecret)]: { name: 'Test Poster', agent: true } };
  const e = finalizeEvent(
    {
      kind: 30079,
      created_at: NOW - 86_400,
      content: JSON.stringify({ name: 'Heat', objectives: [{ id: 'handout:water', ask: 'Hand out water.' }] }),
      tags: [['d', 'heat'], ['t', 'starcom_mission_package'], ['t', 'navcom_handoff'], ['t', 'navcom_mission'],
        ['mission_state', 'open'], ['valid_until', String(NOW + 10 * 86_400)], ['jurisdiction', 'us-ca']]
    },
    posterSecret
  );
  const read = readMissionPackage(e, publishers);
  const m = (read as { mission: Mission }).mission;

  it('is unknown on the ninth day, and nothing is kept as how it settled', async () => {
    const took: Wire = { publish: async () => true, query: async (urls) => ({ events: [], answered: urls }) };
    const filed = await fileReport(m, { date: localDay(NOW - 86_400), asks: ['handout:water'], counts: [] }, 'open', NOW, {}, took);
    expect(filed.ok).toBe(true);
    // Every relay it would ask is somewhere else, and there is no signal to reach it.
    const after = await settlements(NOW + 9 * 86_400, wire);
    expect(after.answered).toEqual({ poster: false, operators: false });
    expect(after.standing.size).toBe(0);
    expect(sent()[0]!.final).toBeUndefined();
  }, 20_000);
});

type Wire = import('./claims').Wire;
