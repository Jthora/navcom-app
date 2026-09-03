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
  test('typing a city finds the city, asking nobody', async ({ page }) => {
    /*
     * This used to assert "with no fetch and no watch", and half of that is now untrue on
     * purpose. The console carried every record inline so its search needed no fetch at all;
     * at 1,405 records that was a 94 kB page against a 120 kB budget with a ceiling near
     * 4,600, and national coverage needs more [`delivery.md`]. It now carries every *region*
     * and fetches one region's records.
     *
     * **The half that is doctrine still holds and is what this asserts:** nothing here asks a
     * person. A static file on the same origin is not `Query`, which goes to the watch.
     */
    await blankDevice(page);
    await open(page, '/');

    const input = page.getByLabel(/where are you, or what do you need/i);
    await expect(input).toBeVisible();

    await input.fill('st. louis');
    const first = page.locator('.nc-results li').first();
    await expect(first).toBeVisible({ timeout: 10_000 });
    await expect(first.locator('[data-hit="region"]')).toBeVisible();
    await expect(first.locator('.nc-results-name')).toContainText(/st\. louis/i);
  });

  test('and a region result opens that region, not the top of the whole list', async ({ page }) => {
    /*
     * The first version of this linked to `/directory/#<region>`. That anchor does not exist --
     * the public index has one, `#main` -- so it dropped a stranger at the top of a 1,405-entry
     * list to find by eye what they had just searched for, which is the failure the test below
     * was written to stop. Caught by that test, and asserted here so it cannot come back.
     */
    await blankDevice(page);
    await open(page, '/');
    await page.getByLabel(/where are you, or what do you need/i).fill('st. louis');
    const link = page.locator('.nc-results li [data-hit="region"]').first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    expect(await link.getAttribute('href')).toBe('/terminal/directory/st-louis/');
  });

  test('an unmatched query says so plainly, rather than showing nothing silently', async ({ page }) => {
    await blankDevice(page);
    await open(page, '/');
    await page.getByLabel(/where are you, or what do you need/i).fill('zzz-nothing-like-this-zzz');
    await expect(page.getByText(/nothing matches yet/i)).toBeVisible();
  });

  test('a result opens onto the record it named, not a list to search in again', async ({ page }) => {
    /*
     * The console promises, in its own words, that "Results open onto the full record —
     * hours, intake rules, and how recently anyone checked." It used to link to the record's
     * *region*, dropping a stranger at the top of a fifty-entry list to find again by eye the
     * thing they had just successfully searched for. The sentence was true of a page the link
     * did not go to.
     */
    await blankDevice(page);
    await open(page, '/');

    /*
     * Pick a region first, which a visitor who denied location does by hand.
     *
     * The property this test protects is unchanged -- a **named place** opens its own record.
     * What changed is that the console no longer carries every record, so the records of one
     * region have to be loaded before there is a named place to click. Searching "st. louis"
     * now finds the *city*, correctly, which is a different result and has its own test above.
     *
     * Deliberately the manual picker rather than a geolocation stub: it is the path somebody
     * who declined location takes, and it must not buy them less than allowing it would.
     */
    await page.getByLabel(/pick a region/i).selectOption('st-louis');

    const input = page.getByLabel(/where are you, or what do you need/i);
    const first = page.locator('.nc-results li').first();
    await expect(first).toBeVisible({ timeout: 10_000 });
    const named = ((await first.locator('.nc-results-name').textContent()) ?? '').trim();
    expect(named.length).toBeGreaterThan(0);

    // Search that place by name; it must be a record hit, not the city again.
    await input.fill(named.slice(0, 12));
    await expect(first.locator('[data-hit="record"]')).toBeVisible({ timeout: 10_000 });

    await first.locator('a').click();
    await expect(page).toHaveURL(/\/\/[^/]+\/directory\/[a-z0-9-]+\/$/);

    // The record it named — not its region, and not a near-match.
    await expect(page.getByRole('heading', { level: 1, name: named })).toBeVisible();
    // The three things the console's sentence specifically promised are on it.
    await expect(page.getByText('Intake', { exact: false }).first()).toBeVisible();
    // On screen the recency is per-field ("checked 18 Aug 2026"); the "Last checked" line
    // in the same markup is the print header, and is display:none here.
    await expect(page.getByText(/checked \d{1,2} \w{3} \d{4}/).first()).toBeVisible();
  });

  test('never calls a check dated in this phone\'s future "today"', async ({ page }) => {
    /*
     * The console reports the freshest check anywhere in the directory. The age was clamped
     * with Math.max(0, …), so a phone whose clock is behind the newest record computed a
     * negative age and got back the freshest answer the function can give — "today" — for a
     * figure about how well maintained this directory is. Same false all-clear the cached
     * directory's copy age used to compute, and the clamp is what hid it.
     */
    await blankDevice(page);
    await page.clock.setFixedTime(new Date(Date.now() - 40 * 86_400_000));
    await open(page, '/');

    await expect(page.getByText(/this clock is wrong/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/most recent check, anywhere/i)).toBeVisible();
  });

  test('and reads a real age on a phone that is fine', async ({ page }) => {
    // The pair: returning "unknown" always would satisfy the test above and delete the figure.
    await blankDevice(page);
    await open(page, '/');
    const freshest = page.locator('.nc-slot', { hasText: 'most recent check, anywhere' });
    await expect(freshest).toBeVisible({ timeout: 10_000 });
    await expect(freshest).toContainText(/today|day[s]? ago/i);
    await expect(freshest).not.toContainText(/clock is wrong/i);
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

test.describe('the ground under the console', () => {
  /*
   * Runs on every project, deliberately, because the engine is the variable.
   *
   * The existing white-margin test is desktop-Chromium-only and could not see this: on
   * WebKit `body { background: var(--t-ground) }` produced **transparent**, not a wrong
   * colour. `--t-ground` reads `#0B0E12` on `:root` and empty on `body` there, so the
   * declaration was invalid at computed-value time and the console painted its near-white
   * ink on the white canvas underneath — contrast 1.09, masthead invisible, on the live
   * public front door of an iPhone. `/terminal/` was fine on the same browser, and `/` was
   * fine on Chromium, which is why nothing caught it.
   *
   * The fix is a literal fallback in the `var()`. This asserts the outcome rather than the
   * stylesheet, because the stylesheet was syntactically fine both before and after.
   */
  for (const path of ['/', '/terminal/']) {
    test(`is painted at ${path}, not borrowed from whatever is underneath`, async ({ page }) => {
      await blankDevice(page);
      await open(page, path);
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(bg, `${path} has no ground of its own`).not.toBe('rgba(0, 0, 0, 0)');
      expect(bg, `${path} is rendering on white`).not.toMatch(/255,\s*255,\s*255/);
    });
  }
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
