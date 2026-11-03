import { expect, test } from '@playwright/test';
import { seedDevice, open, TEST_SECRET } from './device';

/**
 * An Assist passed on to whoever is close, and taken up in one tap (2026-11-02).
 *
 * On a night several teams patrol one crowd, *I need someone, now* at Penn Station went to everybody
 * on the board, the cleanup crew fifteen blocks north included, and whoever could go had no way to
 * say so but to type a question. The holder can now pass it to the nearest few of those who share
 * where they are, and the operator it reaches can say *I can go*: their own question back to the
 * watch, which the watch answers like any other.
 */

const bytes = (hex: string) => Uint8Array.from((hex.match(/../g) ?? []).map((b) => parseInt(b, 16)));
const WATCH_SECRET = '3'.repeat(63) + '7';

test.describe('an Assist that needs somebody now', () => {
  test('the holder passes it to the nearest few who share where they are, and to nobody further', async ({ page }) => {
    const { finalizeEvent, generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const { buildSignal } = await import('@navcom/core');
    const to = { pubkey: getPublicKey(bytes(WATCH_SECRET)), holders: [getPublicKey(bytes(TEST_SECRET))] };
    const now = Math.floor(Date.now() / 1000);
    const out = (key: Uint8Array, callsign: string, at: { lat: number; lon: number } | null) =>
      finalizeEvent(
        buildSignal(key, to, 'on-station', {
          callsign, area: 'Midtown', expected_duration: 3600, routine_interval: null,
          share_position: at !== null, position: at ? { ...at, precision_m: 0 } : null
        }, now - 60),
        key
      );
    const owl = generateSecretKey();
    await seedDevice(page, {
      callsign: 'Vale',
      watchSecret: WATCH_SECRET,
      relayEvents: [
        out(owl, 'Owl', { lat: 40.7506, lon: -73.9935 }),
        out(generateSecretKey(), 'Herald', { lat: 40.7497, lon: -73.9877 }),
        out(generateSecretKey(), 'Bryant', { lat: 40.7536, lon: -73.9832 }),
        out(generateSecretKey(), 'Times', { lat: 40.758, lon: -73.9855 }),
        out(generateSecretKey(), 'Harlem', { lat: 40.8116, lon: -73.9465 }),
        out(generateSecretKey(), 'Quiet', null),
        finalizeEvent(
          buildSignal(owl, to, 'assist', { urgency: 'now', area: 'Penn Station', position: { lat: 40.7506, lon: -73.9935, precision_m: 0 } }, now - 10),
          owl
        )
      ]
    });
    await open(page, '/terminal/watch/');
    await expect(page.locator('[data-floor] .nc-floor-row')).toHaveCount(6, { timeout: 15_000 });

    await expect(page.locator('[data-pass-on]')).toHaveText('Pass to the others out');
    await page.locator('[data-pass-near]').click();
    const label = page.getByText(/^To /).first();
    await expect(label).toContainText('Herald');
    await expect(label).toContainText('Bryant');
    await expect(label).toContainText('Times');
    await expect(label).not.toContainText('Harlem');
    await page.getByRole('button', { name: 'Pass on', exact: true }).click();
    const passed = page.locator('[data-passed]');
    await expect(passed).toContainText(/Herald/, { timeout: 10_000 });
    await expect(passed).not.toContainText(/Harlem|Quiet|Owl/);
  });

  test('the operator it reaches says they can go in one tap, as a question back to the watch', async ({ page }) => {
    const { finalizeEvent, getPublicKey } = await import('nostr-tools/pure');
    const { buildResponse, openFromGroup } = await import('@navcom/core');
    const watch = bytes(WATCH_SECRET);
    const me = bytes(TEST_SECRET);
    await seedDevice(page, {
      callsign: 'Herald',
      // Held on phones: the holder is a phone whose key this test holds, so it can read what is asked.
      watchtower: { pubkey: getPublicKey(watch), relays: ['wss://fake.relay'], holders: [getPublicKey(watch)] },
      relayEvents: []
    });
    const now = Math.floor(Date.now() / 1000);
    await page.addInitScript((s) => {
      localStorage.setItem('navcom.wipeable', JSON.stringify({ signon: s }));
    }, { at: now - 600, area: 'Herald Sq', expectedUntil: now + 3600, toldAtSignOn: '', routineInterval: null });
    await open(page, '/terminal/');

    const offer = finalizeEvent(
      buildResponse(watch, getPublicKey(me), 'e'.repeat(64), {
        type: 'passed-on', responder: { kind: 'human', callsign: 'Vale' }, text: 'Owl asks for someone near Penn Station, now.', provenance: null
      }, now),
      watch
    );
    await page.evaluate((e) => (window as unknown as { __navcomDeliver: (x: unknown) => number }).__navcomDeliver(e), offer);
    await expect(page.locator('[data-passed-on-text]')).toHaveText('Owl asks for someone near Penn Station, now.', { timeout: 10_000 });

    await page.locator('[data-can-go]').click();
    await expect(page.locator('[data-going]')).toContainText('Told the watch', { timeout: 10_000 });
    const asked = (await page.evaluate(() => (globalThis as unknown as { __navcomPublished?: unknown[] }).__navcomPublished ?? [])) as {
      kind: number; tags: string[][]; content: string;
    }[];
    const query = asked.find((e) => e.kind === 20910 && e.tags.some((t) => t[0] === 't' && t[1] === 'query'));
    expect(query, 'no question went to the watch').toBeTruthy();
    const said = openFromGroup<{ text: string }>(watch, getPublicKey(me), query!.content);
    expect(said.text).toBe('I can go: Owl asks for someone near Penn Station, now.');
  });
});
