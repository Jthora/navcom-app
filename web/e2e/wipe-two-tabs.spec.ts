import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { holdUntil, inventory, open, seedDevice } from './device';

/**
 * A wipe honoured by every page that is open, not just the one that wiped [invariant 5].
 *
 * A wipe ran in the document that wiped and nowhere else. A map open in a second tab went on
 * holding the missions it had read and saved them back into `navcom.wipeable` two seconds after
 * the next one arrived; and a page brought back by Back showed what it had drawn before the wipe,
 * held claims included. A burn was the same, for the decade: a directory open in a second tab
 * wrote every correction it held back on the next one to arrive.
 *
 * **What this does not decide.** Whether a wipe in one tab should also stop a Distress, a public
 * listing or a held watch running in another is the owner's to decide, so nothing here registers
 * `operator.forget` or `board.forget` across tabs, no test asks for it, and the wipe screen says
 * another tab goes on sending until it is closed.
 */

/** Real packages signed by the registered publisher; [0] is the California heat-relief campaign. */
const REAL = JSON.parse(readFileSync(new URL('../../packages/core/test/fixtures/mission-packages.json', import.meta.url), 'utf8'));
const [HEAT, RECALL, LATER] = REAL;
/** The fixtures are real and expire; the clock is fixed so this suite does not. */
const DURING = new Date('2026-10-06T20:00:00Z');
const MISSION = `30079:${HEAT.pubkey}:x`;
const CLAIM = { address: MISSION, title: 'Heat relief', visibility: 'open', ends: 2_000_000_000, claimId: null };

const hasTonight = (page: Page) => page.evaluate(() => localStorage.getItem('navcom.wipeable') !== null);
/** Whether the map's missions copy is on the device: it is saved by the module that hears other tabs. */
const missionsKept = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('navcom.wipeable') ?? '{}').missions !== undefined);
const deliver = (page: Page, event: unknown) =>
  page.evaluate((e) => (window as unknown as { __navcomDeliver: (x: unknown) => number }).__navcomDeliver(e), event);
/** Keys of ours, in localStorage or this tab's sessionStorage, that are not the decade. */
const tonightIn = async (page: Page) => {
  const { local, session } = await inventory(page);
  const ours = (k: string) => k.startsWith('navcom.');
  return {
    local: local.filter((k) => ours(k) && k !== 'navcom.accruing' && k !== 'navcom.accruing.damaged'),
    session: session.filter(ours)
  };
};

test('a map open in another tab writes nothing of tonight back after a wipe, and keeps none of it', async ({ page: map }) => {
  await map.clock.setFixedTime(DURING);
  await seedDevice(map, { relayEvents: [HEAT], __noStorage: true });
  // Tonight outside the blob, which only a wipe by name reaches, and this tab's own: the mission
  // somebody left to take a callsign, which only this tab can destroy, once it hears the wipe.
  await map.addInitScript(() => {
    if (sessionStorage.getItem('e2e.planted') === '1') return;
    sessionStorage.setItem('e2e.planted', '1');
    localStorage.setItem('navcom.wipeable.crews', '{"stand-in":true}');
    sessionStorage.setItem('navcom.pending-mission', '30079:' + 'a'.repeat(64) + ':heat-relief');
    sessionStorage.setItem('navcom.pending-mission-name', 'Heat relief');
  });
  await open(map, '/');
  // The map keeps what it read, which is what the wipe has to end.
  await expect.poll(() => missionsKept(map), { timeout: 15_000 }).toBe(true);
  expect((await tonightIn(map)).session, 'the test seeded this tab').toHaveLength(2);

  const wiping = await map.context().newPage();
  await seedDevice(wiping, { __noStorage: true });
  await open(wiping, '/terminal/wipe/');
  await holdUntil(wiping, 'button:has-text("Hold to wipe tonight")');
  await expect(wiping).toHaveURL(/\/terminal\/$/);

  // Everything of tonight, read from both tabs: localStorage is shared, sessionStorage is each tab's.
  expect(await tonightIn(wiping), 'the wiping tab').toEqual({ local: [], session: [] });
  await expect.poll(() => tonightIn(map), { message: 'the other tab' }).toEqual({ local: [], session: [] });

  // A new package reaches the map after the wipe. It used to save within two seconds.
  expect(await deliver(map, LATER), 'nothing was listening on the map').toBeGreaterThan(0);
  await map.waitForTimeout(3_000);
  expect(await hasTonight(map), 'the other tab put tonight back').toBe(false);

  // Nor as it closes, with a save still waiting: closed at once, so the page closing is what runs it.
  expect(await deliver(map, RECALL)).toBeGreaterThan(0);
  await map.close({ runBeforeUnload: true });
  expect(await hasTonight(wiping), 'the other tab put tonight back as it closed').toBe(false);
});

test('a map open in another tab stops showing claims a wipe took, without waiting for its clock', async ({ page: map }) => {
  await map.clock.setFixedTime(DURING);
  await seedDevice(map, { callsign: 'Wren', relayEvents: [HEAT], wipeable: { mission_claims: [CLAIM] } });
  await open(map, '/');
  const yours = map.locator('section.nc-panel', { has: map.locator('[data-yours]') }).locator('[data-post]');
  await expect(yours).toHaveText('1 held');
  await expect.poll(() => missionsKept(map), { timeout: 15_000 }).toBe(true);

  const wiping = await map.context().newPage();
  await seedDevice(wiping, { __noStorage: true });
  await open(wiping, '/terminal/wipe/');
  await holdUntil(wiping, 'button:has-text("Hold to wipe tonight")');
  await expect(wiping).toHaveURL(/\/terminal\/$/);

  // The map counted again from what is left. It used to show "1 held" until the next minute's tick.
  await expect(yours).toHaveText('nothing claimed', { timeout: 5_000 });
});

test('a page brought back after a wipe draws again from what is left, and only then', async ({ page }) => {
  /*
   * Playwright's Chromium runs with the back-forward cache off, so a real restore cannot be had
   * here. What a restore is, is a page that was frozen while the tier went — it heard no event —
   * shown again with `pageshow` persisted. That is what this stages, on the built root.
   */
  await page.clock.setFixedTime(DURING);
  await seedDevice(page, { callsign: 'Wren', relayEvents: [HEAT], wipeable: { mission_claims: [CLAIM] } });
  await open(page, '/');
  const yours = page.locator('section.nc-panel', { has: page.locator('[data-yours]') }).locator('[data-post]');
  await expect(yours).toHaveText('1 held');
  // What hears a restore comes with the missions copy, once it is loaded.
  await expect.poll(() => missionsKept(page), { timeout: 15_000 }).toBe(true);
  const restore = () =>
    page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await page.evaluate(() => ((window as unknown as { __same: boolean }).__same = true));

  // An ordinary Back: nothing was wiped, so nothing is reloaded or forgotten — though the missions
  // copy was saved again meanwhile, which writes the blob and must not read as a new one.
  await restore();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { __same?: boolean }).__same)).toBe(true);
  await expect(yours).toHaveText('1 held');

  /*
   * Wiped while it was frozen, and signed on again before Back: there is a `navcom.wipeable` on
   * the phone, but not the one this page drew from. Asking only whether one was there missed it.
   */
  await page.evaluate(() => {
    localStorage.removeItem('navcom.wipeable');
    localStorage.setItem('navcom.wipeable', JSON.stringify({ signon: { area: 'Downtown', since: 1 }, '~': 'made-since' }));
  });
  await restore();
  await expect(yours).toHaveText('nothing claimed', { timeout: 10_000 });
  expect(await page.evaluate(() => (window as unknown as { __same?: boolean }).__same)).toBeUndefined();
});

test('a burn in another tab leaves nothing of the decade for this one to write back', async ({ context }) => {
  /*
   * A directory holds every correction for its area in memory and writes the whole map on each
   * one that arrives. Open in a second tab through a burn, the next correction put all of them
   * back, on a phone whose owner had just typed their callsign to destroy everything on it.
   */
  const { generateSecretKey } = await import('nostr-tools/pure');
  const { buildCorrection } = await import('@navcom/core');
  const correction = (hours: string, at: number) =>
    buildCorrection(
      generateSecretKey(),
      { record: 'st-louis-st-patrick-center', verified_by: 'Raven', method: 'in_person', last_verified: '2026-10-01', fields: { hours } },
      at
    );

  const directory = await context.newPage();
  await seedDevice(directory, { callsign: 'Wren', relayEvents: [] });
  await open(directory, '/terminal/directory/st-louis/');
  // Held in memory and on the phone: a correction from before the burn. Delivered until the
  // directory's subscription is open to take it; the same correction again changes nothing.
  const before = correction('open before the burn', 1_800_000_000);
  await expect
    .poll(async () => {
      await deliver(directory, before);
      return directory.evaluate(() => localStorage.getItem('navcom.accruing') ?? '');
    }, { timeout: 15_000 })
    .toContain('open before the burn');
  await directory.evaluate(() => ((window as unknown as { __before: boolean }).__before = true));

  const burning = await context.newPage();
  await seedDevice(burning, { callsign: 'Wren' });
  await open(burning, '/terminal/wipe/');
  await burning.locator('#confirm').fill('Wren');
  await burning.getByRole('button', { name: /burn this device/i }).click();
  await expect(burning).toHaveURL(/\/terminal\/$/, { timeout: 10_000 });

  // The other tab loads again, with nothing in memory to write back.
  await expect
    .poll(() => directory.evaluate(() => (window as unknown as { __before?: boolean }).__before ?? null).catch(() => 'loading'), {
      timeout: 10_000
    })
    .toBeNull();
  await expect(directory.locator('html[data-hydrated="true"]')).toHaveCount(1);

  // A correction reaching it now is what a fresh phone would keep; what it held before is not.
  const after = correction('open after the burn', 1_800_000_100);
  await expect
    .poll(async () => {
      await deliver(directory, after).catch(() => 0);
      return directory.evaluate(() => localStorage.getItem('navcom.accruing') ?? '').catch(() => '');
    }, { timeout: 15_000 })
    .toContain('open after the burn');
  const left = JSON.stringify(await directory.evaluate(() => ({ ...localStorage })));
  expect(left, 'a correction held before the burn was written back').not.toContain('open before the burn');
  expect(left, 'the identity was written back').not.toContain('"secret"');
  expect(left).not.toContain('Wren');
});
