import { expect, test } from '@playwright/test';
import { seedDevice, open } from './device';

/**
 * The sentence a reader never had, at the level where it was actually missing.
 *
 * Every field already carries its own provenance — a value shows "Wren, phone" beneath it when
 * somebody has corrected it. What nothing on the screen said was the region-level fact: that not
 * one of however many places are listed has ever been checked by a person. Field-level honesty,
 * region-level silence, and this is the fix for the silence — answering the question Starcom
 * Academy asked directly in the EIN round.
 */

test.describe('a region where nothing has been confirmed', () => {
  test('says so, once, above the listings', async ({ page }) => {
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await open(page, '/terminal/directory/st-louis/');

    const banner = page.locator('[data-readout][data-tone="warn"]', { hasText: 'Unconfirmed' });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/none of what's below has been checked by a person/i);
  });

  test('and disappears the moment one correction from a person lands', async ({ page }) => {
    /*
     * The end-to-end version of the claim: this is not a static flag on seed data, it is a live
     * computation over merged corrections. Confirming a single field on a single record for the
     * whole region should retract the banner immediately, on this device, with no reload.
     */
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await open(page, '/terminal/directory/st-louis/');

    const banner = page.locator('[data-readout][data-tone="warn"]', { hasText: 'Unconfirmed' });
    await expect(banner).toBeVisible();

    await page.locator('section.group > button.head').first().click();
    const record = page.locator('[data-record]').first();
    await record.getByRole('button', { name: /report a problem/i }).click();
    await record.getByRole('button', { name: /^open$/i }).click();
    await record.locator('input.fix').fill('24/7');
    await record.getByRole('button', { name: /^send$/i }).click();

    await expect(record.locator('[data-corrected]')).toBeVisible({ timeout: 10_000 });
    await expect(banner).toHaveCount(0);
  });
});

test.describe('an empty region', () => {
  test('shows the empty-state readout, not the unconfirmed one', async ({ page }) => {
    // The two banners answer different questions and must never both appear, or stack in a way
    // that reads as the screen contradicting itself. An empty region has no records to be
    // unconfirmed about.
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await open(page, '/terminal/directory/nashville/');

    await expect(page.getByText(/nothing yet/i).first()).toBeVisible();
    await expect(page.locator('[data-readout][data-tone="warn"]', { hasText: 'Unconfirmed' })).toHaveCount(0);
  });

  test('and adding one confirmed place does not trigger the unconfirmed banner either', async ({ page }) => {
    // An operator-added place can only exist via in_person, staff_confirmed or phone, so a
    // region containing only added places is never "unconfirmed" — checked here rather than
    // assumed from the rule in places.ts.
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await open(page, '/terminal/directory/nashville/');

    await page.locator('[data-add-place]').click();
    await page.locator('#pl-name').fill('Room In The Inn');
    await page.locator('#pl-addr').fill('705 Drexel St');
    await page.locator('#pl-how').selectOption('in_person');
    await page.locator('[data-add-save]').click();

    await expect(page.locator('[data-record]').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-readout][data-tone="warn"]', { hasText: 'Unconfirmed' })).toHaveCount(0);
  });
});
