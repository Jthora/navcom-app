import { expect, test } from '@playwright/test';
import { seedDevice, open, TEST_SECRET } from './device';

/**
 * What an operator is told about their peers.
 *
 * Each device draws this itself from what it can decrypt — no watch is in the path and
 * nothing persists it. Four claims live here and nowhere else, and none had ever been
 * rendered from a real event:
 *
 * - Silence is **named**, not hidden. Leaving a quiet peer off the list would read as *"not
 *   out"*, which is a claim nobody made [invariant 3]
 * - *"Nothing heard is not the same as home"*, said out loud
 * - Overdue is a **nudge**. Nothing escalates from it — no page, no ladder, no contact
 * - Who is watching you is **only what somebody said**, never inferred from you watching them
 */

const mine = () => Uint8Array.from((TEST_SECRET.match(/../g) ?? []).map((b) => parseInt(b, 16)));

/** A peer's heartbeat, sealed to this operator, as a relay would deliver it. */
async function heartbeat(
  peer: Uint8Array,
  payload: Record<string, unknown>
): Promise<unknown> {
  const { getPublicKey } = await import('nostr-tools/pure');
  const { buildPresence } = await import('@navcom/core');
  const now = Math.floor(Date.now() / 1000);
  return buildPresence(peer, [getPublicKey(mine())], {
    callsign: 'Raven', status: 'out', area: 'north side', until: now + 3600, ...payload
  } as never, now)[0];
}

async function withPeer(page: import('@playwright/test').Page, events: unknown[], peerPub: string) {
  await seedDevice(page, {
    callsign: 'Wren',
    peers: [{ pubkey: peerPub, callsign: 'Raven', since: 1_800_000_000 }],
    relayEvents: events
  });
}

test.describe('what this device says about a peer', () => {
  test('shows them out, with the area they gave', async ({ page }) => {
    const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const raven = generateSecretKey();
    await withPeer(page, [await heartbeat(raven, {})], getPublicKey(raven));
    await open(page, '/terminal/');

    const peers = page.locator('[data-peers]');
    await expect(peers).toBeVisible({ timeout: 10_000 });
    await expect(peers).toContainText('Raven');
    await expect(peers).toContainText(/is out/);
    await expect(peers).toContainText(/north side/);
  });

  test('names a peer it has heard nothing from, rather than leaving them off', async ({ page }) => {
    // Invariant 3. Hiding them would read as "not out", which is a claim nobody made.
    const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const raven = generateSecretKey();
    await withPeer(page, [], getPublicKey(raven));
    await open(page, '/terminal/');

    const peers = page.locator('[data-peers]');
    await expect(peers).toBeVisible({ timeout: 10_000 });
    await expect(peers).toContainText('Raven');
    await expect(peers).toContainText(/nothing heard/i);
    await expect(peers).toContainText(/nothing\s+heard\s+is\s+not\s+the\s+same\s+as\s+home/i);
  });

  test('says somebody is watching only when they said so', async ({ page }) => {
    const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const raven = generateSecretKey();
    await withPeer(page, [await heartbeat(raven, { watching: true })], getPublicKey(raven));
    await open(page, '/terminal/');

    const watching = page.locator('[data-watching-you]');
    await expect(watching).toBeVisible({ timeout: 10_000 });
    await expect(watching).toContainText('Raven');
    await expect(watching).toContainText(/watching for you tonight/i);
  });

  test('and never infers it from a peer simply being out', async ({ page }) => {
    // Two people can each assume the other is keeping an eye out. Assuming a symmetry nobody
    // agreed to is exactly how somebody ends up watched by nobody.
    const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const raven = generateSecretKey();
    await withPeer(page, [await heartbeat(raven, { watching: false })], getPublicKey(raven));
    await open(page, '/terminal/');

    await expect(page.locator('[data-peers]')).toContainText('Raven', { timeout: 10_000 });
    await expect(page.locator('[data-watching-you]')).toHaveCount(0);
  });

  test('never turns a quiet peer into an alarm', async ({ page }) => {
    // Nothing escalates from presence. No page, no ladder, no contact — people are late for
    // ordinary reasons far more often than dangerous ones.
    const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const raven = generateSecretKey();
    await withPeer(page, [], getPublicKey(raven));
    await open(page, '/terminal/');

    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/alarm|emergency|escalat/i);
  });
});
