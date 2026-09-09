import { expect, test, type Page } from '@playwright/test';
import { seedDevice, open } from './device';

/**
 * The public roster, and the tier it exists for.
 *
 * `visibility: 'public'` is the only setting that puts an operator somewhere a visitor who
 * never opens the app can see them, and this page is that somewhere. The assertions worth
 * having are the ones about what it refuses to become: no count, no ranking, and no claim
 * that anybody checked it.
 */

async function cardWith(visibility: 'public' | 'board' | 'address', callsign: string) {
  const { generateSecretKey } = await import('nostr-tools/pure');
  const { buildCard } = await import('@navcom/core');
  return buildCard(
    generateSecretKey(),
    { callsign, region: 'st-louis', doing: 'Water and socks.' },
    Math.floor(Date.now() / 1000),
    { visibility, does: ['patrol'] }
  );
}

const seed = (page: Page, events: unknown[]) =>
  seedDevice(page, { callsign: 'Wren', relayEvents: events });

test('lists an operator who chose to be public', async ({ page }) => {
  await seed(page, [await cardWith('public', 'Raven')]);
  await open(page, '/who/');
  await expect(page.getByRole('link', { name: 'Raven' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Water and socks.')).toBeVisible();
});

test('a link from it opens that operator’s card', async ({ page }) => {
  await seed(page, [await cardWith('public', 'Raven')]);
  await open(page, '/who/');
  await expect(page.getByRole('link', { name: 'Raven' })).toHaveAttribute(
    'href',
    /\/terminal\/who\/\?k=[0-9a-f]{64}/
  );
});

test('says nobody has checked it, and never counts anything', async ({ page }) => {
  await seed(page, [await cardWith('public', 'Raven'), await cardWith('public', 'Wren')]);
  await open(page, '/who/');
  await expect(page.getByRole('link', { name: 'Raven' })).toBeVisible({ timeout: 10_000 });

  await expect(page.getByText(/nobody has checked any of this/i)).toBeVisible();
  const body = await page.locator('body').innerText();
  // A count invites gaming and tells a reader nothing they can act on.
  expect(body).not.toMatch(/\b\d+\s+(operators?|people|listed|volunteers?)\b/i);
});

test('is alphabetical, which rewards nothing', async ({ page }) => {
  await seed(page, [await cardWith('public', 'Zed'), await cardWith('public', 'Ana')]);
  await open(page, '/who/');
  await expect(page.getByRole('link', { name: 'Ana' })).toBeVisible({ timeout: 10_000 });
  const names = await page.locator('.who a').allInnerTexts();
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
});

test('says outright that it is not in a search index', async ({ page }) => {
  // The cost of reading live rather than prerendering, stated rather than implied.
  await seed(page, []);
  await open(page, '/who/');
  await expect(page.getByText(/not in any search index/i)).toBeVisible();
});

test('an empty roster is not the same as nobody using NavCom', async ({ page }) => {
  await seed(page, []);
  await open(page, '/who/');
  // `\s+` because the source wraps this sentence across a line and Playwright does not
  // normalise whitespace for a regex match -- the same trap as asserting on source text where
  // the stylesheet had uppercased it.
  await expect(page.getByText(/ordinary case rather than a\s+failure/i)).toBeVisible({ timeout: 10_000 });
});

test('a card that did not choose public is not on it', async ({ page }) => {
  /*
   * The assertion the whole tier rests on, and it could not be made until the relay stub
   * honoured `#l` -- it matched only `kinds` and `#p`, so every card arrived regardless of
   * its label and this test would have passed with the filter deleted.
   */
  await seed(page, [
    await cardWith('public', 'Raven'),
    await cardWith('board', 'Onlyboard'),
    await cardWith('address', 'Onlyaddress')
  ]);
  await open(page, '/who/');
  await expect(page.getByRole('link', { name: 'Raven' })).toBeVisible({ timeout: 10_000 });

  await expect(page.getByRole('link', { name: 'Onlyboard' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Onlyaddress' })).toHaveCount(0);
});
