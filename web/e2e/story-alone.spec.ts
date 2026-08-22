import { expect, test } from '@playwright/test';
import { blankDevice, open } from './device';

/**
 * **The Newcomer, who knows nobody.**
 *
 * She has been handed a link by somebody at a meeting. No callsign, no watch, no peers, no
 * squad — and `CLAUDE.md` is emphatic that this is not a lesser state: *"The default is Alone,
 * and it is not a degraded state. An operator who knows nobody is the common case, not the
 * edge one, and the app must never present having no watch as incomplete setup."*
 *
 * Every step below uses a control she can see. Nothing is seeded past a screen, because the
 * question is not whether the screens work — other tests cover that — but whether the
 * **journey** does.
 */

test.describe('arriving with nothing', () => {
  test('is told what to do first, and never that the app is unfinished', async ({ page }) => {
    await blankDevice(page);
    await open(page, '/terminal/');

    // One instruction, and it is an invitation rather than a warning.
    await expect(page.getByRole('heading', { name: /start here/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /choose a callsign/i })).toBeVisible();

    // And nothing anywhere calls her incomplete, unfinished, or not set up.
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/incomplete|unfinished|finish setting up|complete your setup/i);
  });

  test('gets a working tool from one screen, without an account', async ({ page }) => {
    await blankDevice(page);
    await open(page, '/terminal/');
    await page.getByRole('link', { name: /choose a callsign/i }).click();

    await page.locator('#callsign').fill('Newcomer');
    await page.getByRole('button', { name: /generate keypair/i }).click();

    // Confirmed where she is standing — the setup screen shows the name and the key it made.
    // (Status deliberately does not repeat it; it is her own device and her own name.)
    await expect(page.getByText('Newcomer').first()).toBeVisible();
    await expect(page.getByText(/there is also no recovery/i)).toBeVisible();

    // And walking on to Status, the tool is hers and working rather than asking for more.
    await open(page, '/terminal/');
    await expect(page.getByRole('heading', { name: /start here/i })).toHaveCount(0);
    // Distress, from Status, without knowing a URL. It was on the two branches that have a
    // watch and not on this one — so the most common operator, in the most common state, had
    // no path from here to their entire safety net.
    await expect(page.getByRole('link', { name: /^distress$/i })).toBeVisible();
  });

  test('is told plainly that having no watch is a normal way to work', async ({ page }) => {
    // The sentence this project cares most about getting right for her.
    await blankDevice(page);
    await open(page, '/terminal/');
    await page.getByRole('link', { name: /choose a callsign/i }).click();
    await page.locator('#callsign').fill('Newcomer');
    await page.getByRole('button', { name: /generate keypair/i }).click();
    await open(page, '/terminal/');

    await expect(page.getByRole('heading', { name: /normal way to work/i })).toBeVisible();
    await expect(page.getByText(/most operators patrol alone/i)).toBeVisible();
    await expect(page.getByText(/not unfinished setup/i)).toBeVisible();
  });

  test('can carry an area for a night with no signal, by tapping it', async ({ page }) => {
    // The Alone layer's whole promise: a cached directory, needing nothing and nobody.
    await blankDevice(page);
    await open(page, '/terminal/');
    await page.getByRole('link', { name: /choose a callsign/i }).click();
    await page.locator('#callsign').fill('Newcomer');
    await page.getByRole('button', { name: /generate keypair/i }).click();

    await open(page, '/terminal/directory/');
    const area = page.getByRole('link', { name: /st\.? louis/i }).first();
    await expect(area).toBeVisible();
    await area.click();

    // A real record, readable, with the thing that decides a trip.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(200);
  });

  test('can put her own person one tap away, which is her whole safety net', async ({ page }) => {
    // She has no on-call and no watch, so this is not the third rung of a ladder — it is the
    // entire ladder.
    await blankDevice(page);
    await open(page, '/terminal/');
    await page.getByRole('link', { name: /choose a callsign/i }).click();
    await page.locator('#callsign').fill('Newcomer');
    await page.getByRole('button', { name: /generate keypair/i }).click();

    await page.locator('#clabel').fill('Sam');
    await page.locator('#cnumber').fill('+1 555 0100');
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect(page.getByText('+1 555 0100')).toBeVisible();

    // And it is reachable from Distress, which is where she would go for it.
    await open(page, '/terminal/distress/');
    await expect(page.getByRole('link', { name: /text sam/i })).toBeVisible();
  });
});
