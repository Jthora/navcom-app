import { expect, test, type Page } from '@playwright/test';
import { seedDevice, open, TEST_SECRET } from './device';

/**
 * What the watch tells everybody out [core `notice`], at both ends (2026-11-02).
 *
 * The Watched layer is somebody who answers questions and tells you what is happening, and until
 * this a watch could tell only the person who asked. On the night several teams patrol one crowd,
 * *the police have closed 8th Ave* went over a group chat.
 *
 * On the operator's phone it is held as one current fact and shown on every screen: whole on
 * Status, and as one line in the strip the signature toggle already keeps clear at the foot of the
 * others, so arriving moves nothing under a thumb on its way to Distress. Silent, with nothing to
 * accept or answer.
 */

const bytes = (hex: string) => Uint8Array.from((hex.match(/../g) ?? []).map((b) => parseInt(b, 16)));
const WATCH_SECRET = '4'.repeat(63) + '7';

/** Counts vibration, installed before the app's own scripts: a notice must never buzz. */
async function countBuzz(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const g = globalThis as unknown as { __buzz: number };
    g.__buzz = 0;
    navigator.vibrate = (() => {
      g.__buzz += 1;
      return true;
    }) as Navigator['vibrate'];
  });
}

test.describe('the watch tells the people out what is happening', () => {
  test('an operator reading another screen sees it there, nothing moves and nothing buzzes, and Status has it whole', async ({ page }) => {
    const { finalizeEvent, getPublicKey } = await import('nostr-tools/pure');
    const { buildResponse } = await import('@navcom/core');
    const watch = bytes(WATCH_SECRET);
    await countBuzz(page);
    await seedDevice(page, {
      callsign: 'Kite',
      watchtower: { pubkey: getPublicKey(watch), relays: ['wss://fake.relay'] },
      relayEvents: []
    });
    const now = Math.floor(Date.now() / 1000);
    await page.addInitScript((s) => {
      localStorage.setItem('navcom.wipeable', JSON.stringify({ signon: s }));
    }, { at: now - 600, area: 'Penn Station', expectedUntil: now + 3600, toldAtSignOn: '', routineInterval: null });

    // Loaded straight onto a screen that is not Status: the one a phone reloaded mid-patrol is on.
    await open(page, '/terminal/directory/');
    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible();
    const before = await heading.boundingBox();
    await expect(page.locator('[data-notice-line]')).toHaveCount(0);

    const said = finalizeEvent(
      buildResponse(
        watch,
        getPublicKey(bytes(TEST_SECRET)),
        'e'.repeat(64),
        { type: 'notice', responder: { kind: 'human', callsign: 'Vale' }, text: 'Police line across 8th Ave at 33rd. Go round by 9th.', provenance: null },
        now
      ),
      watch
    );
    await page.evaluate((e) => (window as unknown as { __navcomDeliver: (x: unknown) => number }).__navcomDeliver(e), said);

    const line = page.locator('[data-notice-line]');
    await expect(line).toBeVisible({ timeout: 10_000 });
    await expect(line).toContainText('Vale');
    await expect(line).toContainText('Police line across 8th Ave');
    expect(await heading.boundingBox(), 'the screen moved when it arrived').toEqual(before);
    expect(await page.evaluate(() => (globalThis as unknown as { __buzz: number }).__buzz)).toBe(0);

    // Status shows it whole, and the line is not shown twice there.
    await line.click();
    await page.waitForURL('**/terminal/');
    await expect(page.locator('[data-notice-text]')).toHaveText('Police line across 8th Ave at 33rd. Go round by 9th.');
    await expect(page.locator('[data-notice-line]')).toHaveCount(0);
    await page.locator('[data-notice-text] ~ .passed-acts').getByRole('button', { name: 'Put down' }).click();
    await expect(page.locator('[data-notice-text]')).toHaveCount(0);
  });

  test('the holder tells everybody out, or only the teams chosen, and sees who it reached', async ({ page }) => {
    const { finalizeEvent, generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const { buildSignal } = await import('@navcom/core');
    const to = { pubkey: getPublicKey(bytes(WATCH_SECRET)), holders: [getPublicKey(bytes(TEST_SECRET))] };
    const now = Math.floor(Date.now() / 1000);
    const out = (key: Uint8Array, callsign: string, team: string) =>
      finalizeEvent(
        buildSignal(key, to, 'on-station', { callsign, team, area: 'Midtown', expected_duration: 3600, routine_interval: null, share_position: false, position: null } as never, now - 60),
        key
      );
    await seedDevice(page, {
      callsign: 'Vale',
      watchSecret: WATCH_SECRET,
      relayEvents: [out(generateSecretKey(), 'Owl', 'Zone Guardians'), out(generateSecretKey(), 'Kite', 'Rescue Rangers')]
    });
    await open(page, '/terminal/watch/');
    await expect(page.locator('[data-floor] .nc-floor-row')).toHaveCount(2, { timeout: 15_000 });

    await page.getByRole('button', { name: 'Tell everyone out' }).click();
    await page.getByLabel('To everyone out').fill('Police line across 8th Ave at 33rd.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const told = page.locator('[data-told]');
    await expect(told).toContainText('Police line across 8th Ave at 33rd.', { timeout: 10_000 });
    await expect(told).toContainText(/to (Owl, Kite|Kite, Owl)/);

    // Narrowed to one team, it goes to that team alone, and says so before it goes.
    await page.locator('[data-teams] button', { hasText: 'Rescue Rangers' }).click();
    await page.getByRole('button', { name: 'Tell Rescue Rangers' }).click();
    await page.getByLabel('To Rescue Rangers').fill('Water at the 34th St corner.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(told).toContainText('Water at the 34th St corner.', { timeout: 10_000 });
    await expect(told).toContainText('to Kite');
    await expect(told).not.toContainText('Owl');
  });
});
