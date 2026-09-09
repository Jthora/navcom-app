import { expect, test } from '@playwright/test';
import { seedDevice, open } from './device';

/**
 * The board renders what a card actually carries.
 *
 * Written because it did not. `buildCard` learned to publish activity terms and handles,
 * the card screen learned to edit them, and `BoardEntry` carried neither — so an operator
 * could add their TikTok, publish it, and no surface in this app displayed it. The editor
 * wrote fields only the editor read, which is this project's own rule about mechanisms
 * nobody can reach, pointed at a feature rather than a button.
 *
 * These seed a real signed card onto the stubbed relay and read the rendered board, rather
 * than asserting on state — the gap was precisely between the two.
 */

/** A card as a relay would hand it over: signed, with links and activity terms in its tags. */
async function cardEvent(opts: {
  callsign: string;
  region: string;
  doing?: string;
  does?: string[];
  links?: { platform: string; handle: string }[];
}) {
  const { generateSecretKey } = await import('nostr-tools/pure');
  const { buildCard } = await import('@navcom/core');
  return buildCard(
    generateSecretKey(),
    { callsign: opts.callsign, region: opts.region, doing: opts.doing },
    Math.floor(Date.now() / 1000),
    { does: opts.does, links: opts.links }
  );
}

const REGION = 'st-louis';

/**
 * A device already looking at that region.
 *
 * The find screen watches the region on your own card, so seeding one is what puts the
 * board on screen without driving the select first.
 */
const watching = (event: unknown) => ({
  callsign: 'Wren',
  accruing: { card: { region: REGION }, contact_secret: 'b'.repeat(63) + '2' },
  relayEvents: [event]
});

test('shows the activity terms an operator published', async ({ page }) => {
  const event = await cardEvent({
    callsign: 'Raven',
    region: REGION,
    does: ['patrol', 'supplies']
  });
  await seedDevice(page, watching(event));
  await open(page, '/terminal/find/');

  const row = page.locator('li', { hasText: 'Raven' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Patrol');
  await expect(row).toContainText('Supplies');
});

test('renders a term as its label, never as the raw tag', async ({ page }) => {
  const event = await cardEvent({ callsign: 'Raven', region: REGION, does: ['firstaid'] });
  await seedDevice(page, watching(event));
  await open(page, '/terminal/find/');

  const row = page.locator('li', { hasText: 'Raven' });
  await expect(row).toContainText('Carries a kit');
  await expect(row).not.toContainText('firstaid');
});

test('names that somebody is elsewhere, and sends you to their card for the detail', async ({ page }) => {
  /*
   * Handles moved to `who/` deliberately. Twelve links per row over a 200-card board is not a
   * list anybody reads, and the board's job is who is here. This asserts the board points at
   * the surface that has them rather than silently dropping the information.
   */
  const event = await cardEvent({
    callsign: 'Raven',
    region: REGION,
    links: [
      { platform: 'tiktok', handle: 'raven' },
      { platform: 'bluesky', handle: 'raven.bsky.social' }
    ]
  });
  await seedDevice(page, watching(event));
  await open(page, '/terminal/find/');

  const row = page.locator('li', { hasText: 'Raven' });
  const through = row.getByRole('link', { name: /where else they are/i });
  await expect(through).toBeVisible();
  await expect(through).toHaveAttribute('href', /\/terminal\/who\/\?k=[0-9a-f]{64}/);
  // The board no longer names the platforms itself.
  await expect(row.getByRole('link', { name: 'TikTok' })).toHaveCount(0);
});

test('a callsign on the board opens that operator', async ({ page }) => {
  const event = await cardEvent({ callsign: 'Raven', region: REGION });
  await seedDevice(page, watching(event));
  await open(page, '/terminal/find/');

  await expect(
    page.locator('li', { hasText: 'Raven' }).getByRole('link', { name: 'Raven' })
  ).toHaveAttribute('href', /\/terminal\/who\/\?k=[0-9a-f]{64}/);
});

test('a card that says none of this still renders as a complete card', async ({ page }) => {
  // The default, and the common case. It must not read as an unfinished profile.
  const event = await cardEvent({ callsign: 'Raven', region: REGION, doing: 'Water, Thursdays.' });
  await seedDevice(page, watching(event));
  await open(page, '/terminal/find/');

  const row = page.locator('li', { hasText: 'Raven' });
  await expect(row).toContainText('Water, Thursdays.');
  await expect(row.locator('.does')).toHaveCount(0);
  await expect(row.locator('.elsewhere')).toHaveCount(0);
});

test('the board offers no way to filter or sort by what somebody claims', async ({ page }) => {
  /*
   * A board filterable by claimed capability rewards claiming more of them, and nobody
   * checks a card. The absence is the feature.
   */
  const event = await cardEvent({ callsign: 'Raven', region: REGION, does: ['patrol'] });
  await seedDevice(page, watching(event));
  await open(page, '/terminal/find/');

  await expect(page.getByRole('button', { name: /patrol|filter|sort/i })).toHaveCount(0);
  await expect(page.locator('.does').getByRole('link')).toHaveCount(0);
});
