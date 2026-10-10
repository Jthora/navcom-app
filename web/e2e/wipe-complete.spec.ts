import { expect, test, type Page } from '@playwright/test';
import { holdUntil, inventory, open, SEEDED, seedDevice } from './device';

/**
 * Everything on the phone after a panic wipe, and after a burn [invariant 5].
 *
 * Every wipe test before this read the two tier blobs and nothing else, so each would have stayed
 * green with tonight's data on the phone under any other name — and twice it was: a salvage copy of
 * a damaged blob, and the mission somebody left in this tab, which Status went on offering to take
 * them "Back to" after the wipe. This drives the real controls and then lists **all four** places a
 * page can keep anything, against an allowlist, so a key nobody classified fails the day it is
 * written.
 *
 * The service worker is blocked so the cache list is this test's own: one cache stands in for the
 * offline copies, and nothing re-creates one behind the burn.
 */
test.use({ serviceWorkers: 'block' });

const MISSION = `30079:${'a'.repeat(64)}:heat-relief`;
/** The test's own once-only marker, beside the harness's. */
const PLANTED = 'e2e.wipe-planted';

/** What the harness itself keeps, and the framework keeps for scrolling: nobody's data. */
const notOurs = (key: string) => key === SEEDED || key === PLANTED || key.startsWith('sveltekit:');

async function phoneWithEverything(page: Page) {
  await seedDevice(page, {
    callsign: 'Wren',
    peers: [{ pubkey: 'b'.repeat(64), callsign: 'Raven', since: 1 }],
    contact: { label: 'Sam', number: '+15555550100' },
    wipeable: {
      record_notes: { 'st-louis-0001': { text: 'side door after 9' } },
      mission_claims: [{ address: MISSION, title: 'Heat relief', visibility: 'open', ends: 2_000_000_000, claimId: null }]
    }
  });
  await page.addInitScript(
    ({ planted, mission }) => {
      if (localStorage.getItem(planted) === '1') return;
      localStorage.setItem(planted, '1');
      // The salvage copies, as storage leaves them for a damaged blob.
      localStorage.setItem('navcom.accruing.damaged', '{ last year');
      localStorage.setItem('navcom.wipeable.damaged', '{ last night');
      // Wipeable data outside the blob [groups.md §8]: stand-ins for a crew roster and a cache.
      localStorage.setItem('navcom.wipeable.crews', '{"stand-in":true}');
      localStorage.setItem('navcom.wipeable.cache.missions', '{"stand-in":true}');
      // The mission somebody left to take a callsign, in this tab [missions/pending.ts].
      sessionStorage.setItem('navcom.pending-mission', mission);
      sessionStorage.setItem('navcom.pending-mission-name', 'Heat relief');
    },
    { planted: PLANTED, mission: MISSION }
  );
}

test('a panic wipe leaves the decade and nothing of tonight; a burn leaves nothing of ours', async ({ page }) => {
  await phoneWithEverything(page);
  await open(page, '/terminal/');
  // Status offers the way back to the mission: the state the wipe has to end.
  await expect(page.locator('[data-back-to-mission]')).toContainText(/back to heat relief/i);
  // An offline copy, standing in for the shell and directory the service worker keeps.
  await page.evaluate(() => caches.open('navcom-terminal-e2e').then((c) => c.put('/e2e', new Response('x'))));

  const before = await inventory(page);
  // The seed is all there, so what follows is not vacuous.
  expect(before.local).toEqual(expect.arrayContaining([
    'navcom.accruing', 'navcom.accruing.damaged', 'navcom.wipeable', 'navcom.wipeable.damaged',
    'navcom.wipeable.crews', 'navcom.wipeable.cache.missions'
  ]));
  expect(before.session).toEqual(expect.arrayContaining(['navcom.pending-mission', 'navcom.pending-mission-name']));

  // The way an operator gets there, and the real hold.
  await page.getByRole('link', { name: /wipe this device/i }).click();
  await holdUntil(page, 'button:has-text("Hold to wipe tonight")');
  await expect(page).toHaveURL(/\/terminal\/$/);
  // Status again, drawn after the wipe: an identity, nothing to go back to.
  await expect(page.getByRole('link', { name: /^sign on$/i }).first()).toBeVisible();
  await expect(page.locator('[data-back-to-mission]')).toHaveCount(0);

  const wiped = await inventory(page);
  expect(wiped.local.filter((k) => !notOurs(k)), 'after a wipe: the decade and its salvage copy').toEqual([
    'navcom.accruing',
    'navcom.accruing.damaged'
  ]);
  expect(wiped.session.filter((k) => !notOurs(k)), 'after a wipe: nothing of ours in this tab').toEqual([]);
  if (wiped.idb) expect(wiped.idb, 'NavCom keeps nothing in IndexedDB').toEqual([]);
  // The offline copies are the public site, not tonight: a wipe leaves them for a burn.
  expect(wiped.caches).toEqual(['navcom-terminal-e2e']);

  await page.getByRole('link', { name: /wipe this device/i }).click();
  await page.locator('#confirm').fill('Wren');
  await page.getByRole('button', { name: /burn this device/i }).click();
  // Burn navigates only once the caches are gone, so this is after everything it does.
  await expect(page).toHaveURL(/\/terminal\/$/, { timeout: 10_000 });

  const burned = await inventory(page);
  expect(burned.local.filter((k) => !notOurs(k)), 'after a burn: no key of ours').toEqual([]);
  expect(burned.session.filter((k) => !notOurs(k)), 'after a burn: nothing of ours in this tab').toEqual([]);
  if (burned.idb) expect(burned.idb).toEqual([]);
  expect(burned.caches, 'after a burn: no offline copies').toEqual([]);
});

test('a key under the Wipeable name is destroyed even when the blob itself is absent', async ({ page }) => {
  // Nothing in the blob yet tonight, but a roster on the phone: the wipe is by name, not by blob.
  await seedDevice(page, { callsign: 'Wren' });
  await page.addInitScript((planted) => {
    if (localStorage.getItem(planted) === '1') return;
    localStorage.setItem(planted, '1');
    localStorage.removeItem('navcom.wipeable');
    localStorage.setItem('navcom.wipeable.crews', '{"stand-in":true}');
  }, PLANTED);
  await open(page, '/terminal/wipe/');
  await holdUntil(page, 'button:has-text("Hold to wipe tonight")');
  await expect(page).toHaveURL(/\/terminal\/$/);
  expect((await inventory(page)).local.filter((k) => !notOurs(k))).toEqual(['navcom.accruing']);
});
