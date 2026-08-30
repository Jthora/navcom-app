import { expect, test } from '@playwright/test';
import { seedDevice, open, TEST_SECRET } from './device';

/**
 * The watch telling an operator they are past the time they gave.
 *
 * `watch-state.spec.md` requires the node to mark an overdue entry, make it visible to
 * whoever holds watch, **and attempt contact with the operator**. The third logged
 * `contact-not-attempted` for months behind a comment saying it should read badly until it
 * stopped being true.
 *
 * The daemon side is tested in `packages/watchtower`. This is the half that decides whether
 * any of that reaches a person — and shipping the sending without it would have been the
 * fifth instance of *a mechanism nobody can reach*, which is the failure this file's
 * neighbours exist to catch.
 */

const mine = () => Uint8Array.from((TEST_SECRET.match(/../g) ?? []).map((b) => parseInt(b, 16)));

/** A session that is already past the window it declared. */
function pastWindow() {
  const now = Math.floor(Date.now() / 1000);
  return {
    at: now - 7200,
    area: 'Downtown',
    expectedUntil: now - 600,
    toldAtSignOn: 'nobody is on call',
    routineInterval: null
  };
}

/** The watch's unsolicited `contact`, sealed to this operator. */
async function nudge(watchSecret: Uint8Array, text = 'You are past the time you gave.') {
  const { finalizeEvent, getPublicKey } = await import('nostr-tools/pure');
  const { buildResponse } = await import('@navcom/core');
  const now = Math.floor(Date.now() / 1000);
  return finalizeEvent(
    buildResponse(
      watchSecret,
      getPublicKey(mine()),
      'e'.repeat(64),
      {
        type: 'contact',
        responder: { kind: 'agent', callsign: 'watchtower' },
        text,
        provenance: null
      } as never,
      now
    ),
    watchSecret
  );
}

test.describe('the watch says you are past your window', () => {
  test('it reaches the operator, silently, and says what to do about it', async ({ page }) => {
    const { getPublicKey, generateSecretKey } = await import('nostr-tools/pure');
    const watchSecret = generateSecretKey();

    await seedDevice(page, {
      callsign: 'Wren',
      watchtower: { pubkey: getPublicKey(watchSecret), relays: ['wss://fake.relay'] },
      // A relay that answers, holding nothing. Without this key `seedDevice` installs the
      // dead socket and no subscription ever opens, so nothing could be delivered at all.
      relayEvents: []
    });
    await page.addInitScript((s) => {
      localStorage.setItem('navcom.wipeable', JSON.stringify({ signon: s }));
    }, pastWindow());
    await open(page, '/terminal/');

    // Before the watch says anything, the screen shows only the device's own arithmetic —
    // and promises exactly what is about to happen.
    await expect(page.getByText(/past declared/i)).toBeVisible();
    await expect(page.getByText(/the watch will nudge, nothing more/i)).toBeVisible();
    await expect(page.locator('[data-nudged]')).toHaveCount(0);

    await page.evaluate(
      (e) => (window as unknown as { __navcomDeliver: (x: unknown) => number }).__navcomDeliver(e),
      await nudge(watchSecret)
    );

    const nudged = page.locator('[data-nudged]');
    await expect(nudged).toBeVisible({ timeout: 10_000 });
    await expect(nudged).toContainText(/the watch nudged/i);
    // It points at the two things that actually answer it, and neither is an alarm.
    await expect(nudged).toContainText(/check in if you are still out, or stand down/i);
    await expect(nudged).not.toContainText(/are you ok/i);
    await expect(nudged).not.toContainText(/emergency|urgent|alert/i);
  });

  test('and a response of any other type does not raise it', async ({ page }) => {
    // The subscription is standing and unfiltered by `#e`, so it sees every response the
    // watch addresses to this operator. Only `contact` may set this.
    const { getPublicKey, generateSecretKey, finalizeEvent } = await import('nostr-tools/pure');
    const { buildResponse } = await import('@navcom/core');
    const watchSecret = generateSecretKey();

    await seedDevice(page, {
      callsign: 'Wren',
      watchtower: { pubkey: getPublicKey(watchSecret), relays: ['wss://fake.relay'] },
      // A relay that answers, holding nothing. Without this key `seedDevice` installs the
      // dead socket and no subscription ever opens, so nothing could be delivered at all.
      relayEvents: []
    });
    await page.addInitScript((s) => {
      localStorage.setItem('navcom.wipeable', JSON.stringify({ signon: s }));
    }, pastWindow());
    await open(page, '/terminal/');

    const ack = finalizeEvent(
      buildResponse(
        watchSecret,
        getPublicKey(mine()),
        'e'.repeat(64),
        { type: 'ack', responder: { kind: 'agent', callsign: 'watchtower' }, text: null, provenance: null } as never,
        Math.floor(Date.now() / 1000)
      ),
      watchSecret
    );
    await page.evaluate(
      (e) => (window as unknown as { __navcomDeliver: (x: unknown) => number }).__navcomDeliver(e),
      ack
    );

    await expect(page.getByText(/past declared/i)).toBeVisible();
    await expect(page.locator('[data-nudged]')).toHaveCount(0);
  });
});
