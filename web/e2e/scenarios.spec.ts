import { expect, test } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { blankDevice, holdUntil, open, seedDevice, serviceWorkerReady, TEST_SECRET } from './device';

/**
 * Three nights from the stint brief of 2026-11-03, each the way somebody will actually live it, on
 * the built app: a newcomer on no list going out alone in Queens, an iPhone locking in a pocket, and
 * the only holder asleep when a Distress comes in. Each is held to what the brief says should happen
 * and to the invariant it says is at stake.
 */

const SAM = { label: 'Sam', number: '+1 212 555 0100' };
const me = getPublicKey(Uint8Array.from((TEST_SECRET.match(/../g) ?? []).map((b) => parseInt(b, 16))));
/** Words that put a verdict on a person. A newcomer is unknown, never suspect [identity.md]. */
const VERDICT = /\b(suspected|infiltrat\w*|informants?|untrusted|unvetted|not vetted|fake operator)\b/i;

test.describe('a newcomer on no list, a first night in Queens, with no code and no hub', () => {
  // SC1: the Alone layer, the cached directory, a Distress that says it pages nobody, the person one
  // tap away, and nothing that reads as unfinished or suspect [invariants 2, 9].
  test('goes out with a working tool, and is told exactly what is and is not behind them', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: 40.7557, longitude: -73.8831 }, timezoneId: 'America/New_York' });
    const page = await context.newPage();
    await blankDevice(page);

    await open(page, '/terminal/setup/');
    await page.locator('#callsign').fill('Juniper');
    await page.getByRole('button', { name: /create profile/i }).click();
    await page.locator('[data-person-open]').click();
    await page.locator('#clabel').fill(SAM.label);
    await page.locator('#cnumber').fill(SAM.number);
    await page.getByRole('button', { name: /^save$/i }).click();

    // What is behind her, before she goes: no watch, said as a fact and not as a setup left undone.
    await open(page, '/terminal/sign-on/');
    await expect(page.locator('[data-told] [data-slot="watch"]')).toContainText(/no watch/i);
    await expect(page.locator('[data-told] [data-slot="distress"]')).toContainText(/your person/i);
    const before = await page.locator('main, body').first().innerText();
    expect(before).not.toMatch(/incomplete|unfinished|finish setting up|complete your setup/i);
    expect(before).not.toMatch(VERDICT);
    await page.locator('#area').fill('Jackson Heights');
    await page.locator('#share').selectOption('coarse');
    await page.getByRole('button', { name: /^sign on$/i }).click();
    await page.waitForURL('**/terminal/');
    await expect(page.locator('[data-station]')).toBeVisible();

    // Her standing is nothing yet, which is nothing against her.
    await open(page, '/terminal/standing/');
    expect(await page.locator('main, body').first().innerText()).not.toMatch(VERDICT);

    // New York's places carried for the night, then the signal goes underground.
    await open(page, '/terminal/directory/new-york/');
    await expect(page.locator('[data-record]').first()).toBeVisible({ timeout: 20_000 });
    await serviceWorkerReady(page);
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('[data-record]').first()).toBeVisible({ timeout: 20_000 });

    // A Distress with no watch says there is none, and puts Sam one tap away, offline.
    await open(page, '/terminal/distress/');
    await expect(page.locator('[data-no-watch]')).toBeVisible();
    await expect(page.locator('[data-contact] a').first()).toContainText(/sam/i);

    // Queens is outside the saved streets: the radar, asking nobody.
    await open(page, '/terminal/map/');
    await expect(page.locator('[data-radar]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-streets-state]')).toContainText('Manhattan only');
    await context.close();
  });
});

test.describe('an iPhone locking in a pocket', () => {
  // SC6: told before signing on, and when it goes quiet nothing escalates on its own [invariants 3, 9].
  test.describe('on an iPhone', () => {
    test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1' });
    test('sign-on says a locked iPhone sends nothing, before the operator commits', async ({ page }) => {
      await seedDevice(page, { callsign: 'Kite', contact: SAM });
      await open(page, '/terminal/sign-on/');
      await expect(page.locator('[data-told] [data-slot="locked"]')).toContainText(/pauses/i);
    });
  });

  test('anywhere else it says the phone may pause it', async ({ page }) => {
    await seedDevice(page, { callsign: 'Kite', contact: SAM });
    await open(page, '/terminal/sign-on/');
    await expect(page.locator('[data-told] [data-slot="locked"]')).toContainText(/may pause/i);
  });

  test('gone quiet past the time they gave, the watch sees it rise and is offered an ask, and nothing is sent or sounded', async ({ page }) => {
    const WATCH = '6'.repeat(63) + '1';
    const watchPub = getPublicKey(Uint8Array.from((WATCH.match(/../g) ?? []).map((b) => parseInt(b, 16))));
    const { buildSignal } = await import('@navcom/core');
    const kite = generateSecretKey();
    const now = Math.floor(Date.now() / 1000);
    const out = finalizeEvent(buildSignal(kite, { pubkey: watchPub, holders: [me] }, 'on-station', {
      callsign: 'Kite', area: 'Herald Sq', expected_duration: 3600, routine_interval: null, share_position: false, position: null
    } as never, now - 3 * 3600), kite);
    await seedDevice(page, { callsign: 'Lighthouse', watchSecret: WATCH, relayEvents: [out] });
    await open(page, '/terminal/watch/');
    await holdUntil(page, 'button:has-text("take the watch")');
    await expect(page.locator('.nc-floor-row[data-status="overdue"]')).toContainText('Kite', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: /ask kite to check in/i })).toBeVisible();
    await page.waitForTimeout(3_000);
    // Never a Distress for silence, and nothing said to Kite or anybody else until the holder asks.
    await expect(page).not.toHaveTitle(/^Distress/);
    const sent = await page.evaluate(() => ((window as never as { __navcomPublished?: { kind: number }[] }).__navcomPublished ?? []).filter((e) => e.kind !== 10910).length);
    expect(sent, 'the watch sent something on its own about an operator gone quiet').toBe(0);
  });
});

test.describe('the only holder asleep when a Distress comes in', () => {
  // SC10: it keeps sending, and once no answer has come in time it says nobody is coming, with the
  // operator's person still one tap away [invariant 2]. Ten minutes, on the page's own clock.
  test('the operator is told nobody is coming, still sending, with their person one tap away', async ({ page }) => {
    test.setTimeout(90_000);
    await page.clock.install();
    await seedDevice(page, {
      callsign: 'Raven',
      contact: SAM,
      watchtower: { pubkey: getPublicKey(generateSecretKey()), relays: ['wss://fake.relay'], holders: [getPublicKey(generateSecretKey())] },
      relayEvents: []
    });
    await open(page, '/terminal/distress/');
    const raise = page.locator('button.raise');
    const box = (await raise.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1_600);
    await page.mouse.up();
    await expect(page.locator('[data-nobody-answering]')).toHaveCount(0, { timeout: 5_000 });

    // Ten and a half minutes on, then half a minute at a time, so each answer window the sending
    // waits on closes as it would.
    await page.clock.fastForward('10:30');
    const nobody = page.locator('[data-nobody-answering]');
    for (let i = 0; i < 40 && !(await nobody.isVisible()); i++) {
      await page.clock.fastForward('00:30');
      await page.waitForTimeout(150);
    }
    await expect(nobody).toBeVisible({ timeout: 5_000 });
    await expect(nobody).toContainText(/nobody is coming/i);
    await expect(nobody).toContainText(/still sending/i);
    await expect(page.locator('[data-contact] a').first()).toContainText(/sam/i);
  });
});
