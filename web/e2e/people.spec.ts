import { expect, test, type Page } from '@playwright/test';
import { open, seedDevice } from './device';

/**
 * People, against the built site [docs/design/groups.md §3, §4, phase 1's tests].
 *
 * Find narrows what the phone already holds and asks nobody; a card read from a board lives in
 * memory and nowhere else; and a profile is named in history by a handle, so the history a wipe
 * cannot reach holds no key. Each is a promise about what leaves the screen, which the logic can keep
 * while the output does not, so each is read off the page and its socket.
 */

const REGION = 'st-louis';
const KIND_CARD = 10911;

async function cardOf(callsign: string) {
  const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
  const { buildCard } = await import('@navcom/core');
  const secret = generateSecretKey();
  return {
    event: buildCard(secret, { callsign, region: REGION }, Math.floor(Date.now() / 1000), { visibility: 'board' }),
    contact: getPublicKey(secret)
  };
}

type Filter = Record<string, unknown>;
/** Every REQ's filters the page sent, in order [device.ts]. */
const asked = (page: Page) => page.evaluate(() => ((globalThis as unknown as { __navcomAsked?: Filter[][] }).__navcomAsked ?? []));
const forCards = (reqs: Filter[][]) => reqs.filter((fs) => fs.some((f) => (f['kinds'] as number[] | undefined)?.includes(KIND_CARD)));

async function toFind(page: Page, relayEvents: unknown[]) {
  await seedDevice(page, { callsign: 'kestrel', relayEvents });
  await open(page, '/');
  await page.locator('[data-yours]').click();
  await page.locator('[data-open-find]').click();
  await expect(page.locator('[data-screen="find"]')).toBeVisible();
}

/** Everything this page has put where it outlives the tab's memory: both storages, and history. */
const kept = (page: Page) =>
  page.evaluate(() => {
    const out: string[] = [JSON.stringify(history.state ?? null)];
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i)!;
        out.push(key, store.getItem(key) ?? '');
      }
    }
    return out.join('\n');
  });

test('typing in Find asks no relay for anything', async ({ page }) => {
  await toFind(page, []);
  const before = (await asked(page)).length;

  await page.locator('#people-q').fill('wren');
  await page.locator('#people-q').fill('a1b2c3');
  await expect(page.locator('[data-find-nothing]')).toBeVisible();
  // Long enough for a debounced search to have gone out, had there been one.
  await page.waitForTimeout(1500);

  const since = (await asked(page)).slice(before);
  expect(forCards(since), 'a card was asked for while typing').toEqual([]);
  expect(JSON.stringify(since)).not.toMatch(/wren|a1b2c3/);
});

test('a card read from a board is kept in memory only, and history names it by a handle', async ({ page }) => {
  const raven = await cardOf('Raven');
  await toFind(page, [raven.event]);

  await page.locator('#find-region').selectOption(REGION);
  await page.locator('[data-load-board]').click();
  // Two relays answer with the same card: one person, counted once.
  await expect(page.locator('[data-screen="find"] .more')).toContainText('1 card');
  // The board's ask named the city and nobody in it.
  const board = forCards(await asked(page)).filter((fs) => fs.some((f) => Array.isArray(f['#d'])));
  expect(board.length).toBeGreaterThan(0);
  expect(JSON.stringify(board)).not.toContain(raven.contact);

  await page.locator('#people-q').fill('rav');
  await page.locator(`[data-hit-card="${raven.contact}"]`).click();
  const profile = page.locator('[data-screen="profile"]');
  await expect(profile).toContainText('Raven');
  await expect(profile.locator('[data-profile-card="seen"]')).toBeVisible();

  const stored = await kept(page);
  expect(stored, 'the card’s key was written where a wipe cannot reach or a reload keeps').not.toContain(raven.contact);
  expect(stored).not.toContain('Raven');
});

test('after a reload a profile in history names nobody, and asks for nothing', async ({ page }) => {
  const raven = await cardOf('Raven');
  await toFind(page, [raven.event]);
  await page.locator('#find-region').selectOption(REGION);
  await page.locator('[data-load-board]').click();
  await page.locator('#people-q').fill('rav');
  await page.locator(`[data-hit-card="${raven.contact}"]`).click();
  await expect(page.locator('[data-screen="profile"]')).toContainText('Raven');

  // Back to Find, and reload there: a reload clears the entry it lands on [+page.svelte], so the
  // profile's entry is the one after it, still holding its handle. Forward brings it back to a
  // page that has never heard of that handle.
  await page.goBack();
  await expect(page.locator('[data-screen="find"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-yours]')).toBeVisible();
  await page.goForward();
  const profile = page.locator('[data-screen="profile"]');
  await expect(profile).toContainText('Not on this phone');
  await expect(profile).not.toContainText('Raven');
  await expect(profile.locator('[data-fetch-card]')).toHaveCount(0);
  expect(JSON.stringify(await asked(page))).not.toContain(raven.contact);
});
