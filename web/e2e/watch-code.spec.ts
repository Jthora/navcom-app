import { expect, test, type Page } from '@playwright/test';
import { getPublicKey } from 'nostr-tools/pure';
import { open, seedDevice } from './device';

/**
 * **A watch held on a phone hands operators a code that reaches it** [build order 4.6].
 *
 * The screen gave operators the address. A watch on phones reads the board with each holder's own
 * key, so an operator who typed the address alone sealed everything to a key no phone opens: their
 * sign-on, their questions and their `Distress` reached nobody, and the board's own tests passed
 * because every one of them seeded the holders straight into storage [journey, 2026-10-28].
 *
 * So the code is held to what makes it work: signed by the watch, naming this phone's own key as a
 * holder, and filling an operator's Setup with exactly that when pasted. The whole flow over a relay
 * is `journey.spec.ts`; this is the part that runs in every build.
 */

async function holder(page: Page, callsign: string) {
  await seedDevice(page, { callsign, relayEvents: [] });
  await open(page, '/terminal/watch/');
  await page.getByRole('button', { name: /start a watch on this phone/i }).click();
  await expect(page.locator('[data-watch-code]')).toBeVisible();
}

const TEST_SECRET_PUBKEY = () => getPublicKey(Uint8Array.from(('a'.repeat(63) + '1').match(/../g)!.map((b) => parseInt(b, 16))));

test('the code names this phone as a holder, is signed by the watch, and fills Setup with it', async ({ browser }) => {
  const context = await browser.newContext();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  await holder(page, 'Lighthouse');

  await expect(page.locator('[data-code-qr] svg')).toBeVisible();
  await page.getByRole('button', { name: /copy the code/i }).click();
  const code = await page.evaluate(() => navigator.clipboard.readText());

  const { parseWatchCode } = await import('@navcom/core');
  const read = parseWatchCode(code);
  const address = ((await page.locator('[data-watch-address]').textContent()) ?? '').replace(/\s+/g, '');
  expect(read.pubkey).toBe(address);
  // This phone reads the board with its own operator key, so that is who operators must seal to.
  expect(read.holders).toEqual([TEST_SECRET_PUBKEY()]);
  expect(read.relays.length).toBeGreaterThan(0);

  // Pasted on another phone, Setup fills in all of it.
  const operator = await context.newPage();
  await seedDevice(operator, { callsign: 'Kestrel', secret: 'b'.repeat(63) + '2', relayEvents: [] } as Parameters<typeof seedDevice>[1]);
  await open(operator, '/terminal/setup/');
  await operator.locator('#code').fill(code);
  await operator.getByRole('button', { name: /fill in from the code/i }).click();
  await expect(operator.locator('#pubkey')).toHaveValue(address);
  await expect(operator.locator('#holders')).toHaveValue(new RegExp(TEST_SECRET_PUBKEY()));
  await context.close();
});

test('another holder’s key, added on the screen, goes into the code beside this phone’s', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await holder(page, 'Lighthouse');
  const other = 'c'.repeat(63) + '7';
  const otherKey = getPublicKey(Uint8Array.from(other.match(/../g)!.map((b) => parseInt(b, 16))));
  await page.getByText(/others hold this watch on their phones too/i).click();
  await page.locator('#other-holders').fill(`  ${otherKey.toUpperCase()}\n`);
  await expect(page.locator('[data-watch-code]')).toContainText('2 holders');
  await page.getByRole('button', { name: /copy the code/i }).click();
  const { parseWatchCode } = await import('@navcom/core');
  const read = parseWatchCode(await page.evaluate(() => navigator.clipboard.readText()));
  expect([...read.holders].sort()).toEqual([TEST_SECRET_PUBKEY(), otherKey].sort());
});
