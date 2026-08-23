import { expect, test } from '@playwright/test';
import { seedDevice, open } from './device';

/**
 * Two claims about phones that are only true on some phones.
 *
 * **Right-to-left** is enforced by scanning the built CSS for physical properties, which is
 * the right check and is not the same as rendering. Nothing in this app sets `dir` — the
 * message catalogue is deferred [5.9] — so the property could only ever be verified
 * statically. A browser can force the direction, which turns *"the stylesheet has no
 * `border-left`"* into *"the app actually holds together mirrored"*.
 *
 * **Battery** is Chromium-only and absent on iOS entirely, so the low-battery warning is a
 * mechanism most readers of this codebase will never see. Absent is correct behaviour — but a
 * warning that has never been rendered is a warning nobody has checked.
 */

const SCREENS = ['/terminal/', '/terminal/patrols/', '/terminal/directory/st-louis/'];

test.describe('mirrored, for a reader who starts on the right', () => {
  for (const path of SCREENS) {
    test(`${path} does not scroll sideways in RTL`, async ({ page }) => {
      // The rule this project already holds itself to: wide content scrolls inside its own
      // container, and the page body never scrolls horizontally.
      await seedDevice(page, { callsign: 'Wren' });
      await open(page, path);
      await page.evaluate(() => {
        document.documentElement.setAttribute('dir', 'rtl');
        document.documentElement.setAttribute('lang', 'ar');
      });
      await page.waitForTimeout(200);

      const overflow = await page.evaluate(() => {
        const d = document.documentElement;
        return d.scrollWidth - d.clientWidth;
      });
      expect(overflow, `${path} overflows by ${overflow}px when mirrored`).toBeLessThanOrEqual(1);
    });
  }

  test('and the controls are still there when mirrored', async ({ page }) => {
    await seedDevice(page, { callsign: 'Wren' });
    await open(page, '/terminal/');
    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));

    await expect(page.getByRole('link', { name: /^distress$/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /sign on/i })).toBeVisible();
  });
});

test.describe('a phone that is about to die', () => {
  test('says so to the operator, and only to the operator', async ({ page }) => {
    // Told to the operator, published to nobody: a battery level on the heartbeat would let
    // anybody watching a relay work out which phone is about to go quiet.
    await seedDevice(page, { callsign: 'Wren' });
    await page.addInitScript(() => {
      // A phone at 9%, which the Battery Status API reports as a level of 0.09.
      (navigator as unknown as { getBattery: () => Promise<unknown> }).getBattery = () =>
        Promise.resolve({
          level: 0.09,
          charging: false,
          addEventListener: () => {},
          removeEventListener: () => {}
        });
    });
    await open(page, '/terminal/');

    /*
     * On station first, because that is the only time it matters.
     *
     * The warning is scoped to being out, and correctly: *"when it dies you stop sending, and
     * the people watching for you will see nothing rather than something wrong."* A phone at
     * 9% on a kitchen table is nobody's problem, and warning about it is the noise that trains
     * people to dismiss warnings.
     */
    await page.getByRole('link', { name: /sign on/i }).click();
    await page.locator('#area').fill('north riverfront');
    await page.getByRole('button').last().click();
    await page.waitForURL('**/terminal/');

    // The battery reading moved into a slot when the status screen became a panel [P1]. The
    // marker follows it; both facts below are asserted exactly as before.
    const warning = page.locator('[data-battery]');
    await expect(warning).toBeVisible({ timeout: 10_000 });
    await expect(warning).toContainText('9%');
    await expect(warning).toContainText(/when it dies you stop sending/i);
  });

  test('says nothing at all on a phone with plenty left', async ({ page }) => {
    await seedDevice(page, { callsign: 'Wren' });
    await page.addInitScript(() => {
      (navigator as unknown as { getBattery: () => Promise<unknown> }).getBattery = () =>
        Promise.resolve({
          level: 0.82,
          charging: false,
          addEventListener: () => {},
          removeEventListener: () => {}
        });
    });
    await open(page, '/terminal/');
    await page.getByRole('link', { name: /sign on/i }).click();
    await page.locator('#area').fill('north riverfront');
    await page.getByRole('button').last().click();
    await page.waitForURL('**/terminal/');
    await expect(page.locator('p.battery')).toHaveCount(0);
  });

  test('says nothing about a phone on a charger, however low', async ({ page }) => {
    // The rule that makes the warning worth reading: a phone on a charger at 4% is a phone
    // that is fine in ten minutes, and warning about it is the kind of noise that trains
    // people to dismiss warnings. No test covered `charging` at all, so the guard could have
    // been deleted silently.
    await seedDevice(page, { callsign: 'Wren' });
    await page.addInitScript(() => {
      (navigator as unknown as { getBattery: () => Promise<unknown> }).getBattery = () =>
        Promise.resolve({
          level: 0.04,
          charging: true,
          addEventListener: () => {},
          removeEventListener: () => {}
        });
    });
    await open(page, '/terminal/');
    await page.getByRole('link', { name: /sign on/i }).click();
    await page.locator('#area').fill('north riverfront');
    await page.getByRole('button').last().click();
    await page.waitForURL('**/terminal/');

    await expect(page.locator('p.battery')).toHaveCount(0);
  });

  test('and nothing at all on a phone that cannot tell', async ({ page }) => {
    // iOS has no Battery Status API. Absent is the correct behaviour — nothing here
    // estimates, and no screen shows a reading that is a guess.
    await seedDevice(page, { callsign: 'Wren' });
    await page.addInitScript(() => {
      delete (navigator as unknown as { getBattery?: unknown }).getBattery;
    });
    await open(page, '/terminal/');
    await page.getByRole('link', { name: /sign on/i }).click();
    await page.locator('#area').fill('north riverfront');
    await page.getByRole('button').last().click();
    await page.waitForURL('**/terminal/');
    await expect(page.locator('p.battery')).toHaveCount(0);
  });
});
