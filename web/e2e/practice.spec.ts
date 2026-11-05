import { expect, test, type Page } from '@playwright/test';
import { open, seedDevice } from './device';

/**
 * Practice (2026-11-04) [practice.ts], on the built screen: reached from Status, the four signals
 * pressed against a pretend watch, with no signal and with no watch, and nothing sent anywhere. The
 * real Distress is one tap away the whole time.
 */

const sent = (page: Page) =>
  page.evaluate(() => ((window as never as { __navcomPublished?: unknown[] }).__navcomPublished ?? []).length);

test('an operator practises all four against a pretend watch, and nothing leaves the phone', async ({ page }) => {
  await seedDevice(page, { callsign: 'Kite', watchtower: { pubkey: 'a'.repeat(64), relays: ['wss://fake.relay'] }, relayEvents: [], contact: { label: 'Sam', number: '+15555550100' } });
  await open(page, '/terminal/');
  await page.locator('[data-practice-link]').click();
  await expect(page).toHaveURL(/\/terminal\/practice\/$/);
  await expect(page.locator('[data-practice-banner]')).toContainText(/nothing is sent/i);
  await expect(page.locator('[data-real-distress]')).toHaveAttribute('href', '/terminal/distress/');
  const before = await sent(page);

  await page.locator('[data-practice-check-in]').click();
  await expect(page.locator('[data-practice-outcome="check-in"]')).toContainText(/heard/i, { timeout: 8_000 });
  await expect(page.locator('[data-practice-outcome="check-in"]')).toContainText('Pretend watch');

  await page.locator('#practice-q').fill('Somewhere warm near here?');
  await page.locator('[data-practice-query]').click();
  const query = page.locator('[data-practice-outcome="query"]');
  await expect(query).toContainText(/waiting for the watch/i);
  await expect(query).toContainText(/call first/i, { timeout: 12_000 });

  await page.locator('[data-practice-assist="now"]').click();
  await expect(page.locator('[data-practice-outcome="assist"]')).toContainText(/passed on/i, { timeout: 10_000 });

  // The hold, as long as the real one: a tap does nothing. Measured each time, since what is above it grows.
  const hold = page.locator('[data-practice-distress]');
  const holdIt = async () => {
    await hold.scrollIntoViewIfNeeded();
    const box = (await hold.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1_500);
    await page.mouse.up();
  };
  await hold.click();
  await expect(page.locator('[data-practice-outcome="distress"]')).toHaveCount(0);
  await holdIt();
  const distress = page.locator('[data-practice-outcome="distress"]');
  await expect(distress).toContainText(/waiting for the watch/i);
  await expect(distress).toContainText(/answered/i, { timeout: 10_000 });
  await expect(distress).toContainText('Pretend watch');

  // No signal: it waits, then goes by itself.
  await page.locator('[data-practice-no-signal]').check();
  await page.locator('[data-practice-check-in]').click();
  const checkIn = page.locator('[data-practice-outcome="check-in"]');
  await expect(checkIn).toHaveAttribute('data-phase', 'waiting-signal');
  await expect(checkIn).toContainText(/waiting for signal/i);
  await expect(checkIn).toContainText(/heard/i, { timeout: 12_000 });

  // No watch: said at once, with their own person named.
  await page.locator('[data-practice-no-signal]').uncheck();
  await page.locator('[data-practice-no-watch]').check();
  await holdIt();
  await expect(distress).toContainText(/no watch to send it to/i);
  await expect(distress).toContainText('text Sam');

  // Nothing at all went to a relay.
  expect(await sent(page)).toBe(before);

  await page.locator('[data-practice-reset]').click();
  await expect(page.locator('[data-practice-outcome]')).toHaveCount(0);
});
