import { expect, test, type Page } from '@playwright/test';
import { seedDevice, open, deliver } from './device';

/**
 * **The second person who can hold the watch.**
 *
 * A squad with no box is the common case, and a squad of one is not a squad. This is the whole
 * of that growth, walked with nothing seeded: Wren starts a watch on her phone, hands the key
 * to Ash in person, and Ash — who has just arrived and has no standing at all — is told plainly
 * that she cannot hold the board yet, and by what route she could.
 *
 * Then Wren vouches for her, and only then does the button exist.
 *
 * **Rule 9.** Every state below is produced by a control. Nothing is written into storage past
 * a screen, which is what this pass is for: the first time this story was attempted, it could
 * not be told at all — see the audit.
 */

async function device(page: Page, callsign: string) {
  await seedDevice(page, { callsign, relayEvents: [] });
  return page;
}

test.describe('a squad grows by one', () => {
  test('the founder can hand over the key, and the newcomer can take it', async ({ browser }) => {
    const wren = await device(await browser.newPage(), 'Wren');
    await open(wren, '/terminal/watch/');

    // Founding needs nobody's permission, because there is nobody to ask.
    await wren.getByRole('button', { name: /start a watch on this phone/i }).click();
    await expect(wren.getByRole('button', { name: /take the watch/i })).toBeVisible();

    // Handed over in person. This is the control that did not exist.
    await wren.getByRole('button', { name: /show the watch key/i }).click();
    const key = (await wren.locator('[data-watch-key]').innerText()).trim();
    expect(key).toMatch(/^[0-9a-f]{64}$/);

    const ash = await device(await browser.newPage(), 'Ash');
    await open(ash, '/terminal/watch/');
    await ash.locator('#key').fill(key);
    await ash.getByRole('button', { name: /^join$/i }).click();

    // Same watch, so the same address — that is what makes it one watch and not two.
    const address = (t: string) => t.replace(/\s+/g, '');
    await expect
      .poll(async () => address(await ash.locator('p.blocks').innerText()))
      .toBe(address(await wren.locator('p.blocks').innerText()));

    await wren.close();
    await ash.close();
  });

  test('and holding the key is not permission to hold the board', async ({ browser }) => {
    /*
     * The gate, from the side it protects. Ash can answer as this watch the moment she has the
     * key — that is what the key is — but *"holding a board means operators go out believing a
     * named human is reading what they send"*, and that is not hers to take on her own say-so
     * while the watch is somebody else's.
     */
    const wren = await device(await browser.newPage(), 'Wren');
    await open(wren, '/terminal/watch/');
    await wren.getByRole('button', { name: /start a watch on this phone/i }).click();
    await wren.getByRole('button', { name: /show the watch key/i }).click();
    const key = (await wren.locator('[data-watch-key]').innerText()).trim();

    const ash = await device(await browser.newPage(), 'Ash');
    await open(ash, '/terminal/watch/');
    await ash.locator('#key').fill(key);
    await ash.getByRole('button', { name: /^join$/i }).click();

    await expect(ash.locator('[data-ungated]')).toBeVisible();
    await expect(ash.getByRole('button', { name: /take the watch/i })).toHaveCount(0);
    // And it says what to do about it, rather than only that she cannot.
    await expect(ash.getByText(/ask somebody who already holds this watch/i)).toBeVisible();

    await wren.close();
    await ash.close();
  });

  test('and one credential, handed over by hand, opens it', async ({ browser }) => {
    const wren = await device(await browser.newPage(), 'Wren');
    await open(wren, '/terminal/watch/');
    await wren.getByRole('button', { name: /start a watch on this phone/i }).click();
    await wren.getByRole('button', { name: /show the watch key/i }).click();
    const key = (await wren.locator('[data-watch-key]').innerText()).trim();

    const ash = await device(await browser.newPage(), 'Ash');
    await open(ash, '/terminal/watch/');
    await ash.locator('#key').fill(key);
    await ash.getByRole('button', { name: /^join$/i }).click();
    await expect(ash.locator('[data-ungated]')).toBeVisible();

    // Wren writes it on her standing screen and hands it over the same way as the key.
    await open(wren, '/terminal/standing/');
    await wren.getByRole('button', { name: /^can take watch$/i }).click();
    const credential = await wren.locator('pre.blob').innerText();

    await open(ash, '/terminal/standing/');
    await ash.locator('#cred').fill(credential);
    await ash.getByRole('button', { name: /take it up/i }).click();
    await expect(ash.locator('[data-endorsement="can-take-watch"]')).toBeVisible();

    await open(ash, '/terminal/watch/');
    const vouchers = ash.locator('[data-vouchers]');
    await expect(vouchers).toBeVisible();
    await expect(vouchers).toContainText(/wren/i);
    // The claim and its limit in one breath. Somebody's word about how she has worked before
    // is not a promise about tonight, and only she can make that one.
    await expect(vouchers).toContainText(/not a\s+promise that you will stay awake tonight/i);
    await expect(ash.getByRole('button', { name: /take the watch/i })).toBeVisible();

    await wren.close();
    await ash.close();
  });

  test('and the gate closes again when the endorser takes it back', async ({ browser }) => {
    /*
     * The direction that matters, and the reason the gate is worth having at all.
     *
     * Somebody who could take the watch yesterday and cannot today has to find that out **on a
     * screen they open**, not at the moment they try — so this walks all the way back to the
     * watch screen and looks for the button to be gone, rather than stopping at the standing
     * screen where the withdrawal is easy to see.
     */
    const wren = await device(await browser.newPage(), 'Wren');
    await open(wren, '/terminal/watch/');
    await wren.getByRole('button', { name: /start a watch on this phone/i }).click();
    await wren.getByRole('button', { name: /show the watch key/i }).click();
    const key = (await wren.locator('[data-watch-key]').innerText()).trim();

    await open(wren, '/terminal/standing/');
    await wren.getByRole('button', { name: /^can take watch$/i }).click();
    const credential = await wren.locator('pre.blob').innerText();

    const ash = await device(await browser.newPage(), 'Ash');
    await open(ash, '/terminal/watch/');
    await ash.locator('#key').fill(key);
    await ash.getByRole('button', { name: /^join$/i }).click();

    await open(ash, '/terminal/standing/');
    await ash.locator('#cred').fill(credential);
    await ash.getByRole('button', { name: /take it up/i }).click();
    await expect(ash.locator('[data-endorsement="can-take-watch"]')).toBeVisible();

    await open(ash, '/terminal/watch/');
    await expect(ash.getByRole('button', { name: /take the watch/i })).toBeVisible();

    // She leaves the phone on the status screen, which is where a withdrawal is heard.
    await open(ash, '/terminal/');

    await wren.locator('[data-withdraw]').first().click();
    await expect(wren.locator('[data-withdraw]')).toHaveCount(0);
    expect(await deliver(wren, ash)).toBeGreaterThan(0);

    await open(ash, '/terminal/watch/');
    await expect(ash.locator('[data-ungated]')).toBeVisible({ timeout: 10_000 });
    await expect(ash.getByRole('button', { name: /take the watch/i })).toHaveCount(0);
    // She still holds the key, and can still answer. Only the board is closed to her.
    await expect(ash.locator('p.blocks')).toBeVisible();

    await wren.close();
    await ash.close();
  });
});
