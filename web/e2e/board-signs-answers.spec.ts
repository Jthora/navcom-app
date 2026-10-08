import { expect, test } from '@playwright/test';
import { seedDevice, open, TEST_SECRET } from './device';

/**
 * A squad member's acknowledgement, signed for themselves [G3; `signals.spec.md`, *The answer
 * signature*].
 *
 * An operator's phone that knows its watch's holders ends a `Distress` only on an answer one of them
 * signed with their own key: the watch key alone is held by every member and everybody who ever was
 * one. The board sent the watch key's signature and nothing else, so every acknowledgement from a
 * phone-held watch read on a current operator's phone as one it could not confirm. This drives the
 * built Watch screen and checks what actually left it, opened as the operator opens it.
 */

const WATCH_SECRET = 'a'.repeat(63) + '3';
const bytes = (hex: string) => Uint8Array.from((hex.match(/../g) ?? []).map((b) => parseInt(b, 16)));

test('an acknowledgement from the board carries the member’s own signature on exactly what it said', async ({ page }) => {
  const { generateSecretKey, finalizeEvent, getPublicKey } = await import('nostr-tools/pure');
  const { buildDistress, open: openSealed, answerSignedByResponder, distressClosure, watchtowerAt } = await import('@navcom/core');
  const W = getPublicKey(bytes(WATCH_SECRET));
  const member = getPublicKey(bytes(TEST_SECRET));
  const hurt = generateSecretKey();
  const squad = watchtowerAt(W, [member]);
  const distress = finalizeEvent(buildDistress(hurt, squad, { position: null, area: 'north side' }, 1_800_000_000), hurt);

  await seedDevice(page, { callsign: 'Wren', watchSecret: WATCH_SECRET, relayEvents: [distress] });
  await open(page, '/terminal/watch/');
  await expect(page.getByRole('heading', { name: 'Distress' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /tell them you are awake/i }).click();
  await page.locator('textarea').fill('awake, on my way');
  await page.getByRole('button', { name: /^send$/i }).click();

  const response = await page.waitForFunction(
    () => ((window as never as { __navcomPublished?: { kind: number }[] }).__navcomPublished ?? []).find((e) => e.kind === 20912) ?? null,
    undefined,
    { timeout: 10_000 }
  );
  const event = (await response.jsonValue()) as unknown as { pubkey: string; content: string; tags: string[][] };
  expect(event.pubkey, 'the answer is still the watch’s').toBe(W);
  const payload = openSealed<{ responder: { pubkey?: string; callsign: string }; sig?: string; text: string }>(hurt, W, event.content);
  expect(payload.responder.pubkey).toBe(member);
  const ids = event.tags.filter((t) => t[0] === 'e').map((t) => t[1]!);
  const about = { watch: W, operator: getPublicKey(hurt), ids };
  expect(answerSignedByResponder(about, payload as never), 'not the member’s own signature on this answer').toBe(true);
  // A key the operator's phone was handed as a holder: what makes it end a Distress there.
  expect(distressClosure(squad).holders).toContain(member);
});
