import { expect, test, type Browser, type Page } from '@playwright/test';
import { seedDevice, open, deliver, TEST_SECRET } from './device';

/**
 * **Asking for help, and being told nobody is coming.**
 *
 * The Quartermaster needs a second pair of hands. What this milestone insists on is that a
 * watch with nobody to send **says so, in as many words** — because *"an operator who asked
 * for help, got an acknowledgement and waited is worse off than one who was told plainly."*
 *
 * Two phones: the one asking, and the one holding the board. Nothing between them but a relay.
 */

const WATCH = 'a'.repeat(63) + '3';

async function watchPub() {
  const { getPublicKey } = await import('nostr-tools/pure');
  return getPublicKey(
    Uint8Array.from((WATCH.match(/../g) ?? []).map((b) => parseInt(b, 16)))
  );
}

/**
 * The phone holding the board.
 *
 * Seeded with the fixed test key so the operator can be configured to seal to it: a squad
 * lists one **operator** key per phone, and signals go to those rather than to the watch key.
 * That is what lets a member be removed without re-provisioning everybody.
 */
async function theWatch(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await seedDevice(page, { callsign: 'Raven', watchSecret: WATCH, relayEvents: [] });
  return page;
}

/** Raven's operator key — the fixed one every seeded device gets. */
async function holderPub() {
  const { getPublicKey } = await import('nostr-tools/pure');
  return getPublicKey(
    Uint8Array.from((TEST_SECRET.match(/../g) ?? []).map((b) => parseInt(b, 16)))
  );
}

/** The operator out there, configured against that watch. */
async function theOperator(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await seedDevice(page, {
    callsign: 'Wren',
    watchtower: {
      pubkey: await watchPub(),
      relays: ['wss://fake.relay'],
      holders: [await holderPub()]
    },
    relayEvents: []
  });
  return page;
}

test.describe('a watch with nobody to send', () => {
  test.setTimeout(60_000);

  test('says nobody is coming, rather than leaving them on an acknowledgement', async ({ browser }) => {
    const operator = await theOperator(browser);
    const watch = await theWatch(browser);

    // The board is open and waiting, because a delivery lands in subscriptions open now.
    await open(watch, '/terminal/watch/');

    await open(operator, '/terminal/assist/');
    await operator.locator('textarea').first().fill('need a second pair of hands on 8th');
    await operator.getByRole('button', { name: /^assist —/i }).click();

    // The relay carries the ask to whoever is holding the board.
    const asked = await deliver(operator, watch);
    expect(asked, 'the assist never left the phone').toBeGreaterThan(0);

    await expect(watch.getByText(/second pair of hands/)).toBeVisible({ timeout: 10_000 });

    // Raven has nobody to send, and says so with the control built for exactly that.
    await watch.getByRole('button', { name: /^answer$/i }).click();
    await watch.locator('textarea').fill('everyone is committed tonight');
    await watch.getByRole('button', { name: /nobody can come/i }).click();

    const answered = await deliver(watch, operator);
    expect(answered, 'the answer never left the board').toBeGreaterThan(0);

    // And the operator is told in as many words, not left holding an acknowledgement.
    const told = operator.locator('[data-declined]');
    await expect(told).toBeVisible({ timeout: 10_000 });
    await expect(told).toContainText(/nobody is coming/i);
    await expect(operator.locator('[data-acked]')).toHaveCount(0);

    await operator.context().close();
    await watch.context().close();
  });

  test('and the operator was told before they asked that this could happen', async ({ browser }) => {
    // Said on the way in, not only on the way out. Somebody deciding whether to ask should
    // know the honest answer is available.
    const operator = await theOperator(browser);
    await open(operator, '/terminal/assist/');
    await expect(operator.getByText(/a watch that has nobody to send will say so/i)).toBeVisible();
    await operator.context().close();
  });
});
