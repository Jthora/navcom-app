import { expect, test, type Page } from '@playwright/test';
import { open, seedDevice } from './device';
import { frame, mapReady, screenAt, seen, tapAt, toneNear } from './map';
import { serveZones } from './zsp';

/**
 * Starcom's Zones on the landing map [docs/design/map.md, Layers and Zones; the owner's map decisions
 * D6, D7 and D10], against the build that deploys, on the phone.
 *
 * **No real Zones exist before Stage 1 lands (23 Oct)**, and nothing synthetic ships, so this build
 * has none: the one test that asks without a route sees the map say so. Every other test serves
 * NavCom's own fixture partition by route [./zsp.ts], with its stage set per test.
 *
 * What a person can reach is what is tested: the control, the choice, a tap that opens a Zone, the
 * lookup that answers which Sector the phone is in, and that none of it asks anybody but navcom.app,
 * or fetches anything because of what is on screen or where the phone is.
 */

// Routes must see every request; the worker would answer some from its cache first.
test.use({ serviceWorkers: 'block' });

/** Everything the page asks for over HTTP, by URL. */
function requests(page: Page): string[] {
  const all: string[] = [];
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) all.push(r.url());
  });
  return all;
}

async function landed(page: Page, seed: Parameters<typeof seedDevice>[1] = { __noStorage: true }) {
  await seedDevice(page, seed);
  await open(page, '/');
  await mapReady(page);
}

async function chooseZones(page: Page) {
  await page.getByRole('button', { name: 'Map layers' }).click();
  const screen = page.locator('[data-screen="layers"]');
  await expect(screen).toBeVisible();
  await screen.getByRole('radio', { name: /^Zones/ }).check();
  await expect(page.locator('[data-legend="zones"]')).toBeVisible();
  return screen;
}

test.describe('Starcom’s Zones on the map', () => {
  test('one control away, Nation States until somebody chooses, and nothing of any layer fetched before', async ({ page }) => {
    const all = requests(page);
    await landed(page);
    const control = page.getByRole('button', { name: 'Map layers' });
    await expect(control).toBeVisible();
    const box = (await control.boundingBox())!;
    expect(box.height, 'under the 48px thumb floor').toBeGreaterThanOrEqual(48);
    await control.click();
    await expect(page.locator('[data-screen="layers"]').getByRole('radio', { name: /^Nation States/ })).toBeChecked();
    expect(all.filter((u) => /\/grid\/(zsp\/|timezones|region-times)/.test(u)), 'a layer fetched before it was chosen').toEqual([]);
  });

  test('in this build there are none yet, and the map says so rather than drawing nothing', async ({ page }) => {
    await landed(page);
    const screen = await chooseZones(page);
    await expect(page.locator('[data-legend="zones"]')).toHaveText('Zones · not in this build yet');
    await expect(screen).toContainText(/not in this build/i);
  });

  test('choosing Zones fetches every outline once, from navcom.app only, and draws them in three weights', async ({ page }) => {
    const all = requests(page);
    const asked = await serveZones(page);
    await landed(page);
    await chooseZones(page);
    await expect(page.locator('[data-legend="zones"]')).toContainText('NavCom test fixture, never shipped, CC BY 4.0');
    await frame(page);
    expect(asked).toEqual(['outlines.json']);
    const home = new URL(page.url()).origin;
    expect(all.filter((u) => new URL(u).origin !== home), 'asked somebody other than navcom.app').toEqual([]);
    // A container's edge is drawn heaviest, in the muted neutral; a line between two Zones of one container is not.
    const container = await screenAt(page, -30, 30);
    const zone = await screenAt(page, -90, 30);
    expect(await toneNear(page, container.x, container.y, 3, '--t-muted'), 'no container edge between Laurentia and Europaea').toBeGreaterThan(0);
    expect(await toneNear(page, zone.x, zone.y, 2, '--t-muted'), 'a Zone’s edge drawn as heavily as a container’s').toBe(0);
  });

  test('panning and zooming across the whole Earth asks for no container’s Sectors', async ({ page }) => {
    const asked = await serveZones(page);
    await landed(page);
    await chooseZones(page);
    await page.locator('[data-back]').click();
    const canvas = page.locator('.grid canvas');
    await canvas.focus();
    for (const key of ['+', '+', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown', '-', '-', '0']) {
      await page.keyboard.press(key);
    }
    await frame(page);
    expect(asked, 'what is on screen fetched a container').toEqual(['outlines.json']);
  });

  test('a tap on a Zone opens it and fetches exactly its container’s Sectors; a tap on a Sector then says where it sits', async ({ page }) => {
    const asked = await serveZones(page);
    await landed(page);
    await chooseZones(page);
    await page.locator('[data-back]').click();
    await tapAt(page, -120, 45, 'Laurentia West');
    const zone = page.locator('[data-screen="zone"][data-zone="zone:laurentia-west"]');
    await expect(zone).toBeVisible();
    await expect(zone.locator('[data-zone-open="zone:laurentia-west/sector:north"]')).toBeVisible();
    expect(asked).toEqual(['outlines.json', 'terra-laurentia.json']);
    await page.locator('[data-back]').click();
    await tapAt(page, -120, 45, 'Laurentia West, north');
    const sector = page.locator('[data-screen="zone"][data-zone="zone:laurentia-west/sector:north"]');
    await expect(sector).toBeVisible();
    await expect(sector.locator('[data-chain]')).toHaveText(/Terra Laurentia\s*›\s*Laurentia West Zone\s*›\s*Laurentia west, north/);
    await expect(sector).toContainText('Montes');
    // Opened once, and nothing else: the second tap was answered from what the first brought.
    expect(asked).toEqual(['outlines.json', 'terra-laurentia.json']);
  });

  test('a draft says so on the map and on every screen, and keeps nothing', async ({ page }) => {
    await serveZones(page, '2');
    await landed(page);
    const screen = await chooseZones(page);
    await expect(page.locator('[data-legend="zones"]')).toContainText('draft, stage 2, view only');
    // Seen, with the layers screen holding the sheet at half: the readout is in the map's key, at the top.
    await expect(page.locator('[data-com]')).toHaveAttribute('data-detent', 'half');
    expect(await seen(page.locator('[data-legend="zones"]')), 'the draft label is under the sheet').toBe(true);
    await expect(screen).toContainText(/draft, stage 2/i);
    await screen.locator('[data-zone-open="terra:africana"]').click();
    await page.locator('[data-zone-open="zone:africana-west"]').click();
    await page.locator('[data-zone-open="zone:africana-west/sector:north"]').click();
    const sector = page.locator('[data-screen="zone"][data-zone="zone:africana-west/sector:north"]');
    await expect(sector).toContainText(/not kept in a draft/i);
    await expect(sector.locator('[data-work-keep]')).toHaveCount(0);
  });

  test('which Sector this phone is in is looked up on the phone: the index, whole, and nothing that says where', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 45.25, longitude: -120.25 });
    const all = requests(page);
    const asked = await serveZones(page);
    await landed(page, {});
    const screen = await chooseZones(page);
    await expect(page.locator('[data-legend="zones"]')).toContainText('CC BY 4.0');
    const before = all.length;
    await screen.locator('[data-lookup-here]').click();
    const lookup = page.locator('[data-screen="lookup"]');
    await expect(lookup.locator('[data-found="zone:laurentia-west/sector:north"]')).toContainText('Laurentia west, north');
    await expect(lookup.locator('[data-found="zone:laurentia-west/sector:north"]')).toContainText('Terra Laurentia › Laurentia West Zone');
    await expect(lookup).toContainText(/looked up on this phone/i);
    // After the fix: the whole index, and no container chosen by where the phone is.
    const after = all.slice(before).map((u) => new URL(u).pathname).filter((p) => p.startsWith('/grid/'));
    expect(after).toEqual(['/grid/zsp/index.json']);
    expect(asked).not.toContain('terra-laurentia.json');
    expect(all.some((u) => /45\.2|120\.2/.test(u)), 'the position left the phone').toBe(false);

    // Opening what it found fetches nothing either: the Sector is named from the index, its Zone and
    // Terra from the outlines. One tap here used to fetch the container the phone is in (review, 2026-10-19).
    const sector = page.locator('[data-screen="zone"][data-zone="zone:laurentia-west/sector:north"]');
    await lookup.locator('[data-found="zone:laurentia-west/sector:north"] button').first().click();
    await expect(sector.locator('[data-chain]')).toHaveText(/Terra Laurentia\s*›\s*Laurentia West Zone\s*›\s*Laurentia west, north/);
    // What would fetch it is the person's own tap on its Zone, and the screen says what that tells the host.
    await expect(sector.locator('[data-slot="landform"]')).toContainText('tells navcom.app which Terra');
    await frame(page);
    expect(asked, 'opening the Sector the lookup found fetched its container').not.toContain('terra-laurentia.json');
    await page.locator('[data-back]').click();

    // Kept, on this phone, in the tier a panic wipe takes [D7; invariant 5].
    await lookup.locator('[data-work-keep]').click();
    await expect(lookup).toContainText(/where you work/i);
    const tiers = await page.evaluate(() => ({ wipeable: localStorage.getItem('navcom.wipeable') ?? '', accruing: localStorage.getItem('navcom.accruing') ?? '' }));
    expect(tiers.wipeable).toContain('zone:laurentia-west/sector:north');
    expect(tiers.accruing).not.toContain('laurentia');
    await page.locator('[data-back]').click();
    await page.locator('[data-back]').click();
    await page.getByRole('button', { name: 'Map layers' }).click();
    await expect(page.locator('[data-screen="layers"]')).toContainText('Laurentia west, north');
    // And where somebody works opens the same way, every time: from what the phone holds.
    await page.locator('[data-work-open]').click();
    await expect(sector.locator('[data-chain]')).toHaveText(/Terra Laurentia\s*›\s*Laurentia West Zone\s*›\s*Laurentia west, north/);
    await expect(sector).toContainText(/where you work/i);
    await frame(page);
    expect(asked, 'opening where somebody works fetched its container').not.toContain('terra-laurentia.json');
  });

  test('the CC BY credit is shown with the Zones', async ({ page }) => {
    await serveZones(page);
    await landed(page);
    const screen = await chooseZones(page);
    await expect(screen.locator('[data-slot="credit"]')).toContainText('CC BY 4.0');
    await expect(screen.locator('[data-slot="credit"]')).toContainText('NavCom test fixture, never shipped');
  });
});
