import { expect, test } from '@playwright/test';
import { seedDevice, open, TEST_SECRET } from './device';

/**
 * Several teams on one watch, as the NYC night will have them (2026-11-02).
 *
 * The board did not know there were teams: a sign-on carried a callsign and an area, so four crews'
 * twenty people were one list, and two of them called Owl were two identical rows. A sign-on now
 * carries the team the operator typed, the board says it beside each name, a name two operators
 * share shows each one's key print, and the holder can narrow the list to one team — never hiding a
 * Distress or anybody past their time, the rows a watch exists to see.
 */

const WATCH_SECRET = '6'.repeat(63) + '7';
const bytes = (hex: string) => Uint8Array.from((hex.match(/../g) ?? []).map((b) => parseInt(b, 16)));

/** A signal from `sender`, sealed to this phone as the watch's holder, said at `at`. */
async function signal(sender: Uint8Array, type: 'on-station' | 'query' | 'distress', payload: Record<string, unknown>, at: number) {
  const { finalizeEvent, getPublicKey } = await import('nostr-tools/pure');
  const { buildDistress, buildSignal } = await import('@navcom/core');
  const to = { pubkey: getPublicKey(bytes(WATCH_SECRET)), holders: [getPublicKey(bytes(TEST_SECRET))] };
  const built = type === 'distress' ? buildDistress(sender, to, payload as never, at) : buildSignal(sender, to, type, payload as never, at);
  return finalizeEvent(built, sender);
}

const out = (callsign: string, team: string, area: string, expected_duration = 3600) => ({
  callsign, team, area, expected_duration, routine_interval: null, share_position: false, position: null
});

test.describe('a watch several teams share', () => {
  test('says each operator’s team, tells two Owls apart, and narrows to one team without hiding who is late', async ({ page }) => {
    const { generateSecretKey } = await import('nostr-tools/pure');
    const now = Math.floor(Date.now() / 1000);
    const [owlZ, owlR, kite, cedar, dove] = [generateSecretKey(), generateSecretKey(), generateSecretKey(), generateSecretKey(), generateSecretKey()];
    await seedDevice(page, {
      callsign: 'Wren',
      watchSecret: WATCH_SECRET,
      relayEvents: [
        await signal(owlZ, 'on-station', out('Owl', 'Zone Guardians', 'Herald Sq'), now - 60),
        await signal(owlR, 'on-station', out('Owl', 'Rescue Rangers', 'Penn Station'), now - 60),
        await signal(kite, 'on-station', out('Kite', 'rescue rangers', '8th Ave'), now - 60),
        // Out for ten minutes, two hours ago: past their time.
        await signal(cedar, 'on-station', out('Cedar', 'Zone Guardians', 'Times Sq', 600), now - 7200),
        await signal(kite, 'query', { text: 'somewhere warm near Penn', area: '8th Ave' }, now - 30),
        await signal(owlZ, 'query', { text: 'water at Herald Sq', area: 'Herald Sq' }, now - 20),
        await signal(dove, 'on-station', out('Dove', 'Zone Guardians', 'Bryant Park'), now - 60),
        await signal(dove, 'distress', { position: null, area: 'Bryant Park' }, now - 10)
      ]
    });
    await open(page, '/terminal/watch/');

    const rows = page.locator('[data-floor] .nc-floor-row');
    await expect(rows).toHaveCount(5, { timeout: 15_000 });
    await expect(rows.filter({ hasText: 'Kite' }).locator('[data-floor-team]')).toHaveText('rescue rangers');
    await expect(rows.filter({ hasText: 'Cedar' }).locator('[data-floor-team]')).toHaveText('Zone Guardians');

    // Two Owls: each row shows a print of its own key, and a name nobody shares shows none.
    const owls = rows.filter({ hasText: 'Owl' });
    await expect(owls).toHaveCount(2);
    const prints = await owls.locator('[data-floor-print]').allTextContents();
    expect(prints).toHaveLength(2);
    for (const p of prints) expect(p).toMatch(/^[0-9a-f]{4}( [0-9a-f]{4}){3}$/);
    expect(prints[0]).not.toBe(prints[1]);
    await expect(rows.filter({ hasText: 'Kite' }).locator('[data-floor-print]')).toHaveCount(0);

    // The question is under the name its asker signed on with, beside their team, and asking
    // somebody late to check in names their team too.
    const question = page.locator('li:has-text("somewhere warm near Penn")');
    await expect(question.locator('.name')).toHaveText('Kite');
    await expect(question.locator('[data-ask-team]')).toHaveText('rescue rangers');
    await expect(page.getByRole('button', { name: 'Ask Cedar (Zone Guardians) to check in' })).toBeVisible();

    // Narrowed to one team, typed two ways: that team, Cedar, who is past their time, and Dove, in
    // Distress. Two holders split a night's teams this way.
    const teams = page.locator('[data-teams] button');
    await expect(teams).toHaveText(['All', 'Rescue Rangers', 'Zone Guardians']);
    await teams.filter({ hasText: 'Rescue Rangers' }).click();
    await expect(rows).toHaveCount(4);
    await expect(rows.filter({ hasText: 'Herald Sq' })).toHaveCount(0);
    await expect(rows.filter({ hasText: 'Times Sq' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Bryant Park' })).toHaveCount(1);
    await expect(teams.filter({ hasText: 'Rescue Rangers' })).toHaveAttribute('aria-pressed', 'true');

    // What waits on the other team is named, not hidden; the Distress is not narrowed at all.
    await expect(page.getByText('somewhere warm near Penn')).toBeVisible();
    await expect(page.getByText('water at Herald Sq')).toHaveCount(0);
    await expect(page.locator('[data-also-waiting]')).toContainText('Owl (Zone Guardians)');
    await expect(page.locator('section.urgent')).toContainText('Dove');

    // Both teams chosen is everything again, and so is All.
    await teams.filter({ hasText: 'Zone Guardians' }).click();
    await expect(rows).toHaveCount(5);
    await expect(page.getByText('water at Herald Sq')).toBeVisible();
    await expect(page.locator('[data-also-waiting]')).toHaveCount(0);
    await teams.filter({ hasText: 'All' }).click();
    await expect(teams.filter({ hasText: 'All' })).toHaveAttribute('aria-pressed', 'true');
    await expect(rows).toHaveCount(5);
  });

  test('a sign-on takes a team, Status shows it, and the next sign-on offers it again', async ({ page }) => {
    await seedDevice(page, { callsign: 'Kite' });
    await open(page, '/terminal/sign-on/');
    await page.getByLabel('Area').fill('Penn Station');
    await page.getByLabel('Team').fill('Rescue Rangers');
    await page.getByRole('button', { name: 'Sign on' }).click();
    await expect(page.locator('[data-station]')).toContainText('Rescue Rangers', { timeout: 10_000 });

    await open(page, '/terminal/sign-on/');
    await expect(page.getByLabel('Team')).toHaveValue('Rescue Rangers');
  });
});
