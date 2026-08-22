import { expect, test } from '@playwright/test';
import { seedDevice, open, TEST_SECRET, answerNextSignal } from './device';

/**
 * Query — the screen this project says **is** the product.
 *
 * *"Query goes to the watch. Someone with both hands free does the lookup. That is the
 * product."* It is also the screen where two invariants are rendered and nowhere else: an
 * agent is never presented as a human [invariant 5], and an answer with no provenance is not
 * rendered as fact.
 *
 * Until this file existed, no browser test opened it.
 */

const mine = () => Uint8Array.from((TEST_SECRET.match(/../g) ?? []).map((b) => parseInt(b, 16)));

/** Builds the watch's reply to whatever the app actually published. */
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

test.describe('asking the watch', () => {
  test('says there is nobody to ask when no watch is configured', async ({ page }) => {
    // "No watch added" and "the watch is down" are different situations an operator acts on
    // differently, and the screen is explicit that they must not read as one sentence.
    await seedDevice(page, { callsign: 'Wren' });
    await open(page, '/terminal/query/');

    await expect(page.getByText(/query goes to a watch/i)).toBeVisible();
    await expect(page.getByText(/nobody\s+to\s+ask/i)).toBeVisible();
  });

  test('will not send an empty question', async ({ page }) => {
    const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    await seedDevice(page, {
      callsign: 'Wren',
      watchtower: { pubkey: getPublicKey(generateSecretKey()), relays: ['wss://fake.relay'] }
    });
    await open(page, '/terminal/query/');

    const ask = page.getByRole('button', { name: /ask/i });
    await expect(ask).toBeDisabled();
    await page.locator('#q').fill('bed tonight, has a dog');
    await expect(ask).toBeEnabled();
  });

  test('does not record anything about the person being asked for', async ({ page }) => {
    // Invariant 1. The screen has to say this where somebody is about to type.
    const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    await seedDevice(page, {
      callsign: 'Wren',
      watchtower: { pubkey: getPublicKey(generateSecretKey()), relays: ['wss://fake.relay'] }
    });
    await open(page, '/terminal/query/');

    await expect(page.getByText(/write about the need, not the person/i)).toBeVisible();
  });

  test('renders an answer with no provenance as unverified, not as fact', async ({ page }) => {
    const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const watchSecret = generateSecretKey();
    const reply = await replyBuilder(watchSecret, {
      type: 'answer',
      responder: { kind: 'human', callsign: 'Raven' },
      text: 'The shelter on 8th has beds',
      provenance: null
    });

    await seedDevice(page, {
      callsign: 'Wren',
      watchtower: { pubkey: getPublicKey(watchSecret), relays: ['wss://fake.relay'] },
      relayEvents: []
    });
    await open(page, '/terminal/query/');

    await page.locator('#q').fill('bed tonight');
    await page.getByRole('button', { name: /ask/i }).click();
    await answerNextSignal(page, reply);

    const unverified = page.locator('[data-provenance="none"]');
    await expect(unverified).toBeVisible({ timeout: 10_000 });
    await expect(unverified).toContainText(/call first/i);
  });

  test('never presents an agent as a human [invariant 5]', async ({ page }) => {
    // An operator must never be uncertain whether they are talking to a person.
    const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const watchSecret = generateSecretKey();
    const reply = await replyBuilder(watchSecret, {
      type: 'answer',
      responder: { kind: 'agent', callsign: 'nightwatch' },
      text: 'Two beds listed at the 8th Street shelter',
      provenance: { method: 'directory', verified: '2026-08-18' }
    });

    await seedDevice(page, {
      callsign: 'Wren',
      watchtower: { pubkey: getPublicKey(watchSecret), relays: ['wss://fake.relay'] },
      relayEvents: []
    });
    await open(page, '/terminal/query/');

    await page.locator('#q').fill('bed tonight');
    await page.getByRole('button', { name: /ask/i }).click();
    await answerNextSignal(page, reply);

    const block = page.locator('[data-answer]');
    await expect(block).toBeVisible({ timeout: 10_000 });
    await expect(block).toContainText('nightwatch');
    await expect(block).toContainText(/\bagent\b/);
  });
});
