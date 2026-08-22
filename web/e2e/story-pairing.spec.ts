import { expect, test, type Page, type Browser } from '@playwright/test';
import { seedDevice, open, deliver } from './device';

/**
 * **Two people at a meeting.**
 *
 * The Paired layer, in full: *"Scan a peer's code; you see each other's patrols. Two phones,
 * no watch, no server, no leader."*
 *
 * Two real browser contexts, each its own phone, exchanging through a relay that carries what
 * one published to the other. Everything is done with controls a person can see — the code is
 * read off one screen and typed into the other, which is what people standing together
 * actually do when a camera will not focus in the dark.
 */

async function phone(browser: Browser, callsign: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await seedDevice(page, { callsign, relayEvents: [] });
  return page;
}

/**
 * The code an operator shows somebody standing next to them.
 *
 * Read out of the details panel beside the QR, because a camera does not focus in the dark
 * and reading it aloud is what people actually do. Scoped to that panel: the screen has a
 * second `.blocks` listing relays, and taking both produced a "code" with two relay URLs
 * glued to the front of it.
 */
async function codeOn(page: Page): Promise<string> {
  await open(page, '/terminal/peers/');
  const details = page.locator('details', { hasText: /read it out/i }).first();
  await details.locator('summary').click();
  const blocks = await details.locator('.blocks span').allInnerTexts();
  return blocks.join('').replace(/\s+/g, '');
}

test.describe('pairing, standing next to each other', () => {
  test.setTimeout(60_000);

  test("each ends up on the other's list, from codes read off a screen", async ({ browser }) => {
    const wren = await phone(browser, 'Wren');
    const raven = await phone(browser, 'Raven');

    // Raven reads her code out; Wren types it in. No camera, no server, no leader.
    const ravenCode = await codeOn(raven);
    expect(ravenCode).toMatch(/^[0-9a-f]{64}$/);

    await open(wren, '/terminal/peers/');
    await wren.locator('#code').fill(ravenCode);
    await wren.locator('#name').fill('Raven');
    await wren.getByRole('button', { name: /^pair$/i }).click();

    // Wren has her.
    await expect(wren.getByText('Raven')).toBeVisible();

    // And Wren reads his out, so it is mutual rather than one-sided.
    const wrenCode = await codeOn(wren);
    await open(raven, '/terminal/peers/');
    await raven.locator('#code').fill(wrenCode);
    await raven.locator('#name').fill('Wren');
    await raven.getByRole('button', { name: /^pair$/i }).click();
    await expect(raven.getByText('Wren')).toBeVisible();

    await wren.context().close();
    await raven.context().close();
  });

  test('and then each can see the other is out', async ({ browser }) => {
    // The layer's actual promise. Nothing in this path is a server: one phone publishes a
    // sealed heartbeat and the other decrypts it.
    const wren = await phone(browser, 'Wren');
    const raven = await phone(browser, 'Raven');

    const ravenCode = await codeOn(raven);
    const wrenCode = await codeOn(wren);

    await open(wren, '/terminal/peers/');
    await wren.locator('#code').fill(ravenCode);
    await wren.locator('#name').fill('Raven');
    await wren.getByRole('button', { name: /^pair$/i }).click();

    await open(raven, '/terminal/peers/');
    await raven.locator('#code').fill(wrenCode);
    await raven.locator('#name').fill('Wren');
    await raven.getByRole('button', { name: /^pair$/i }).click();

    // Raven goes out.
    await open(raven, '/terminal/sign-on/');
    await raven.locator('#area').fill('north riverfront');
    await raven.getByRole('button').last().click();
    await raven.waitForURL('**/terminal/');

    /*
     * Wren is looking at her Status screen when it arrives.
     *
     * Order matters and it matters for a real reason: the delivery goes into subscriptions
     * that are **open right now**, and Status is where the presence subscription lives. A
     * navigation afterwards would tear it down and take the heartbeat with it — which is also
     * true of a real phone, where an event that arrives while the app is closed is simply
     * gone. Nothing here stores presence, by design.
     */
    await open(wren, '/terminal/');
    const moved = await deliver(raven, wren);
    expect(moved, 'nothing was published, so the exchange proved nothing').toBeGreaterThan(0);

    /*
     * Asserted as **out, with her area** — not merely present by name.
     *
     * The first version of this checked only that "Raven" appeared, and passed with the relay
     * severed: a paired peer nobody has heard from is listed anyway, with *"nothing heard"*
     * [3.I]. That is right for the product and made the test vacuous. What proves the crossing
     * is the thing only a decrypted heartbeat can produce.
     */
    const peers = wren.locator('[data-peers]');
    await expect(peers).toContainText(/Raven/, { timeout: 10_000 });
    await expect(peers).toContainText(/is out/);
    await expect(peers).toContainText(/north riverfront/);
    await expect(peers).not.toContainText(/nothing heard/i);

    await wren.context().close();
    await raven.context().close();
  });
});
