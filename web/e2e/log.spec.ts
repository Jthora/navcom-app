import { expect, test } from '@playwright/test';
import { seedDevice, open, TEST_SECRET, answerNextSignal } from './device';

/**
 * Your record — what the watch has written about you [C33].
 *
 * Until this file existed, nothing exercised the three verdict states this screen exists to
 * tell apart: a root this device actually saw published, a root the watch only handed over
 * with its own answer (worth nothing), and entries that do not verify at all. All three are
 * easy to get right in the logic and wrong in the wiring — which is exactly the failure mode
 * `docs/verification.md` names, and exactly why this screen had zero browser coverage before.
 */

const mine = () => Uint8Array.from((TEST_SECRET.match(/../g) ?? []).map((b) => parseInt(b, 16)));

async function up(watchSecret: Uint8Array) {
  const { finalizeEvent, getPublicKey } = await import('nostr-tools/pure');
  const { buildWatchStateEvent } = await import('@navcom/core');
  const now = Math.floor(Date.now() / 1000);
  return finalizeEvent(
    buildWatchStateEvent(
      {
        state: 'station',
        since: now - 600,
        holder: 'Watchtower',
        holder_kind: 'node',
        oncall: [],
        agent_health: 'ok',
        last_drill: null,
        now
      } as never,
      now
    ),
    watchSecret
  );
}

/** A one-entry log about the operator, its root, and a review answering with it. */
async function reviewFixture() {
  const { getPublicKey } = await import('nostr-tools/pure');
  const { emptyLog, appendEntry, merkleRoot, inclusionProof } = await import('@navcom/core');
  const me = getPublicKey(mine());
  const node = { kind: 'agent' as const, callsign: 'watchtower', pubkey: 'c'.repeat(64) };
  const log = appendEntry(emptyLog(), {
    at: 1_800_000_000,
    actor: node,
    action: 'acked',
    subject: { kind: 'human' as const, pubkey: me },
    outcome: 'acknowledged'
  });
  const root = merkleRoot(log, 0);
  const entries = [{ entry: log[0]!, proof: inclusionProof(log, 0) }];
  return { root, entries };
}

async function replyBuilder(watchSecret: Uint8Array, payload: Record<string, unknown>) {
  const { finalizeEvent, getPublicKey } = await import('nostr-tools/pure');
  const { buildResponse } = await import('@navcom/core');
  return (signal: { id: string; created_at: number }) =>
    finalizeEvent(
      buildResponse(watchSecret, getPublicKey(mine()), signal.id, payload as never, signal.created_at + 1),
      watchSecret
    );
}

test.describe('what a check here can and cannot tell you', () => {
  test('says both limits before anything is asked', async ({ page }) => {
    await seedDevice(page, { callsign: 'Wren' });
    await open(page, '/terminal/log/');

    await expect(
      page.getByText(/never against one the watch hands over with its own answer/i)
    ).toBeVisible();
    await expect(page.getByText(/cannot tell you whether anything is missing/i)).toBeVisible();
  });
});

test.describe('checking the watch\'s record of you', () => {
  test('a root this device actually saw is Checked', async ({ page }) => {
    const { getPublicKey, generateSecretKey } = await import('nostr-tools/pure');
    const watchSecret = generateSecretKey();
    const { root, entries } = await reviewFixture();
    const reply = await replyBuilder(watchSecret, {
      type: 'log-review',
      responder: { kind: 'agent', callsign: 'watchtower' },
      text: null,
      provenance: null,
      review: { root, entries, more: false }
    });

    await seedDevice(page, {
      callsign: 'Wren',
      watchtower: { pubkey: getPublicKey(watchSecret), relays: ['wss://fake.relay'] },
      relayEvents: [await up(watchSecret)],
      accruing: { seen_roots: [root] }
    });
    await open(page, '/terminal/log/');
    await page.getByRole('button', { name: /ask the watch/i }).click();
    await answerNextSignal(page, reply);

    await expect(page.locator('[data-verdict="verified"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/1 entry/i)).toBeVisible();
  });

  test('a root only the watch ever showed us is Not checked', async ({ page }) => {
    const { getPublicKey, generateSecretKey } = await import('nostr-tools/pure');
    const watchSecret = generateSecretKey();
    const { root, entries } = await reviewFixture();
    const reply = await replyBuilder(watchSecret, {
      type: 'log-review',
      responder: { kind: 'agent', callsign: 'watchtower' },
      text: null,
      provenance: null,
      review: { root, entries, more: false }
    });

    // No `seen_roots` seeded at all -- this device never saw the commitment published.
    await seedDevice(page, {
      callsign: 'Wren',
      watchtower: { pubkey: getPublicKey(watchSecret), relays: ['wss://fake.relay'] },
      relayEvents: [await up(watchSecret)]
    });
    await open(page, '/terminal/log/');
    await page.getByRole('button', { name: /ask the watch/i }).click();
    await answerNextSignal(page, reply);

    const verdict = page.locator('[data-verdict="unchecked"]');
    await expect(verdict).toBeVisible({ timeout: 10_000 });
    await expect(verdict).toContainText(/marking its own homework/i);
  });

  test('an entry that does not verify against a seen root Did not check out', async ({ page }) => {
    const { getPublicKey, generateSecretKey } = await import('nostr-tools/pure');
    const watchSecret = generateSecretKey();
    const { root, entries } = await reviewFixture();
    // Content swapped after the proof was taken -- the exact forgery merkle.test.ts covers
    // at the logic layer. Here it is the screen's job to say so.
    const tampered = [{ ...entries[0]!, entry: { ...entries[0]!.entry, outcome: 'contact-made' } }];
    const reply = await replyBuilder(watchSecret, {
      type: 'log-review',
      responder: { kind: 'agent', callsign: 'watchtower' },
      text: null,
      provenance: null,
      review: { root, entries: tampered, more: false }
    });

    await seedDevice(page, {
      callsign: 'Wren',
      watchtower: { pubkey: getPublicKey(watchSecret), relays: ['wss://fake.relay'] },
      relayEvents: [await up(watchSecret)],
      accruing: { seen_roots: [root] }
    });
    await open(page, '/terminal/log/');
    await page.getByRole('button', { name: /ask the watch/i }).click();
    await answerNextSignal(page, reply);

    await expect(page.locator('[data-verdict="failed"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/not a glitch/i)).toBeVisible();
  });
});
