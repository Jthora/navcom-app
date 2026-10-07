import { expect, test } from '@playwright/test';
import { open, readDevice, seedDevice } from './device';

/**
 * A watch saved on relays this page will not open.
 *
 * Saved where any `ws://` prefix passed, or with a typo the old check let through. It reached
 * nothing from https then either; what changed is what the operator was told. Status said "No
 * watch, and that is a normal way to work … nothing here is waiting on you", and Setup opened
 * blank — no key, no holders — so repairing one line meant finding a person to hand the whole
 * watch over again [audit: relay paths, review].
 *
 * The address here is refused on any page, served over https or not: a port no relay can have.
 */

const WATCH = 'e'.repeat(63) + '5';
const HOLDER = 'c'.repeat(64);
const BAD = 'wss://relay.example:99999';
const stranded = { callsign: 'Wren', watchtower: { pubkey: WATCH, relays: [BAD], holders: [HOLDER] } };

test('Status says this page cannot reach the watch, and which line, rather than that there is none', async ({ page }) => {
  await seedDevice(page, stranded);
  await open(page, '/terminal/');

  const said = page.locator('[data-watch-unreachable]');
  await expect(said).toBeVisible({ timeout: 10_000 });
  await expect(said).toContainText(BAD);
  await expect(said.getByRole('link', { name: /setup/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /normal way to work/i })).toHaveCount(0);
  // Nor does the receipt above the block: core's sentence for Dark opens "No watch."
  await expect(page.locator('[data-capability]')).not.toContainText(/\bno watch\b/i);
  await expect(page.locator('[data-capability]')).toContainText(/cannot be reached from this page/i);
});

test('Setup opens with that watch as it was saved, and one edit repairs it with its holders kept', async ({ page }) => {
  await seedDevice(page, stranded);
  await open(page, '/terminal/setup/');

  await expect(page.locator('#pubkey')).toHaveValue(WATCH);
  await expect(page.locator('#relays')).toHaveValue(BAD);
  await expect(page.locator('#holders')).toHaveValue(HOLDER);
  await expect(page.locator('[data-relays-refused]')).toContainText(BAD);

  await page.locator('#relays').fill('wss://relay.example');
  await page.getByRole('button', { name: /^update$/i }).click();
  await expect(page.locator('[data-relays-refused]')).toHaveCount(0);

  const device = await readDevice(page);
  expect(device.accruing['relays']).toEqual(['wss://relay.example']);
  expect(device.accruing['watch_holders']).toEqual([HOLDER]);
});

/**
 * A watch that works here, still carrying one line from before the check.
 *
 * Every saved line went into the field for a while, and a save checks each line it is given: the
 * operator removing a holder who had left the squad was refused over a line they had not touched,
 * with the reason at the top of the page, off a phone's screen, and "Saved" still under the button
 * [audit: relay paths, review of the fix].
 */
const GOOD = 'wss://relay.example';
const LEFT = 'd'.repeat(64);

test('Setup opens a working watch with only the relays this page reaches, so removing a holder saves', async ({ page }) => {
  await seedDevice(page, { callsign: 'Wren', watchtower: { pubkey: WATCH, relays: [BAD, GOOD], holders: [HOLDER, LEFT] } });
  await open(page, '/terminal/setup/');

  await expect(page.locator('#relays')).toHaveValue(GOOD);
  const left = page.locator('[data-relays-refused]');
  await expect(left).toContainText(BAD);
  await expect(left).toContainText(/not kept when you save/i);

  // A squad member leaves, and their key comes out of the list.
  await page.locator('#holders').fill(HOLDER);
  await page.getByRole('button', { name: /^update$/i }).click();
  await expect(page.locator('[data-watch-error]')).toHaveCount(0);

  const device = await readDevice(page);
  expect(device.accruing['watch_holders']).toEqual([HOLDER]);
  expect(device.accruing['relays']).toEqual([GOOD]);
});

test('an Update that is refused says why beside its button, and stops saying Saved', async ({ page }) => {
  await seedDevice(page, { callsign: 'Wren', watchtower: { pubkey: WATCH, relays: [GOOD], holders: [HOLDER] } });
  await open(page, '/terminal/setup/');

  await page.locator('#holders').fill(`${HOLDER}\nnot-a-key`);
  await page.getByRole('button', { name: /^update$/i }).click();

  // In the watch's own form, where the operator is looking when it happens.
  const why = page.locator('form [data-watch-error]');
  await expect(why).toContainText(/is not a pubkey/i);
  await expect(why).toBeInViewport();
  await expect(page.locator('[data-not-updated]')).toContainText(/not updated/i);
  await expect(page.locator('[data-readout-value]', { hasText: /^Saved$/ })).toHaveCount(0);

  // Nothing was written: the watch as it was is still the watch.
  const device = await readDevice(page);
  expect(device.accruing['watch_holders']).toEqual([HOLDER]);
});

/**
 * The screens that send, for the same stranded watch.
 *
 * Status and Setup said it truthfully, and every screen that sends still told the operator they
 * had never added a watch — including Distress, the one screen read in the worst moment
 * [audit: relay paths, review of the fix].
 */
test('Distress, Sign on, Query and Assist say the watch cannot be reached, not that there is none', async ({ page }) => {
  await seedDevice(page, stranded);

  await open(page, '/terminal/distress/');
  const before = page.locator('[data-no-watch]');
  await expect(before).toContainText(/none of its relays can be reached from this\s+page/i);
  await expect(before).not.toContainText(/you have\s+not added one/i);
  await expect(before.getByRole('link', { name: /fix them in setup/i })).toBeVisible();

  await open(page, '/terminal/sign-on/');
  await expect(page.getByText(/its relays cannot be reached from here/i)).toBeVisible();
  await expect(page.getByText(/you have not added one/i)).toHaveCount(0);

  for (const screen of ['query', 'assist']) {
    await open(page, `/terminal/${screen}/`);
    await expect(page.getByText(/none of its relays can be reached from this page/i)).toBeVisible();
    await expect(page.getByText(/you have not added one/i)).toHaveCount(0);
  }
});
