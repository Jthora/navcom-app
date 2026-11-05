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
  // The night's third relay rides in the code, so one relay down still leaves two (2026-11-04).
  expect(read.relays).toEqual(expect.arrayContaining(['wss://relay.damus.io', 'wss://nos.lol', 'wss://offchain.pub', 'wss://relay.snort.social']));

  // Pasted on another phone — its own context, so its own storage — Setup fills in all of it.
  const phone = await browser.newContext();
  const operator = await phone.newPage();
  await seedDevice(operator, { callsign: 'Kestrel', secret: 'b'.repeat(63) + '2', relayEvents: [] } as Parameters<typeof seedDevice>[1]);
  await open(operator, '/terminal/setup/#watch');
  await operator.locator('#code').fill(code);
  await operator.getByRole('button', { name: /fill in from the code/i }).click();
  await expect(operator.locator('#pubkey')).toHaveValue(address);
  await expect(operator.locator('#holders')).toHaveValue(new RegExp(TEST_SECRET_PUBKEY()));
  await phone.close();
  await context.close();
});

test('another holder’s key, added on the screen, goes into the code beside this phone’s', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await holder(page, 'Lighthouse');
  const other = 'c'.repeat(63) + '7';
  const otherKey = getPublicKey(Uint8Array.from(other.match(/../g)!.map((b) => parseInt(b, 16))));
  await page.getByText('Other holders').click();
  await page.locator('#other-holders').fill(`  ${otherKey.toUpperCase()}\n`);
  await expect(page.locator('[data-watch-code]')).toContainText('2 holders');
  await page.getByRole('button', { name: /copy the code/i }).click();
  const { parseWatchCode } = await import('@navcom/core');
  const read = parseWatchCode(await page.evaluate(() => navigator.clipboard.readText()));
  expect([...read.holders].sort()).toEqual([TEST_SECRET_PUBKEY(), otherKey].sort());
});

test('opened from a camera, the code’s link fills Setup — with a callsign or before one', async ({ browser }) => {
  // A phone's camera opens the QR as a link; nothing is pasted. The fragment is all Setup gets.
  const context = await browser.newContext();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  await holder(page, 'Lighthouse');
  await page.getByRole('button', { name: /copy the code/i }).click();
  const code = await page.evaluate(() => navigator.clipboard.readText());
  const fragment = new URL(code).hash;

  for (const callsign of ['Kestrel', null]) {
    // Another phone: its own context, so its own storage.
    const phone = await browser.newContext();
    const operator = await phone.newPage();
    await seedDevice(operator, (callsign ? { callsign, secret: 'b'.repeat(63) + '2', relayEvents: [] } : { __noStorage: true }) as Parameters<typeof seedDevice>[1]);
    await open(operator, `/terminal/setup/${fragment}`);
    await expect(operator.locator('#pubkey'), callsign ?? 'before a callsign').toHaveValue(/^[0-9a-f]{64}$/);
    await expect(operator.locator('#holders')).toHaveValue(new RegExp(TEST_SECRET_PUBKEY()));
    await phone.close();
  }
  await context.close();
});

test('tonight’s teams, named on the watch, travel in its code and are offered at sign-on', async ({ browser }) => {
  // One typo split a team in two on the board (2026-11-02). The holder names the night's teams; the
  // code carries them, signed, as version 2; Setup keeps them; sign-on offers them.
  const context = await browser.newContext();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  await holder(page, 'Lighthouse');
  await page.locator('[data-teams-tonight]').fill('Rescue Rangers, Zone Guardians, rescue rangers');
  await page.getByRole('button', { name: /copy the code/i }).click();
  const code = await page.evaluate(() => navigator.clipboard.readText());
  expect(code).toMatch(/#watch=2&/);
  expect(new URL(code).hash.match(/[&#]n=/g)).toHaveLength(2);

  const phone = await browser.newContext();
  const operator = await phone.newPage();
  await seedDevice(operator, { callsign: 'Kestrel', secret: 'b'.repeat(63) + '2', relayEvents: [] } as Parameters<typeof seedDevice>[1]);
  await open(operator, `/terminal/setup/${new URL(code).hash}`);
  await expect(operator.locator('#pubkey')).toHaveValue(/^[0-9a-f]{64}$/);
  await operator.getByRole('button', { name: 'Connect' }).click();
  await open(operator, '/terminal/sign-on/');
  await expect(operator.locator('#team')).toHaveAttribute('list', 'teams');
  await expect(operator.locator('#teams option')).toHaveCount(2);
  expect(await operator.locator('#teams option').evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value))).toEqual(['Rescue Rangers', 'Zone Guardians']);
  await phone.close();
  await context.close();
});
