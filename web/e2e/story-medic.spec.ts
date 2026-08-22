import { expect, test } from '@playwright/test';
import { blankDevice, open } from './device';

/**
 * **The Protest Medic's night.**
 *
 * She works alone, has no watch, and her defining requirement is that a seized phone shows
 * nothing about where she was. The Alone layer promises her three things: *"Cached directory,
 * your own patrol record, your own person one tap away."*
 *
 * Only controls she can see are used. Where a step needs a screen she cannot reach from the
 * one before it, that is the finding rather than a reason to navigate by URL.
 */

async function anIdentity(page: import('@playwright/test').Page, name = 'Medic') {
  await blankDevice(page);
  await open(page, '/terminal/');
  await page.getByRole('link', { name: /choose a callsign/i }).click();
  await page.locator('#callsign').fill(name);
  await page.getByRole('button', { name: /generate keypair/i }).click();
  await open(page, '/terminal/');
}

test.describe('a night, with no watch', () => {
  test('she can start a patrol from the screen she lands on', async ({ page }) => {
    // The Alone layer promises her own patrol record. Recording one starts with signing on,
    // and the session layer supports that with no watch on purpose — its own words: "the
    // session is set either way", and a watch's "absence must not mean the patrol never
    // happened."
    await anIdentity(page);
    await expect(page.getByRole('link', { name: /sign on/i })).toBeVisible();
  });

  test('her patrol is in her own record afterwards', async ({ page }) => {
    await anIdentity(page);
    await page.getByRole('link', { name: /sign on/i }).click();

    await page.locator('#area').fill('north riverfront');
    await page.getByRole('button').last().click();

    // Home again, from the screen she is on. Two steps on purpose: the close of the night is
    // the one place she gets to say anything in her own words.
    await page.waitForURL('**/terminal/');
    await page.getByRole('button', { name: /stand down/i }).click();
    await page.locator('#note').fill('quiet night, two handouts at the underpass');
    await page.locator('button.primary').click();
    await page.waitForTimeout(500);

    await open(page, '/terminal/patrols/');
    await expect(page.getByText(/north riverfront/i)).toBeVisible();
    await expect(page.getByText(/two handouts at the underpass/i)).toBeVisible();
  });

  test('and a wipe takes the night while leaving her able to work', async ({ page }) => {
    // Her defining requirement, walked rather than asserted. Panic wipe destroys the Wipeable
    // tier and nothing else [invariant 7]: the night goes, the identity stays, so nobody has
    // to re-provision her at the worst possible moment.
    await anIdentity(page);

    // A night first, so there is something to lose.
    await page.getByRole('link', { name: /sign on/i }).click();
    await page.locator('#area').fill('north riverfront');
    await page.getByRole('button').last().click();
    await page.waitForURL('**/terminal/');
    await page.getByRole('button', { name: /stand down/i }).click();
    await page.locator('#note').fill('quiet night');
    await page.locator('button.primary').click();
    await page.waitForTimeout(400);

    await open(page, '/terminal/patrols/');
    await expect(page.getByText(/north riverfront/i)).toBeVisible();

    // Held down, because a wipe is not something a pocket can do by accident.
    await open(page, '/terminal/wipe/');
    // By class, not by name: the label changes to "Keep holding…" mid-press, so a
    // name-based locator stops matching exactly when the release is needed.
    const hold = page.locator('button.danger:not(.burn)');
    await expect(hold).toContainText(/hold to wipe tonight/i);
    // The hold completes itself after 800ms and goes straight back to an ordinary-looking
    // terminal — no receipt, no confirmation, which is the point. So there is no release to
    // dispatch: waiting for the navigation is waiting for the wipe.
    await hold.dispatchEvent('pointerdown');
    await page.waitForURL('**/terminal/', { timeout: 10_000 });

    // The night is gone.
    await open(page, '/terminal/patrols/');
    await expect(page.getByText(/north riverfront/i)).toHaveCount(0);
    await expect(page.getByText(/nothing yet/i)).toBeVisible();

    // And she can still work: the identity survived, so Status is not asking her to start over.
    await open(page, '/terminal/');
    await expect(page.getByRole('heading', { name: /start here/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /sign on/i })).toBeVisible();
  });
});
