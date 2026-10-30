import { expect, test } from '@playwright/test';
import { open, seedDevice } from './device';

/**
 * Status for an operator with no watch, on the built site: the common case, and not a degraded one.
 *
 * Found on the live walk of 2026-10-29: an operator whose own person was set read *Distress: No
 * addressee* on Status and at sign-on, while the Distress screen put that person first; and the
 * patrol rail offered Query and Assist, which go only to a watch, to somebody who has none.
 */

const SAM = { label: 'Sam', number: '+15550100' };

test('with your person set and no watch, Distress names your person, at sign-on and on Status', async ({ page }) => {
  await seedDevice(page, { callsign: 'Wren', contact: SAM });
  await open(page, '/terminal/sign-on/');
  await expect(page.locator('[data-told] [data-slot="distress"]')).toContainText(/your person/i);
  await expect(page.locator('[data-told] [data-slot="distress"]')).toContainText(/sam: you press send/i);

  await page.locator('#area').fill('Kensington');
  await page.getByRole('button', { name: /^sign on$/i }).click();
  await page.waitForURL('**/terminal/');
  const distress = page.locator('[data-capability] [data-slot="distress"]');
  await expect(distress).toContainText(/your person/i);
  await expect(distress).not.toContainText(/no addressee/i);
  await expect(page.getByText(/Distress reaches Sam/)).toBeVisible();
});

test('with nobody set, it still says nobody, and points to the one net that needs no watch', async ({ page }) => {
  await seedDevice(page, { callsign: 'Wren' });
  await open(page, '/terminal/');
  await expect(page.locator('[data-capability] [data-slot="distress"]')).toContainText(/no addressee/i);
  await expect(page.locator('[data-person-link]')).toHaveAttribute('href', '/terminal/setup/#person');
});

test('out with no watch, the rail offers standing down and not Query or Assist, which would reach nobody', async ({ page }) => {
  await seedDevice(page, { callsign: 'Wren', contact: SAM });
  await open(page, '/terminal/sign-on/');
  await page.locator('#area').fill('Kensington');
  await page.getByRole('button', { name: /^sign on$/i }).click();
  await page.waitForURL('**/terminal/');
  const rail = page.locator('nav[data-rail="out"]');
  await expect(rail.getByRole('button', { name: /stand down/i })).toBeVisible();
  await expect(rail.getByRole('link', { name: /^query$/i })).toHaveCount(0);
  await expect(rail.getByRole('link', { name: /^assist$/i })).toHaveCount(0);
});

test('out with a watch, Query and Assist are on the rail', async ({ page }) => {
  await seedDevice(page, { callsign: 'Wren', watchtower: { pubkey: 'c'.repeat(64), relays: ['wss://relay.damus.io'] }, relayEvents: [] });
  await open(page, '/terminal/sign-on/');
  await page.locator('#area').fill('Kensington');
  await page.getByRole('button', { name: /^sign on$/i }).click();
  await page.waitForURL('**/terminal/');
  const rail = page.locator('nav[data-rail="out"]');
  await expect(rail.getByRole('link', { name: /^query$/i })).toBeVisible();
  await expect(rail.getByRole('link', { name: /^assist$/i })).toBeVisible();
});
