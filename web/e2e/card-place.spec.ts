import { expect, test, type Page } from '@playwright/test';
import { open, seedDevice } from './device';

/**
 * Where an operator says they are, on their card [core: events/area.ts; owner, 2026-10-27].
 *
 * **Earth by default, for everyone**, and any level they choose: a nation, a state or province, a city
 * or town, and on the other ladder the Terra, Zone or Sector where they work. Read from what the card
 * screen publishes, a signed event on the stubbed relay, never from state: the screen saying Earth and
 * the event naming a metro would be the gap this project keeps finding between the two.
 */

type Published = { kind: number; content: string; tags: string[][] };

async function publishedCard(page: Page): Promise<Published> {
  const handle = await page.waitForFunction(
    () => ((window as unknown as { __navcomPublished?: { kind: number }[] }).__navcomPublished ?? []).filter((e) => e.kind === 10911).pop() ?? null,
    undefined,
    { timeout: 10_000 }
  );
  return (await handle.jsonValue()) as Published;
}

const tagged = (e: Published, name: string) => e.tags.filter((t) => t[0] === name);

/** Where somebody works, chosen on the map's Zones layer: kept on this phone, in the Wipeable tier. */
const WORK = {
  id: 'zone:laurentia-west/sector:north',
  name: 'Laurentia west, north',
  zone: 'zone:laurentia-west',
  zoneName: 'Laurentia West Zone',
  container: 'terra:laurentia',
  containerName: 'Terra Laurentia',
  manifest: 'f'.repeat(64)
};

test('a first card names Earth and is on no board, and nothing on the screen calls that unfinished', async ({ page }) => {
  await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
  await open(page, '/terminal/card/');
  const where = page.locator('[data-card-where]');
  await expect(where.locator('input[value="earth"]')).toBeChecked();
  await expect(where).not.toContainText(/choose an area|required|incomplete/i);
  // Boards are by city: with none named, the board is not offered, and Address only is what is chosen.
  await expect(page.locator('input[name="visibility"][value="board"]')).toBeDisabled();
  await expect(page.locator('input[name="visibility"][value="address"]')).toBeChecked();

  await page.getByRole('button', { name: 'Publish your card' }).click();
  const card = await publishedCard(page);
  expect(JSON.parse(card.content).region).toBe('earth');
  expect(tagged(card, 'd')).toEqual([]);
  expect(tagged(card, 'area')).toEqual([]);
  // Out tonight is said on a city's board, and Earth has none.
  await expect(page.getByRole('heading', { name: 'Out tonight' })).toHaveCount(0);
});

test('a nation on one ladder and the Zone where they work on the other, each at the level chosen', async ({ page }) => {
  await seedDevice(page, { callsign: 'Wren', relayEvents: [], wipeable: { work_sector: WORK } });
  await open(page, '/terminal/card/');
  await page.locator('[data-card-where] input[value="nation"]').check();
  await page.locator('#nation').selectOption('ke');
  const zones = page.locator('[data-card-zone]');
  await expect(zones).toContainText('Laurentia west, north');
  await expect(zones).toContainText('Terra Laurentia');
  await zones.locator(`input[value="${WORK.zone}"]`).check();

  await page.getByRole('button', { name: 'Publish your card' }).click();
  const card = await publishedCard(page);
  expect(JSON.parse(card.content).region).toBe('earth');
  expect(tagged(card, 'area')).toEqual([
    ['area', 'nation', 'ke', 'Kenya'],
    ['area', 'zone', 'zone:laurentia-west', 'Laurentia West Zone']
  ]);
  // Nothing finer than was chosen: not the Sector, and no city.
  expect(card.content).not.toContain('sector:north');
  expect(tagged(card, 'd')).toEqual([]);
});

test('a city may be on its board, as every card was before, and one published then still reads as its city', async ({ page }) => {
  await seedDevice(page, {
    callsign: 'Wren',
    relayEvents: [],
    accruing: { card: { region: 'st-louis', visibility: 'board' }, contact_secret: 'b'.repeat(63) + '2', card_sent: 'all' }
  });
  await open(page, '/terminal/card/');
  await expect(page.locator('[data-card-where] input[value="city"]')).toBeChecked();
  await expect(page.locator('#region')).toHaveValue('st-louis');
  await expect(page.locator('input[name="visibility"][value="board"]')).toBeChecked();
  await expect(page.getByRole('heading', { name: 'Out tonight' })).toBeVisible();

  await page.getByRole('button', { name: 'Replace your card' }).click();
  const card = await publishedCard(page);
  expect(JSON.parse(card.content).region).toBe('st-louis');
  expect(tagged(card, 'd')).toEqual([['d', 'st-louis']]);
  expect(tagged(card, 'area')).toEqual([['area', 'city', 'st-louis', 'St. Louis metro']]);

  // Back to Earth: the board goes with the city, and the screen shows it going.
  await page.locator('[data-card-where] input[value="earth"]').check();
  await expect(page.locator('input[name="visibility"][value="address"]')).toBeChecked();
});

test('somebody reading a card sees where its holder says they are, as their claim', async ({ page }) => {
  const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
  const { buildCard } = await import('@navcom/core');
  const secret = generateSecretKey();
  const event = buildCard(secret, { callsign: 'Raven', region: 'earth' }, Math.floor(Date.now() / 1000), {
    visibility: 'address',
    areas: [
      { level: 'province', id: 'us-mo', name: 'Missouri' },
      { level: 'sector', id: 'zone:laurentia-west/sector:north', name: 'Laurentia west, north' }
    ]
  });
  await seedDevice(page, { callsign: 'Wren', relayEvents: [event] });
  await open(page, `/terminal/who/?k=${getPublicKey(secret)}`);
  await expect(page.locator('[data-slot="working"]')).toContainText('Missouri · Laurentia west, north');
});
