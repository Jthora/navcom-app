import { expect, test } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { liveDevice, open } from './device';
import { hermetic, publish, RelayNet } from './journey-harness';

/**
 * A holder who left still holds the watch key (the brief's SC3, 2026-11-04) [core `retire.ts`]. The
 * holder who stays retires it: every phone under it reads Moved, with who and why, sends it nothing
 * more, and goes on refusing it when the old key says it is on station again.
 */

const DAMUS = 'wss://relay.damus.io';
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

let net: RelayNet;
test.beforeEach(() => {
  net = new RelayNet();
});
test.afterEach(async () => {
  await net?.close();
});

test('a retired watch reads Moved on an operator’s phone, by whom and why, and stays retired there', async ({ browser }) => {
  const watch = generateSecretKey();
  const kite = generateSecretKey();
  const owl = generateSecretKey();
  const config = { pubkey: getPublicKey(watch), relays: [DAMUS], holders: [getPublicKey(kite), getPublicKey(owl)] };

  const holder = await hermetic(browser, net, { timezoneId: 'America/New_York' });
  await liveDevice(holder.page, DAMUS, { callsign: 'Kite', secret: hex(kite), watchSecret: hex(watch), watchtower: config });
  const operator = await hermetic(browser, net, { timezoneId: 'America/New_York' });
  await liveDevice(operator.page, DAMUS, { callsign: 'Wren', secret: hex(generateSecretKey()), watchtower: config });

  await open(holder.page, '/terminal/watch/');
  const oldAddress = await holder.page.locator('[data-watch-address]').textContent();
  await holder.page.locator('summary', { hasText: /retire this key/i }).click();
  await holder.page.locator('[data-retire-why]').fill('Owl has left the squad. New code from Kite tonight.');
  await holder.page.locator('[data-retire-open]').click();
  await holder.page.locator('[data-retire-confirm]').click();
  await expect(holder.page.locator('[data-retired-done]')).toBeVisible({ timeout: 15_000 });
  // A new watch, under a new key.
  await expect(holder.page.locator('[data-watch-address]')).not.toHaveText(oldAddress ?? '');

  await open(operator.page, '/terminal/');
  await expect(operator.page.getByText('Moved', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(operator.page.getByText(/Kite: Owl has left the squad/)).toBeVisible();

  // The one who left publishes under the old key again: still Moved, and still nothing to send to.
  const now = Math.floor(Date.now() / 1000) + 2;
  await publish(await net.of(DAMUS), finalizeEvent({ kind: 10910, created_at: now, tags: [], content: JSON.stringify({ v: 4, state: 'station', holder: 'Owl', holder_kind: 'human', oncall: [], since: now, agent_health: 'ok', last_drill: null, log_root: null }) }, watch));
  await open(operator.page, '/terminal/');
  await expect(operator.page.getByText('Moved', { exact: true })).toBeVisible({ timeout: 20_000 });
  await open(operator.page, '/terminal/distress/');
  await expect(operator.page.locator('[data-watch-moved]')).toContainText('Moved');

  await holder.context.close();
  await operator.context.close();
});
