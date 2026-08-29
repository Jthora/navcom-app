import { expect, test } from '@playwright/test';
import { seedDevice, open, TEST_SECRET, answerNextSignal } from './device';

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
