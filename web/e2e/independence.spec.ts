import { expect, test } from '@playwright/test';
import { seedDevice, open } from './device';

/**
 * The app works with nothing.
 *
 * No Watchtower, no peers, no network configured, nobody handed you anything. **That is the
 * common case**, not the edge one — most operators patrol alone and know nobody using this.
 *
 * Two failures this file exists for, both shipped:
 *
 *  - Setup demanded a Watchtower pubkey "handed to you in person", so an operator who knew
 *    nobody was stuck on "Not configured" forever and every action refused
 *  - Peer presence read its relays from the Watchtower config, so the feature built
 *    specifically for people without a watch required one
 *
 * Neither failed a test, because nothing ever opened the app with empty storage.
 */

test.describe('with nothing at all', () => {
  test('a first visit is offered something to do', async ({ page }) => {
    await seedDevice(page);
    await open(page, '/terminal/');

    // Not "Not configured". An operator who knows nobody is not half set up.
    await expect(page.getByText(/not configured/i)).toHaveCount(0);
    await expect(page.getByText(/start here/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /choose a callsign/i })).toBeVisible();
  });

  test('the whole of setup is one field', async ({ page }) => {
    await seedDevice(page);
    await open(page, '/terminal/setup/');

    await page.locator('#callsign').fill('Wren');
    await page.getByRole('button', { name: /generate keypair/i }).click();

    await expect(page.getByText('Wren')).toBeVisible();
    // And now the app is ready. Nothing below is required.
    await open(page, '/terminal/');
    await expect(page.getByRole('link', { name: /cached directory/i })).toBeVisible();
  });

  test('the directory works before anything is configured', async ({ page }) => {
    await seedDevice(page);
    await open(page, '/terminal/directory/');
    // Anchored on "metro". Going national added `st-louis-mn` ("St. Louis, MN") and
    // `st-louis-mo` ("St. Louis, MO"), so /st\. louis/i began matching three links and failed
    // on strict mode. Only the seeded metro this test is about carries the word.
    await expect(page.getByRole('link', { name: /st\. louis metro/i })).toBeVisible();
  });
});

test.describe('with an identity but no watch', () => {
  const SOLO = { callsign: 'Wren' };

  test('is a normal state, not unfinished setup', async ({ page }) => {
    await seedDevice(page, SOLO);
    await open(page, '/terminal/');

    await expect(page.getByText(/normal way to work/i)).toBeVisible();
    // And it names what actually stops working, so nobody discovers it by holding Distress.
    await expect(page.getByText(/Query, Assist and Distress all go to a watch/i)).toBeVisible();
  });

  test('pairing works — the feature exists for exactly this operator', async ({ page }) => {
    // This is the one that shipped broken. Presence took its relays from the Watchtower
    // config, so with no watch there was nowhere to publish and pairing did nothing.
    await seedDevice(page, SOLO);
    await open(page, '/terminal/peers/');

    await expect(page.locator('[data-qr] svg')).toBeVisible();

    await page.locator('#code').fill('b'.repeat(64));
    await page.locator('#name').fill('Raven');
    await page.getByRole('button', { name: /^pair$/i }).click();
    await expect(page.getByText('Raven')).toBeVisible();

    // And it says where presence will go, because every network call has to be explainable.
    // Two relays, not one: a single relay is a single point of failure for presence, and
    // these are free services run by volunteers who owe nobody uptime.
    await expect(page.getByText(/^wss:\/\//)).toHaveCount(2);
  });

  test('a whole patrol needs no watch', async ({ page }) => {
    await seedDevice(page, SOLO);

    await open(page, '/terminal/sign-on/');
    await page.locator('#area').fill('Downtown');
    await page.getByRole('button', { name: /sign on/i }).click();
    await expect(page.locator('[data-station]')).toBeVisible();

    await page.getByRole('button', { name: /stand down/i }).click();
    await page.getByRole('button', { name: /i'm home/i }).click();
    await expect(page.locator('[data-came-home]')).toBeVisible();
  });

  test('Distress says there is nowhere to send it rather than pretending', async ({ page }) => {
    await seedDevice(page, SOLO);
    await open(page, '/terminal/distress/');

    await expect(page.locator('[data-no-watch]')).toBeVisible();
    await expect(page.getByText(/nowhere to send this/i)).toBeVisible();
    // With no contact set either, it points at the one thing that would help.
    await expect(page.getByRole('link', { name: /add someone you would call/i })).toBeVisible();
  });
});
