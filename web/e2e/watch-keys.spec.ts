import { expect, test, type Page } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { holdUntil, open, seedDevice, TEST_SECRET } from './device';

/**
 * Keys for a holder at a laptop (2026-11-04) [watch-keys.ts], on the built screen: Alt+A goes to the
 * Distress before the question, Alt+Q quiets it, a phrase goes in with Alt+1, Ctrl+Enter sends, Esc
 * cancels, Alt+M opens the message to everyone out. A letter on its own does nothing, and a draft is
 * never thrown away by a key.
 */

const WATCH = '7'.repeat(63) + '5';
const bytes = (h: string) => Uint8Array.from((h.match(/../g) ?? []).map((b) => parseInt(b, 16)));
const me = getPublicKey(bytes(TEST_SECRET));
const WATCH_PUB = getPublicKey(bytes(WATCH));

const published = (page: Page) =>
  page.evaluate(() => ((window as never as { __navcomPublished?: { kind?: number }[] }).__navcomPublished ?? []).length);

test('a holder answers a Distress and a question without touching the trackpad', async ({ page }) => {
  const { buildSignal, buildDistress } = await import('@navcom/core');
  const kite = generateSecretKey();
  const now = Math.floor(Date.now() / 1000);
  const to = { pubkey: WATCH_PUB, holders: [me] };
  const events = [
    finalizeEvent(buildSignal(kite, to, 'on-station', { callsign: 'Kite', area: 'Herald Sq', expected_duration: 7200, routine_interval: null, share_position: false, position: null } as never, now - 600), kite),
    finalizeEvent(buildSignal(kite, to, 'query', { text: 'Somewhere warm near Herald Sq?', area: 'Herald Sq' } as never, now - 60), kite),
    finalizeEvent(buildDistress(kite, to, { position: null, area: 'Herald Sq' } as never, now - 20), kite)
  ];
  await seedDevice(page, { callsign: 'Lighthouse', watchSecret: WATCH, watchtower: { pubkey: WATCH_PUB, relays: ['wss://fake.relay'], holders: [me] }, relayEvents: events });
  await open(page, '/terminal/watch/');
  await page.locator('summary', { hasText: /phrases for tonight/i }).click();
  await page.locator('[data-phrases-edit]').fill('Stay where you are, I am calling someone now.');
  await page.locator('[data-phrases-save]').click();
  await holdUntil(page, 'button:has-text("take the watch")');

  // Ringing; Alt+Q quiets it, and the Distress still shows.
  const urgent = page.locator('section.urgent');
  await expect(page.locator('[data-silence]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-silence]')).toHaveAttribute('aria-keyshortcuts', 'Alt+Q');
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  await page.keyboard.press('Alt+KeyQ');
  await expect(page.locator('[data-silence]')).toHaveCount(0);
  await expect(urgent).toBeVisible();

  // A letter alone does nothing.
  await page.keyboard.press('KeyA');
  await expect(page.locator('textarea[id^="a-"]')).toHaveCount(0);

  // Alt+A: the Distress first, though the question came earlier, with the cursor in its box.
  await page.keyboard.press('Alt+KeyA');
  const distressBox = urgent.locator('textarea[id^="a-"]');
  await expect(distressBox).toBeFocused();
  await page.keyboard.type('Heard you.');
  // Again, with words in it: back to the same box, the words kept.
  await page.keyboard.press('Alt+KeyA');
  await expect(distressBox).toBeFocused();
  await expect(distressBox).toHaveValue('Heard you.');
  // A phrase in, after the words.
  await page.keyboard.press('Alt+Digit1');
  await expect(distressBox).toHaveValue('Heard you. Stay where you are, I am calling someone now.');

  // Ctrl+Enter sends it, as Send does, and only then: the box closes on an answer a relay took. (The
  // board marks it Answered when that answer comes back from a relay, which the journeys walk.)
  const before = await published(page);
  await page.keyboard.press('Control+Enter');
  await expect(distressBox).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('[data-answer-unsent]')).toHaveCount(0);
  expect(await published(page)).toBeGreaterThan(before);

  // Alt+A again opens the next box; Esc puts it away unsent. (Until its answer comes back from a relay
  // the Distress still counts as unanswered, so here, with no relay echoing, it is the Distress again.)
  await page.keyboard.press('Alt+KeyA');
  const answerBox = page.locator('textarea[id^="a-"]');
  await expect(answerBox).toBeFocused();
  const beforeCancel = await published(page);
  await page.keyboard.press('Escape');
  await expect(answerBox).toHaveCount(0);
  expect(await published(page)).toBe(beforeCancel);

  // Alt+M opens the message to everyone out, with the cursor in it; Esc closes it.
  await expect(page.locator('[data-tell-open]')).toHaveAttribute('aria-keyshortcuts', 'Alt+M');
  await page.keyboard.press('Alt+KeyM');
  await expect(page.locator('#tell-text')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#tell-text')).toHaveCount(0);
});
