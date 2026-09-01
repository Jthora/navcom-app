import { expect, test } from '@playwright/test';
import { blankDevice, open } from './device';

/**
 * Pass 1 — the first ninety seconds.
 *
 * A stranger opens the app knowing nothing: no callsign, no watch, and quite possibly a
 * region nobody has put anything in. That is the commonest visit this app ever gets and the
 * one with the least tolerance for a sentence that is not true or a control that does
 * nothing.
 *
 * **These use `blankDevice`, not `seedDevice`.** Every other terminal spec seeds a callsign
 * first, which is why none of them could see the defect this file was written for: a visitor
 * with no identity was told a Watchtower was configured.
 */
test.describe('a stranger opens the terminal', () => {
  test('is never told a Watchtower is configured when none is', async ({ page }) => {
    await blankDevice(page);
    await open(page, '/terminal/');

    // The claim that would be false for them, and the panic it reads as.
    await expect(page.getByText(/a watchtower is configured/i)).toHaveCount(0);
    await expect(page.locator('[data-watch-absent]')).toHaveCount(0);
    await expect(page.getByText(/assume nobody is reading what you send/i)).toHaveCount(0);
  });

  test('is told what to do first, and that looking things up needs nothing', async ({ page }) => {
    await blankDevice(page);
    await open(page, '/terminal/');
    await expect(page.getByText(/pick a callsign/i).first()).toBeVisible();
    await expect(page.getByText(/needs no callsign/i).first()).toBeVisible();
  });

  test('is not offered an ordering control on a region with nothing in it', async ({ page }) => {
    /*
     * Thirty-five of sixty-eight regions ship empty, so this is a real first visit for
     * anybody outside the seeded metros. "Nearest first" would ask for their location and
     * then sort nothing — a permission prompt bought with no answer, on the screen where the
     * app has least to offer them.
     */
    await blankDevice(page);
    await open(page, '/terminal/directory/nashville/');
    await expect(page.locator('[data-nearest]')).toHaveCount(0);
    // What they get instead: the state, and something they can actually do about it.
    await expect(page.getByText(/nobody has put this area in/i)).toBeVisible();
    await expect(page.getByText(/add a place that isn't here/i)).toBeVisible();
  });

  test('still offers it where there is something to order', async ({ page }) => {
    // The guard for the rule above. A gate that hid the control everywhere would satisfy it,
    // and that is the shape of fix this project keeps having to catch.
    await blankDevice(page);
    await open(page, '/terminal/directory/st-louis/');
    await expect(page.locator('[data-nearest]')).toBeVisible();
  });
});
