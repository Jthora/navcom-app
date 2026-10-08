import { expect, test, type Page } from '@playwright/test';
import { seedDevice, open, TEST_SECRET, answerNextSignal, serviceWorkerReady } from './device';

/**
 * Wake the others [`escalation.spec.md`, *Wake the others*].
 *
 * Somebody who acknowledged an operator is paged again, because that operator's phone is still
 * sending. The page used to read as a new `Distress` with nothing to do but acknowledge an attempt
 * the watch would ignore. It opens this screen now: fixed words, and one action, which asks the watch
 * to page everyone about that attempt. It closes nothing, and it says what it did.
 */

const mine = () => Uint8Array.from((TEST_SECRET.match(/../g) ?? []).map((b) => parseInt(b, 16)));
const ATTEMPT = 'a'.repeat(64);

async function keys() {
  const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
  const watch = generateSecretKey();
  const executor = generateSecretKey();
  return { watch, executor, W: getPublicKey(watch), X: getPublicKey(executor) };
}

async function seeded(page: Page) {
  const k = await keys();
  const { watchCode } = await import('../src/lib/terminal/watch-code');
  // The escalation key as a phone keeps it: inside the code the watch signed.
  const code = watchCode({ pubkey: k.W, relays: ['wss://fake.relay'], holders: [], executor: k.X }, k.watch);
  await seedDevice(page, {
    callsign: 'Wren',
    watchtower: { pubkey: k.W, relays: ['wss://fake.relay'] },
    accruing: { watch_escalation: code.split('#')[1] },
    relayEvents: []
  });
  return k;
}

/** An answer to the wake signal from `author`, sealed by it to this phone. */
async function answerFrom(author: Uint8Array, text: string) {
  const { finalizeEvent, getPublicKey } = await import('nostr-tools/pure');
  const { buildResponse } = await import('@navcom/core');
  return (signal: { id: string; created_at: number }) =>
    finalizeEvent(
      buildResponse(author, getPublicKey(mine()), signal.id, {
        type: 'answer',
        responder: { kind: 'node', callsign: 'escalation' },
        text,
        provenance: null
      }, signal.created_at + 1),
      author
    );
}

const now = () => Math.floor(Date.now() / 1000);

test.describe('the screen a repeat page opens', () => {
  test.setTimeout(45_000);

  test('says what happened in fixed words, and offers one thing, which is not an acknowledgement', async ({ page }) => {
    await seeded(page);
    const t = now();
    await open(page, `/terminal/wake/?attempt=${ATTEMPT}&paged=${t}&acked=${t - 720}&widens=${t + 240}`);
    await expect(page.locator('[data-wake-words]')).toHaveText(
      'Distress again from the operator you acknowledged 12 min ago. If their phone is still sending in 4 min, the watch treats it as new and pages everyone.'
    );
    await expect(page.getByRole('button', { name: 'Wake the others now' })).toBeVisible();
    await expect(page.getByRole('button', { name: /I have this/i })).toHaveCount(0);
    // Nothing goes until somebody taps.
    expect(await page.evaluate(() => ((window as never as { __navcomPublished?: unknown[] }).__navcomPublished ?? []).length)).toBe(0);
  });

  test('sends the wake signal from this phone’s key when tapped, and shows the watch’s answer', async ({ page }) => {
    const k = await seeded(page);
    await open(page, `/terminal/wake/?attempt=${ATTEMPT}&paged=${now()}`);
    await page.getByRole('button', { name: 'Wake the others now' }).click();

    const { getPublicKey } = await import('nostr-tools/pure');
    const seen: { pubkey?: string } = {};
    // Signed and sealed by the executor's own key: the screen must hear it, not only the watch key.
    const reply = await answerFrom(k.executor, 'Wren asked the watch to page everyone about this one. Paging Raven.');
    await answerNextSignal(page, (signal) => {
      seen.pubkey = signal.pubkey;
      return reply(signal);
    });
    expect(seen.pubkey, 'sent from a key the roster does not hold').toBe(getPublicKey(mine()));
    const published = await page.evaluate(() => (window as never as { __navcomPublished: { tags: string[][] }[] }).__navcomPublished);
    expect(published.some((e) => e.tags.some((t) => t[0] === 't' && t[1] === 'wake-others'))).toBe(true);

    const answered = page.locator('[data-wake-answered]');
    await expect(answered).toBeVisible({ timeout: 15_000 });
    await expect(answered).toContainText('Paging Raven.');
    // It widened who is woken; nothing on the screen says anybody has the operator.
    await expect(answered).not.toContainText(/has it/i);
    await expect(page.locator('[data-wake-words]')).not.toContainText(/has it/i);
  });

  test('says so when the watch does not answer, rather than implying anybody was woken', async ({ page }) => {
    await seeded(page);
    await open(page, `/terminal/wake/?attempt=${ATTEMPT}&paged=${now()}`);
    await page.getByRole('button', { name: 'Wake the others now' }).click();
    const unanswered = page.locator('[data-wake-unanswered]');
    await expect(unanswered).toBeVisible({ timeout: 20_000 });
    await expect(unanswered).toContainText(/cannot say whether anybody/);
  });

  test('gives no time for the others being paged that the page did not give [review: live hole, phone]', async ({ page }) => {
    // As built, the watch pages everyone only once the acknowledgement stops holding, 30 minutes by
    // default; a "5 min" from the page's arrival sent somebody back to sleep.
    await seeded(page);
    await open(page, `/terminal/wake/?attempt=${ATTEMPT}&paged=${now()}`);
    const words = page.locator('[data-wake-words]');
    await expect(words).toContainText('The watch may not page everyone until your acknowledgement stops holding.');
    await expect(words).not.toContainText(/\d/);
  });

  test('shows an answer the watch key alone signed only as unconfirmed, on a box that names its executor', async ({ page }) => {
    const k = await seeded(page);
    await open(page, `/terminal/wake/?attempt=${ATTEMPT}&paged=${now()}`);
    await page.getByRole('button', { name: 'Wake the others now' }).click();
    // What a compromised agent beside the box could send, holding the watch key.
    await answerNextSignal(page, await answerFrom(k.watch, 'Done. The watch is paging Raven, Kestrel about them.'));
    const said = page.locator('[data-wake-unconfirmed]');
    await expect(said).toBeVisible({ timeout: 20_000 });
    await expect(said).toContainText('(unconfirmed)');
    await expect(said).toContainText(/cannot confirm anybody is being woken/);
    await expect(page.locator('[data-wake-answered]')).toHaveCount(0);
  });

  test('offers nothing to send when the page named no attempt', async ({ page }) => {
    await seeded(page);
    await open(page, `/terminal/wake/?paged=${now()}`);
    await expect(page.locator('[data-wake-no-attempt]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Wake the others now' })).toHaveCount(0);
    await expect(page.locator('[data-wake-words]')).toContainText('Distress again from an operator you acknowledged.');
  });
});

test.describe('the screen a repeat page opens, with no signal [review: live hole, phone]', () => {
  test.skip(() => test.info().project.name === 'iphone', 'WebKit driver crashes on navigation while offline');

  test('opens from the address a repeat page carries, query and all', async ({ page, context }) => {
    await seeded(page);
    await open(page, '/terminal/');
    await serviceWorkerReady(page);
    await context.setOffline(true);
    try {
      const response = await open(page, `/terminal/wake/?attempt=${ATTEMPT}&paged=${now()}`);
      expect(response?.status(), 'the saved screen read as not saved').toBeLessThan(400);
      await expect(page.locator('h1')).toHaveText('Wake the others');
      await expect(page.getByRole('button', { name: 'Wake the others now' })).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });
});
