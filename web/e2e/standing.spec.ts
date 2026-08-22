import { expect, test, type Page } from '@playwright/test';
import { seedDevice, open, deliver } from './device';

/**
 * Vouching for somebody, and taking it back.
 *
 * The unit tests prove the rules; this proves **a person can work them**. Every step below is
 * a control on a screen, including the one step that is not a tap: a credential is handed over
 * *by hand* — the app holds nobody's contact details and cannot deliver anything itself — so
 * the test carries the blob between two devices the way a person would, by copying the text.
 *
 * The only thing that crosses a relay here is the withdrawal, which is the one part that is
 * published.
 */

async function standing(page: Page, callsign: string) {
  await seedDevice(page, { callsign, relayEvents: [] });
  await open(page, '/terminal/standing/');
  return page;
}

/** The scope buttons are labelled by the scope with its dashes removed. */
const WATCH = /^can take watch$/i;

test.describe('vouching for somebody', () => {
  test('hands you something that names nobody at all', async ({ page }) => {
    /*
     * The property everything else follows from. If a credential named its recipient, an
     * endorser could write a record about a person who has never agreed to exist here, and
     * the social graph this design refuses to create would exist after all.
     */
    await standing(page, 'Wren');
    await page.getByRole('button', { name: WATCH }).click();

    const blob = await page.locator('pre.blob').innerText();
    const credential = JSON.parse(blob) as { tags: string[][]; content: string; pubkey: string };

    // No `p` tag, no tag of any kind. There is nowhere for a subject to go.
    expect(credential.tags).toEqual([]);
    // And the content carries a scope, the endorser's own callsign, and a date. Nothing else.
    expect(Object.keys(JSON.parse(credential.content)).sort()).toEqual(['at', 'endorser', 'scope']);
  });

  test('and says out loud that whoever holds the bytes can take it up', async ({ page }) => {
    // The cost of naming nobody, stated on the screen where somebody is about to pay it —
    // not in a document they will never open.
    await standing(page, 'Wren');
    await expect(page.getByText(/whoever holds the bytes can take it up/i)).toBeVisible();
    await expect(page.getByText(/you will not\s+be told when they do/i)).toHaveCount(0);

    await page.getByRole('button', { name: WATCH }).click();
    await expect(page.getByText(/you will not\s+be told when they do/i)).toBeVisible();
  });
});

test.describe('taking one up', () => {
  test('needs no network, no account and nobody\'s approval', async ({ browser }) => {
    const wren = await standing(await browser.newPage(), 'Wren');
    await wren.getByRole('button', { name: WATCH }).click();
    const blob = await wren.locator('pre.blob').innerText();

    // Handed over however the two of them already talk. Nothing crosses a relay.
    const ash = await standing(await browser.newPage(), 'Ash');
    await expect(ash.getByText(/nothing yet, and that is the ordinary starting point/i)).toBeVisible();

    await ash.locator('#cred').fill(blob);
    await ash.getByRole('button', { name: /take it up/i }).click();

    const held = ash.locator('[data-endorsement="can-take-watch"]');
    await expect(held).toBeVisible();
    // By name, because recognising who vouched is the whole basis for weighing it.
    await expect(held).toContainText(/from Wren/i);
    await expect(held).toContainText(/0 days ago/i);

    await wren.close();
    await ash.close();
  });

  test('and a credential dated in the future is shown as unweighable, not as fresh', async ({ page }) => {
    /*
     * Somebody can hand you anything, and the paste box is where anything arrives.
     *
     * This rendered **"0 days ago" — the freshest possible — and never aged**, which defeats
     * the one mechanism used here instead of expiry: show the age and let the reader weigh it.
     */
    const { writeCredential } = await import('@navcom/core');
    const { generateSecretKey } = await import('nostr-tools/pure');
    const forward = writeCredential(
      generateSecretKey(),
      { scope: 'can-take-watch', endorser: 'Owl', at: '2099-01-01' },
      Math.floor(Date.now() / 1000)
    );

    await standing(page, 'Ash');
    await page.locator('#cred').fill(JSON.stringify(forward));
    await page.getByRole('button', { name: /take it up/i }).click();

    const held = page.locator('[data-endorsement="can-take-watch"]');
    await expect(held).toBeVisible();
    await expect(held.locator('[data-unweighable]')).toContainText(/not an age you can weigh/i);
    await expect(held).not.toContainText(/0 days ago/i);
  });

  test('and rubbish in the box is an error on the screen, not a broken page', async ({ page }) => {
    await standing(page, 'Ash');
    await page.locator('#cred').fill('here you go mate');
    await page.getByRole('button', { name: /take it up/i }).click();

    await expect(page.locator('p.error')).toBeVisible();
    await expect(page.locator('[data-endorsement]')).toHaveCount(0);
    // Still usable afterwards — the paste box is the one place hostile input arrives.
    await expect(page.locator('#cred')).toBeVisible();
  });

  test('and putting one down leaves nothing behind', async ({ page }) => {
    await standing(page, 'Wren');
    await page.getByRole('button', { name: WATCH }).click();
    const blob = await page.locator('pre.blob').innerText();

    await page.locator('#cred').fill(blob);
    await page.getByRole('button', { name: /take it up/i }).click();
    await expect(page.locator('[data-endorsement]')).toHaveCount(1);

    await page.getByRole('button', { name: /put down/i }).click();
    await expect(page.locator('[data-endorsement]')).toHaveCount(0);
  });
});

test.describe('taking it back', () => {
  test('reaches the holder, and tells them who to ask', async ({ browser }) => {
    /*
     * `can-take-watch` is the gate on holding a board, so *"somebody who could take the watch
     * yesterday and cannot today must find that out on a screen they open, not at the moment
     * they try."*
     *
     * The subscription runs from the status screen rather than this one, for that exact
     * reason — a holder who never opens their standing must still stop relying on it. So this
     * walks the same way: Ash is on the status screen when the withdrawal lands.
     */
    const wren = await standing(await browser.newPage(), 'Wren');
    await wren.getByRole('button', { name: WATCH }).click();
    const blob = await wren.locator('pre.blob').innerText();

    const ash = await standing(await browser.newPage(), 'Ash');
    await ash.locator('#cred').fill(blob);
    await ash.getByRole('button', { name: /take it up/i }).click();
    await expect(ash.locator('[data-endorsement="can-take-watch"]')).toBeVisible();

    // Ash puts the phone away on the screen she actually leaves it on.
    await open(ash, '/terminal/');

    // Wren decides otherwise.
    await wren.locator('[data-withdraw]').first().click();
    // The row goes when the withdrawal has actually been made — waiting on the screen rather
    // than on a timer, and `deliver` reads what was published, which is not there yet if the
    // click has only been dispatched.
    await expect(wren.locator('[data-withdraw]')).toHaveCount(0);
    expect(await deliver(wren, ash)).toBeGreaterThan(0);

    await open(ash, '/terminal/standing/');
    const gone = ash.locator('[data-withdrawn]');
    await expect(gone).toBeVisible({ timeout: 10_000 });
    await expect(gone).toContainText(/wren/i);
    await expect(gone).toContainText(/no longer counts for\s+anything/i);
    // And it is not still sitting in what she holds.
    await expect(ash.locator('[data-endorsement="can-take-watch"]')).toHaveCount(0);

    await wren.close();
    await ash.close();
  });

  test('and a stranger cannot do it on the endorser\'s behalf', async ({ browser }) => {
    /*
     * The same attack as the unit test, driven through the screens: a credential is handed
     * over in the open, so its endorser's key and its id are known to anybody who has seen it.
     * Only the signature is out of reach.
     *
     * **What this test can and cannot tell you.** The forged revocation is stopped in three
     * separate places — the subscription asks only for the endorsers whose credentials are
     * held, the ingest checks `isRevokedBy`, and `held()` checks it again when reading. Any
     * *one* of those can be deleted and this test still passes; it only fails when all three
     * are gone, which was measured rather than assumed.
     *
     * So it is worth having as a statement that the attack does not land through the app, and
     * it is **not** what proves our own signature check exists. That is `endorsement.test.ts`,
     * where the check can be isolated. An end-to-end test cannot see which layer saved it.
     */
    const wren = await standing(await browser.newPage(), 'Wren');
    await wren.getByRole('button', { name: WATCH }).click();
    const blob = await wren.locator('pre.blob').innerText();

    const ash = await standing(await browser.newPage(), 'Ash');
    await ash.locator('#cred').fill(blob);
    await ash.getByRole('button', { name: /take it up/i }).click();
    await expect(ash.locator('[data-endorsement="can-take-watch"]')).toBeVisible();
    await open(ash, '/terminal/');

    // Somebody else publishes a revocation naming that credential, signed by themselves.
    const { revoke } = await import('@navcom/core');
    const { generateSecretKey } = await import('nostr-tools/pure');
    const forged = revoke(generateSecretKey(), JSON.parse(blob).id, Math.floor(Date.now() / 1000));
    await ash.evaluate(
      (e) => (window as unknown as { __navcomDeliver: (x: unknown) => number }).__navcomDeliver(e),
      JSON.parse(JSON.stringify(forged))
    );

    await open(ash, '/terminal/standing/');
    await expect(ash.locator('[data-endorsement="can-take-watch"]')).toBeVisible();
    await expect(ash.locator('[data-withdrawn]')).toHaveCount(0);

    await wren.close();
    await ash.close();
  });
});
