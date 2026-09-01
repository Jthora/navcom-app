import { expect, test } from '@playwright/test';
import { blankDevice, open, seedDevice } from './device';

/**
 * A phone whose clock is wrong.
 *
 * Time was the one untrusted input this system never measured. Core carries the right
 * discipline twice — `CLOCK_TOLERANCE_SECONDS` for an event stamped in our future,
 * `FUTURE_TOLERANCE_DAYS` for a date that cannot be weighed — and both judge somebody else's
 * clock against ours. Nothing measured the ruler, and the only clock check that existed
 * needed a configured Watchtower to run, so the operator working alone had none at all.
 *
 * **Eight days behind, not eighty years.** The spectacular failure is the harmless one: a
 * phone reset to 1970 reads every record's `last_verified` as its own future, `ageInDays`
 * returns `Infinity`, and everything renders stale — the safe answer, reached by accident.
 * It is a week of drift that turns a fortnight-old record into a week-old one and shows its
 * hours instead of holding them back, and a week is what a cheap handset that has been off
 * comes back with.
 *
 * `setFixedTime` rather than `install`: `Date` lies, and every timer keeps running, which is
 * the actual condition being reproduced.
 */

/** Far enough past the staleness margin to be provable, close enough to be the real case. */
const DAYS_BEHIND = 8;

async function clockBehind(page: import('@playwright/test').Page) {
  await page.clock.setFixedTime(new Date(Date.now() - DAYS_BEHIND * 86_400_000));
}

test.describe('the status screen, on a phone that is days behind', () => {
  test('says so, and says what it costs on the way out as well as in', async ({ page }) => {
    await blankDevice(page);
    await clockBehind(page);
    await open(page, '/terminal/');

    const said = page.locator('[data-clock-behind]');
    await expect(said).toBeVisible({ timeout: 10_000 });
    await expect(said).toContainText(/every age in the app is measured from it/i);
    // The half an operator cannot discover by using it: their own work is dated from this
    // clock with no input from them, and a newer date beats an older one.
    await expect(said).toContainText(/lose to the listing you wrote it to fix/i);
    // The fix is on the phone and nowhere in this app.
    await expect(said).toContainText(/automatic date and time/i);
  });

  test('and says nothing at all on a phone that is fine', async ({ page }) => {
    /*
     * The guard for the rule above, and the one that matters most here. A check that fired
     * on every device would be indistinguishable from a working one in a passing test, and
     * would put a permanent warning about somebody's phone on the screen this project spends
     * everything else keeping quiet.
     */
    await blankDevice(page);
    await open(page, '/terminal/');
    await expect(page.locator('[data-clock-behind]')).toHaveCount(0);
    await expect(page.getByText(/clock is wrong/i)).toHaveCount(0);
  });
});

test.describe('the cached directory, which is where a wrong clock does the damage', () => {
  test('stops calling a copy of unknown age "Today"', async ({ page }) => {
    /*
     * This is the defect, and it needed no new screen to find: `snapshotDays` goes negative
     * on a phone that is behind, lands in the `<= 0` branch and renders **Today, in green**,
     * for a copy that may be a week stale. A false all-clear reached by arithmetic, in the
     * one section on the page whose entire job is to keep the copy's age honest.
     */
    await blankDevice(page);
    await clockBehind(page);
    await open(page, '/terminal/directory/st-louis/');

    const refreshed = page.locator('section.snapshot');
    await expect(refreshed).toBeVisible({ timeout: 10_000 });
    await expect(refreshed).toContainText(/unknown/i);
    await expect(refreshed).not.toContainText(/today/i);

    // And it says what to do about everything below it, which is the point of saying it.
    await expect(page.locator('[data-clock-behind]')).toContainText(/call first, on everything/i);
  });

  test('and still reads the real age on a phone that is fine', async ({ page }) => {
    // The paired guard: blanking the age unconditionally would satisfy the assertions above
    // and destroy the section.
    await blankDevice(page);
    await open(page, '/terminal/directory/st-louis/');

    const refreshed = page.locator('section.snapshot');
    await expect(refreshed).toBeVisible({ timeout: 10_000 });
    await expect(refreshed).toContainText(/today|yesterday|days ago/i);
    await expect(refreshed).not.toContainText(/unknown/i);
    await expect(page.locator('[data-clock-behind]')).toHaveCount(0);
  });
});

test.describe('a cached copy opened weeks after it was built', () => {
  /*
   * Found while giving the clock check something trustworthy to measure against, and worse
   * than the thing it was found looking for.
   *
   * `built` came from a universal `load` returning `new Date().toISOString()`. Universal
   * loads re-run on the client, so on the operator's phone it evaluated to *now* — and
   * `snapshotDays` was `now - now`. The section whose entire job is to say how old a cached
   * copy is reported **Today** for a copy of any age, permanently, and its "call first, on
   * everything" warning could never fire. Its own comment said the opposite: "a cached page
   * opened three weeks later does not still claim three-week-old confidence."
   *
   * The fix is a compile-time literal, which cannot re-run. This drives it from the outside
   * the only way a person meets it: an old page and a healthy clock.
   */
  const FORWARD_DAYS = 21;

  test('learns its own age, rather than reporting Today forever', async ({ page }) => {
    await blankDevice(page);
    // The clock is *right*. It is the page that is old — the offline case this is for.
    await page.clock.setFixedTime(new Date(Date.now() + FORWARD_DAYS * 86_400_000));
    await open(page, '/terminal/directory/st-louis/');

    const snapshot = page.locator('section.snapshot');
    await expect(snapshot).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-snapshot-age]')).toHaveAttribute(
      'data-snapshot-age',
      String(FORWARD_DAYS)
    );
    await expect(snapshot).toContainText(/call first/i);
    await expect(snapshot).not.toContainText(/today/i);
  });

  test('and a copy that really is fresh still says so', async ({ page }) => {
    // The pair. Reporting a large age unconditionally would satisfy the test above and make
    // every operator distrust a directory that was in fact refreshed this morning.
    await blankDevice(page);
    await open(page, '/terminal/directory/st-louis/');
    await expect(page.locator('[data-snapshot-age]')).toHaveAttribute('data-snapshot-age', '0');
    await expect(page.locator('section.snapshot')).toContainText(/today/i);
  });
});

test.describe('what a wrong clock does to the work an operator sends', () => {
  /*
   * The other half of the clock, and the half nobody can discover by using the app.
   *
   * `last_verified` on a correction and on a new place, and `at` on an endorsement, are all
   * taken from this clock with no input from the person writing them. Behind, and a check
   * made at a door loses to the listing it was written to fix, because a newer date beats an
   * older one. Ahead, and `FUTURE_TOLERANCE_DAYS` reads it as unweighable. The reader is
   * defended in both directions; the writer was defended by nothing and told nothing.
   *
   * Said at the point of writing rather than only on Status, because that is where somebody
   * can still act on it.
   */
  test('says so before a correction is sent', async ({ page }) => {
    await blankDevice(page);
    await clockBehind(page);
    await open(page, '/terminal/directory/st-louis/');

    await page.locator('[data-report-open]').first().click();
    const said = page.locator('[data-clock-dates-this]').first();
    await expect(said).toBeVisible({ timeout: 10_000 });
    await expect(said).toContainText(/what you send carries its date/i);
    await expect(said).toContainText(/lose to the listing you are fixing/i);
  });

  test('and before a place is added', async ({ page }) => {
    await blankDevice(page);
    await clockBehind(page);
    await open(page, '/terminal/directory/st-louis/');
    await page.locator('[data-add-place]').click();
    await expect(page.locator('[data-clock-dates-this]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('and before somebody is vouched for, where another person relies on it', async ({ page }) => {
    // A callsign, because the vouch section belongs to somebody who has one.
    await seedDevice(page, { callsign: 'Wren' });
    await clockBehind(page);
    await open(page, '/terminal/standing/');
    const said = page.locator('[data-clock-dates-this]');
    await expect(said).toBeVisible({ timeout: 10_000 });
    await expect(said).toContainText(/older standing than it is/i);
  });

  test('and says none of it on a phone that is fine', async ({ page }) => {
    // The pair. A warning shown to everybody is the nag this project bans, and would pass
    // all three assertions above.
    await blankDevice(page);
    await open(page, '/terminal/directory/st-louis/');
    await page.locator('[data-report-open]').first().click();
    await expect(page.locator('[data-clock-dates-this]')).toHaveCount(0);

    await seedDevice(page, { callsign: 'Wren' });
    await open(page, '/terminal/standing/');
    await expect(page.locator('[data-clock-dates-this]')).toHaveCount(0);
  });
});
