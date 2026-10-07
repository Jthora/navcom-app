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
  links?: { platform: string; handle: string; proof?: string }[];
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

test('names the card by its key as well as its callsign, and quotes rather than speaks for them', async ({ page }) => {
  /*
   * Callsigns are not unique, so the name at the top does not say who is answerable for the
   * line under it. The print is of the key that signed the card, and the line is marked as a
   * quotation so nobody reads it in the app's voice.
   */
  const { event, contact } = await cardFor({ callsign: 'Raven', doing: 'Water and socks, Thursdays.' });
  await seedDevice(page, seeded(event));
  await open(page, `/terminal/who/?k=${contact}`);

  const { keyPrint } = await import('@navcom/core');
  await expect(page.locator('[data-readout-value]', { hasText: keyPrint(contact)! })).toBeVisible();
  await expect(page.locator('q', { hasText: 'Water and socks, Thursdays.' })).toBeVisible();
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
  // A relay that answers, with nothing stored for this address.
  await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
  await open(page, `/terminal/who/?k=${contact}`);

  await expect(page.getByText(/nothing here/i)).toBeVisible();
  // Not found and does not exist are different, and this screen cannot tell them apart. The
  // explanation moved behind a `Why` with the prose reduction; it is still there, one tap in.
  await page.getByText(/why that is not the same as no card/i).click();
  await expect(page.getByText(/cannot tell them apart/i)).toBeVisible();
});

test('an address nobody could be asked about is unknown, not without a card', async ({ page }) => {
  // No relay answers at all [audit: relay paths, F20]. "Nothing here" would be a claim about
  // the address made from no answer.
  const { contact } = await cardFor({ callsign: 'Raven' });
  await seedDevice(page, { callsign: 'Wren' });
  await open(page, `/terminal/who/?k=${contact}`);

  // A dead connection gives up after the pool's three-second wait.
  await expect(page.getByText(/no relay answered/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/nothing here/i)).toHaveCount(0);
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


/**
 * The handle proof — the one claim on this page that can be disproven.
 *
 * NIP-39 has carried a proof field since links shipped and nothing ever filled it, so every
 * handle was a claim. What matters here is not that a proof can pass: it is that **nothing is
 * fetched until somebody taps**, because this screen's whole design is that opening a card
 * tells nobody, and a check is the one place that stops being true.
 */

const GIST = 'a1b2c3d4e5f6';

async function npubOf(contact: string) {
  const { npubEncode } = await import('nostr-tools/nip19');
  return npubEncode(contact);
}

/** Answers GitHub's gist endpoint, and counts how many times it was asked. */
async function fakeGist(
  page: import('@playwright/test').Page,
  body: unknown
): Promise<{ calls: () => number }> {
  let calls = 0;
  await page.route('https://api.github.com/**', async (route) => {
    calls++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return { calls: () => calls };
}

test('a handle with a proof is unchecked until somebody taps, and contacts nobody before that', async ({
  page
}) => {
  const { event, contact } = await cardFor({
    callsign: 'Raven',
    links: [{ platform: 'github', handle: 'raven', proof: GIST }]
  });
  const npub = await npubOf(contact);
  const gist = await fakeGist(page, {
    owner: { login: 'raven' },
    files: { 'nostr.md': { content: `Verifying that I control the following Nostr public key: ${npub}` } }
  });

  await seedDevice(page, seeded(event));
  await open(page, `/terminal/who/?k=${contact}`);

  await expect(page.getByText('Unchecked')).toBeVisible();
  expect(gist.calls(), 'the page reached GitHub before anybody asked it to').toBe(0);

  await page.getByRole('button', { name: /Check GitHub/i }).click();

  await expect(page.getByText('Proven')).toBeVisible();
  expect(gist.calls()).toBe(1);
});

test('the check control is reachable by thumb, like every other control', async ({ page }) => {
  // The standard `card-profile.spec.ts` holds the link controls to. A new control on a screen
  // nothing measured is how the standard stops being one.
  const { event, contact } = await cardFor({
    callsign: 'Raven',
    links: [{ platform: 'github', handle: 'raven', proof: GIST }]
  });
  await seedDevice(page, seeded(event));
  await open(page, `/terminal/who/?k=${contact}`);
  await page.setViewportSize({ width: 375, height: 667 });

  const box = await page.getByRole('button', { name: /Check GitHub/i }).boundingBox();
  expect(box, 'the check control has no box').not.toBeNull();
  expect(box!.height, `it is ${box!.height}px tall`).toBeGreaterThanOrEqual(40);
  expect(box!.width, `it is ${box!.width}px wide`).toBeGreaterThanOrEqual(40);
});

test('a proof written by somebody else is refuted, and never sounds the alarm', async ({ page }) => {
  const { event, contact } = await cardFor({
    callsign: 'Raven',
    links: [{ platform: 'github', handle: 'raven', proof: GIST }]
  });
  const npub = await npubOf(contact);
  // The obvious forgery: point at a real proof belonging to another account.
  await fakeGist(page, {
    owner: { login: 'someone-else' },
    files: { 'nostr.md': { content: `Verifying that I control the following Nostr public key: ${npub}` } }
  });

  await seedDevice(page, seeded(event));
  await open(page, `/terminal/who/?k=${contact}`);
  await page.getByRole('button', { name: /Check GitHub/i }).click();

  await expect(page.getByText('Someone else')).toBeVisible();
  // `panel.md` rule 7: the alarm channel belongs to Distress and to a watch state that is lying
  // about itself. A handle that does not prove out is worth knowing and is not an emergency.
  await expect(page.locator('[data-tone="alarm"]')).toHaveCount(0);
});

test('a check that could not reach the platform says unknown, never no', async ({ page }) => {
  const { event, contact } = await cardFor({
    callsign: 'Raven',
    links: [{ platform: 'github', handle: 'raven', proof: GIST }]
  });
  await page.route('https://api.github.com/**', (route) => route.abort());

  await seedDevice(page, seeded(event));
  await open(page, `/terminal/who/?k=${contact}`);
  await page.getByRole('button', { name: /Check GitHub/i }).click();

  await expect(page.getByText('Not checked')).toBeVisible();
  await expect(page.getByText(/unknown is not no/i)).toBeVisible();
});

test('a handle on a platform that answers nobody is not offered a check it cannot do', async ({
  page
}) => {
  const { event, contact } = await cardFor({
    callsign: 'Raven',
    links: [{ platform: 'x', handle: 'raven', proof: 'anything' }]
  });
  await seedDevice(page, seeded(event));
  await open(page, `/terminal/who/?k=${contact}`);

  await expect(page.getByRole('heading', { name: 'Raven' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Check/i })).toHaveCount(0);
});
