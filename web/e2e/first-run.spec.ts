import { expect, test } from '@playwright/test';
import { blankDevice, open } from './device';

/**
 * Pass 1 — the first ninety seconds.
 *
 * A stranger opens the terminal knowing nothing, with no callsign and no watch. That is the
 * most common visit this app ever gets and the one with the least tolerance for a sentence
 * that is not true.
 */
test.describe('a stranger opens the terminal', () => {
  test('is never told a Watchtower is configured when none is', async ({ page }) => {
    await blankDevice(page);
    await open(page, '/terminal/');

    // The claim that would be false for them.
    await expect(page.getByText(/a watchtower is configured/i)).toHaveCount(0);
    await expect(page.locator('[data-watch-absent]')).toHaveCount(0);
  });

  test('is told what to do first, and that looking things up needs nothing', async ({ page }) => {
    await blankDevice(page);
    await open(page, '/terminal/');
    await expect(page.getByText(/pick a callsign/i).first()).toBeVisible();
    await expect(page.getByText(/needs no callsign/i).first()).toBeVisible();
  });
});
