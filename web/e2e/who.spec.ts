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

/**
 * Make the page believe the phone asked for less.
 *
 * `navigator.connection.saveData` is a real browser setting and cannot be toggled from a
 * test, so it is defined on the page before any script runs. This is the one signal in
 * `lean.ts` that is a stated preference rather than a measurement.
 */
const asDataSaver = (page: import('@playwright/test').Page) =>
  page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      get: () => ({ saveData: true, effectiveType: '4g' })
    });
  });

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

  /*
   * The claim is now a readout with the prose behind a `Why`, per `panel.md` -- this screen
   * was at 63 words read before anything was opened against a 40-word target. The short form
   * still comes before the links, and the long form is still there word for word.
   */
  await expect(page.getByText('By nobody')).toBeVisible();

  // Lowercased, because `innerText` returns *rendered* text and the stylesheet uppercases
  // headings -- the first version of this compared against the source and missed by case.
  const body = (await page.locator('body').innerText()).toLowerCase();
  const claim = body.indexOf('by nobody');
  const links = body.indexOf('where else they are');
  expect(claim, 'the claim is not on the page').toBeGreaterThan(-1);
  expect(links, 'the links section is not on the page').toBeGreaterThan(-1);
  expect(claim, 'the claim must come before the links, not after them').toBeLessThan(links);

  // The full sentence survives, one tap away rather than deleted.
  await page.getByText(/what that means/i).click();
  await expect(page.getByText(/no part of it has been checked by anybody/i)).toBeVisible();
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
  // Lean, because ranking is what this tests and the facade is where rank is legible. On a
  // fast connection the featured slot is a frame, which is the next test's job.
  await asDataSaver(page);
  await open(page, `/terminal/who/?k=${contact}`);

  await expect(page.locator('.face.lead')).toContainText('TikTok');
  await expect(page.locator('.beside .face')).toHaveCount(2);
  // Reddit was published first and is still only listed.
  await expect(page.locator('.listed')).toContainText('Reddit');
  await expect(page.locator('.face.lead')).not.toContainText('Reddit');
});

test('a phone asking for less gets the facade and no third party', async ({ page }) => {
  /*
   * The facade is now the *lean* path rather than the only path. An operator who chose TikTok
   * gets TikTok; a phone with Data Saver on gets a card and the same link. The page is never
   * missing anything, only lighter -- and the decision is the phone's, not a question put to
   * somebody who came to look at a person.
   */
  const { event, contact } = await cardFor({
    callsign: 'Raven',
    links: [
      { platform: 'tiktok', handle: 'raven' },
      { platform: 'instagram', handle: 'raven' }
    ]
  });
  await seedDevice(page, seeded(event));
  await asDataSaver(page);

  const offsite: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).host;
    if (!host.includes('localhost') && !host.includes('127.0.0.1')) offsite.push(host);
  });

  await open(page, `/terminal/who/?k=${contact}`);
  await expect(page.locator('.face.lead')).toBeVisible();
  await page.waitForTimeout(1200);

  expect(offsite, `a lean phone reached ${offsite.join(', ')}`).toEqual([]);
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('a fast phone gets the embed, as a frame and never a script', async ({ page }) => {
  const { event, contact } = await cardFor({
    callsign: 'Raven',
    links: [{ platform: 'instagram', handle: 'nasa' }]
  });
  await seedDevice(page, seeded(event));
  await open(page, `/terminal/who/?k=${contact}`);

  const frame = page.locator('iframe.frame');
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('src', 'https://www.instagram.com/nasa/embed/');
  await expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(frame).toHaveAttribute('loading', 'lazy');
  // Sandboxed, and no platform script in our own document.
  await expect(frame).toHaveAttribute('sandbox', /allow-scripts/);
  await expect(page.locator('script[src*="tiktok"], script[src*="instagram"], script[src*="facebook"]')).toHaveCount(0);
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
  // Not found and does not exist are different, and this screen cannot tell them apart. The
  // explanation moved behind a `Why` with the prose reduction; it is still there, one tap in.
  await page.getByText(/why that is not the same as no card/i).click();
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
