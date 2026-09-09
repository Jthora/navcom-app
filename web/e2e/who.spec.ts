import { expect, test } from '@playwright/test';
import { seedDevice, open } from './device';

/**
 * One operator's card, reached by their address.
 *
 * The assertions that matter here are about what the screen **refuses** to become. A page
 * shaped like a profile invites the belief that somebody vetted it, and nobody did; a page
 * that renders somebody's TikTok invites an embed, and one measured 60 MB across thirteen
 * hosts. Both are checked by loading the page and reading it, not by inspecting state.
 */

const REGION = 'st-louis';

async function cardFor(opts: {
  callsign: string;
  doing?: string;
  does?: string[];
  links?: { platform: string; handle: string }[];
}) {
  const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
  const { buildCard } = await import('@navcom/core');
  const secret = generateSecretKey();
  const event = buildCard(
    secret,
    { callsign: opts.callsign, region: REGION, doing: opts.doing },
    Math.floor(Date.now() / 1000),
    { does: opts.does, links: opts.links }
  );
  return { event, contact: getPublicKey(secret) };
}

const seeded = (event: unknown) => ({ callsign: 'Wren', relayEvents: [event] });

test('renders the card the address names', async ({ page }) => {
  const { event, contact } = await cardFor({
    callsign: 'Raven',
    doing: 'Water and socks, Thursdays.',
    does: ['patrol', 'supplies']
  });
  await seedDevice(page, seeded(event));
  await open(page, `/terminal/who/?k=${contact}`);

  await expect(page.getByRole('heading', { name: 'Raven' })).toBeVisible();
  await expect(page.getByText('Water and socks, Thursdays.')).toBeVisible();
  await expect(page.getByText(/Patrol/)).toBeVisible();
  await expect(page.getByText(/Supplies/)).toBeVisible();
});

test('says nobody has checked any of it, before the links rather than under them', async ({ page }) => {
  const { event, contact } = await cardFor({
    callsign: 'Raven',
    links: [{ platform: 'tiktok', handle: 'raven' }]
  });
  await seedDevice(page, seeded(event));
  await open(page, `/terminal/who/?k=${contact}`);

  await expect(page.getByText(/nobody has checked any of this/i)).toBeVisible();

  // Lowercased, because `innerText` returns *rendered* text and the stylesheet uppercases
  // headings -- the first version of this compared against the source and missed by case.
  const body = (await page.locator('body').innerText()).toLowerCase();
  const disclaimer = body.indexOf('nobody has checked');
  const links = body.indexOf('where else they are');
  expect(disclaimer, 'the disclaimer is not on the page').toBeGreaterThan(-1);
  expect(links, 'the links section is not on the page').toBeGreaterThan(-1);
  expect(disclaimer, 'the disclaimer must come before the links, not after them').toBeLessThan(links);
});

test('lays links out by rank, and never features one that can only be a link', async ({ page }) => {
  const { event, contact } = await cardFor({
    callsign: 'Raven',
    // Reddit first. It refuses framing and refuses unauthenticated reads.
    links: [
      { platform: 'reddit', handle: 'raven' },
      { platform: 'tiktok', handle: 'raven' },
      { platform: 'bluesky', handle: 'raven.bsky.social' },
      { platform: 'youtube', handle: 'raven' }
    ]
  });
  await seedDevice(page, seeded(event));
  await open(page, `/terminal/who/?k=${contact}`);

  await expect(page.locator('.face.lead')).toContainText('TikTok');
  await expect(page.locator('.beside .face')).toHaveCount(2);
  // Reddit was published first and is still only listed.
  await expect(page.locator('.listed')).toContainText('Reddit');
  await expect(page.locator('.face.lead')).not.toContainText('Reddit');
});

test('contacts no third party until somebody taps', async ({ page }) => {
  /*
   * The facade property, asserted as network behaviour rather than as markup. A TikTok embed
   * measured 60 MB over 71 requests to 13 hosts; the device floor is a prepaid Android 8.
   */
  const { event, contact } = await cardFor({
    callsign: 'Raven',
    links: [
      { platform: 'tiktok', handle: 'raven' },
      { platform: 'instagram', handle: 'raven' },
      { platform: 'youtube', handle: 'raven' }
    ]
  });
  await seedDevice(page, seeded(event));

  const offsite: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).host;
    if (!host.includes('localhost') && !host.includes('127.0.0.1')) offsite.push(host);
  });

  await open(page, `/terminal/who/?k=${contact}`);
  await expect(page.locator('.face.lead')).toBeVisible();
  await page.waitForTimeout(1200);

  expect(offsite, `the page reached ${offsite.join(', ')} before anybody tapped`).toEqual([]);
  // And no frame or platform script exists to do it later.
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('script[src*="tiktok"], script[src*="instagram"]')).toHaveCount(0);
});

test('tells no platform which card was being read', async ({ page }) => {
  const { event, contact } = await cardFor({
    callsign: 'Raven',
    links: [{ platform: 'tiktok', handle: 'raven' }]
  });
  await seedDevice(page, seeded(event));
  await open(page, `/terminal/who/?k=${contact}`);

  for (const a of await page.locator('.face, .listed a').all()) {
    await expect(a).toHaveAttribute('referrerpolicy', 'no-referrer');
    await expect(a).toHaveAttribute('rel', /noopener/);
  }
});

test('an address with no card says so without claiming the card does not exist', async ({ page }) => {
  const { contact } = await cardFor({ callsign: 'Raven' });
  // Seeded with no events at all.
  await seedDevice(page, { callsign: 'Wren' });
  await open(page, `/terminal/who/?k=${contact}`);

  await expect(page.getByText(/nothing here/i)).toBeVisible();
  // Not found and does not exist are different, and this screen cannot tell them apart.
  await expect(page.getByText(/cannot tell them apart/i)).toBeVisible();
});

test('a link carrying no address says that, rather than looking broken', async ({ page }) => {
  await seedDevice(page, { callsign: 'Wren' });
  await open(page, '/terminal/who/');
  await expect(page.getByText(/no address/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /browse an area/i })).toBeVisible();
});

test('offers nothing to rank, sort or filter by', async ({ page }) => {
  const { event, contact } = await cardFor({ callsign: 'Raven', does: ['patrol'] });
  await seedDevice(page, seeded(event));
  await open(page, `/terminal/who/?k=${contact}`);

  // No count of anything, and nothing that reads as a score or a tier.
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/\b\d+\s+(followers|patrols|reports|endorsements|vouches)\b/i);
  expect(body).not.toMatch(/verified|rank|level|score|tier/i);
});
