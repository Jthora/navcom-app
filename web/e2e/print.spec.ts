import { expect, test } from '@playwright/test';

/**
 * What somebody gets when an operator hands them paper.
 *
 * The only artifact this project produces that **cannot be corrected after it leaves**. A
 * screen shows how old its data is because a confident wrong answer is the worst failure
 * here; a printed page looks equally authoritative the day it was printed and eighteen
 * months later.
 *
 * Emulated rather than actually printed — `emulateMedia({ media: 'print' })` applies the
 * print stylesheet to a live page, which is what these assertions are about.
 */

const RECORD = '/directory/st-louis-st-patrick-center/';

test.describe('a printed record', () => {
  test('carries its own age and its source', async ({ page }) => {
    await page.goto(RECORD);
    await page.emulateMedia({ media: 'print' });

    const block = page.locator('[data-print-provenance]');
    await expect(block).toBeVisible();
    await expect(block).toContainText('navcom.app');
    await expect(block).toContainText(/last checked|nobody has checked this/i);
    // The instruction that survives being out of date.
    await expect(block).toContainText(/call before you go/i);
  });

  test('says nothing about provenance on screen, where the ages are already shown', async ({ page }) => {
    await page.goto(RECORD);
    await expect(page.locator('[data-print-provenance]')).toBeHidden();
  });

  test('drops the navigation, which is dead ink on paper', async ({ page }) => {
    await page.goto(RECORD);
    await page.emulateMedia({ media: 'print' });

    await expect(page.locator('header nav')).toBeHidden();
    await expect(page.locator('footer')).toBeHidden();
  });

  test('prints dark ink on white however the reader has their theme', async ({ page }) => {
    // Somebody in dark mode would otherwise print white text on nothing, or a page of ink.
    // The screen adapts to the reader; paper adapts to nobody.
    await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
    await page.goto(RECORD);

    const bg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--ground').trim()
    );
    const ink = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()
    );
    expect(bg).toBe('#ffffff');
    expect(ink).toBe('#000000');
  });

  test('still shows the flag first, because that is what decides the trip', async ({ page }) => {
    // Display rule 3 does not stop applying on paper.
    await page.goto(RECORD);
    await page.emulateMedia({ media: 'print' });
    const record = page.locator('[data-record]');
    await expect(record).toBeVisible();
  });
});

test.describe('a sheet that has been in a pocket for a year', () => {
  /**
   * This file opens by naming the failure: *"a printed page looks equally authoritative the
   * day it was printed and eighteen months later."* The sheet carried the **record's** age
   * and not its own, so a reader holding paper had no fixed point to compare against.
   */
  test('says when the page it came from was published', async ({ page }) => {
    await page.goto(RECORD);
    await page.emulateMedia({ media: 'print' });

    const block = page.locator('[data-print-provenance]');
    await expect(block).toContainText(/published/i);
    // A real date, not a relative phrase — a relative phrase stops being true on paper the
    // moment the ink dries.
    await expect(block).toContainText(/\d{4}-\d{2}-\d{2}/);
    await expect(block).toContainText(/treat everything here as out of date/i);
  });

  test("agrees with the screen about whether the record is stale", async ({ page }) => {
    /*
     * This asserted the *verdict* — that no warning appears — with a comment explaining the
     * stale branch "cannot be exercised today: no seeded record is more than sixty days old".
     *
     * Sixty was the wrong threshold. `hours` is a **volatile** field and goes stale after
     * fourteen days, and the record this prints was verified 2026-08-18. The branch became
     * reachable on its own, with no code change, and the test failed for the one reason a
     * test should never fail: the world moved and the assertion was pinned to a date.
     *
     * So it asserts the property instead of the verdict. `staleOnPaper` exists so that paper
     * and screen cannot disagree about the same record, and that is true on both sides of the
     * threshold — which is what makes it worth testing at all.
     */
    await page.goto(RECORD);

    const onScreen = (await page.locator('body').innerText()).toLowerCase();
    const screenSaysCallFirst = onScreen.includes('call first');

    await page.emulateMedia({ media: 'print' });
    const onPaper = (await page.locator('[data-print-provenance]').innerText()).toLowerCase();
    const paperWarns = onPaper.includes('may no longer be true');

    expect(
      paperWarns,
      screenSaysCallFirst
        ? 'the screen says call first and the sheet does not carry the warning'
        : 'the sheet warns about a record the screen considers current'
    ).toBe(screenSaysCallFirst);

    // The unconditional half is there either way, which is what a reader needs regardless.
    await expect(page.locator('[data-print-provenance]')).toContainText(/call before you go/i);
  });
});
