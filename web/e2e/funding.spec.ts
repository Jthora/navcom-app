import { expect, test } from '@playwright/test';
import { readDevice, seedDevice, open } from './device';

/**
 * An address, and nothing that could become a leaderboard.
 *
 * `funding.md`'s rule 2 is the one that would be quietly broken first — a total is the most
 * natural thing in the world to add and the single most damaging, because money is a
 * stronger status signal than any badge.
 */

const OUT = { callsign: 'Wren' };

test('states the real picture before anything is enabled', async ({ page }) => {
  await seedDevice(page, OUT);
  await open(page, '/terminal/funding/');

  await expect(page.getByText(/this app never touches money/i)).toBeVisible();
  await expect(page.getByText(/nothing here counts anything/i)).toBeVisible();
  // The cost that catches people out.
  await expect(page.getByText(/converting to cash usually is not/i)).toBeVisible();
});

test('says the crew address reaches nobody, where it is typed', async ({ page }) => {
  // It was written on the phone, read back into the same box, and published nowhere -- while
  // sitting directly under an address that does go on a card. Found by an audit for state
  // written and never read; the limit is stated rather than the field quietly removed.
  await seedDevice(page, OUT);
  await open(page, '/terminal/funding/');

  await expect(page.getByText(/published nowhere/i)).toBeVisible();
});

test('shows no amount, and has nowhere to put one', async ({ page }) => {
  // Matching the WORD "total" would fail on this screen's own copy, which promises there
  // will never be one -- the third prose false-positive in this suite. What matters is that
  // no figure is rendered and no element exists to render one into.
  await seedDevice(page, OUT);
  await open(page, '/terminal/funding/');

  const body = await page.locator('body').innerText();
  // No amount with a unit: "1,200 sats", "0.004 BTC", "$40".
  expect(body).not.toMatch(/\d[\d,.]*\s*(sats?|btc)\b/i);
  expect(body).not.toMatch(/[$£€]\s?\d/);
  // And no element claiming to hold one.
  for (const attr of ['[data-total]', '[data-received]', '[data-balance]', '[data-supporters]']) {
    await expect(page.locator(attr), attr).toHaveCount(0);
  }
});

test('an address is saved, and a bad one is refused while you are looking at it', async ({ page }) => {
  await seedDevice(page, OUT);
  await open(page, '/terminal/funding/');

  await page.locator('#mine').fill('not-an-address');
  await page.getByRole('button', { name: /^save$/i }).click();
  await expect(page.getByText(/not a lightning address/i)).toBeVisible();

  await page.locator('#mine').fill('Wren@getalby.com');
  await page.getByRole('button', { name: /^save$/i }).click();
  await expect(page.locator('[data-saved]')).toBeVisible();

  const device = await readDevice(page);
  expect(device.accruing['lightning']).toBe('wren@getalby.com');
});

test('the squad address is kept separate from anybody\'s own', async ({ page }) => {
  // Money for socks arriving somewhere that is nobody's is a different thing from money
  // arriving at a person.
  await seedDevice(page, OUT);
  await open(page, '/terminal/funding/');
  await page.locator('#mine').fill('wren@getalby.com');
  await page.locator('#squad').fill('supplies@getalby.com');
  await page.getByRole('button', { name: /^save$/i }).click();

  const device = await readDevice(page);
  expect(device.accruing['lightning']).toBe('wren@getalby.com');
  expect(device.accruing['lightning_squad']).toBe('supplies@getalby.com');
});

test('works from Ghost — an address needs no card', async ({ page }) => {
  // The operator who most needs support may be the one who most needs to stay invisible.
  await seedDevice(page, OUT);
  await open(page, '/terminal/funding/');
  await page.locator('#mine').fill('wren@getalby.com');
  await page.getByRole('button', { name: /^save$/i }).click();

  const device = await readDevice(page);
  expect(device.accruing['lightning']).toBeTruthy();
  expect(device.accruing['card'], 'no card was published').toBeUndefined();
  await expect(page.getByText(/this one works from ghost/i)).toBeVisible();
});

test('clearing the field removes it', async ({ page }) => {
  await seedDevice(page, OUT);
  await open(page, '/terminal/funding/');
  await page.locator('#mine').fill('wren@getalby.com');
  await page.getByRole('button', { name: /^save$/i }).click();
  await page.locator('#mine').fill('');
  await page.getByRole('button', { name: /^save$/i }).click();

  const device = await readDevice(page);
  expect(device.accruing['lightning']).toBeUndefined();
});
