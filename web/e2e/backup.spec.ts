import { expect, test } from '@playwright/test';
import { readDevice, seedDevice, open } from './device';

/**
 * Carrying an identity to another phone, and getting it back after a dropped one.
 *
 * One mechanism, two situations. The tests care about the refusals more than the round
 * trip: what this screen must *not* do is quietly destroy standing.
 */

const OUT = { callsign: 'Wren' };

test('says plainly that nobody can give an identity back', async ({ page }) => {
  await seedDevice(page, OUT);
  await open(page, '/terminal/backup/');

  await expect(page.getByText(/nobody to ask for your identity back/i)).toBeVisible();
  await expect(page.getByText(/a backup you never made does not exist/i)).toBeVisible();
});

test('says it at persona creation too, not only when it is too late', async ({ page }) => {
  await seedDevice(page);
  await open(page, '/terminal/setup/');
  await expect(page.getByText(/nobody can give this back to you/i)).toBeVisible();
});

test('a backup round-trips onto a phone with no identity', async ({ page, browser }) => {
  await seedDevice(page, { ...OUT, contact: { label: 'Sam', number: '+15550100' } });
  await open(page, '/terminal/backup/');
  await page.locator('#pass').fill('correct horse battery');
  await page.getByRole('button', { name: /make a backup/i }).click();
  const blob = await page.locator('pre.blob').innerText();
  expect(blob).not.toContain('Wren');

  // A different device entirely, with nothing on it.
  const fresh = await browser.newContext();
  const other = await fresh.newPage();
  await seedDevice(other);
  await open(other, '/terminal/backup/');
  await other.locator('#rblob').fill(blob);
  await other.locator('#rpass').fill('correct horse battery');
  await other.getByRole('button', { name: /^restore$/i }).click();
  await expect(other.locator('[data-restored]')).toBeVisible();

  const device = await readDevice(other);
  expect(device.accruing['callsign']).toBe('Wren');
  expect(JSON.stringify(device.accruing['emergency_contact'])).toContain('Sam');
  await fresh.close();
});

test('refuses to restore over a live identity, which would lose standing silently', async ({ page }) => {
  // The operator doing this is usually somebody who mistyped which phone they were holding.
  await seedDevice(page, OUT);
  await open(page, '/terminal/backup/');
  await page.locator('#pass').fill('pw');
  await page.getByRole('button', { name: /make a backup/i }).click();
  const blob = await page.locator('pre.blob').innerText();

  await page.locator('#rblob').fill(blob);
  await page.locator('#rpass').fill('pw');
  await page.getByRole('button', { name: /^restore$/i }).click();
  await expect(page.getByText(/already has an identity/i).first()).toBeVisible();
});

test('a wrong passphrase and a damaged backup say the same thing', async ({ page, browser }) => {
  // Telling them apart would tell somebody holding a stolen backup whether they were
  // getting closer.
  await seedDevice(page, OUT);
  await open(page, '/terminal/backup/');
  await page.locator('#pass').fill('right');
  await page.getByRole('button', { name: /make a backup/i }).click();
  const blob = await page.locator('pre.blob').innerText();

  const fresh = await browser.newContext();
  const other = await fresh.newPage();
  await seedDevice(other);
  await open(other, '/terminal/backup/');
  await other.locator('#rblob').fill(blob);
  await other.locator('#rpass').fill('wrong');
  await other.getByRole('button', { name: /^restore$/i }).click();
  await expect(other.getByText(/wrong passphrase, or the backup is damaged/i)).toBeVisible();
  await fresh.close();
});

test('a recovery code brings back who you are, and says what it does not', async ({ page, browser }) => {
  await seedDevice(page, OUT);
  await open(page, '/terminal/backup/');
  await page.getByRole('button', { name: /show it/i }).click();
  const code = (await page.locator('.blocks').innerText()).replace(/\s/g, '');
  expect(code).toHaveLength(64);

  const fresh = await browser.newContext();
  const other = await fresh.newPage();
  await seedDevice(other);
  await open(other, '/terminal/backup/');
  await other.locator('#rblob').fill(code);
  await other.getByRole('button', { name: /^restore$/i }).click();

  // It said "Your callsign is back", which a recovery code does not restore: `restoreCode`
  // writes the key alone, and the callsign is stored separately.
  await expect(other.locator('[data-restored]')).toContainText(/not your callsign or anything you held/i);
  const device = await readDevice(other);
  expect(device.accruing['secret']).toBeTruthy();
  await fresh.close();
});

test('carries the decade and not tonight', async ({ page }) => {
  // A backup that carried the wipeable tier would carry the thing a panic wipe destroys,
  // and restoring it would undo a wipe somebody meant.
  await page.addInitScript(() => {
    localStorage.setItem('navcom.accruing', JSON.stringify({ secret: 'a'.repeat(63) + '1', callsign: 'Wren' }));
    localStorage.setItem('navcom.wipeable', JSON.stringify({ signon: { area: 'tonight-only' } }));
    localStorage.setItem('navcom.seeded', '1');
  });
  await open(page, '/terminal/backup/');
  await page.locator('#pass').fill('pw');
  await page.getByRole('button', { name: /make a backup/i }).click();

  // Encrypted, so assert on what comes back rather than on the blob.
  await expect(page.getByText(/not tonight's patrol/i)).toBeVisible();
});
