import { expect, test } from '@playwright/test';
import { seedDevice, open, TEST_SECRET, answerNextSignal, holdUntil } from './device';

/**
 * What the operator is told while a `Distress` is running.
 *
 * Invariant 2 is two halves: *"`Distress` terminates in a human, or tells the operator it
 * couldn't."* The first half is proven in core across nine numbered failure modes. **The
 * second half is rendered here and had never been driven from a real event** — the screen was
 * opened by several tests, for the hold control and the contact link, and none of them ever
 * put a response on it.
 *
 * Two things the screen must never do are asserted alongside, because they are what make the
 * telling trustworthy: an agent is never presented as the answer [invariant 5], and nothing
 * on this screen closes a Distress.
 */

const mine = () => Uint8Array.from((TEST_SECRET.match(/../g) ?? []).map((b) => parseInt(b, 16)));

async function replyBuilder(watchSecret: Uint8Array, payload: Record<string, unknown>) {
  const { finalizeEvent, getPublicKey } = await import('nostr-tools/pure');
  const { buildResponse } = await import('@navcom/core');
  return (signal: { id: string; created_at: number }) =>
    finalizeEvent(
      buildResponse(watchSecret, getPublicKey(mine()), signal.id, payload as never,
        signal.created_at + 1),
      watchSecret
    );
}

/**
 * Holds the control down until the Distress is actually out.
 *
 * The hold completes on its own and the sending starts; waiting for the published event is
 * the honest signal, where a fixed timeout is a guess that goes stale on a slower machine.
 * No release is dispatched — by then the control has been replaced by the live view.
 */
async function raiseDistress(page: import('@playwright/test').Page) {
  await page.locator('button.raise').dispatchEvent('pointerdown');
  await page.waitForFunction(
    () => (((window as never as { __navcomPublished?: unknown[] }).__navcomPublished) ?? []).length > 0,
    undefined,
    { timeout: 15_000 }
  );
}

async function withWatch(page: import('@playwright/test').Page) {
  const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
  const watchSecret = generateSecretKey();
  await seedDevice(page, {
    callsign: 'Wren',
    watchtower: { pubkey: getPublicKey(watchSecret), relays: ['wss://fake.relay'] },
    relayEvents: []
  });
  return watchSecret;
}

test.describe('while a Distress is running', () => {
  test.setTimeout(45_000);

  test('a human acknowledgement is shown by name', async ({ page }) => {
    const watchSecret = await withWatch(page);
    const reply = await replyBuilder(watchSecret, {
      type: 'ack',
      responder: { kind: 'human', callsign: 'Raven' },
      text: 'awake, on my way',
      provenance: null
    });

    await open(page, '/terminal/distress/');
    await raiseDistress(page);
    await answerNextSignal(page, reply);

    const block = page.locator('[data-distress="acknowledged"]');
    await expect(block).toBeVisible({ timeout: 15_000 });
    await expect(block).toContainText('Raven');
    await expect(page.getByText(/awake, on my way/i)).toBeVisible();
  });

  test('an agent answering is not presented as a human having it [invariant 5]', async ({ page }) => {
    // The one that matters most here: an agent holding the line must read as still looking
    // for a person, not as help arriving.
    const watchSecret = await withWatch(page);
    const reply = await replyBuilder(watchSecret, {
      type: 'answer',
      responder: { kind: 'agent', callsign: 'nightwatch' },
      text: 'seen',
      provenance: null
    });

    await open(page, '/terminal/distress/');
    await raiseDistress(page);
    await answerNextSignal(page, reply);

    await expect(page.getByText(/still looking for a human/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-distress="acknowledged"]')).toHaveCount(0);
  });

  test('the watch saying nobody can be reached is shown at once, as the watch [invariant 2]', async ({ page }) => {
    /*
     * The defect this guards: the escalation ladder's own "Nobody is coming" was filed under
     * "an agent answered" and its words thrown away, so an operator with nobody on call was
     * told something was still happening for ten minutes, until the phone's own timer said
     * otherwise. The ladder is the watch, not an agent, and its word is shown when it arrives.
     */
    const watchSecret = await withWatch(page);
    const reply = await replyBuilder(watchSecret, {
      type: 'escalation-status',
      responder: { kind: 'node', callsign: 'escalation' },
      text: "Couldn't reach anyone. Nobody is coming.",
      provenance: null,
      ladder: 'exhausted'
    });

    await open(page, '/terminal/distress/');
    await raiseDistress(page);
    await answerNextSignal(page, reply);

    const nobody = page.locator('[data-watch-exhausted]');
    await expect(nobody).toBeVisible({ timeout: 15_000 });
    await expect(nobody).toContainText(/Nobody is coming/);
    await expect(nobody).toContainText(/Couldn't reach anyone/);
    await expect(page.getByText(/an agent answered/i)).toHaveCount(0);
    // Still sending: only the operator ends it, and a human who answers later still counts.
    await expect(page.locator('[data-distress="running"]')).toBeVisible();
  });

  test('an answer to an earlier Distress is shown as that, and the sending goes on [#0]', async ({ page }) => {
    /*
     * The watch holds a person's answer and repeats it to a new Distress from the same phone,
     * naming the new attempt and the one they answered. A run started after that answer -- the
     * app reopened or the phone wiped once that ladder was over -- never sent or joined the one
     * they answered, and that answer closed it under "Answered" and "Wren has it" in a tenth of a
     * second, though the watch had not escalated this Distress.
     */
    const watchSecret = await withWatch(page);
    const { finalizeEvent, getPublicKey } = await import('nostr-tools/pure');
    const { buildResponse } = await import('@navcom/core');
    const held = (signal: { id: string; created_at: number }) => {
      const template = buildResponse(
        watchSecret,
        getPublicKey(mine()),
        signal.id,
        {
          type: 'ack',
          responder: { kind: 'human', callsign: 'Wren' },
          text: 'Acknowledged 20 min ago. The watch has not escalated this one. If your phone is still sending in 10 min, the watch treats it as new.',
          provenance: null,
          ladder: 'acknowledged'
        } as never,
        signal.created_at + 1
      );
      // The Distress Wren answered: one this run never sent.
      template.tags.push(['e', 'e'.repeat(64)]);
      return finalizeEvent(template, watchSecret);
    };

    await open(page, '/terminal/distress/');
    await raiseDistress(page);
    await answerNextSignal(page, held);

    const block = page.locator('[data-acknowledged-earlier]');
    await expect(block).toBeVisible({ timeout: 15_000 });
    await expect(block).toContainText('Wren');
    await expect(block).toContainText(/earlier\s+Distress\s+from you, not this one/);
    await expect(block).toContainText(/has not escalated this one/);
    // None of what a person answering this one would show.
    await expect(page.locator('[data-distress="acknowledged"]')).toHaveCount(0);
    await expect(page.locator('.live.acked')).toHaveCount(0);
    await expect(page.getByText(/has it/i)).toHaveCount(0);
    await expect(page.locator('.nc-panel-post')).toHaveText(/Sending/);
    // And it is still sending, with the operator's way to stop it.
    await expect(page.locator('[data-distress="running"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /stand down/i })).toBeVisible();
  });

  test('a Distress started again mid-ladder ends when the person paged answers that ladder [review: relay paths, R1]', async ({ page }) => {
    /*
     * The app reopened or the phone wiped while the first Distress's ladder was still paging, and
     * the Distress sent again. The watch joins this run's attempts to that ladder and says so,
     * naming the attempt and the ladder's own id. The person paged answers the id their page
     * carried -- one this run never sent. That answer was dropped, the hold's repeat of it showed
     * as an answer to an earlier Distress, and the phone went on sending while Wren was on her way.
     */
    const watchSecret = await withWatch(page);
    const { finalizeEvent, getPublicKey } = await import('nostr-tools/pure');
    const { buildResponse } = await import('@navcom/core');
    const ladder = 'a'.repeat(64);
    const joined = (signal: { id: string; created_at: number }) => {
      const template = buildResponse(
        watchSecret,
        getPublicKey(mine()),
        signal.id,
        { type: 'escalation-status', responder: { kind: 'node', callsign: 'escalation' }, text: 'Paging Wren.', provenance: null, ladder: 'paging' } as never,
        signal.created_at + 1
      );
      // The ladder this attempt joined: opened by the Distress sent before the app closed.
      template.tags.push(['e', ladder]);
      return finalizeEvent(template, watchSecret);
    };
    // Wren's answer to her page, which carried the ladder's own id and nothing of this run's.
    const wrenOnHerPage = (signal: { created_at: number }) =>
      finalizeEvent(
        buildResponse(
          watchSecret,
          getPublicKey(mine()),
          ladder,
          { type: 'ack', responder: { kind: 'human', callsign: 'Wren' }, text: 'Wren is responding.', provenance: null, ladder: 'acknowledged' } as never,
          signal.created_at + 2
        ),
        watchSecret
      );

    await open(page, '/terminal/distress/');
    await raiseDistress(page);
    await answerNextSignal(page, joined);
    await expect(page.getByText(/the watch: Paging Wren\./)).toBeVisible({ timeout: 15_000 });
    await answerNextSignal(page, wrenOnHerPage);

    const block = page.locator('[data-distress="acknowledged"]');
    await expect(block).toBeVisible({ timeout: 15_000 });
    await expect(block).toContainText('Wren');
    await expect(page.locator('[data-acknowledged-earlier]')).toHaveCount(0);
  });

  test('the watch saying nobody can be reached stays said when it pages again', async ({ page }) => {
    // The phone now sends again as soon as a ladder runs out, so the next ladder's "Paging Wren."
    // arrives within a second. Going by the latest report, the panel was gone almost as it came.
    // Both replies here name the first attempt -- answerNextSignal takes the first Distress it
    // finds -- so what this pins is the screen's rule, not which attempt a fresh ladder answers.
    const watchSecret = await withWatch(page);
    const exhausted = await replyBuilder(watchSecret, {
      type: 'escalation-status',
      responder: { kind: 'node', callsign: 'escalation' },
      text: "Couldn't reach anyone. Nobody is coming.",
      provenance: null,
      ladder: 'exhausted'
    });
    const pagingAgain = await replyBuilder(watchSecret, {
      type: 'escalation-status',
      responder: { kind: 'node', callsign: 'escalation' },
      text: 'Paging Wren.',
      provenance: null,
      ladder: 'paging'
    });

    await open(page, '/terminal/distress/');
    await raiseDistress(page);
    await answerNextSignal(page, exhausted);
    await expect(page.locator('[data-watch-exhausted]')).toBeVisible({ timeout: 15_000 });
    await answerNextSignal(page, pagingAgain);
    await expect(page.getByText(/the watch: Paging Wren\./)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-watch-exhausted]')).toBeVisible();
  });

  test('and nothing on the screen closes it', async ({ page }) => {
    // Only the operator ends a Distress, and only by stopping the sending themselves.
    const watchSecret = await withWatch(page);
    const reply = await replyBuilder(watchSecret, {
      type: 'ack',
      responder: { kind: 'human', callsign: 'Raven' },
      text: null,
      provenance: null
    });

    await open(page, '/terminal/distress/');
    await raiseDistress(page);
    await answerNextSignal(page, reply);
    await expect(page.locator('[data-distress="acknowledged"]')).toBeVisible({ timeout: 15_000 });

    const labels = (await page.getByRole('button').allInnerTexts()).join(' | ');
    expect(labels).not.toMatch(/close|resolve|clear|dismiss|cancel distress/i);
  });
});

test.describe('a wipe while a Distress is running', () => {
  test.setTimeout(60_000);

  /*
   * Decided 2026-09-13: a wipe stops what this phone is still sending, a Distress included. A
   * review then found the stop only landed at the top of the loop's next pass — up to a minute
   * of the send button unavailable on a phone just wiped, with the cancellation coming back onto
   * the screen as an error. Driven through the screens a person would use and never a reload,
   * which ends the Distress on its own and would prove nothing.
   */
  test('stops it at once, leaves no trace of it, and the phone can send again', async ({ page }) => {
    await withWatch(page);
    await open(page, '/terminal/distress/');
    await raiseDistress(page);
    await expect(page.locator('[data-distress="running"]')).toBeVisible({ timeout: 15_000 });

    await page.locator('header a[href="/terminal/"]').first().click();
    await page.locator('nav[data-rail="all"] a[href="/terminal/wipe/"]').click();
    await holdUntil(page, 'button:has-text("Hold to wipe tonight")');
    await expect(page).toHaveURL(/\/terminal\/$/);

    const distresses = () =>
      page.evaluate(() =>
        (((window as never as { __navcomPublished?: { kind: number }[] }).__navcomPublished) ?? [])
          .filter((e) => e.kind === 20911).length
      );
    const atWipe = await distresses();

    await page.locator('a[href="/terminal/distress/"]').first().click();
    await expect(page.locator('button.raise')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-distress]')).toHaveCount(0);
    await expect(page.getByText(/cancelled/i)).toHaveCount(0);

    await page.waitForTimeout(3_000);
    expect(await distresses(), 'nothing sent after the wipe').toBe(atWipe);
  });
});

test.describe('holding to send with no watch configured (found in robustness audit)', () => {
  // The ordinary Alone case, not an edge one. raiseDistress() used to build its context
  // (which throws when no watch is configured) before its own try/catch even started, and
  // the caller here fires it with no await and no catch -- so the throw became an unhandled
  // rejection nothing on this screen ever saw. An operator who felt the hold complete was
  // told nothing, which is invariant 2 failing in exactly the way it forbids.
  test('says plainly that nothing was sent, rather than showing nothing at all', async ({ page }) => {
    await seedDevice(page, { callsign: 'Wren' });
    await open(page, '/terminal/distress/');

    await page.locator('button.raise').dispatchEvent('pointerdown');
    await expect(page.locator('p.error')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('p.error')).not.toHaveText('');
  });
});

test.describe('a Distress every relay refuses', () => {
  test.setTimeout(45_000);

  /*
   * The failure that looks most like success.
   *
   * `unreachable` is the one phase that means the signal never left the device — the relay
   * answered, so there is no connection error anywhere, and it answered `OK … false`. If the
   * screen does not say so, an operator watching a Distress "run" is watching nothing, which
   * is the precise shape invariant 2 forbids: *it may fail, it may never fail silently.*
   *
   * `refusePublish` has existed on the seed since the watch-side work and four tests use it,
   * none of them here. So the ladder's own rendering of a refused publish had never once been
   * driven, on the screen where being wrong costs the most.
   */
  test('says it never left the phone, and keeps trying rather than stopping', async ({ page }) => {
    const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const watchSecret = generateSecretKey();
    await seedDevice(page, {
      callsign: 'Wren',
      watchtower: { pubkey: getPublicKey(watchSecret), relays: ['wss://fake.relay'] },
      // `relayEvents: []` installs the mock socket. Without it the seed leaves the socket
      // alone, `wss://fake.relay` fails to connect, and the screen reports `unreachable`
      // for an entirely different reason — which is how the first version of this test
      // passed with `refusePublish: false` and proved nothing.
      relayEvents: [],
      refusePublish: true
    });
    await open(page, '/terminal/distress/');
    await page.locator('button.raise').dispatchEvent('pointerdown');

    // Told, in words, that nothing was sent — not left reading a progress list.
    await expect(page.getByText(/never left the phone/i).first()).toBeVisible({ timeout: 20_000 });

    // And it is still going. Only the operator ends a Distress; a client that gave up on
    // its own would have failed silently one line after saying so out loud.
    await expect(page.getByText(/attempt 2/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('button.raise')).toHaveCount(0);
  });
});
