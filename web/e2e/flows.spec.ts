import { expect, test } from '@playwright/test';
import { readDevice, seedDevice, open } from './device';

/**
 * A night, end to end.
 *
 * Sign on, be on station, come home, find it in your own record. Every step of this works
 * with **no watch** — going out is a local fact and telling somebody about it is optional,
 * which is the change that made the app usable by the operator it is most often for.
 */

const WREN = { callsign: 'Wren' };

test('a whole patrol, with nobody watching', async ({ page }) => {
  await seedDevice(page, WREN);

  await open(page, '/terminal/sign-on/');
  await page.locator('#area').fill('Downtown');
  await page.locator('#hours').selectOption('2');
  await page.getByRole('button', { name: /sign on/i }).click();

  // Status now says you are out, and what you were told when you went.
  await expect(page).toHaveURL(/\/terminal\/$/);
  await expect(page.locator('[data-station]')).toBeVisible();
  await expect(page.getByText('Downtown')).toBeVisible();

  // Coming home. The one place an operator writes in their own words.
  await page.getByRole('button', { name: /stand down/i }).click();
  await page.locator('#note').fill('quiet night, two handouts at the underpass');
  await page.getByRole('button', { name: /i'm home/i }).click();

  // Confirmed even though nobody was watching. The close of the night is not conditional
  // on an audience.
  await expect(page.locator('[data-came-home]')).toBeVisible();
  await expect(page.locator('[data-station]')).toHaveCount(0);

  // And it is in their own record, which never left the phone.
  await open(page, '/terminal/patrols/');
  await expect(page.getByText('Downtown')).toBeVisible();
  await expect(page.getByText(/two handouts at the underpass/)).toBeVisible();
  await expect(page.getByText(/1 patrol/)).toBeVisible();
});

test('the patrol lands in the wipeable tier unless asked otherwise', async ({ page }) => {
  // Off by default. A seized phone shows nothing about anybody's nights.
  await seedDevice(page, WREN);

  await open(page, '/terminal/sign-on/');
  await page.locator('#area').fill('Riverfront');
  await page.getByRole('button', { name: /sign on/i }).click();
  await page.getByRole('button', { name: /stand down/i }).click();
  await page.getByRole('button', { name: /i'm home/i }).click();
  await expect(page.locator('[data-came-home]')).toBeVisible();

  const device = await readDevice(page);
  expect(device.wipeable['patrols']).toBeTruthy();
  expect(device.accruing['patrols']).toBeFalsy();
});

test('an export carries the operator and nobody else', async ({ page }) => {
  await seedDevice(page, WREN);

  await open(page, '/terminal/sign-on/');
  await page.locator('#area').fill('Downtown');
  await page.getByRole('button', { name: /sign on/i }).click();
  await page.getByRole('button', { name: /stand down/i }).click();
  await page.getByRole('button', { name: /i'm home/i }).click();
  await expect(page.locator('[data-came-home]')).toBeVisible();

  await open(page, '/terminal/patrols/');
  await page.getByRole('button', { name: /show what would be shared/i }).click();

  const shared = await page.locator('[data-export]').innerText();
  expect(shared).toContain('Wren');
  expect(shared).toContain('Downtown');
  // No coordinates at any precision. The stream showed a street corner; the export must
  // not carry a fix the stream never did.
  expect(shared).not.toMatch(/\d+\.\d{4,}/);
});

test('the directory is browsable and every field says what it is', async ({ page }) => {
  await open(page, '/terminal/directory/');
  // Anchored on "metro". Going national added `st-louis-mn` ("St. Louis, MN") and
  // `st-louis-mo` ("St. Louis, MO"), so /st\. louis/i began matching three links and failed
  // on strict mode. Only the seeded metro this test is about carries the word.
  await page.getByRole('link', { name: /st\. louis metro/i }).click();

  await expect(page.locator('[data-record]').first()).toBeVisible();

  // The rule the whole directory exists for: a field nobody checked reads "unknown",
  // never as an absence of restriction.
  const unknowns = page.locator('[data-display="unknown"]');
  expect(await unknowns.count()).toBeGreaterThan(0);
  await expect(unknowns.first()).toHaveText(/unknown/i);
});
