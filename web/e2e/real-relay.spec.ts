import { expect, test, type Browser } from '@playwright/test';
import { holdUntil, liveDevice, open, TEST_SECRET } from './device';
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
 * retention, and this implements NIP-01 plainly — keeping no ephemeral event, as most do not, so
 * every one published here waits for its listener first (see `relay-server.ts`). Two phones on
 * two networks is still a human task, and it is still `0.2` in the build order.
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

/**
 * Waits until the relay holds a subscription this event would reach.
 *
 * For an ephemeral event. The relay keeps none, as most do not, so one published before the page
 * under test is listening is gone — and the test would pass or fail on how fast the page loaded,
 * or pass a "never shown" assertion because nobody was listening yet [audit: relay paths, F25].
 */
async function listenedFor(event: Parameters<LocalRelay['subscribers']>[0], what: string) {
  await expect
    .poll(() => relay.subscribers(event), { timeout: 20_000, message: `nothing subscribed for ${what}` })
    .toBeGreaterThan(0);
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
    // Presence is ephemeral: listened for before anybody goes out, or the first one is gone.
    await listenedFor(
      { id: '0'.repeat(64), pubkey: wrenKey, created_at: Math.floor(Date.now() / 1000), kind: 20913, tags: [['p', ravenKey]], content: '', sig: '' },
      "a peer's presence on the status screen"
    );

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

    const contact = await contactEvent('You are past the time you gave.');
    await listenedFor(contact, 'the watch contacting an overdue operator');
    await publish(contact);

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

  /**
   * Answers the operator's signal the way a daemon would: same relay, real frames.
   *
   * `after` is how many events the relay had before the operator asked. The relay is shared by
   * the whole file, so the first signal on it is an earlier test's — answering that one is how
   * the wrong-target test could pass without the page under test ever listening.
   */
  async function answerNext(text: string, after: number, opts: { wrongTarget?: boolean } = {}) {
    const { finalizeEvent } = await import('nostr-tools/pure');
    const { buildResponse } = await import('@navcom/core');
    const { WebSocket } = await import('ws');

    // The signal the terminal actually published, found on the relay rather than guessed.
    const asked = () => relay.received.slice(after).find((e) => e.kind === 20910) ?? null;
    const signal = await expect
      .poll(asked, { timeout: 20_000, message: 'the terminal never published a signal to the relay' })
      .not.toBeNull()
      .then(() => asked()!);

    const answering = async (target: string) =>
      finalizeEvent(
        buildResponse(
          watch.secret,
          await pubkeyOf(TEST_SECRET),
          target,
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
    // The whole point of the `#e` term. A response to some other signal must not be read as the
    // answer to this one.
    const event = await answering(opts.wrongTarget ? 'f'.repeat(64) : signal.id);
    // Listened for with the right target either way: the wrong one reaches no subscription by
    // design, and waiting on it would wait forever.
    await listenedFor(opts.wrongTarget ? await answering(signal.id) : event, 'the answer to a signal');

    const socket = new WebSocket(relay.url);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
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
    const after = relay.received.length;
    await page.getByRole('button', { name: /ask/i }).first().click();
    return { context, page, after };
  }

  test('an answer to the operator’s own signal reaches them', async ({ browser }: { browser: Browser }) => {
    const { context, page, after } = await askSomething(browser);

    await answerNext('Our Lady’s Inn takes dogs. Ring the bell at the side door.', after);

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
    const { context, page, after } = await askSomething(browser);

    await answerNext('this answers something else entirely', after, { wrongTarget: true });

    // Long enough that a wrong filter would have shown it.
    await page.waitForTimeout(3_000);
    await expect(page.locator('[data-answer]')).toHaveCount(0);

    await context.close();
  });
});

test.describe('the rest of the filters, against a relay that honours them', () => {
  /**
   * `verification.md` listed ten client subscription filters and noted that eight had never
   * run against anything that honours a filter. `waitForResponse` was done first because it
   * is the return leg of every signal. These are the next two by consequence.
   *
   * Each is a different filter *shape*, which is the reason to do them rather than assume the
   * first proved the pattern: `authors` narrows by who wrote it, `#d` by which record it is
   * about, and a relay that ignored either would look identical to one that agreed.
   */

  /** Publishes straight to the relay, as a daemon or another operator's phone would. */
  async function publish(event: unknown) {
    const { WebSocket } = await import('ws');
    const socket = new WebSocket(relay.url);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    socket.send(JSON.stringify(['EVENT', event]));
    await new Promise((r) => setTimeout(r, 250));
    socket.close();
  }

  test('watch state reaches a terminal that asked for it by author', async ({ browser }: { browser: Browser }) => {
    /*
     * `relay.ts` subscribes `{ kinds: [10910], authors: [config.pubkey], limit: 1 }`. If that
     * `authors` term is wrong the terminal reads **Dark while a watch is on station** — the
     * operator is told nobody is behind them when somebody is, which is the exact belief
     * invariant 4 exists to protect.
     */
    const { finalizeEvent, generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const { buildWatchStateEvent } = await import('@navcom/core');
    const secret = generateSecretKey();
    const now = Math.floor(Date.now() / 1000);

    const context = await browser.newContext();
    const page = await context.newPage();
    await liveDevice(page, relay.url, {
      callsign: 'Wren',
      watchtower: { pubkey: getPublicKey(secret), relays: [relay.url] }
    });
    await open(page, '/terminal/');
    // Dark is the honest starting value, not a placeholder.
    await expect(page.getByText(/dark/i).first()).toBeVisible();

    await publish(
      finalizeEvent(
        buildWatchStateEvent(
          {
            state: 'station', since: now - 600, holder: 'Vale', holder_kind: 'human',
            oncall: [], agent_health: 'ok', last_drill: null, now
          } as never,
          now
        ),
        secret
      )
    );

    await expect(page.getByText(/on station/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/vale/i).first()).toBeVisible();
    await context.close();
  });

  test('a correction reaches the next operator, matched on the record it is about', async ({ browser }: { browser: Browser }) => {
    /*
     * `corrections.svelte.ts` subscribes `{ kinds: [30911], '#d': [...records] }` — the only
     * `#d` filter in the client. If it is wrong, **what one operator learned at a door never
     * reaches the next one**, and the directory's whole correction loop is a no-op that looks
     * like it is working.
     */
    const { generateSecretKey } = await import('nostr-tools/pure');
    const { buildCorrection } = await import('@navcom/core');

    const context = await browser.newContext();
    const page = await context.newPage();
    await liveDevice(page, relay.url, { callsign: 'Wren' });
    await open(page, '/terminal/directory/st-louis/');
    await expect(page.locator('[data-corrected]')).toHaveCount(0);

    // Written by somebody else entirely — this is the case the loop exists for.
    await publish(
      buildCorrection(
        generateSecretKey(),
        {
          record: 'st-louis-st-patrick-center',
          verified_by: 'Raven',
          method: 'in_person',
          // Today, not a fixed date. Hours go stale after fourteen days, and a stale correction
          // never outranks the published record — so a fixed date made this test start failing
          // by itself two weeks after it was written, with nothing wrong with the filter.
          last_verified: new Date().toISOString().slice(0, 10),
          fields: { hours: 'closed Sundays' }
        },
        Math.floor(Date.now() / 1000)
      )
    );

    const corrected = page.locator('[data-corrected]').first();
    await expect(corrected).toBeVisible({ timeout: 20_000 });
    await expect(corrected).toContainText(/from operators/i);
    // Provenance by name, on the face of the corrected field [build-order 7.6]. The summary
    // line above says a correction exists; this is the part that says whose word it is.
    await expect(page.getByText(/raven/i).first()).toBeVisible();
    await context.close();
  });
});

test.describe('the two filter shapes still untested', () => {
  /**
   * Chosen by audit rather than by working down a list.
   *
   * Five client filters remained after `waitForResponse`, `relay.ts` and `corrections`, and
   * they are not equal. Three reuse a shape already proven — `standing.ts` and `pq` are
   * `authors`, `invites` is `#p`. These two are the ones left that are genuinely different:
   * a **multi-kind** filter, and the only `#g` in the client.
   */
  async function publish(event: unknown) {
    const { WebSocket } = await import('ws');
    const socket = new WebSocket(relay.url);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    socket.send(JSON.stringify(['EVENT', event]));
    await new Promise((r) => setTimeout(r, 250));
    socket.close();
  }

  /*
   * A board test was written here and removed rather than shipped.
   *
   * It asserted that a signal reaches the phone holding the watch, and it **passed with the
   * `#p` filter deliberately broken** -- verified by replacing the pubkey with a traceable
   * marker, confirming the marker was in the built artifact, and watching the test go green
   * anyway. The relay is not at fault: it tags each delivered event with the matching
   * subscription's own id, and neither of the board's two filters matches a `20910` once the
   * first is broken.
   *
   * So the test was passing for a reason nothing here explains, which makes it worth less
   * than no test: a green check against a broken mechanism is the exact thing this file
   * exists to disprove. `board.svelte.ts` stays on the unverified list in `verification.md`
   * until somebody works out where that event actually came from.
   */

  test('a place added in the field reaches the region it is in', async ({ browser }: { browser: Browser }) => {
    /*
     * `places.svelte.ts` subscribes `{ kinds: [30915], '#g': [region] }` — the only `#g` in
     * the client, and the tag exists precisely so a device can ask one relay for one metro.
     * If it is wrong, a place somebody added from a doorway is invisible to everybody else,
     * and the cold-start fix for a region with no published directory silently does nothing.
     */
    const { generateSecretKey } = await import('nostr-tools/pure');
    const { buildPlace } = await import('@navcom/core');

    const context = await browser.newContext();
    const page = await context.newPage();
    await liveDevice(page, relay.url, { callsign: 'Wren' });
    await open(page, '/terminal/directory/st-louis/');

    await publish(
      buildPlace(
        generateSecretKey(),
        {
          region: 'st-louis',
          name: 'The Cherokee Street Drop-in',
          type: 'daytime',
          address: '412 Cherokee St',
          verified_by: 'Raven',
          method: 'in_person',
          last_verified: '2026-08-30'
        } as never,
        Math.floor(Date.now() / 1000)
      )
    );

    await expect(page.getByText(/cherokee street drop-in/i).first()).toBeVisible({ timeout: 20_000 });
    await context.close();
  });
});

test.describe('the last three filters, against a relay that honours them', () => {
  /**
   * The three `verification.md` listed as reusing a proven shape — `standing.ts` and `pq` are
   * `authors`, `invites` is `#p`.
   *
   * Reusing a shape is a reason to do them last, not a reason to skip them. The shape being
   * proven says a relay honours `authors` somewhere; it says nothing about whether *this*
   * subscription names the right authors. Every one of the three is seeded here with the
   * event **absent**, so the assertion is that it arrived over the wire and changed the
   * screen — not that a fixture was rendered.
   */
  async function publish(event: unknown) {
    const { WebSocket } = await import('ws');
    const socket = new WebSocket(relay.url);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    socket.send(JSON.stringify(['EVENT', event]));
    await new Promise((r) => setTimeout(r, 250));
    socket.close();
  }

  const mine = () => Uint8Array.from((TEST_SECRET.match(/../g) ?? []).map((b) => parseInt(b, 16)));

  test('a withdrawn endorsement reaches the operator holding it', async ({ browser }: { browser: Browser }) => {
    /*
     * `standing.ts` subscribes `{ kinds: [30914], authors: endorsers }`. If those authors are
     * wrong the withdrawal never arrives, and the consequence is not cosmetic: standing is
     * the gate on taking the watch, so an endorsement somebody has taken back goes on
     * opening it. Operators would sign on to a board held by somebody no longer vouched for.
     */
    const { generateSecretKey } = await import('nostr-tools/pure');
    const { writeCredential, revoke, claimCredential } = await import('@navcom/core');

    const raven = generateSecretKey();
    const credential = writeCredential(
      raven, { scope: 'can-take-watch', endorser: 'Raven', at: '2026-08-01' }, 1_800_000_000
    );
    const claim = claimCredential(mine(), credential, 1_800_000_001);

    const context = await browser.newContext();
    const page = await context.newPage();
    await liveDevice(page, relay.url, {
      callsign: 'Wren',
      // The endorsement is held; the withdrawal is deliberately not seeded.
      accruing: { endorsements: [{ credential, claim }] }
    });

    /*
     * Status, not the standing screen. `standing.start()` is called from `/terminal/` on
     * purpose -- "a holder who never opens that screen must still stop relying on an
     * endorsement somebody has taken back" -- so the standing screen never subscribes at all.
     * The first version of this test opened it and failed, which read exactly like a broken
     * filter and was a broken test.
     */
    await open(page, '/terminal/');
    await expect(page.locator('[data-withdrawn]')).toHaveCount(0);

    const withdrawal = revoke(raven, credential.id, 1_800_009_999);
    await publish(withdrawal);

    // Waiting on the event's own id, so this does not depend on a storage key name. It is
    // the wait; the assertion below is the thing a person actually sees.
    await page.waitForFunction(
      (id) => JSON.stringify(localStorage).includes(id as string),
      withdrawal.id,
      { timeout: 25_000 }
    );

    await open(page, '/terminal/standing/');
    const withdrawn = page.locator('[data-withdrawn]');
    await expect(withdrawn).toBeVisible({ timeout: 15_000 });
    await expect(withdrawn).toContainText('Raven');
    await context.close();
  });

  test('an invite reaches the person it names', async ({ browser }: { browser: Browser }) => {
    /*
     * `invites.svelte.ts` subscribes `{ kinds: [1910], '#p': addresses }`. Declining is
     * deliberately silent — there is no refusal and no read receipt — so an invite that never
     * arrives is indistinguishable, from the sender's side, from one that was ignored. The
     * failure is unobservable by either party, which is why it needs observing here.
     */
    const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const { buildInvite } = await import('@navcom/core');
    const raven = generateSecretKey();

    const context = await browser.newContext();
    const page = await context.newPage();
    await liveDevice(page, relay.url, { callsign: 'Wren' });
    await open(page, '/terminal/peers/');
    await expect(page.getByText('Raven')).toHaveCount(0);

    await publish(buildInvite(raven, getPublicKey(mine()), { callsign: 'Raven' }, 1_800_000_000));

    await expect(page.getByText('Raven').first()).toBeVisible({ timeout: 25_000 });
    await context.close();
  });

  test("a peer's key bundle reaches the operator and lifts the cover notice", async ({ browser }: { browser: Browser }) => {
    /*
     * `pq.svelte.ts` subscribes `{ kinds: [10912], authors: wanted }`. Wrong authors and the
     * bundle never lands, so the Status screen reports "Classical only" for a peer who is in
     * fact covered — the mildest of the three, and the only one whose failure is a false
     * *pessimism* rather than a false reassurance. Worth having for exactly that reason: it
     * is the one where a broken filter is indistinguishable from the honest starting state.
     */
    const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const { buildKeyBundle } = await import('@navcom/core');
    const raven = generateSecretKey();

    const context = await browser.newContext();
    const page = await context.newPage();
    await liveDevice(page, relay.url, {
      callsign: 'Wren',
      peers: [{ pubkey: getPublicKey(raven), callsign: 'Raven', since: 0 }]
    });
    await open(page, '/terminal/');
    await expect(page.getByText(/classical only/i)).toBeVisible({ timeout: 20_000 });

    await publish(buildKeyBundle(raven, Math.floor(Date.now() / 1000)));

    await expect(page.getByText(/classical only/i)).toHaveCount(0, { timeout: 25_000 });
    await context.close();
  });
});

test.describe('the board, the one filter that resisted a naive test', () => {
  /**
   * The tenth and last.
   *
   * A previous attempt at this was written and **withdrawn** rather than shipped: it passed
   * with the `#p` term deliberately broken. Everything that could explain that has since been
   * ruled out by reading rather than guessed at — the local relay routes each event by the
   * matching subscription's own id and honours `#`-tag terms (`relay-server.ts`); the board's
   * second filter is `kinds: [10910]` and cannot match a `20910`; and `apply()` — the only
   * writer of board entries — is called from exactly one place, the subscription's `onevent`.
   *
   * The addressing also reconciles, which it did not appear to before: `sendSignal` tags
   * `['p', watchtower.pubkey]` and seals the payload to `watchtower.holders`. So the `#p`
   * term on the *watch* key and decryption with the *operator's own* key are both correct,
   * and are answering two different questions.
   *
   * Which leaves the break itself as the thing that most likely never reached the running
   * filter. So this one is falsified **first**: broken, watched to fail, and only then
   * restored. A green that has not been earned that way is what got the last attempt binned.
   */
  async function publish(event: unknown) {
    const { WebSocket } = await import('ws');
    const socket = new WebSocket(relay.url);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    socket.send(JSON.stringify(['EVENT', event]));
    await new Promise((r) => setTimeout(r, 250));
    socket.close();
  }

  test('a signal addressed to the watch reaches the phone holding it', async ({ browser }: { browser: Browser }) => {
    const { finalizeEvent, generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const { sealToGroup, KIND_SIGNAL } = await import('@navcom/core');

    const watchHex = 'd'.repeat(63) + '7';
    const watchSecret = Uint8Array.from((watchHex.match(/../g) ?? []).map((b) => parseInt(b, 16)));
    const watchPub = getPublicKey(watchSecret);
    // This device's own operator key. A squad seals to holders, and the board decrypts with
    // the operator's key, not the watch's.
    const holder = await pubkeyOf(TEST_SECRET);

    const context = await browser.newContext();
    const page = await context.newPage();
    await liveDevice(page, relay.url, {
      callsign: 'Vale',
      watchSecret: watchHex,
      watchtower: { pubkey: watchPub, relays: [relay.url], holders: [holder] }
    });
    await open(page, '/terminal/watch/');

    // Empty is the honest starting state, and it is what makes the transition below mean
    // something: nothing but the subscription can populate this.
    await expect(page.locator('[data-empty-board]')).toBeVisible({ timeout: 20_000 });

    const wren = generateSecretKey();
    const signal = finalizeEvent(
      {
        kind: KIND_SIGNAL,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', watchPub], ['t', 'on-station']],
        content: sealToGroup(wren, [holder], {
          callsign: 'Wren',
          area: 'Downtown',
          expected_duration: 7200,
          routine_interval: null,
          share_position: false,
          position: null
        })
      },
      wren
    );
    // An empty board is drawn before its subscription reaches the relay, so it proves nothing
    // about who is listening.
    await listenedFor(signal, 'a signal on the phone holding the watch');
    await publish(signal);

    const row = page.locator('.nc-floor-row');
    await expect(row).toHaveCount(1, { timeout: 25_000 });
    await expect(row).toContainText('Wren');
    await context.close();
  });

  /*
   * What a watch carrying a patrol needs off the board, on the built page and over a real relay
   * (NYC audit, 2026-11-02): when somebody is due, where they shared they were, where a Distress
   * came from, and a screen that sounds and stays lit while it holds the watch.
   */
  test('a Distress shows where it came from, on a screen that sounds and stays lit while it holds the watch', async ({ browser }: { browser: Browser }) => {
    const { finalizeEvent, generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const { buildDistress, buildSignal } = await import('@navcom/core');

    const watchHex = 'e'.repeat(63) + '7';
    const watchSecret = Uint8Array.from((watchHex.match(/../g) ?? []).map((b) => parseInt(b, 16)));
    const watchPub = getPublicKey(watchSecret);
    const holder = await pubkeyOf(TEST_SECRET);
    const to = { pubkey: watchPub, holders: [holder] };
    const fix = { lat: 40.7505, lon: -73.9934, precision_m: 500 };

    const context = await browser.newContext();
    const page = await context.newPage();
    await liveDevice(page, relay.url, {
      callsign: 'Vale',
      watchSecret: watchHex,
      watchtower: { pubkey: watchPub, relays: [relay.url], holders: [holder] }
    });
    await open(page, '/terminal/watch/');
    await expect(page.locator('[data-empty-board]')).toBeVisible({ timeout: 20_000 });

    await holdUntil(page, 'button:has-text("take the watch")');
    await expect(page.locator('[data-watch-post]')).toContainText(/on station/i, { timeout: 10_000 });
    await expect(page.locator('[data-watch-sound]')).toContainText(/Turn off/);
    await expect(page.locator('[data-watch-screen]')).toBeVisible();

    const wren = generateSecretKey();
    const now = Math.floor(Date.now() / 1000);
    const signOn = finalizeEvent(
      buildSignal(wren, to, 'on-station', {
        callsign: 'Wren', area: 'Midtown', expected_duration: 7200,
        routine_interval: 1800, share_position: true, position: fix
      }, now),
      wren
    );
    await listenedFor(signOn, 'a sign-on on the phone holding the watch');
    await publish(signOn);

    const row = page.locator('.nc-floor-row');
    await expect(row).toContainText('check-in in 30 min', { timeout: 25_000 });
    await expect(page.locator('[data-floor-pin]')).toContainText('within 500 m');
    await expect(page.locator('[data-floor-pin]')).toHaveAttribute('target', '_blank');

    await publish(finalizeEvent(buildDistress(wren, to, { position: fix, area: 'Midtown' }, now + 1), wren));
    await expect(page.locator('[data-ask-area]')).toContainText('Midtown', { timeout: 25_000 });
    await expect(page.locator('[data-ask-fix]')).toContainText('40.7505, -73.9934');
    await expect(row.first()).toContainText('Distress');
    await expect(page).toHaveTitle(/^Distress · Watch/);

    // Silenced, it still shows, and the title still says so: silence stops the sound, not the Distress.
    await page.locator('[data-silence]').click();
    await expect(page.locator('[data-silence]')).toHaveCount(0);
    await expect(page.locator('[data-ask-fix]')).toBeVisible();
    await expect(page).toHaveTitle(/^Distress · Watch/);
    await context.close();
  });

  test('a question answered from a directory record carries where its words came from', async ({ browser }: { browser: Browser }) => {
    const { finalizeEvent, generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const { buildSignal, open: openSealed, KIND_RESPONSE } = await import('@navcom/core');

    const watchHex = '9'.repeat(63) + '7';
    const watchSecret = Uint8Array.from((watchHex.match(/../g) ?? []).map((b) => parseInt(b, 16)));
    const watchPub = getPublicKey(watchSecret);
    const holder = await pubkeyOf(TEST_SECRET);
    const to = { pubkey: watchPub, holders: [holder] };

    const context = await browser.newContext();
    const page = await context.newPage();
    await liveDevice(page, relay.url, {
      callsign: 'Vale',
      watchSecret: watchHex,
      watchtower: { pubkey: watchPub, relays: [relay.url], holders: [holder] }
    });
    await open(page, '/terminal/watch/');
    await expect(page.locator('[data-empty-board]')).toBeVisible({ timeout: 20_000 });

    // Asked from beside Penn Station, so the lookup opens on New York, nearest first.
    const wren = generateSecretKey();
    const ask = finalizeEvent(
      buildSignal(wren, to, 'query', { text: 'somewhere warm right now', area: 'Midtown', position: { lat: 40.7506, lon: -73.9935, precision_m: 500 } }, Math.floor(Date.now() / 1000)),
      wren
    );
    await listenedFor(ask, 'a question on the phone holding the watch');
    await publish(ask);
    await expect(page.getByText('somewhere warm right now')).toBeVisible({ timeout: 25_000 });

    await page.getByRole('button', { name: 'Answer' }).click();
    await page.locator('[data-lookup-open]').click();
    await expect(page.locator('[data-lookup]')).toContainText('New York metro', { timeout: 15_000 });
    const first = page.locator('[data-lookup-place]').first();
    await expect(first).toBeVisible({ timeout: 15_000 });
    const name = (await first.locator('.name').textContent())!.trim();
    await first.click();
    await expect(page.locator('#a-' + ask.id)).toHaveValue(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await expect(page.locator('[data-attached]')).toContainText(name);

    const before = relay.received.length;
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => relay.received.slice(before).filter((e) => e.kind === KIND_RESPONSE).length, { timeout: 15_000 }).toBeGreaterThan(0);
    const sent = relay.received.slice(before).find((e) => e.kind === KIND_RESPONSE)!;
    const payload = openSealed<{ text: string; provenance: { record_id: string; method: string | null } | null }>(wren, watchPub, sent.content);
    expect(payload.text).toContain(name);
    expect(payload.provenance?.record_id).toBeTruthy();
    await context.close();
  });

  test('an Assist passed on, heard back from the relay, leaves somebody else’s Distress sounding', async ({ browser }: { browser: Browser }) => {
    /*
     * A passed-on named each recipient's latest signal, and the board read every response of its own
     * that named a signal as the answer to it. Raven's latest was her Distress: passing Owl's Assist
     * on marked it Answered and the watch stopped sounding for it (found 2026-11-02). Over a real relay,
     * because the board hearing its own note back is the whole of the bug.
     */
    const { finalizeEvent, generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const { buildSignal, buildDistress, KIND_RESPONSE } = await import('@navcom/core');

    const watchHex = '5'.repeat(63) + '7';
    const watchPub = getPublicKey(Uint8Array.from((watchHex.match(/../g) ?? []).map((b) => parseInt(b, 16))));
    const holder = await pubkeyOf(TEST_SECRET);
    const to = { pubkey: watchPub, holders: [holder] };

    const context = await browser.newContext();
    const page = await context.newPage();
    await liveDevice(page, relay.url, {
      callsign: 'Vale',
      watchSecret: watchHex,
      watchtower: { pubkey: watchPub, relays: [relay.url], holders: [holder] }
    });
    await open(page, '/terminal/watch/');
    await expect(page.locator('[data-empty-board]')).toBeVisible({ timeout: 20_000 });

    const now = () => Math.floor(Date.now() / 1000);
    const [raven, owl, kite] = [generateSecretKey(), generateSecretKey(), generateSecretKey()];
    for (const [key, callsign] of [[raven, 'Raven'], [owl, 'Owl'], [kite, 'Kite']] as const) {
      const out = finalizeEvent(
        buildSignal(key, to, 'on-station', { callsign, area: 'Midtown', expected_duration: 7200, routine_interval: null, share_position: false, position: null }, now()),
        key
      );
      await listenedFor(out, 'a sign-on on the phone holding the watch');
      await publish(out);
    }
    await expect(page.locator('[data-floor] .nc-floor-row')).toHaveCount(3, { timeout: 20_000 });

    await publish(finalizeEvent(buildDistress(raven, to, { position: null, area: 'Midtown' }, now()), raven));
    await expect(page).toHaveTitle(/^Distress · Watch/, { timeout: 20_000 });
    await publish(finalizeEvent(buildSignal(owl, to, 'assist', { urgency: 'now', area: 'Penn Station' }, now()), owl));
    await page.locator('[data-pass-on]').click({ timeout: 20_000 });

    const before = relay.received.length;
    await page.getByRole('button', { name: 'Pass on', exact: true }).click();
    // To Kite: Owl asked, and Raven is in Distress.
    await expect(page.locator('[data-passed]')).toContainText('Kite');
    await expect(page.locator('[data-passed]')).not.toContainText('Raven');
    await expect.poll(() => relay.received.slice(before).filter((e) => e.kind === KIND_RESPONSE).length, { timeout: 15_000 }).toBe(1);
    // Long enough for the relay to have handed the board its own note back.
    await page.waitForTimeout(2_000);
    await expect(page.locator('[data-distress-answered]')).toHaveCount(0);
    await expect(page).toHaveTitle(/^Distress · Watch/);
    await context.close();
  });
});
