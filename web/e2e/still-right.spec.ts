import { expect, test, type Page } from '@playwright/test';
import { open, seedDevice } from './device';

/**
 * Verify five local listings [propagation.md, Cold start], and the one act it is made of: a person
 * standing behind a public listing as it is, on a day, by a way of knowing that is theirs (2026-11-04).
 * The crew's own places in New York are 284 scraped records nobody has checked; this is how they
 * become checked, one tap each, without a form.
 */

async function area(page: Page) {
  await open(page, '/terminal/directory/st-louis/');
  // Every kind of place starts open; its header closes it.
  await expect(page.locator('[data-record]').first()).toBeVisible({ timeout: 15_000 });
}

async function stillRight(page: Page, i: number, how: RegExp) {
  const record = page.locator('[data-record][data-seeded="true"]').nth(i);
  await record.locator('[data-still-right]').click();
  await record.getByRole('button', { name: how }).click();
  return record;
}

test.describe('Still right', () => {
  test('says who checked it, how and when, takes the unverified mark off it, and counts the area checked by a person', async ({ page }) => {
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await area(page);
    await expect(page.locator('[data-readout]', { hasText: 'Unconfirmed' })).toBeVisible();
    const id = await page.locator('[data-record][data-seeded="true"]').first().getAttribute('data-record');
    const record = await stillRight(page, 0, /^i phoned$/i);
    const checked = page.locator(`[data-record="${id}"] [data-confirmed]`);
    await expect(checked).toContainText('Checked');
    await expect(checked).toContainText(/Wren, phone, \d{4}-\d{2}-\d{2}/);
    await expect(page.locator(`[data-record="${id}"] [data-seeded-note]`)).toHaveCount(0);
    // It changed nothing the listing says, and is not a report against it.
    await expect(page.locator(`[data-record="${id}"] [data-report]`)).toHaveCount(0);
    await expect(page.locator('[data-readout]', { hasText: 'Unconfirmed' })).toHaveCount(0);
    void record;
  });
});

test.describe('Check five', () => {
  test('counts the five you mark, and is gone for good once they are done', async ({ page }) => {
    await seedDevice(page, { callsign: 'Kite', relayEvents: [] });
    await area(page);
    const offer = page.locator('[data-check-five]');
    await expect(offer).toContainText('0 of 5');
    for (let i = 0; i < 5; i++) {
      // The first unchecked one each time: a checked record keeps its button but is no longer first.
      await stillRight(page, i, /^i was there$/i);
      if (i < 4) await expect(offer).toContainText(`${i + 1} of 5`);
    }
    await expect(offer).toHaveCount(0);
    await page.reload();
    await page.waitForSelector('html[data-hydrated="true"]');
    await expect(page.locator('[data-check-five]')).toHaveCount(0);
  });

  test('Not now puts it down, and it is never offered again', async ({ page }) => {
    await seedDevice(page, { callsign: 'Kite', relayEvents: [] });
    await area(page);
    await page.locator('[data-check-five-later]').click();
    await expect(page.locator('[data-check-five]')).toHaveCount(0);
    await open(page, '/terminal/directory/new-york/');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-check-five]')).toHaveCount(0);
  });

  test('is never offered to somebody with no profile, and Still right is not a gate on anything', async ({ page }) => {
    await seedDevice(page, { relayEvents: [] });
    await area(page);
    await expect(page.locator('[data-check-five]')).toHaveCount(0);
    // The listings are all there to read, checked or not.
    expect(await page.locator('[data-record]').count()).toBeGreaterThan(5);
  });
});
