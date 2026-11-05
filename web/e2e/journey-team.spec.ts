import { expect, test, type Browser } from '@playwright/test';
import { generateSecretKey } from 'nostr-tools/pure';
import { liveDevice, open } from './device';
import { hermetic, RelayNet, type Hermetic } from './journey-harness';

/**
 * A team pairs in one scan each (2026-11-04) [team.svelte.ts], on three phones over relays on this
 * machine: one shows a team code, two scan it, and every phone lists the other two under the names
 * they gave themselves and pairs with them when its holder presses Pair. Nothing pairs by itself.
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

async function phone(browser: Browser, callsign: string): Promise<Hermetic> {
  const h = await hermetic(browser, net, { timezoneId: 'America/New_York' });
  await liveDevice(h.page, DAMUS, { callsign, secret: hex(generateSecretKey()) });
  return h;
}

test('three phones pair with each other from one team code, each by its own press', async ({ browser }) => {
  const kite = await phone(browser, 'Kite');
  const wren = await phone(browser, 'Wren');
  const owl = await phone(browser, 'Owl');

  await open(kite.page, '/terminal/peers/');
  await kite.page.locator('[data-team-show]').click();
  const qr = kite.page.locator('[data-team-qr]');
  await expect(qr).toBeVisible();
  const link = (await qr.getAttribute('data-link'))!;
  expect(link).toMatch(/^https:\/\/navcom\.app\/terminal\/peers\/#team=[0-9a-f]{64}\.\d+$/);
  const hash = link.slice(link.indexOf('#'));

  // Scanned: a link that opens the team, never the one-person form.
  for (const h of [wren, owl]) {
    await open(h.page, `/terminal/peers/${hash}`);
    await expect(h.page.locator('#code')).toHaveValue('');
  }

  // Each phone lists the other two by the names they gave themselves, and nobody is paired yet.
  for (const [h, others] of [[kite, ['Wren', 'Owl']], [wren, ['Kite', 'Owl']], [owl, ['Kite', 'Wren']]] as const) {
    for (const name of others) {
      await expect(h.page.locator(`[data-team-member="${name}"]`)).toBeVisible({ timeout: 20_000 });
    }
    await expect(h.page.locator('.paired')).toHaveCount(0);
  }

  // Owl leaves Wren out; the others take both.
  await owl.page.locator('[data-team-member="Wren"] input').uncheck();
  for (const h of [kite, wren, owl]) await h.page.locator('[data-team-accept]').click();
  await expect(kite.page.locator('.paired')).toContainText('Wren');
  await expect(kite.page.locator('.paired')).toContainText('Owl');
  await expect(wren.page.locator('.paired')).toContainText('Kite');
  await expect(owl.page.locator('.paired')).toContainText('Kite');
  await expect(owl.page.locator('.paired')).not.toContainText('Wren');

  // Kept as peers are: across a reload, with the team code gone with the screen.
  await open(owl.page, '/terminal/peers/');
  await expect(owl.page.locator('.paired')).toContainText('Kite');
  await expect(owl.page.locator('[data-team-qr]')).toHaveCount(0);

  for (const h of [kite, wren, owl]) await h.context.close();
});

test('a team code that has run out says so, and pairs nobody', async ({ browser }) => {
  const wren = await phone(browser, 'Wren');
  const old = Math.floor(Date.now() / 1000) - 5;
  await open(wren.page, `/terminal/peers/#team=${'ab'.repeat(32)}.${old}`);
  await expect(wren.page.locator('[data-team-refused]')).toContainText(/run out/i);
  await wren.context.close();
});
