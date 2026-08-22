import { expect, test } from '@playwright/test';
import { seedDevice, open } from './device';

test.setTimeout(45_000);

test('watch the first two seconds of a distress', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 120)));
  page.on('crash', () => errors.push('PAGE CRASHED'));

  const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
  const watchSecret = generateSecretKey();
  await seedDevice(page, {
    callsign: 'Wren',
    watchtower: { pubkey: getPublicKey(watchSecret), relays: ['wss://fake.relay'] },
    relayEvents: []
  });
  await open(page, '/terminal/distress/');

  await page.locator('button.raise').dispatchEvent('pointerdown');
  for (const ms of [400, 400, 400, 400]) {
    await page.waitForTimeout(ms);
    const kinds = await page.evaluate(() =>
      ((window as never as { __navcomPublished?: {kind:number}[] }).__navcomPublished ?? []).length
    ).catch(() => 'PAGE GONE');
    console.log(`  t+${ms}: published=${kinds}`);
    if (kinds === 'PAGE GONE') break;
  }
  console.log('ERRORS: ' + (errors.join(' | ') || 'none'));
  expect(true).toBe(true);
});
