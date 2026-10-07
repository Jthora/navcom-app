import { expect, test } from '@playwright/test';
import { open, seedDevice } from './device';

/**
 * Whether anybody has your card, as the card screen says it.
 *
 * The outcome of a send is kept beside the card [audit: relay paths, F18], and the screen read
 * anything it did not recognise as "Published" — including no outcome at all, which is every card
 * saved before outcomes were kept, every one restored from a backup made then, and one whose send
 * was cut off. A card no relay ever took read as published [audit: relay paths, review].
 */

const CARD = { card: { region: 'st-louis' }, contact_secret: 'b'.repeat(63) + '2' };

test('a card with no record of being sent does not read as published', async ({ page }) => {
  await seedDevice(page, { callsign: 'Wren', accruing: CARD });
  await open(page, '/terminal/card/');

  const said = page.locator('[data-slot="card"]');
  await expect(said).toBeVisible();
  await expect(said).toContainText(/not known if sent/i);
  await expect(said).not.toContainText(/published/i);
});

test('one every relay took still does', async ({ page }) => {
  await seedDevice(page, { callsign: 'Wren', accruing: { ...CARD, card_sent: 'all' } });
  await open(page, '/terminal/card/');

  await expect(page.locator('[data-slot="card"]')).toContainText(/published/i);
});
