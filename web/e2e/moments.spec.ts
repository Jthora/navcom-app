import { expect, test } from '@playwright/test';
import { seedDevice, open } from './device';

/**
 * The two moments this product is for, and the one screen laid out for somebody else.
 *
 * `positioning.md` lists what operators need and names one the genre almost never shows:
 * *"coming home and being counted."* Standing down ended a patrol and reported a time.
 */

test.describe('coming home', () => {
  test('shows the line that was written, not just the time', async ({ page }) => {
    await seedDevice(page, { callsign: 'Wren' });
    await open(page, '/terminal/sign-on/');
    await page.locator('#area').fill('north riverfront');
    await page.getByRole('button', { name: /^sign on$/i }).click();
    await page.waitForURL('**/terminal/');

    await page.getByRole('button', { name: /stand down/i }).click();
    await page.locator('#note').fill('quiet night');
    await page.getByRole('button', { name: /i'm home/i }).click();

    const home = page.locator('[data-came-home]');
    await expect(home).toBeVisible({ timeout: 10_000 });
    // How long she was out, and where — the record under her own callsign.
    await expect(home).toContainText(/north riverfront/i);
    await expect(home).toContainText(/your record/i);
  });

  test('and counts her even though nobody was watching', async ({ page }) => {
    /*
     * The close of the night is not conditional on an audience. With no watch there is nobody
     * to confirm it, and the record is hers either way — which is the whole Alone position
     * applied to the one moment it would be easiest to skip.
     */
    await seedDevice(page, { callsign: 'Wren' });
    await open(page, '/terminal/sign-on/');
    await page.locator('#area').fill('Downtown');
    await page.getByRole('button', { name: /^sign on$/i }).click();
    await page.waitForURL('**/terminal/');

    await page.getByRole('button', { name: /stand down/i }).click();
    await page.getByRole('button', { name: /i'm home/i }).click();

    const home = page.locator('[data-came-home]');
    await expect(home).toBeVisible({ timeout: 10_000 });
    await expect(home).toContainText(/nobody was watching, and it still counts/i);
  });
});

test.describe('presenting a credential', () => {
  test('is a screen for the other person to read', async ({ page }) => {
    /*
     * Credentials are checked in person, offline, with no lookup — so there is a moment where
     * you hold the phone out to somebody standing in front of you. `presentable()` existed for
     * exactly this and **nothing rendered it**: the screen imported the function and never
     * called it.
     */
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await open(page, '/terminal/standing/');
    await page.getByRole('button', { name: /^can take watch$/i }).click();
    const blob = await page.locator('pre.blob').innerText();
    await page.locator('#cred').fill(blob);
    await page.getByRole('button', { name: /take it up/i }).click();
    await expect(page.locator('[data-endorsement="can-take-watch"]')).toBeVisible();

    await page.getByRole('button', { name: /^show$/i }).first().click();

    const shown = page.locator('[data-presenting]');
    await expect(shown).toBeVisible();
    // The scope, who vouched, and the age — because nothing here expires on a timer and the
    // reader is the one who weighs it.
    await expect(shown).toContainText(/can take watch/i);
    await expect(shown).toContainText(/vouched by wren/i);
    // And the line that makes it checkable rather than decorative.
    await expect(shown).toContainText(/verified on this device/i);
    await expect(shown).toContainText(/no network used/i);

    // Sized for a second reader at arm's length, not a thumb at thirty centimetres.
    const size = await shown.locator('.present-scope').evaluate(
      (el) => parseFloat(getComputedStyle(el).fontSize)
    );
    expect(size).toBeGreaterThan(30);
  });

  test('and it is not dressed up as identification', async ({ page }) => {
    /*
     * It is somebody's word, shown. A credential that resembles official identification is the
     * beginning of exactly the authority this project refuses — no legal name, no photograph,
     * no issuing body, no expiry.
     */
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await open(page, '/terminal/standing/');
    await page.getByRole('button', { name: /^can take watch$/i }).click();
    const blob = await page.locator('pre.blob').innerText();
    await page.locator('#cred').fill(blob);
    await page.getByRole('button', { name: /take it up/i }).click();
    await page.getByRole('button', { name: /^show$/i }).first().click();

    const shown = page.locator('[data-presenting]');
    await expect(shown).toBeVisible();
    await expect(shown.locator('img')).toHaveCount(0);
    await expect(shown).not.toContainText(/expires|valid until|issued by|licence|license|badge|id no/i);
  });
});
