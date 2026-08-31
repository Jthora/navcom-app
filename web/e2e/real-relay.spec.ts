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

test.describe('the watch reaching an overdue operator, over a real relay', () => {
  /**
   * The half of the overdue contact that had never spoken NIP-01.
   *
   * `watch-state.spec.md` requires the node to attempt contact with an operator who is past
   * the window they declared, and until recently it logged `contact-not-attempted` instead.
   * The daemon half is unit-tested with an injected pool; the terminal half is browser-tested
   * against `ReplayingSocket` — **which ignores filters entirely**, handing every delivered
   * event to every open subscription.
   *
   * That is the gap. `overdue.svelte.ts` subscribes with
   * `{ kinds: [20912], authors: [watch], '#p': [me] }`, and against the stub every one of
   * those three could be wrong and the test would still pass. This relay matches filters
   * properly, so arriving here means the client composed a `REQ` a real relay agreed with.
   */
  let watch: { secret: Uint8Array; pubkey: string };

  test.beforeAll(async () => {
    const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const secret = generateSecretKey();
    watch = { secret, pubkey: getPublicKey(secret) };
  });

  /** Publishes straight to the relay, the way a daemon would. No browser involved. */
  async function publish(event: unknown) {
    const { WebSocket } = await import('ws');
    const socket = new WebSocket(relay.url);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    socket.send(JSON.stringify(['EVENT', event]));
    // Give the relay a moment to store and fan out before the socket goes away.
    await new Promise((r) => setTimeout(r, 250));
    socket.close();
  }

  async function contactEvent(text: string) {
    const { finalizeEvent, getPublicKey } = await import('nostr-tools/pure');
    const { buildResponse } = await import('@navcom/core');
    return finalizeEvent(
      buildResponse(
        watch.secret,
        await pubkeyOf(TEST_SECRET),
        'e'.repeat(64),
        {
          type: 'contact',
          responder: { kind: 'agent', callsign: 'watchtower' },
          text,
          provenance: null
        } as never,
        Math.floor(Date.now() / 1000)
      ),
      watch.secret
    );
  }

  test('lands on the operator’s own screen, through a filter the relay agreed with', async ({
    browser
  }: {
    browser: Browser;
  }) => {
    const context = await browser.newContext();
    const wren = await context.newPage();

    await liveDevice(wren, relay.url, {
      callsign: 'Wren',
      watchtower: { pubkey: watch.pubkey, relays: [relay.url] }
    });
    // Already past the window she declared, so the screen is in the state the nudge answers.
    const now = Math.floor(Date.now() / 1000);
    await wren.addInitScript((s) => {
      localStorage.setItem('navcom.wipeable', JSON.stringify({ signon: s }));
    }, { at: now - 7200, area: 'north riverfront', expectedUntil: now - 600, toldAtSignOn: 'nobody is on call', routineInterval: null });

    await open(wren, '/terminal/');
    await expect(wren.locator('[data-nudged]')).toHaveCount(0);

    await publish(await contactEvent('You are past the time you gave.'));

    // Nothing about this was faked: a real socket, a real REQ the client composed, a relay
    // that would have dropped the event had any of the three filter terms been wrong.
    await expect(wren.locator('[data-nudged]')).toBeVisible({ timeout: 20_000 });
    await expect(wren.locator('[data-nudged]')).toContainText(/the watch nudged/i);

    await context.close();
  });

  test('and the relay holding it learned nothing about her', async () => {
    /*
     * The nudge is the one message a node sends unasked, so it is the one most worth
     * checking for leaks. What an observer may see is a `20912` addressed to a pubkey --
     * the same shape as every ack. Never the area, never the callsign, never the word.
     */
    const contacts = relay.received.filter((e) => e.kind === 20912);
    expect(contacts.length).toBeGreaterThan(0);

    const onTheWire = JSON.stringify(contacts);
    expect(onTheWire).not.toContain('north riverfront');
    expect(onTheWire).not.toContain('Wren');
    expect(onTheWire).not.toContain('overdue');
    expect(onTheWire).not.toContain('past the time');
  });
});

test.describe('the return leg of every signal, over a real relay', () => {
  /**
   * `waitForResponse`'s filter — the highest-stakes one in the system, and until now the
   * least tested.
   *
   * It is how an operator learns the answer to a `Query`, an `Assist`, and a `Distress`.
   * Its filter has four terms — `kinds`, `authors`, `#p`, `#e` — and `#e` is the one no
   * other subscription here uses: it narrows to responses to *this one signal*, which is
   * what stops an old ack being read as an answer to a new question.
   *
   * Against `ReplayingSocket` all four could be wrong and every test would pass, because the
   * stub hands every delivered event to every open subscription. `verification.md` names
   * this as the one to do first, because if it is wrong an operator is told nobody replied
   * when somebody did.
   */
  let watch: { secret: Uint8Array; pubkey: string };

  test.beforeAll(async () => {
    const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const secret = generateSecretKey();
    watch = { secret, pubkey: getPublicKey(secret) };
  });

  /** Answers the operator's signal the way a daemon would: same relay, real frames. */
  async function answerNext(text: string, opts: { wrongTarget?: boolean } = {}) {
    const { finalizeEvent } = await import('nostr-tools/pure');
    const { buildResponse } = await import('@navcom/core');
    const { WebSocket } = await import('ws');

    // The signal the terminal actually published, found on the relay rather than guessed.
    const signal = await expect
      .poll(
        () => relay.received.find((e) => e.kind === 20910) ?? null,
        { timeout: 20_000, message: 'the terminal never published a signal to the relay' }
      )
      .not.toBeNull()
      .then(() => relay.received.find((e) => e.kind === 20910)!);

    const socket = new WebSocket(relay.url);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    const event = finalizeEvent(
      buildResponse(
        watch.secret,
        await pubkeyOf(TEST_SECRET),
        // The whole point of the `#e` term. A response to some other signal must not be
        // read as the answer to this one.
        opts.wrongTarget ? 'f'.repeat(64) : signal.id,
        {
          type: 'answer',
          responder: { kind: 'human', callsign: 'Vale' },
          text,
          provenance: { record_id: 'st-louis-example', verified: '2026-08-01', method: 'phone' }
        } as never,
        Math.floor(Date.now() / 1000)
      ),
      watch.secret
    );
    socket.send(JSON.stringify(['EVENT', event]));
    await new Promise((r) => setTimeout(r, 250));
    socket.close();
    return signal;
  }

  async function askSomething(browser: Browser) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await liveDevice(page, relay.url, {
      callsign: 'Wren',
      watchtower: { pubkey: watch.pubkey, relays: [relay.url] }
    });
    await open(page, '/terminal/query/');
    await page.locator('#q').fill('anywhere open past midnight that takes a dog');
    await page.getByRole('button', { name: /ask/i }).first().click();
    return { context, page };
  }

  test('an answer to the operator’s own signal reaches them', async ({ browser }: { browser: Browser }) => {
    const { context, page } = await askSomething(browser);

    await answerNext('Our Lady’s Inn takes dogs. Ring the bell at the side door.');

    const answer = page.locator('[data-answer]');
    await expect(answer).toBeVisible({ timeout: 20_000 });
    await expect(answer).toContainText(/takes dogs/i);
    // A human answered, and the screen says so — invariant 5 works in both directions.
    await expect(answer).toContainText(/vale/i);
    // Provenance present, so it must not render as unverified.
    await expect(page.locator('[data-provenance="none"]')).toHaveCount(0);

    await context.close();
  });

  test('and a response to a different signal is not mistaken for it', async ({ browser }: { browser: Browser }) => {
    /*
     * The `#e` term, tested by breaking it from the outside rather than by editing the
     * client. A relay that honours filters will simply not deliver this, which is the
     * behaviour an operator's safety rests on: the answer they see is the answer to the
     * question they asked.
     */
    const { context, page } = await askSomething(browser);

    await answerNext('this answers something else entirely', { wrongTarget: true });

    // Long enough that a wrong filter would have shown it.
    await page.waitForTimeout(3_000);
    await expect(page.locator('[data-answer]')).toHaveCount(0);

    await context.close();
  });
});
