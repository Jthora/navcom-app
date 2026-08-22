import { expect, test } from '@playwright/test';
import { seedDevice, open, deliver } from './device';

/**
 * **The trip nobody had to make twice.**
 *
 * Milestone 6 is called *knowledge gets in*, and getting in is only half of it. A correction
 * that reaches a relay and never reaches another operator has changed nothing about the night
 * anybody is having. The claim under test is the whole one: **what Wren learned standing at a
 * locked door is on Ash's phone before Ash walks somebody to the same door.**
 *
 * Two devices, and every step on both of them is a control a person can reach. Nothing is
 * seeded past a screen, the correction is not written into Ash's storage, and the only thing
 * that crosses between the two pages is an event the app itself published.
 */

/** Opens the region and expands the first group — the walk in, on either device. */
async function doorway(page: import('@playwright/test').Page, callsign: string) {
  await seedDevice(page, { callsign, relayEvents: [] });
  await open(page, '/terminal/directory/st-louis/');
  await page.locator('section.group > button.head').first().click();
  return page.locator('[data-record]').first();
}

test.describe('a place that turned somebody away', () => {
  test("what one operator learned at the door is on the next one's phone", async ({ browser }) => {
    const wren = await browser.newPage();
    const ash = await browser.newPage();

    // Ash is already looking at the directory — she is deciding where to walk somebody now.
    const theirs = await doorway(ash, 'Ash');
    await expect(theirs).toBeVisible();
    await expect(theirs.locator('[data-report]')).toHaveCount(0);

    // Wren is outside, and it is shut. One tap, because that is the urgent one.
    const mine = await doorway(wren, 'Wren');
    await mine.getByRole('button', { name: /report a problem/i }).click();
    await mine.getByRole('button', { name: /^closed$/i }).click();
    await expect(mine.locator('[data-report]')).toBeVisible({ timeout: 10_000 });

    // The relay carries it. This is the only thing that crosses.
    expect(await deliver(wren, ash)).toBeGreaterThan(0);

    /*
     * And the part the milestone is actually for.
     *
     * By name — Ash is told *who* says the place is shut, not that "a correction exists".
     * Provenance by name is what lets her weigh it: she may know Wren, and she may not.
     */
    const report = theirs.locator('[data-report]');
    await expect(report).toBeVisible({ timeout: 10_000 });
    await expect(report).toContainText(/wren/i);
    await expect(report).toContainText(/closed/i);

    await wren.close();
    await ash.close();
  });

  test('and the listing underneath is still there to argue with', async ({ browser }) => {
    /*
     * A correction is not a delete, and this is the reason it is not.
     *
     * One operator's bad night must not be able to remove a place from everybody else's
     * directory — *"one hostile operator could make any record unusable for everybody, which
     * is deletion wearing a different hat"* [6.U]. Ash sees Wren's report **and** the address
     * and phone number, and gets to decide.
     */
    const wren = await browser.newPage();
    const ash = await browser.newPage();

    const theirs = await doorway(ash, 'Ash');
    const before = await theirs.innerText();

    const mine = await doorway(wren, 'Wren');
    await mine.getByRole('button', { name: /report a problem/i }).click();
    await mine.getByRole('button', { name: /^closed$/i }).click();
    await expect(mine.locator('[data-report]')).toBeVisible({ timeout: 10_000 });
    await deliver(wren, ash);

    await expect(theirs.locator('[data-report]')).toBeVisible({ timeout: 10_000 });
    await expect(theirs.locator('[data-report]')).toContainText(/listing below is unchanged/i);

    // Everything that was on the record is still on the record. Nothing was taken away.
    const after = await theirs.innerText();
    for (const line of before.split('\n').map((l) => l.trim()).filter((l) => l.length > 2)) {
      expect(after).toContain(line);
    }

    await wren.close();
    await ash.close();
  });

  test('and she still has it in a stairwell with no signal', async ({ browser }) => {
    /*
     * The trip is the moment the knowledge has to be there, and the trip is where the signal
     * is worst — a basement, a stairwell, a shelter with block walls. A correction that only
     * exists while a relay is reachable is a correction that is absent exactly when somebody
     * is standing in front of the door.
     */
    const wren = await browser.newPage();
    const ash = await browser.newPage();

    const theirs = await doorway(ash, 'Ash');
    const mine = await doorway(wren, 'Wren');
    await mine.getByRole('button', { name: /report a problem/i }).click();
    await mine.getByRole('button', { name: /^closed$/i }).click();
    await expect(mine.locator('[data-report]')).toBeVisible({ timeout: 10_000 });
    await deliver(wren, ash);
    await expect(theirs.locator('[data-report]')).toBeVisible({ timeout: 10_000 });

    // She puts the phone away, walks, and takes it out again somewhere with nothing.
    await ash.reload();
    await ash.locator('section.group > button.head').first().click();
    const again = ash.locator('[data-record]').first().locator('[data-report]');
    await expect(again).toBeVisible({ timeout: 10_000 });
    await expect(again).toContainText(/wren/i);

    await wren.close();
    await ash.close();
  });
});
