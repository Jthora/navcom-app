import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { WebSocket } from 'ws';
import { startRelay, type LocalRelay } from '../../../e2e/relay-server';

/**
 * The browser tests' relay, held to what a relay keeps [audit: relay paths, F25].
 *
 * It kept every ephemeral event for the whole run and handed it to any later subscription, so an
 * acknowledgement published before a page was listening still arrived — which no relay does after
 * five minutes, and most never do. A test of the app that passed that way was a test of this relay.
 */

let relay: LocalRelay;

beforeAll(async () => {
  relay = await startRelay();
});

afterAll(async () => {
  await relay?.close();
});

const author = generateSecretKey();
const to = 'a'.repeat(64);
const signed = (kind: number, p = to) =>
  finalizeEvent({ kind, created_at: Math.floor(Date.now() / 1000), tags: [['p', p]], content: 'test' }, author);

async function connect(): Promise<WebSocket> {
  const socket = new WebSocket(relay.url);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return socket;
}

/** Publishes over a socket of its own, and returns once the relay has said OK. */
async function publish(event: ReturnType<typeof signed>): Promise<void> {
  const socket = await connect();
  await new Promise<void>((resolve) => {
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw));
      if (message[0] === 'OK' && message[1] === event.id) resolve();
    });
    socket.send(JSON.stringify(['EVENT', event]));
  });
  socket.close();
}

/** Opens a subscription, and returns the ids served before its end-of-stored-events. */
async function served(filter: object): Promise<string[]> {
  const socket = await connect();
  const ids = await new Promise<string[]>((resolve) => {
    const got: string[] = [];
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw));
      if (message[0] === 'EVENT') got.push(message[2].id);
      if (message[0] === 'EOSE') resolve(got);
    });
    socket.send(JSON.stringify(['REQ', 'sub', filter]));
  });
  socket.close();
  return ids;
}

describe('what the relay keeps', () => {
  it('serves no ephemeral event to a subscription opened after it', async () => {
    const answer = signed(20912);
    const kept = signed(1);
    await publish(answer);
    await publish(kept);

    const ids = await served({ kinds: [20912, 1], '#p': [to] });
    expect(ids, 'an answer published before anybody listened was served later').not.toContain(answer.id);
    // The control: the same subscription is served what a relay does keep.
    expect(ids).toContain(kept.id);
    // And the tests that check what crossed the wire still see it.
    expect(relay.received.map((e) => e.id)).toContain(answer.id);
  });

  it('forwards one to a subscription that was open when it arrived', async () => {
    const socket = await connect();
    const answer = signed(20912);
    const arrived = new Promise<string>((resolve) => {
      socket.on('message', (raw) => {
        const message = JSON.parse(String(raw));
        if (message[0] === 'EVENT') resolve(message[2].id);
      });
    });
    socket.send(JSON.stringify(['REQ', 'live', { kinds: [20912], '#p': [to] }]));
    await expect.poll(() => relay.subscribers(answer)).toBe(1);

    await publish(answer);
    expect(await arrived).toBe(answer.id);
    socket.close();
  });
});

describe('how many are listening', () => {
  it('counts the open subscriptions an event would reach, and only those', async () => {
    const socket = await connect();
    socket.send(JSON.stringify(['REQ', 'live', { kinds: [20912], '#p': [to] }]));
    await expect.poll(() => relay.subscribers(signed(20912))).toBe(1);

    expect(relay.subscribers(signed(20912, 'b'.repeat(64))), 'addressed to somebody else').toBe(0);
    expect(relay.subscribers(signed(20913)), 'another kind').toBe(0);

    socket.send(JSON.stringify(['CLOSE', 'live']));
    await expect.poll(() => relay.subscribers(signed(20912))).toBe(0);
    socket.close();
  });
});
