import { expect, test, type Page } from '@playwright/test';
import { seedDevice, open, TEST_SECRET } from './device';

/**
 * Answering, which is what a board is for.
 *
 * Taking the watch, the qualification gate, giving it up and the Distress section are all
 * driven elsewhere. **The answer itself was not** — and it is the whole job: somebody asked,
 * and a human on the other end says something back.
 *
 * Two rules are asserted alongside, because they are what make an answer trustworthy: an
 * answered query leaves the board and a `Distress` never does [invariant 2], and *"nobody can
 * come"* is offered for an Assist and refused for a `Distress`.
 */

const WATCH_SECRET = 'a'.repeat(63) + '3';

async function watchPub() {
  const { getPublicKey } = await import('nostr-tools/pure');
  return getPublicKey(
    Uint8Array.from((WATCH_SECRET.match(/../g) ?? []).map((b) => parseInt(b, 16)))
  );
}

/** A signal from an operator, addressed to this watch and sealed to its holder. */
async function signalTo(type: 'query' | 'assist', payload: Record<string, unknown>) {
  const { generateSecretKey, finalizeEvent, getPublicKey } = await import('nostr-tools/pure');
  const { buildSignal } = await import('@navcom/core');
  const mine = Uint8Array.from((TEST_SECRET.match(/../g) ?? []).map((b) => parseInt(b, 16)));
  const sender = generateSecretKey();
  return finalizeEvent(
    buildSignal(sender, { pubkey: await watchPub(), holders: [getPublicKey(mine)] },
      type, payload as never, 1_800_000_000),
    sender
  );
}

async function boardWith(page: Page, events: unknown[]) {
  await seedDevice(page, { callsign: 'Wren', watchSecret: WATCH_SECRET, relayEvents: events });
  await open(page, '/terminal/watch/');
}

const publishedCount = (page: Page) =>
  page.evaluate(() =>
    ((window as never as { __navcomPublished?: unknown[] }).__navcomPublished ?? []).length
  );

test.describe('answering somebody from the board', () => {
  test('sends the answer and takes the question off the board', async ({ page }) => {
    await boardWith(page, [await signalTo('query', { text: 'bed tonight, has a dog', area: 'north' })]);

    await expect(page.getByText(/bed tonight, has a dog/)).toBeVisible({ timeout: 10_000 });
    const before = await publishedCount(page);

    await page.getByRole('button', { name: /^answer$/i }).click();
    await page.locator('textarea').fill('the shelter on 8th takes dogs');
    await page.getByRole('button', { name: /^send$/i }).click();

    // Something actually left the phone.
    await expect.poll(() => publishedCount(page), { timeout: 10_000 })
      .toBeGreaterThan(before);
    // And it has been dealt with, so it is off the board.
    await expect(page.getByText(/bed tonight, has a dog/)).toHaveCount(0);
  });

  test('never takes a Distress off the board, even after answering it', async ({ page }) => {
    // Acknowledging is telling them somebody is awake, not that it is over. Only a human
    // ending it clears one [invariant 2], and this screen cannot know that has happened.
    const { generateSecretKey, finalizeEvent, getPublicKey } = await import('nostr-tools/pure');
    const { buildDistress } = await import('@navcom/core');
    const mine = Uint8Array.from((TEST_SECRET.match(/../g) ?? []).map((b) => parseInt(b, 16)));
    const hurt = generateSecretKey();
    const distress = finalizeEvent(
      buildDistress(hurt, { pubkey: await watchPub(), holders: [getPublicKey(mine)] },
        { position: null, area: 'north side' }, 1_800_000_000),
      hurt
    );

    await boardWith(page, [distress]);
    await expect(page.getByRole('heading', { name: 'Distress' })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: /tell them you are awake/i }).click();
    await page.locator('textarea').fill('awake, on my way');
    await page.getByRole('button', { name: /^send$/i }).click();
    await page.waitForTimeout(500);

    // Still there. It is not this screen's to close.
    await expect(page.getByRole('heading', { name: 'Distress' })).toBeVisible();
  });

  test('offers "nobody can come" for an Assist, where it is a real and honest reply', async ({ page }) => {
    // An operator who asked for help, got an acknowledgement and waited is worse off than one
    // told plainly that nobody is coming.
    await boardWith(page, [await signalTo('assist', { urgency: 'soon', text: 'second pair of hands', area: 'north' })]);

    await expect(page.getByText(/second pair of hands/)).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /^answer$/i }).click();
    await expect(page.getByRole('button', { name: /nobody can come/i })).toBeVisible();
  });
});
