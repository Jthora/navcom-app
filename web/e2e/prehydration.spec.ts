import { expect, test } from '@playwright/test';

/**
 * What a prerendered screen does before its JavaScript has arrived.
 *
 * Every terminal screen is on the glass and tappable in that window, which is real on a
 * prepaid Android 8. The peers screen already learned what a `<form>` does when tapped in it —
 * *"a native GET submit: the page reloads and the code the operator just typed is gone"* — and
 * was changed to a plain button. **The same defect was still on four other forms**, including
 * the callsign, which is the first thing every operator types.
 *
 * JavaScript off is the extreme of that window, and the honest way to test it.
 */
test.use({ javaScriptEnabled: false });

const FORMS = [
  { path: '/terminal/setup/', field: '#callsign', typed: 'Wren' },
  { path: '/terminal/assist/', field: 'textarea', typed: 'need a second pair of hands' },
  { path: '/terminal/query/', field: '#q', typed: 'bed tonight' },
  { path: '/terminal/resupply/', field: 'textarea', typed: 'out of socks' }
];

for (const { path, field, typed } of FORMS) {
  test(`${path} does not throw away what was typed`, async ({ page }) => {
    await page.goto(path);
    const input = page.locator(field).first();
    await input.fill(typed);

    // A tap in the pre-hydration window. It must do nothing at all: a tap that does nothing
    // is recoverable, and one that clears the field is not.
    await page.locator('button[type="submit"]').first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);

    expect(page.url(), `${path} navigated`).not.toContain('?');
    expect(await input.inputValue(), `${path} lost the typed value`).toBe(typed);
  });
}

test('every terminal submit button is inert in the prerendered HTML', async ({ page }) => {
  // The property, rather than four examples of it: nothing that submits a form is enabled
  // before anything is bound to it.
  for (const { path } of FORMS) {
    await page.goto(path);
    const buttons = page.locator('form button[type="submit"]');
    const n = await buttons.count();
    for (let i = 0; i < n; i++) {
      await expect(buttons.nth(i), `${path} button ${i} was tappable`).toBeDisabled();
    }
  }
});
