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

const { wire, inboxOf, takePart, held, claimAgain, letGo, unreleased } = await import('./claims');
const { fileReport, localDay, reportAgain, sent, settlements } = await import('./reports');

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

/** How a relay answers an event it is sent: takes it, refuses it, says nothing, or drops the connection. */
type Takes = 'ok' | 'refuse' | 'duplicate' | 'silent' | 'drop';

/** A relay that answers subscriptions with an end, and events as `takes` says — changeable mid-test. */
async function publishRelay(takes: Takes): Promise<{ url: string; takes: Takes; received: Event[] }> {
  const http = createServer();
  const wss = new WebSocketServer({ noServer: true });
  const tcp = new Set<Socket>();
  const peers = new Set<Peer>();
  const state = { url: '', takes, received: [] as Event[] };
  http.on('connection', (s) => {
    tcp.add(s);
    s.on('close', () => tcp.delete(s));
  });
  http.on('upgrade', (req: IncomingMessage, socket, head) => {
    wss.handleUpgrade(req, socket, head, (peer) => {
      peers.add(peer);
      peer.on('close', () => peers.delete(peer));
      peer.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as unknown[];
        if (msg[0] === 'REQ') return void peer.send(JSON.stringify(['EOSE', msg[1]]));
        if (msg[0] !== 'EVENT') return;
        const e = msg[1] as Event;
        state.received.push(e);
        if (state.takes === 'drop') return void peer.terminate();
        if (state.takes === 'silent') return;
        if (state.takes === 'refuse') return void peer.send(JSON.stringify(['OK', e.id, false, 'blocked: not here']));
        if (state.takes === 'duplicate') return void peer.send(JSON.stringify(['OK', e.id, false, 'duplicate: already have it']));
        peer.send(JSON.stringify(['OK', e.id, true, '']));
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
  state.url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}`;
  return state;
}

const signed = () => finalizeEvent({ kind: 1, created_at: 1791300000, content: 'x', tags: [] }, generateSecretKey());

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

describe('what the real wire says became of an event [audit 11.S, finding 61]', () => {
  /*
   * nostr-tools stops waiting for a relay's answer after 4.4 seconds and rejects, and the wire read
   * every rejection as "no relay took it". On a congested cell the relay had taken it: the screen
   * said "Nothing was sent", and the retry sent the same work again under a new id.
   */
  it('took when a relay took it, or already had it; refused when every relay said no or could not be reached', async () => {
    const takes = await publishRelay('ok');
    const has = await publishRelay('duplicate');
    const refuses = await publishRelay('refuse');
    // First, because the old wire got the others' answers right and this one wrong: a relay saying
    // it already holds the event is a relay holding it, not one refusing it [review].
    expect(await wire.publish([has.url], signed())).toBe('took');
    expect(await wire.publish([takes.url, 'wss://nowhere.example'], signed())).toBe('took');
    expect(await wire.publish([refuses.url, 'wss://nowhere.example'], signed())).toBe('refused');
    expect(await wire.publish(['wss://nowhere.example'], signed())).toBe('refused');
  }, 20_000);

  it('unconfirmed when a relay that was sent it never answered, or dropped with it on the way — never "refused"', async () => {
    const silent = await publishRelay('silent');
    const drops = await publishRelay('drop');
    const refuses = await publishRelay('refuse');
    expect(await wire.publish([silent.url, refuses.url, 'wss://nowhere.example'], signed())).toBe('unconfirmed');
    expect(silent.received).toHaveLength(1);
    expect(await wire.publish([drops.url], signed())).toBe('unconfirmed');
  }, 30_000);

  it('a report a relay took without answering in time is listed, and sent again as the same event', async () => {
    const relay = await publishRelay('silent');
    set('accruing', 'relays_own', [relay.url]);
    const NOW = 1791403200;
    const m = heatMission(NOW);
    const filed = await fileReport(m, { date: localDay(NOW - 86_400), asks: ['handout:water'], counts: [] }, 'open', NOW, {}, wire);
    expect(filed).toMatchObject({ ok: false, because: 'unconfirmed' });
    expect(sent()).toHaveLength(1);
    relay.takes = 'ok';
    expect(await reportAgain(sent()[0]!, wire)).toBe('took');
    const reports = relay.received.filter((e) => e.kind === 1912);
    expect(reports.map((e) => e.id)).toEqual([sent()[0]!.id, sent()[0]!.id]);
  }, 30_000);

  it('a claim a relay took without answering in time is held, and sent again as the same event', async () => {
    const relay = await publishRelay('silent');
    set('accruing', 'relays_own', [relay.url]);
    const NOW = 1791403200;
    const m = heatMission(NOW);
    const r = await takePart(m, 'open', NOW, wire);
    expect(r.ok).toBe(true);
    expect(held(NOW)[0]!.unconfirmed).toBeDefined();
    relay.takes = 'ok';
    expect(await claimAgain(m.address, NOW + 60, wire)).toBe('took');
    const claims = relay.received.filter((e) => e.kind === 1985);
    expect(new Set(claims.map((e) => e.id)).size).toBe(1);
    expect(claims).toHaveLength(2);
  }, 30_000);
});

describe('letting go with no signal, through the real wire [audit 11.S, finding 66]', () => {
  it('keeps the release when no relay takes it, and sends it from the mission once one does', async () => {
    const relay = await publishRelay('ok');
    set('accruing', 'relays_own', [relay.url]);
    const NOW = 1791403200;
    const m = heatMission(NOW);
    expect((await takePart(m, 'open', NOW, wire)).ok).toBe(true);
    relay.takes = 'refuse';
    const offline = await letGo(m, NOW + 60, wire);
    expect(offline.sent).toBe(false);
    // Off her claims at once: walking away is never refused.
    expect(held(NOW + 60)).toEqual([]);
    relay.takes = 'ok';
    await letGo(m, NOW + 3_600, wire);
    const releases = relay.received.filter((e) => e.kind === 1985 && e.tags.some((t) => t[0] === 'l' && t[1] === 'released'));
    expect(releases, 'the release was sent once there was signal').toHaveLength(2);
    expect(releases[1]!.id).toBe(releases[0]!.id);
    expect(offline).toEqual({ sent: false, unconfirmed: false, because: 'No relay took the release.' });
    expect(unreleased(NOW + 3_600)).toEqual([]);
  }, 30_000);
});

/** A mission package as the poster signs it, ending ten days after `now`. */
function heatMission(now: number): Mission {
  const posterSecret = generateSecretKey();
  const publishers = { [getPublicKey(posterSecret)]: { name: 'Test Poster', agent: true } };
  const e = finalizeEvent(
    {
      kind: 30079,
      created_at: now - 86_400,
      content: JSON.stringify({ name: 'Heat', objectives: [{ id: 'handout:water', ask: 'Hand out water.' }] }),
      tags: [['d', `heat-${now}-${Math.random()}`], ['t', 'starcom_mission_package'], ['t', 'navcom_handoff'], ['t', 'navcom_mission'],
        ['mission_state', 'open'], ['valid_until', String(now + 10 * 86_400)], ['jurisdiction', 'us-ca']]
    },
    posterSecret
  );
  return (readMissionPackage(e, publishers) as { mission: Mission }).mission;
}

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
    const took: Wire = { publish: async () => 'took', query: async (urls) => ({ events: [], answered: urls }) };
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
