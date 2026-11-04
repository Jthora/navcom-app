import { expect, test } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { open, seedDevice, TEST_SECRET } from './device';

/**
 * Tonight's phrases (the joint night, 2026-11-04): written ahead by the holder, one tap into an
 * answer, and nothing sent until Send. Wipeable, as tonight's arrangement is.
 */

const WATCH = '7'.repeat(63) + '3';
const bytes = (h: string) => Uint8Array.from((h.match(/../g) ?? []).map((b) => parseInt(b, 16)));
const me = getPublicKey(bytes(TEST_SECRET));
const WATCH_PUB = getPublicKey(bytes(WATCH));

test('a phrase written ahead goes into the answer in one tap, and is sent only when the holder sends it', async ({ page }) => {
  const { buildSignal } = await import('@navcom/core');
  const kite = generateSecretKey();
  const now = Math.floor(Date.now() / 1000);
  const to = { pubkey: WATCH_PUB, holders: [me] };
  const events = [
    finalizeEvent(buildSignal(kite, to, 'on-station', { callsign: 'Kite', area: 'Herald Sq', expected_duration: 7200, routine_interval: null, share_position: false, position: null } as never, now - 600), kite),
    finalizeEvent(buildSignal(kite, to, 'query', { text: 'Somewhere warm near Herald Sq?', area: 'Herald Sq' } as never, now - 30), kite)
  ];
  await seedDevice(page, { callsign: 'Lighthouse', watchSecret: WATCH, watchtower: { pubkey: WATCH_PUB, relays: ['wss://fake.relay'], holders: [me] }, relayEvents: events });
  await open(page, '/terminal/watch/');
  await page.locator('summary', { hasText: /phrases for tonight/i }).click();
  await page.locator('[data-phrases-edit]').fill('The drop-in on 30th is open all night.\n\nAvoid 8th Ave, police line at 33rd.');
  await page.locator('[data-phrases-save]').click();
  await expect(page.locator('[data-phrases-save]')).toHaveText('Saved');

  await page.getByRole('button', { name: /^answer$/i }).first().click({ timeout: 15_000 });
  const phrases = page.locator('[data-phrases] button');
  await expect(phrases).toHaveCount(2);
  const before = await page.evaluate(() => ((window as never as { __navcomPublished?: unknown[] }).__navcomPublished ?? []).length);
  await phrases.first().click();
  await expect(page.locator('textarea[id^="a-"]').first()).toHaveValue('The drop-in on 30th is open all night.');
  // Put in, not sent.
  expect(await page.evaluate(() => ((window as never as { __navcomPublished?: unknown[] }).__navcomPublished ?? []).length)).toBe(before);

  // Tonight's: kept in the tier a panic wipe destroys.
  const tier = await page.evaluate(() => Object.keys(localStorage).find((k) => (localStorage.getItem(k) ?? '').includes('drop-in on 30th')));
  expect(tier).toMatch(/wipe/i);
});
