import { expect, test } from '@playwright/test';
import { seedDevice, open } from './device';

/**
 * Saying *"I have this"* from the device that woke you.
 *
 * The last missing piece of the paging path [build order 2.5]. `distress-ack` has been a
 * defined signal with a ten-second budget — *"one tap, and somebody is waiting on it as they
 * are waiting on nothing else"* — the executor has accepted it, the roster could identify who
 * sent it, and **no client ever sent one.** The push notification told people to
 * "acknowledge in the console", and the service worker's own comment recorded why: an earlier
 * text said *"open the terminal and acknowledge"* and there was no such control.
 *
 * The id arrives in the URL because it cannot arrive any other way. `20911` is ephemeral, so a
 * relay forwards it to whoever is subscribed at that instant and stores nothing: a phone that
 * was asleep when the Distress fired and woke on the notification finds the event gone.
 */

const ID = 'a'.repeat(64);

test.describe('a paged operator acknowledging', () => {
  test('is offered the ack above everything else on the screen', async ({ page }) => {
    /*
     * Rule 5 allows one lit action, and this outranks sign-on and check-in: somebody raised a
     * Distress and is waiting on this tap. Asserted because the ordering is the whole point —
     * an ack buried under a sign-on prompt is an ack nobody finds at 3am.
     */
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await open(page, `/terminal/?ack=${ID}`);

    const ack = page.locator('[data-ack]');
    await expect(ack).toBeVisible();
    await expect(ack.getByRole('button', { name: /i have this/i })).toBeVisible();
    await expect(page.locator('[data-ack-pending]')).toContainText(/waiting for a human/i);
  });

  test('says what the tap does before it is tapped', async ({ page }) => {
    // "The only thing that stops the ladder paging" is the fact that makes the tap urgent,
    // and it is the one a person woken at 3am has no context for.
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await open(page, `/terminal/?ack=${ID}`);
    await expect(page.locator('[data-ack-pending]')).toContainText(/stops the ladder/i);
  });

  test('offers nothing when no Distress was carried in', async ({ page }) => {
    // The control exists only when there is something to acknowledge. A permanent "I have
    // this" button is an invitation to stop a ladder that is not running.
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await open(page, '/terminal/');
    await expect(page.locator('[data-ack]')).toHaveCount(0);
    await expect(page.locator('[data-ack-pending]')).toHaveCount(0);
  });

  test('refuses an id that is not a real event id', async ({ page }) => {
    /*
     * A query parameter is attacker-controlled by definition — anybody can send anybody a
     * link. A malformed one must not produce a control that sends a malformed ack.
     */
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await open(page, '/terminal/?ack=not-a-real-event-id');
    await expect(page.locator('[data-ack]')).toHaveCount(0);
  });

  test('never acknowledges without a tap', async ({ page }) => {
    /*
     * The load-bearing guard [signals.spec]: *"MUST be an explicit act by a person. A delivery
     * receipt, a read receipt or an app-open event MUST NOT be routed into it — someone whose
     * phone buzzed is not someone who woke up."*
     *
     * Opening the page is exactly an app-open, so this asserts that arriving on the URL sends
     * nothing and still shows the control as unsent.
     */
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await open(page, `/terminal/?ack=${ID}`);
    await page.waitForTimeout(1200);
    await expect(page.locator('[data-ack-sent]')).toHaveCount(0);
    await expect(page.locator('[data-ack]')).toBeVisible();
  });

  test('a failed ack says so, rather than looking like a success', async ({ page }) => {
    /*
     * The ladder keeps paging either way. The person standing here has to know their ack did
     * not land, because the alternative is believing they have handled something they have
     * not — which is the same failure invariant 2 exists to prevent, one step further on.
     */
    await seedDevice(page, { callsign: 'Wren', relayEvents: [], refusePublish: true });
    await open(page, `/terminal/?ack=${ID}`);
    await page.locator('[data-ack]').getByRole('button').click();
    await expect(page.locator('[data-ack-failed]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-ack-failed]')).toContainText(/did not send/i);
    await expect(page.locator('[data-ack-sent]')).toHaveCount(0);
  });
});
