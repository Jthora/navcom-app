import { expect, test, type Page } from '@playwright/test';
import { seedDevice, open } from './device';

/**
 * The sentence somebody reads before they walk out the door.
 *
 * `capabilitySentence` is rendered on three screens — the status screen, sign-on, and stored
 * as `toldAtSignOn` — and **had no browser coverage at all**. It is the capability receipt:
 * the one thing CLAUDE.md says must work when everything else is down, and the mechanism
 * behind invariant 4, *"an operator must never believe a human is watching when none is."*
 *
 * The unit tests prove the sentence composes correctly. These prove **a person is shown it**,
 * in the state they are actually in, on the screen they actually open.
 */

const NOW = () => Math.floor(Date.now() / 1000);

/** Puts a device under a watch that is publishing `input`, and opens `path`. */
async function under(page: Page, input: Record<string, unknown>, path = '/terminal/') {
  const { finalizeEvent, generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
  const { buildWatchStateEvent } = await import('@navcom/core');
  const secret = generateSecretKey();
  const now = NOW();

  const event = finalizeEvent(
    buildWatchStateEvent({ since: now - 600, agent_health: 'ok', last_drill: null, now, ...input } as never, now),
    secret
  );

  await seedDevice(page, {
    callsign: 'Wren',
    watchtower: { pubkey: getPublicKey(secret), relays: ['wss://fake.relay'] },
    relayEvents: [event]
  });
  await open(page, path);
  return page;
}

const oncall = (callsign: string) => ({
  author: { kind: 'node' as const, callsign },
  channel: 'sms' as const,
  expires: NOW() + 3600
});

test.describe('what the terminal tells you before you go out', () => {
  test('a watch with one person on call says the ladder ends there', async ({ page }) => {
    /*
     * 9.3, and the half of it that is easy to lose: *tell operators what is thin — do not
     * publish it.* One on-call is the situation this project is actually in, and an operator
     * relying on it is owed the shape of it rather than a green light.
     */
    await under(page, {
      state: 'automated', holder: 'nightwatch', holder_kind: 'agent', oncall: [oncall('Raven')]
    });

    const said = page.locator('[data-capability]');
    await expect(said).toContainText(/raven/i, { timeout: 10_000 });
    await expect(said).toContainText(/one person, so if they miss it the ladder ends there/i);
  });

  test('and a console with nobody on call does not read as staffed', async ({ page }) => {
    // The state that looks strongest saying the weakest fact behind it: a named human at a
    // console is true and is not a ladder, and by 3am they can be asleep.
    await under(page, {
      state: 'station', holder: 'Owl', holder_kind: 'human', oncall: []
    });

    const said = page.locator('[data-capability]');
    await expect(said).toContainText(/owl is at the console/i, { timeout: 10_000 });
    await expect(said).toContainText(/nobody is on call/i);
    await expect(said).toContainText(/pages nobody and tells you so/i);
  });

  test('and Dark says Distress will reach nobody, and that the terminal still works', async ({ page }) => {
    /*
     * The state an operator meets most often. It has to carry both halves: pressing `Distress`
     * reaches nobody tonight, **and** this is not the app being broken — *"the default is
     * Alone, and it is not a degraded state."*
     */
    await under(page, { state: 'dark', holder: null, holder_kind: null, oncall: [] });

    const said = page.locator('[data-capability]');
    await expect(said).toContainText(/page nobody/i, { timeout: 10_000 });
    await expect(said).toContainText(/still works offline/i);
  });
});

test.describe('and it is there before you commit to anything', () => {
  test('the sign-on screen says it, not the screen after', async ({ page }) => {
    // Invariant 4. Reading it after signing on is reading it too late — the decision it
    // informs is whether to go out at all.
    await under(page, {
      state: 'dark', holder: null, holder_kind: null, oncall: []
    }, '/terminal/sign-on/');

    await expect(page.locator('[data-told]')).toContainText(/page nobody/i, { timeout: 10_000 });
  });

  test('and the roster it names to you is not in anything this device publishes', async ({ page }) => {
    /*
     * The other half of 9.3, and the reason the receipt rides on a sentence rather than
     * becoming a field: naming the on-call roster **to the world** hands an adversary the one
     * name worth targeting. Naming it to the person about to walk out the door is the point.
     */
    await under(page, {
      state: 'automated', holder: 'nightwatch', holder_kind: 'agent', oncall: [oncall('Raven')]
    }, '/terminal/sign-on/');

    await expect(page.locator('[data-told]')).toContainText(/raven/i, { timeout: 10_000 });

    // An area is required before anybody can sign on, which is the point of the field.
    await page.locator('#area').fill('Downtown');
    await page.getByRole('button', { name: /^sign on$/i }).click();
    await expect
      .poll(async () =>
        page.evaluate(() => JSON.stringify((window as unknown as { __navcomPublished?: unknown[] }).__navcomPublished ?? []))
      )
      .not.toBe('[]');

    const published = await page.evaluate(() =>
      JSON.stringify((window as unknown as { __navcomPublished?: unknown[] }).__navcomPublished ?? [])
    );
    expect(published).not.toContain('Raven');
  });
});
