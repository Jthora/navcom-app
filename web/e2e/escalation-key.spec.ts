import { expect, test, type Page } from '@playwright/test';
import { seedDevice, open, readDevice, TEST_SECRET, answerNextSignal } from './device';

/**
 * The escalation executor's own key, on a phone [G3; `escalation.spec.md`, *Who may close a
 * Distress*].
 *
 * The executor's key is the only one whose answer ends a `Distress` on a box: not the daemon's, which
 * the agent runs beside, and not the watch key, which every squad member and every former one holds.
 * A phone had nowhere to keep it, so every operator's `Distress` ended on an answer anything holding
 * the watch key could send. These follow it from the code it arrives in, through Setup and Status,
 * to the Distress screen, where an answer it cannot attribute is said and never taken as "has it".
 */

const mine = () => Uint8Array.from((TEST_SECRET.match(/../g) ?? []).map((b) => parseInt(b, 16)));

async function keys() {
  const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
  const watch = generateSecretKey();
  const executor = generateSecretKey();
  return { watch, executor, W: getPublicKey(watch), X: getPublicKey(executor) };
}

type Keys = Awaited<ReturnType<typeof keys>>;

/** A watch code the watch signed, as a link. */
async function codeFor(k: Keys, fields: { executor?: string; relays?: string[] } = {}) {
  const { watchCode } = await import('../src/lib/terminal/watch-code');
  return watchCode({ pubkey: k.W, relays: fields.relays ?? ['wss://watch.example'], holders: [], executor: fields.executor }, k.watch);
}

/** What a phone keeps for a watch whose escalation key it was given: the signed code, from `watch=` on. */
async function kept(k: Keys, relays = ['wss://fake.relay']) {
  return { watch_escalation: (await codeFor(k, { executor: k.X, relays })).split('#')[1]! };
}

/** A 20912 from `author`, sealed by it to this phone, saying a person has it. */
async function humanFrom(author: Uint8Array) {
  const { finalizeEvent, getPublicKey } = await import('nostr-tools/pure');
  const { buildResponse } = await import('@navcom/core');
  return (signal: { id: string; created_at: number }) =>
    finalizeEvent(
      buildResponse(author, getPublicKey(mine()), signal.id, {
        type: 'ack',
        responder: { kind: 'human', callsign: 'Raven' },
        text: 'awake, on my way',
        provenance: null
      }, signal.created_at + 1),
      author
    );
}

async function raiseDistress(page: Page) {
  await page.locator('button.raise').dispatchEvent('pointerdown');
  await page.waitForFunction(
    () => (((window as never as { __navcomPublished?: { kind: number }[] }).__navcomPublished) ?? []).some((e) => e.kind === 20911),
    undefined,
    { timeout: 15_000 }
  );
}

test.describe('a watch code, on Setup', () => {
  test('fills in the watch and keeps its escalation key, which has no field of its own', async ({ page }) => {
    const k = await keys();
    await seedDevice(page, { callsign: 'Wren' });
    await open(page, '/terminal/setup/');
    await page.locator('#code').fill(`Here: ${await codeFor(k, { executor: k.X })}.`);
    await page.getByRole('button', { name: 'Fill in from the code' }).click();
    await expect(page.locator('#pubkey')).toHaveValue(k.W);
    await expect(page.locator('#relays')).toHaveValue('wss://watch.example');
    await expect(page.locator('[data-escalation-key="named"]')).toContainText(k.X.slice(0, 4));
    await expect(page.locator('[data-escalation-key="named"]')).toContainText(/signed by the watch on \d{4}-\d{2}-\d{2}/);
    await page.getByRole('button', { name: 'Connect' }).click();
    await expect.poll(async () => String((await readDevice(page)).accruing['watch_escalation'] ?? '')).toContain(`x=${k.X}`);
    expect((await readDevice(page)).accruing['watchtower']).toBe(k.W);
  });

  test('fills in nothing from a code the watch did not sign [review: live hole, phone]', async ({ page }) => {
    const k = await keys();
    const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const stranger = getPublicKey(generateSecretKey());
    await seedDevice(page, { callsign: 'Wren' });
    await open(page, '/terminal/setup/');
    // The watch's own code, its escalation key swapped for a stranger's, as anybody could post it.
    const forged = (await codeFor(k, { executor: k.X })).replace(`x=${k.X}`, `x=${stranger}`);
    await page.locator('#code').fill(forged);
    await page.getByRole('button', { name: 'Fill in from the code' }).click();
    await expect(page.locator('[data-code-error]')).toContainText(/not signed by the watch/);
    await expect(page.locator('#pubkey')).toHaveValue('');
  });

  test('opens filled in from a watch code’s link, and saves nothing until the operator does', async ({ page }) => {
    const k = await keys();
    await seedDevice(page, { callsign: 'Wren' });
    const link = await codeFor(k, { executor: k.X });
    await open(page, `/terminal/setup/#${link.split('#')[1]}`);
    await expect(page.locator('#pubkey')).toHaveValue(k.W);
    await expect(page.locator('[data-escalation-key="named"]')).toBeVisible();
    expect((await readDevice(page)).accruing['watchtower']).toBeUndefined();
  });

  test('asks before a code adds an escalation key to the watch saved here, and says what else it changes', async ({ page }) => {
    // Every box's operators have no key saved today: a code naming one for their own watch is where a
    // key that is not the watch's would arrive, so adding one asks as loudly as replacing one.
    const k = await keys();
    await seedDevice(page, { callsign: 'Wren', watchtower: { pubkey: k.W, relays: ['wss://watch.example'] } });
    const link = await codeFor(k, { executor: k.X, relays: ['wss://watch.example', 'wss://second.example'] });
    await open(page, `/terminal/setup/#${link.split('#')[1]}`);
    await expect(page.locator('[data-escalation-key="named"]')).toContainText(/new for this watch/);
    const changes = page.locator('[data-code-changes]');
    await expect(changes).toContainText('Adds the relay wss://second.example');
    await expect(changes).toContainText(/Adds an escalation key/);
    const save = page.getByRole('button', { name: 'Update' });
    await expect(save).toBeDisabled();
    expect((await readDevice(page)).accruing['watch_escalation']).toBeUndefined();
    await page.locator('[data-key-confirm] input').check();
    await expect(save).toBeEnabled();
    await save.click();
    await expect.poll(async () => String((await readDevice(page)).accruing['watch_escalation'] ?? '')).toContain(`x=${k.X}`);
  });
});

test.describe('Status, on a watch that does not yet name its escalation key', () => {
  test('says so, and what it means', async ({ page }) => {
    const k = await keys();
    await seedDevice(page, { callsign: 'Wren', watchtower: { pubkey: k.W, relays: ['wss://watch.example'] } });
    await open(page, '/terminal/');
    const slot = page.locator('[data-escalation-key="none"]');
    await expect(slot).toBeVisible();
    await expect(slot).toContainText('Not named');
    await expect(slot).toContainText(/cannot be told from the agent/);
  });

  test('says nothing of the kind once it does', async ({ page }) => {
    const k = await keys();
    await seedDevice(page, {
      callsign: 'Wren',
      watchtower: { pubkey: k.W, relays: ['wss://watch.example'] },
      accruing: await kept(k, ['wss://watch.example'])
    });
    await open(page, '/terminal/');
    await expect(page.locator('[data-capability]')).toBeVisible();
    await expect(page.locator('[data-escalation-key="none"]')).toHaveCount(0);
  });
});

test.describe('a Distress on a box that names its executor', () => {
  test.setTimeout(45_000);

  test('shows a person’s answer the watch key alone signed as said, never as “has it”, and keeps sending', async ({ page }) => {
    const k = await keys();
    await seedDevice(page, {
      callsign: 'Wren',
      watchtower: { pubkey: k.W, relays: ['wss://fake.relay'] },
      accruing: await kept(k),
      relayEvents: []
    });
    await open(page, '/terminal/distress/');
    await raiseDistress(page);
    await answerNextSignal(page, await humanFrom(k.watch));

    const said = page.locator('[data-human-unconfirmed]');
    await expect(said).toBeVisible({ timeout: 15_000 });
    await expect(said).toContainText('Raven');
    await expect(said).toContainText(/cannot confirm/);
    await expect(page.locator('[data-distress="running"]')).toBeVisible();
    await expect(page.locator('[data-distress="acknowledged"]')).toHaveCount(0);
    await expect(page.getByText(/Raven has it/)).toHaveCount(0);
  });

  test('ends on the executor’s own answer', async ({ page }) => {
    const k = await keys();
    await seedDevice(page, {
      callsign: 'Wren',
      watchtower: { pubkey: k.W, relays: ['wss://fake.relay'] },
      accruing: await kept(k),
      relayEvents: []
    });
    await open(page, '/terminal/distress/');
    await raiseDistress(page);
    await answerNextSignal(page, await humanFrom(k.executor));
    await expect(page.locator('[data-distress="acknowledged"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-unattributed]')).toHaveCount(0);
  });

  test('on a box that names none, ends as before, and says it cannot tell a person from the agent', async ({ page }) => {
    const k = await keys();
    await seedDevice(page, {
      callsign: 'Wren',
      watchtower: { pubkey: k.W, relays: ['wss://fake.relay'] },
      relayEvents: []
    });
    await open(page, '/terminal/distress/');
    await raiseDistress(page);
    await answerNextSignal(page, await humanFrom(k.watch));
    await expect(page.locator('[data-distress="acknowledged"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-unattributed]')).toContainText(/does not yet name its escalation key/);
  });
});
