import { expect, test } from '@playwright/test';
import { seedDevice, open } from './device';

/**
 * Getting what you learned at a door into the directory.
 *
 * The whole point of Milestone 6, and **the form had never been driven.** 6.E tested the
 * *unsent* state by seeding it, precisely because an attempt to drive this by guessing at
 * selectors timed out — so the path an operator actually takes was covered nowhere.
 *
 * It is a doorway path: one hand, standing up, in the dark. Every step here is a tap except
 * the value itself.
 */

async function firstRecord(page: import('@playwright/test').Page) {
  await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
  await open(page, '/terminal/directory/st-louis/');
  await page.locator('section.group > button.head').first().click();
  return page.locator('[data-record]').first();
}

test.describe('correcting a record from a doorway', () => {
  test('a correction can be made entirely by tapping, bar the value', async ({ page }) => {
    const record = await firstRecord(page);
    await expect(record).toBeVisible();

    await record.getByRole('button', { name: /report a problem/i }).click();
    // The fields are offered as buttons, and by their readable label — this page never
    // shows a raw field name, so `hours` appears as "Open".
    await record.getByRole('button', { name: /^open$/i }).click();
    await record.locator('input.fix').fill('24/7');
    await record.getByRole('button', { name: /^send$/i }).click();

    // Held on this device immediately — an operator at a door must see their own correction
    // whether or not a relay took it [6.E].
    await expect(record.locator('[data-corrected]')).toBeVisible({ timeout: 10_000 });
  });

  test('and it shows as corrected, attributed rather than silently merged', async ({ page }) => {
    const record = await firstRecord(page);
    await record.getByRole('button', { name: /report a problem/i }).click();
    await record.getByRole('button', { name: /^open$/i }).click();
    await record.locator('input.fix').fill('24/7');
    await record.getByRole('button', { name: /^send$/i }).click();

    /*
     * The attribution is per field, not per record.
     *
     * `[data-corrected]` says the record carries corrections at all; the name lives on the
     * field itself — *"your callsign is on records people rely on. Provenance by name, never
     * a total, and there is nothing here to compare between two operators."*
     */
    const attribution = record.locator('[data-said-by="hours"]');
    await expect(attribution).toBeVisible({ timeout: 10_000 });
    await expect(attribution).toContainText(/wren/i);
    await expect(attribution).toContainText(/in person/i);
  });

  test('reporting it closed is one tap, because that is the urgent one', async ({ page }) => {
    // A place that has shut is the thing worth knowing before somebody walks there.
    const record = await firstRecord(page);
    await record.getByRole('button', { name: /report a problem/i }).click();
    await record.getByRole('button', { name: /^closed$/i }).click();

    await expect(record.locator('[data-report]')).toBeVisible({ timeout: 10_000 });
  });

  test('the operator is told it goes out under their callsign, before it does', async ({ page }) => {
    // Provenance by name is the whole model, so somebody about to correct should know their
    // name travels with it.
    const record = await firstRecord(page);
    await record.getByRole('button', { name: /report a problem/i }).click();
    await expect(record.getByText(/goes out under your callsign/i)).toBeVisible();
  });

  test('and backing out leaves the record untouched', async ({ page }) => {
    // A tap that does nothing is recoverable; one that half-corrects a record is not.
    const record = await firstRecord(page);
    await record.getByRole('button', { name: /report a problem/i }).click();
    await record.getByRole('button', { name: /^cancel$/i }).click();

    await expect(record.locator('[data-corrected]')).toHaveCount(0);
    await expect(record.getByRole('button', { name: /report a problem/i })).toBeVisible();
  });
});

test.describe('a note to yourself about a place', () => {
  test('can be kept and dropped without going anywhere near a relay', async ({ page }) => {
    // Wipeable tier: tonight's observation about a doorway, destroyed by a panic wipe.
    const record = await firstRecord(page);
    await record.getByRole('button', { name: /note|jot|keep a note/i }).first().click();
    await record.locator('input.fix').fill('side door after 9, ring twice');
    await record.getByRole('button', { name: /^keep$/i }).click();

    await expect(record.locator('[data-note]')).toContainText(/side door after 9/i);

    await record.getByRole('button', { name: /done with it/i }).click();
    await expect(record.locator('[data-note]')).toHaveCount(0);
  });
});
