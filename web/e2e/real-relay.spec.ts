import { expect, test, type Browser } from '@playwright/test';
import { liveDevice, open, TEST_SECRET } from './device';
import { startRelay, type LocalRelay } from './relay-server';

/**
 * The client, against an actual relay.
 *
 * `verification.md` lists this under **what none of this covers**: *"peer presence has never
 * crossed a real relay, and one browser context cannot test two operators meaningfully."*
 *
 * Every other two-device test here runs against `ReplayingSocket`, which hands back canned
 * events and never speaks the protocol — so what has been proven so far is that the app
 * behaves when a fake relay behaves. This runs the same story over a real WebSocket, a real
 * `["REQ", …]` the client composed, real `["EVENT", …]` frames it signed, and a second browser
 * context that subscribed independently and was never told what to expect.
 *
 * **What it does not prove**, said plainly so the gap does not get quietly closed in somebody's
 * head: that `relay.damus.io` behaves. Public relays differ in filter handling, rate limits and
 * retention, and this implements NIP-01 plainly. Two phones on two networks is still a human
 * task, and it is still `0.2` in the build order.
 *
 * Not in the default run. `npm run test:relay`.
 */

const RAVEN = 'c'.repeat(63) + '7';

let relay: LocalRelay;

test.beforeAll(async () => {
  relay = await startRelay();
});

test.afterAll(async () => {
  await relay?.close();
});

async function pubkeyOf(hex: string) {
  const { getPublicKey } = await import('nostr-tools/pure');
  return getPublicKey(Uint8Array.from((hex.match(/../g) ?? []).map((b) => parseInt(b, 16))));
}

test.describe('over a relay that is actually running', () => {
  test('the relay is real, so a passing run means something', async () => {
    /*
     * Without this the file passes beautifully against a relay that never started — which is
     * the failure mode of every test that watches for an absence, and one this project has
     * been bitten by before.
     */
    expect(relay.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);
    const { WebSocket } = await import('ws');
    const socket = new WebSocket(relay.url);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    socket.close();
  });

  test('one operator signing on reaches another operator, with nothing faked', async ({ browser }: { browser: Browser }) => {
    const wrenKey = await pubkeyOf(TEST_SECRET);
    const ravenKey = await pubkeyOf(RAVEN);

    // Two devices, each paired with the other, both pointed at the same relay. Neither is
    // told what the other will send.
    const a = await browser.newContext();
    const wren = await a.newPage();
    await liveDevice(wren, relay.url, {
      callsign: 'Wren',
      peers: [{ pubkey: ravenKey, callsign: 'Raven', since: 1 }]
    });

    const b = await browser.newContext();
    const raven = await b.newPage();
    await liveDevice(raven, relay.url, {
      secret: RAVEN,
      callsign: 'Raven',
      peers: [{ pubkey: wrenKey, callsign: 'Wren', since: 1 }]
    } as never);

    // Raven is watching her status screen, which is where a peer's presence lands.
    await open(raven, '/terminal/');

    // Wren goes out.
    await open(wren, '/terminal/sign-on/');
    await wren.locator('#area').fill('north riverfront');
    await wren.getByRole('button', { name: /^sign on$/i }).click();
    await wren.waitForURL('**/terminal/');

    // The relay saw it, over a real socket.
    await expect
      .poll(() => relay.received.length, { timeout: 15_000 })
      .toBeGreaterThan(0);

    // And Raven's phone drew it for herself, from a subscription she opened before it existed.
    await expect(raven.locator('[data-peers]')).toContainText(/wren/i, { timeout: 20_000 });
    await expect(raven.locator('[data-peers]')).toContainText(/north riverfront/i);

    await a.close();
    await b.close();
  });

  test('and nothing readable about her is on the relay', async () => {
    /*
     * The property the whole architecture rests on: *"nothing readable ever reaches a server."*
     * Every other test asserts this against a stub that never had a chance to leak. Here the
     * bytes genuinely crossed a socket and are sitting in the relay's memory.
     */
    expect(relay.received.length).toBeGreaterThan(0);
    const onTheWire = JSON.stringify(relay.received);

    expect(onTheWire).not.toContain('north riverfront');
    expect(onTheWire).not.toContain('Wren');
    expect(onTheWire).not.toContain('Raven');
  });
});
