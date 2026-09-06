import { test, expect } from '@playwright/test';
import { seedDevice, open } from './device';

/**
 * A control must not say two things at once.
 *
 * This shipped carrying `aria-pressed={sig === 'low'}` while its visible label named the
 * *destination*, so at rest in low signature a screen reader announced **"DOCUMENT, toggle
 * button, pressed"** — the label naming one mode, the state naming the other, and the pair
 * together asserting that document mode was on when it was not.
 *
 * Both halves were individually valid, which is why axe-core could not see it and why this
 * needs a test of its own. The same defect existed on the root console, copied.
 *
 * Asserted in both directions because a toggle is only half-tested in one.
 */
test.describe('the signature toggle', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('names what a tap does, and never claims a state that could disagree', async ({ page }) => {
    await seedDevice(page, { callsign: 'Wren' });
    await open(page, '/terminal/');
    const button = page.locator('button.signature');

    for (const pass of ['at rest', 'after toggling']) {
      const mode = await page.evaluate(() =>
        document.documentElement.getAttribute('data-signature')
      );
      const name = (await button.getAttribute('aria-label')) ?? '';

      expect(
        await button.getAttribute('aria-pressed'),
        `${pass}: a button whose label names its destination must not also carry a pressed state`
      ).toBeNull();

      expect(
        name.toLowerCase(),
        `${pass}: in ${mode} mode the accessible name should offer the other one`
      ).toContain(mode === 'low' ? 'document' : 'low signature');

      await button.click();
      await page.waitForTimeout(120);
    }
  });
});
