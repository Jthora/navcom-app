import { expect, test, type Page } from '@playwright/test';
import { seedDevice, open } from './device';

/**
 * The panel, in a browser.
 *
 * `panel.test.ts` holds the rules; this holds the rules **as rendered**, which is the
 * distinction this project has paid for three times: a rule the logic honoured and the output
 * did not.
 *
 * The doctrine and its phases are in `docs/design/panel.md`.
 */

const NOW = () => Math.floor(Date.now() / 1000);

/** A device under a watch that is actually publishing `input`. */
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

test.describe('the capability receipt, as a panel', () => {
  test('states the watch in one word, where a sentence used to be', async ({ page }) => {
    await under(page, { state: 'dark', holder: null, holder_kind: null, oncall: [] });

    const watch = page.locator('[data-slot="watch"] [data-readout-value]');
    await expect(watch).toBeVisible({ timeout: 10_000 });
    await expect(watch).toHaveText(/^dark$/i);

    // And the consequence gets its own slot rather than being buried mid-paragraph.
    await expect(page.locator('[data-slot="distress"] [data-readout]')).toHaveText(/no addressee/i);
  });

  test('and the sentence is still there, word for word', async ({ page }) => {
    /*
     * Rule 3, and the whole reason terseness is safe here. `DARK` without *"it still works
     * offline"* reads as the app being broken — so the prose was relocated, not deleted.
     */
    await under(page, { state: 'dark', holder: null, holder_kind: null, oncall: [] });

    const why = page.locator('[data-capability] [data-why]');
    await expect(why).toHaveCount(1);
    await expect(why).toContainText(/page nobody/i);
    await expect(why).toContainText(/still works offline/i);

    // And a person can actually reach it — a disclosure nobody can open is not a disclosure.
    await expect(why.locator('.nc-why-body')).toBeHidden();
    await why.locator('summary').click();
    await expect(why.locator('.nc-why-body')).toBeVisible();
  });

  test('names who is on call, and says when that is one person', async ({ page }) => {
    // 9.3: tell operators what is thin. The thin part is the loudest thing in the slot.
    await under(page, {
      state: 'automated', holder: 'nightwatch', holder_kind: 'agent', oncall: [oncall('Raven')]
    });

    const slot = page.locator('[data-slot="on-call"]');
    await expect(slot).toContainText(/raven/i, { timeout: 10_000 });
    await expect(slot).toContainText(/sole — ladder ends here/i);
  });

  test('and an agent is still identified as an agent', async ({ page }) => {
    // Invariant 5. Terseness must not be where this quietly stops being true.
    await under(page, {
      state: 'automated', holder: 'nightwatch', holder_kind: 'agent', oncall: [oncall('Raven')]
    });

    const watch = page.locator('[data-slot="watch"]');
    await expect(watch).toContainText(/automated/i, { timeout: 10_000 });
    await expect(watch).toContainText(/agent · not a human/i);
  });

  test('and an empty slot still holds its place', async ({ page }) => {
    /*
     * Rule 4. A slot that disappears when it has nothing to say cannot be learned by position,
     * and it makes "nothing to report" indistinguishable from "never asked".
     */
    await under(page, { state: 'dark', holder: null, holder_kind: null, oncall: [] });

    const slot = page.locator('[data-slot="on-call"]');
    await expect(slot).toBeVisible({ timeout: 10_000 });
    await expect(slot.locator('[data-readout-value]')).toHaveText('—');
  });
});

test.describe('rule 2, against the built artifact', () => {
  test('no readout anywhere has become a sentence', async ({ page }) => {
    /*
     * The rule is enforced in the component, which marks itself rather than throwing — a copy
     * edit must never take a screen down at 2am. This is the half that makes the mark matter:
     * nothing marked may reach a screen.
     *
     * Checked across the states that render different readouts, because a limit that only
     * holds in the happy path is not a limit.
     */
    const states = [
      { state: 'dark', holder: null, holder_kind: null, oncall: [] },
      { state: 'station', holder: 'Owl', holder_kind: 'human', oncall: [] },
      { state: 'automated', holder: 'nightwatch', holder_kind: 'agent', oncall: [oncall('Raven')] },
      {
        state: 'automated', holder: 'nightwatch', holder_kind: 'agent',
        oncall: [oncall('Raven'), oncall('Owl'), oncall('Finch')]
      }
    ];

    for (const s of states) {
      await under(page, s);
      await expect(page.locator('[data-readout]').first()).toBeVisible({ timeout: 10_000 });
      const overlong = await page.locator('[data-readout][data-overlong="true"]').allTextContents();
      expect(overlong, `overlong readout in state ${s.state}`).toEqual([]);
    }
  });
});
