import { expect, test } from '@playwright/test';
import { seedDevice, open } from './device';

/**
 * The way back from a note to a correction.
 *
 * "Capture cold, correct warm" is the whole design of a field note: you write it at a door
 * with gloves on and turn it into a correction somewhere with light. `notes.ts` says so in as
 * many words.
 *
 * **The second half had no path.** The Status screen reported *"N waiting — jotted, not yet
 * corrections"* and offered no way to reach any of them, so an operator had to remember which
 * of sixty-eight areas each note was about, open the directory, and find the record from
 * memory. A note that cannot be found again does not become a correction — and the whole
 * published directory holds exactly **one** `in_person` check against 477 scraped ones, which
 * is the shape of that failing.
 *
 * This walks it as a person does, because "a mechanism nobody can reach is not built" is the
 * rule that was being broken and a test that called the API would not have noticed.
 */

const REGION = '/terminal/directory/st-louis/';

test('a note jotted at a door can be found again from Status', async ({ page }) => {
  await seedDevice(page, { callsign: 'Wren' });
  await open(page, REGION);

  // Jot one, the way somebody does it one-handed.
  await page.getByRole('button', { name: /note for later/i }).first().click();
  await page.locator('input.fix').first().fill('shut intake 20:30');
  await page.getByRole('button', { name: /^keep$/i }).first().click();
  await expect(page.locator('[data-note]').first()).toContainText('shut intake 20:30');

  // The name it was kept under, so the assertion below is about this place and not any
  // place. Asserted non-empty rather than guarded with an `if`: a name that failed to resolve
  // would otherwise skip the only check that ties the two screens together.
  const named = ((await page.locator('[data-record] h3').first().textContent()) ?? '').trim();
  expect(named.length, 'no record name resolved, so the link check below would prove nothing').toBeGreaterThan(3);

  await open(page, '/terminal/');

  const waiting = page.locator('[data-notes-open]');
  await expect(waiting, 'Status still offers no way back to a note').toBeVisible({ timeout: 10_000 });
  // The note's own text is deliberately NOT here: this is the screen most likely to be read
  // over a shoulder, and the note is the riskiest free text in the system by its own account.
  await expect(waiting).not.toContainText('shut intake 20:30');

  const back = waiting.locator('a[href^="/terminal/directory/"]').first();
  await expect(back).toBeVisible();
  await expect(back, 'the way back does not name the place it goes to').toContainText(named.slice(0, 12));

  // And it actually goes to the screen where a correction can be made.
  await back.click();
  await expect(page).toHaveURL(/\/terminal\/directory\/st-louis\/$/);
  await expect(page.locator('[data-report-open]').first()).toBeVisible();
});

test('and Status says nothing when nothing is waiting', async ({ page }) => {
  /*
   * The pair. A panel that is always there is a panel somebody stops reading, and this one
   * appears on the screen the whole app is built around keeping quiet.
   */
  await seedDevice(page, { callsign: 'Wren' });
  await open(page, '/terminal/');
  await expect(page.locator('[data-notes-open]')).toHaveCount(0);
});
