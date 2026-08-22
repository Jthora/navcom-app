import { expect, test } from '@playwright/test';
import { seedDevice, open, TEST_SECRET, answerNextSignal } from './device';

/**
 * **The Sleeper's 3am.**
 *
 * This project's own name for the on-call person who sleeps through things — the reason drills
 * are randomised, because *"the Sleeper learns a fixed schedule faster than anybody."* Their
 * entire job is to be woken and to say *"I have this"*, and the spec budgets it at **10
 * seconds: one tap, and somebody is waiting on it.**
 *
 * Walked from the notification inwards, using only what a half-awake person can find.
 */

const mine = () => Uint8Array.from((TEST_SECRET.match(/../g) ?? []).map((b) => parseInt(b, 16)));

test.describe('woken at 3am', () => {
  test('the notification names a path that exists', async ({ page }) => {
    // It said "Open the terminal and acknowledge", and there is no acknowledge control in the
    // terminal. Somebody with seconds must not be sent looking for a button that is not there.
    await seedDevice(page, { callsign: 'Wren' });
    await open(page, '/terminal/');

    const sw = await page.evaluate(async () => {
      const r = await fetch('/service-worker.js');
      return r.ok ? r.text() : '';
    });
    expect(sw).not.toMatch(/Open the terminal and acknowledge/);
    expect(sw).toMatch(/Open the board and tell them you are awake/);
    // And a drill is pointed at the console, which is what the SMS page already says.
    expect(sw).toMatch(/Acknowledge it in the console/);
  });

  test('holding the watch, she can tell them she is awake in one tap', async ({ page }) => {
    // The path that does work: a squad member holding the watch answers from the board.
    const { generateSecretKey, finalizeEvent, getPublicKey } = await import('nostr-tools/pure');
    const { buildDistress } = await import('@navcom/core');

    const watchSecret = 'a'.repeat(63) + '3';
    const watchPub = getPublicKey(
      Uint8Array.from((watchSecret.match(/../g) ?? []).map((b) => parseInt(b, 16)))
    );
    const hurt = generateSecretKey();
    const distress = finalizeEvent(
      buildDistress(hurt, { pubkey: watchPub, holders: [getPublicKey(mine())] },
        { position: null, area: 'north side' }, 1_800_000_000),
      hurt
    );

    await seedDevice(page, { callsign: 'Wren', watchSecret, relayEvents: [distress] });
    await open(page, '/terminal/watch/');

    // Distress has its own section above everything [4.R], so she does not scroll for it.
    await expect(page.getByRole('heading', { name: 'Distress' })).toBeVisible({ timeout: 10_000 });

    // One tap to open the reply, and the button says what it does.
    await page.getByRole('button', { name: /tell them you are awake/i }).click();
    await expect(page.locator('textarea')).toBeVisible();
  });

  test('and she is never offered a way to decline a Distress', async ({ page }) => {
    // "Nobody can come" is a real and honest reply to an Assist. Core refuses it for a
    // Distress, and the screen must not offer it either — a watch able to decline one could
    // end it with a tap [invariant 2].
    const { generateSecretKey, finalizeEvent, getPublicKey } = await import('nostr-tools/pure');
    const { buildDistress } = await import('@navcom/core');

    const watchSecret = 'a'.repeat(63) + '3';
    const watchPub = getPublicKey(
      Uint8Array.from((watchSecret.match(/../g) ?? []).map((b) => parseInt(b, 16)))
    );
    const hurt = generateSecretKey();
    const distress = finalizeEvent(
      buildDistress(hurt, { pubkey: watchPub, holders: [getPublicKey(mine())] },
        { position: null, area: 'north side' }, 1_800_000_000),
      hurt
    );

    await seedDevice(page, { callsign: 'Wren', watchSecret, relayEvents: [distress] });
    await open(page, '/terminal/watch/');
    await page.getByRole('button', { name: /tell them you are awake/i }).click();

    const labels = (await page.getByRole('button').allInnerTexts()).join(' | ');
    expect(labels).not.toMatch(/nobody can come/i);
  });
});
