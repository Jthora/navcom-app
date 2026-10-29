import { expect, test, type Page } from '@playwright/test';
import { open, seedDevice } from './device';

/**
 * A relay that refuses this phone for volume, on the built site [lib/terminal/refusing.svelte.ts].
 *
 * relay.damus.io answered this project's own machine *"rate-limited: you are noting too much"* on
 * 2026-10-29, and sending on drew a ban on the address, reads and all. So the routine beats stop at
 * the first such answer and come back once it cools, and Status says which relay and why, because
 * a ban is on the address: everyone on the same Wi-Fi shares it, and the person can change network.
 */

const KIND_PEER_PRESENCE = 20913;
const SAID = 'rate-limited: you are noting too much';

async function raven() {
  const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
  return getPublicKey(generateSecretKey());
}

const presences = (page: Page) =>
  page.evaluate((kind) => ((globalThis as unknown as { __navcomPublished?: { kind: number }[] }).__navcomPublished ?? []).filter((e) => e.kind === kind).length, KIND_PEER_PRESENCE);

test('a relay that rate-limits this phone is named on Status, and the beat holds off it until it cools', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T20:00:00Z') });
  await seedDevice(page, {
    callsign: 'Wren',
    peers: [{ pubkey: await raven(), callsign: 'Raven', since: 1_793_000_000 }],
    refusePublish: true,
    refuseWith: SAID
  });
  await open(page, '/terminal/sign-on/');
  await page.locator('#area').fill('Kensington');
  await page.getByRole('button', { name: /^sign on$/i }).click();
  await page.waitForURL('**/terminal/');

  // Both shipped relays refused the presence sent at sign-on, in those words.
  const refusing = page.locator('[data-refusing]');
  await expect(refusing).toHaveCount(2);
  await expect(page.locator('[data-refusing="wss://relay.damus.io"]')).toContainText('relay.damus.io');
  await expect(refusing.first()).toContainText(/rate-limited/i);
  await expect(page.getByText('A relay refusing this phone')).toBeVisible();

  // The next beat goes nowhere: every relay is cooling down.
  const sent = await presences(page);
  expect(sent).toBeGreaterThan(0);
  await page.clock.runFor(61_000);
  expect(await presences(page)).toBe(sent);

  // Once it has cooled, the beat tries again, and is refused again, so the line stays.
  await page.clock.runFor(10 * 60_000);
  expect(await presences(page)).toBeGreaterThan(sent);
  await expect(refusing).toHaveCount(2);
});

test('a relay that refuses for any other reason is not held off, and Status does not call it a rate limit', async ({ page }) => {
  await seedDevice(page, {
    callsign: 'Wren',
    peers: [{ pubkey: await raven(), callsign: 'Raven', since: 1_793_000_000 }],
    refusePublish: true,
    refuseWith: 'blocked: not on the allowlist'
  });
  await open(page, '/terminal/sign-on/');
  await page.locator('#area').fill('Kensington');
  await page.getByRole('button', { name: /^sign on$/i }).click();
  await page.waitForURL('**/terminal/');
  await expect(page.locator('[data-capability]')).toBeVisible();
  await expect(page.locator('[data-refusing]')).toHaveCount(0);
});
