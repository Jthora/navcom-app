import { expect, test } from '@playwright/test';
import { seedDevice, open } from './device';

/**
 * Pairing on a phone whose browser has no barcode reader.
 *
 * `BarcodeDetector` is the last of the three things `verification.md` named as differing
 * between Chromium and WebKit, and it is the one with a control attached: the peers screen
 * offers "Scan their code" only `{#if scannable}`. Safari does not ship the API, so on an
 * iPhone that button is simply not there.
 *
 * Absent is the right answer — a scan button that opens a camera and never resolves would be
 * worse. What has to be true, and was asserted nowhere, is that **the other way in is not
 * behind the same gate**. Pairing is how the Paired layer exists at all, and a screen that
 * offered no route to it on iOS would take that whole layer away from every iPhone without
 * saying so.
 *
 * Runs on both projects deliberately: the point is the difference between them.
 */

test('the way in that needs no camera is always there', async ({ page }) => {
  await seedDevice(page, { callsign: 'Wren' });
  await open(page, '/terminal/peers/');

  const scannable = await page.evaluate(() => 'BarcodeDetector' in globalThis);

  // Unconditional, on every engine. This is the assertion that matters.
  await expect(page.locator('#code')).toBeVisible();
  await expect(page.locator('#name')).toBeVisible();
  await expect(page.getByRole('button', { name: /^pair$/i })).toBeVisible();
  // And the operator's own code, to hand the other way.
  await expect(page.locator('[data-qr]')).toBeVisible();

  const scan = page.getByRole('button', { name: /scan their code/i });
  if (scannable) {
    await expect(scan, 'the camera route is missing where the browser has one').toHaveCount(1);
  } else {
    /*
     * Absent rather than present-and-inert. A control that cannot work must not look like
     * one that can — the same standard the on-call screen meets when Web Push is
     * unavailable.
     */
    await expect(scan, 'a scan control is offered by a browser that cannot scan').toHaveCount(0);
  }
});
