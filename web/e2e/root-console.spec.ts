import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { blankDevice, open, seedDevice } from './device';

/**
 * The root console, driven for real.
 *
 * Runs under both Playwright projects: `phone` (the suite's default, matching this project's
 * whole argument about what actually reaches a person) and `desktop` (scoped to this file
 * only, in `playwright.config.ts` — the one deliberate exception, because this is the one
 * screen meant to be seen on a desktop monitor first, and the bridge layout and the
 * white-margin regression this file guards against were both invisible at phone width).
 */

test.describe('the root console — search works with nothing set up', () => {
  test('typing filters the real directory, with no fetch and no watch', async ({ page }) => {
    await blankDevice(page);
    await open(page, '/');

    const input = page.getByLabel(/where are you, or what do you need/i);
    await expect(input).toBeVisible();

    await input.fill('st. louis');
    const results = page.locator('.nc-results li');
    await expect(results.first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.nc-results-meta').first()).toContainText(/st\. louis/i);
  });

  test('an unmatched query says so plainly, rather than showing nothing silently', async ({ page }) => {
    await blankDevice(page);
    await open(page, '/');
    await page.getByLabel(/where are you, or what do you need/i).fill('zzz-nothing-like-this-zzz');
    await expect(page.getByText(/nothing matches yet/i)).toBeVisible();
  });

  test('the manual region picker is the fallback when nothing is typed', async ({ page }) => {
    await blankDevice(page);
    await open(page, '/');
    const select = page.locator('#region-pick');
    await expect(select).toBeVisible();
    const optionCount = await select.locator('option').count();
    // "Not now" plus at least one real region.
    expect(optionCount).toBeGreaterThan(1);
  });
});

test.describe('the fusion — Com reacts to what Nav is looking at', () => {
  test('picking a region changes the Network panel from network-wide to that region\'s own figures', async ({ page }) => {
    await blankDevice(page);
    await open(page, '/');

    const networkPanel = page.locator('section.nc-panel', { has: page.locator('h2', { hasText: 'Network' }) });
    // Before any focus: the network-wide "Coverage" slot is what's shown.
    await expect(networkPanel.getByText('Coverage')).toBeVisible();

    await page.locator('#region-pick').selectOption({ index: 1 });

    // After focusing a region: Com switches to that region's own figures, named in the
    // panel's own header — the fusion this file exists to prove, not just describe.
    await expect(networkPanel.locator('[data-slot="records"]')).toBeVisible({ timeout: 5_000 });
    await expect(networkPanel.locator('[data-slot="verify"]')).toBeVisible();
    await expect(networkPanel.locator('[data-slot="holding-watch"]')).toBeVisible();
  });

  test('the watch explainer never claims coverage — it only explains the mechanic', async ({ page }) => {
    await blankDevice(page);
    await open(page, '/');
    await page.locator('#region-pick').selectOption({ index: 1 });

    // "Holding watch" appears twice — the Slot's own key label, and again inside the Why
    // body's prose — so the disclosure is opened by its unique `<summary>` text instead.
    await page.getByText('What that would mean').click();
    const why = page.locator('details', { has: page.getByText('What that would mean') });
    // Source line-wraps become literal newlines in raw textContent (unlike rendered,
    // visually-collapsed text) — normalized so an assertion can't fail on where a sentence
    // happened to wrap rather than on what it actually says.
    const text = ((await why.textContent()) ?? '').replace(/\s+/g, ' ');

    // The one line this test exists to hold: no phrasing that would read as a real,
    // specific coverage claim for whatever region got focused.
    for (const banned of [/is being watched/i, /is covered/i, /is active near/i, /currently watching/i]) {
      expect(text).not.toMatch(banned);
    }
    expect(text).toMatch(/nothing here discovers a Watchtower/i);
  });

  test('the help-verify prompt links into the real correction flow, not a dead end', async ({ page }) => {
    await blankDevice(page);
    await open(page, '/');
    await page.locator('#region-pick').selectOption({ index: 1 });
    // The Slot label "Verify" doesn't open anything — the disclosure's own summary does.
    await page.getByText('Help verify', { exact: false }).click();

    const link = page.locator('a[href^="/terminal/directory/"]').first();
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toMatch(/^\/terminal\/directory\/[a-z0-9-]+\/$/);
  });
});

test.describe('desktop-only: the split-screen bridge and the white-margin regression', () => {
  test('Nav and Com render side by side above the 48rem breakpoint', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'layout check needs real desktop width');
    await blankDevice(page);
    await open(page, '/');

    const panels = page.locator('.nc-bridge > section.nc-panel');
    await expect(panels).toHaveCount(2);
    const [nav, com] = await Promise.all([panels.nth(0).boundingBox(), panels.nth(1).boundingBox()]);
    if (!nav || !com) throw new Error('panels did not render with a bounding box');

    // Side by side: same row (top edges close together), second panel starts where the
    // first one ends rather than below it.
    expect(Math.abs(nav.y - com.y)).toBeLessThan(4);
    expect(com.x).toBeGreaterThanOrEqual(nav.x + nav.width - 4);
  });

  test('no gap between the viewport edge and the console — the bug this shipped with', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the bug was only ever visible at desktop width');
    await blankDevice(page);
    await open(page, '/');

    const margin = await page.evaluate(() => getComputedStyle(document.body).marginTop);
    expect(margin).toBe('0px');

    // The ground colour reaches the literal edge of the viewport, not just under the
    // content column — `$lib/terminal/tokens.css`'s body reset is what this depends on.
    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bodyBg).not.toBe('rgba(0, 0, 0, 0)');
    expect(bodyBg).not.toMatch(/255, 255, 255/);
  });
});

test.describe('accessibility — automated, both signature modes', () => {
  test('no axe violations in the default (document) signature', async ({ page }) => {
    await blankDevice(page);
    await open(page, '/');
    await page.locator('#region-pick').selectOption({ index: 1 }); // exercise the focused-region markup too

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test('no axe violations in low signature — the mode this page never used to apply at all', async ({ page }) => {
    // Seeded rather than clicked: proves the *inherited* preference applies correctly, which
    // is the actual bug this test guards — this page used to never read it at all.
    await seedDevice(page, { accruing: { signature: 'low' } });
    await open(page, '/');
    await expect(page.locator('html')).toHaveAttribute('data-signature', 'low');
    await page.locator('#region-pick').selectOption({ index: 1 });

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test('the signature toggle is reachable from this screen too, not just the terminal', async ({ page }) => {
    await blankDevice(page);
    await open(page, '/');
    const toggle = page.locator('[data-signature-toggle]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText(/low signature/i);

    await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-signature', 'low');
    await expect(toggle).toHaveText(/document/i);
  });
});
