import { expect, test, type Page, type Browser } from '@playwright/test';
import { seedDevice, blankDevice, open } from './device';

/**
 * **The phone that went in the river.**
 *
 * Milestone 9 is *no single point of failure*, and on a network where nobody has an
 * institution behind them, the single point of failure is usually a phone. There is no
 * account, no server holding a copy, and nobody who can give an identity back — so a backup
 * is the only thing between an operator and starting again from nothing.
 *
 * The existing tests prove the blob round-trips and assert on `localStorage`. This asks the
 * question a person actually has: **am I myself again?** Every step is a control, and the
 * second device is genuinely blank — no callsign, no keys, nothing written past a screen.
 */

/** Makes a backup through the screen and returns the blob. */
async function backUp(page: Page, passphrase: string) {
  await open(page, '/terminal/backup/');
  await page.locator('#pass').fill(passphrase);
  await page.getByRole('button', { name: /make a backup/i }).click();
  const blob = await page.locator('pre.blob').innerText();
  expect(blob).not.toContain('Wren');
  return blob;
}

/** A phone nobody has ever used, restoring from a blob. */
async function newPhone(browser: Browser, blob: string, passphrase: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await blankDevice(page);
  await open(page, '/terminal/backup/');
  await page.locator('#rblob').fill(blob);
  await page.locator('#rpass').fill(passphrase);
  await page.getByRole('button', { name: /^restore$/i }).click();
  await expect(page.locator('[data-restored]')).toBeVisible();
  return { page, context };
}

test.describe('starting again on a phone somebody just bought', () => {
  test('the standing she built over years comes back, by name', async ({ browser }) => {
    /*
     * Standing is the thing here that takes longest to build and cannot be reissued — the
     * endorser cannot see whether you claimed theirs, and nobody adjudicates. If it does not
     * survive a lost phone, then what an operator has is *"a decade of standing, lost to"* a
     * dropped handset.
     */
    const owl = await browser.newPage();
    await seedDevice(owl, { callsign: 'Owl', relayEvents: [] });
    await open(owl, '/terminal/standing/');
    await owl.getByRole('button', { name: /^can take watch$/i }).click();
    const credential = await owl.locator('pre.blob').innerText();

    const wren = await browser.newPage();
    await seedDevice(wren, { callsign: 'Wren', relayEvents: [] });
    await open(wren, '/terminal/standing/');
    await wren.locator('#cred').fill(credential);
    await wren.getByRole('button', { name: /take it up/i }).click();
    await expect(wren.locator('[data-endorsement="can-take-watch"]')).toBeVisible();

    const blob = await backUp(wren, 'correct horse battery');
    const { page, context } = await newPhone(browser, blob, 'correct horse battery');

    await open(page, '/terminal/standing/');
    const held = page.locator('[data-endorsement="can-take-watch"]');
    await expect(held).toBeVisible();
    // By name, because that is what a credential is worth: somebody who is recognised.
    await expect(held).toContainText(/from Owl/i);

    await context.close();
    await owl.close();
    await wren.close();
  });

  test('and so does the watch, which is not the same as the phone that held it', async ({ browser }) => {
    /*
     * A squad with no box keeps the watch's identity on somebody's phone, and every operator
     * configured against that address is pointed at it. Losing the phone must not be the watch
     * ending — that would strand everybody signed on under it, which is the failure
     * `joinWatch` already refuses to cause by accident.
     */
    const wren = await browser.newPage();
    await seedDevice(wren, { callsign: 'Wren', relayEvents: [] });
    await open(wren, '/terminal/watch/');
    await wren.getByRole('button', { name: /start a watch on this phone/i }).click();
    await wren.getByRole('button', { name: /show the watch key/i }).click();
    const key = (await wren.locator('[data-watch-key]').innerText()).trim();
    const address = (await wren.locator('p.blocks').innerText()).replace(/\s+/g, '');

    const blob = await backUp(wren, 'correct horse battery');
    const { page, context } = await newPhone(browser, blob, 'correct horse battery');

    await open(page, '/terminal/watch/');
    // The same watch, so the same address — operators pointed at it are not stranded.
    await expect
      .poll(async () => (await page.locator('p.blocks').innerText()).replace(/\s+/g, ''))
      .toBe(address);
    await page.getByRole('button', { name: /show the watch key/i }).click();
    expect((await page.locator('[data-watch-key]').innerText()).trim()).toBe(key);
    // And founding came with it, so she can still hold her own board.
    await expect(page.getByRole('button', { name: /take the watch/i })).toBeVisible();

    await context.close();
    await wren.close();
  });

  test('and tonight does not come back with her', async ({ browser }) => {
    /*
     * The half the screen already claims and nothing had checked past the claim: a backup
     * carries the decade and **not tonight**. If the wipeable tier crossed, restoring a backup
     * would undo a panic wipe somebody meant — the tier exists to be destroyed.
     *
     * The existing test asserts that the screen *says* so. This signs on first, and looks for
     * the patrol on the other side.
     *
     * **What this test can and cannot tell you.** The boundary is defended twice — by what is
     * sealed, and by which tier restore writes into — and breaking *either one alone* leaves
     * this green: a seal that carries tonight is harmless while restore only writes into
     * `accruing`, where nothing reads a patrol. Both had to be broken together before it
     * failed. The seal side is pinned where it can be isolated, in `backup.test.ts`.
     */
    const wren = await browser.newPage();
    await seedDevice(wren, { callsign: 'Wren', relayEvents: [] });
    await open(wren, '/terminal/sign-on/');
    await wren.locator('#area').fill('Downtown');
    await wren.getByRole('button', { name: /^sign on$/i }).click();
    // She is out: the status screen offers the things only somebody out is offered.
    await open(wren, '/terminal/');
    await expect(wren.getByRole('button', { name: /stand down/i })).toBeVisible();

    const blob = await backUp(wren, 'correct horse battery');
    const { page, context } = await newPhone(browser, blob, 'correct horse battery');

    await open(page, '/terminal/');
    // Herself again: the screen offers her a patrol rather than asking who she is. A device
    // with no identity says "pick a callsign" here, and that is what starting over looks like.
    await expect(page.getByRole('link', { name: /^sign on$/i }).first()).toBeVisible();
    await expect(page.getByText(/pick a callsign/i)).toHaveCount(0);
    // ...and not still out on a patrol that ended when the phone did.
    await expect(page.getByRole('button', { name: /stand down/i })).toHaveCount(0);

    await context.close();
    await wren.close();
  });
});
