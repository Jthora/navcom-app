import { expect, test } from '@playwright/test';
import { seedDevice, open } from './device';

/**
 * A correction naming its own weak backing, driven the way an operator would.
 *
 * Ratified network-wide (R4) after Starcom Academy's credential format used the identical
 * pattern for its own modules — a claim can say which of its own parts rest on thin backing,
 * rather than a consumer having to guess. The case this exists for: *"they confirmed the
 * website is right"* is not the same claim as *"they read me the current hours"*, and without
 * this the two look identical on the screen — both `phone`, same date, same confidence.
 *
 * The property worth driving end to end, not just unit-testing: the checkbox must actually
 * reach the published correction, the caveat must actually render next to the value it names,
 * and it must never appear where nobody asked for it.
 */

async function firstRecord(page: import('@playwright/test').Page) {
  await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
  await open(page, '/terminal/directory/st-louis/');
  await page.locator('section.group > button.head').first().click();
  return page.locator('[data-record]').first();
}

test.describe('flagging a correction as not fully sure', () => {
  test('the caveat appears next to the field it names, and only that field', async ({ page }) => {
    const record = await firstRecord(page);

    await record.getByRole('button', { name: /report a problem/i }).click();
    await record.getByRole('button', { name: /^open$/i }).click();
    await record.locator('input.fix').fill('24/7');
    await record.locator('[data-bridged-toggle]').check();
    await record.getByRole('button', { name: /^send$/i }).click();

    const caveat = record.locator('[data-bridged-caveat="hours"]');
    await expect(caveat).toBeVisible({ timeout: 10_000 });
    await expect(caveat).toContainText(/uncertain/i);

    // Attributed alongside the caveat, the same as any other correction — this is an extra
    // word next to the provenance line, never a replacement for it.
    await expect(record.locator('[data-said-by="hours"]')).toContainText(/wren/i);
  });

  test('an unflagged correction carries no caveat at all', async ({ page }) => {
    const record = await firstRecord(page);

    await record.getByRole('button', { name: /report a problem/i }).click();
    await record.getByRole('button', { name: /^open$/i }).click();
    await record.locator('input.fix').fill('24/7');
    // The checkbox is left unchecked — the ordinary path, exercised in correcting.spec.ts,
    // and it must not have started emitting a caveat nobody asked for.
    await record.getByRole('button', { name: /^send$/i }).click();

    await expect(record.locator('[data-said-by="hours"]')).toBeVisible({ timeout: 10_000 });
    await expect(record.locator('[data-bridged-caveat]')).toHaveCount(0);
  });

  test('the toggle resets after sending, so it cannot silently carry over to the next field', async ({ page }) => {
    /*
     * The failure this guards against: an operator flags one field, sends it, corrects a
     * second field for an unrelated reason, and the checkbox — left checked from the previous
     * correction — silently flags the second one too. State that outlives the action it was
     * for is exactly the kind of bug that is invisible until somebody's honest correction
     * carries a caveat they never meant to add.
     *
     * Both fields have to be free-text ones — the toggle only exists on that path, see the
     * comment beside it in +page.svelte — so this uses `hours` then `intake_hours`, the second
     * free-text field this schema offers.
     */
    const record = await firstRecord(page);

    await record.getByRole('button', { name: /report a problem/i }).click();
    await record.getByRole('button', { name: /^open$/i }).click();
    await record.locator('input.fix').fill('24/7');
    await record.locator('[data-bridged-toggle]').check();
    await record.getByRole('button', { name: /^send$/i }).click();
    await expect(record.locator('[data-bridged-caveat="hours"]')).toBeVisible({ timeout: 10_000 });

    await record.getByRole('button', { name: /report a problem/i }).click();
    await record.getByRole('button', { name: /^intake$/i }).click();
    await expect(record.locator('[data-bridged-toggle]')).not.toBeChecked();
  });
});
