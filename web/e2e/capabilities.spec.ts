import { expect, test } from '@playwright/test';
import { CAPABILITIES, type Capability } from '../src/lib/capabilities';
import { seedDevice, open } from './device';

/**
 * `requires` is the truth, not a comment.
 *
 * For each capability, the device is seeded with **exactly what it declares and nothing
 * more**, and then its control is operated. A capability that quietly needs something it
 * did not admit to fails here.
 *
 * This is the check that would have caught peer presence on the day it was written. It
 * declared no watch and needed one — it read its relay list from the Watchtower config, so
 * the feature built specifically for operators without a watch did nothing for them. It
 * passed every test, because no test had ever opened it with only an identity.
 */

/** A pubkey shaped correctly and belonging to nobody. */
const NOBODY = 'b'.repeat(64);

/**
 * A watch that is actually on station, signed by a key this test holds.
 *
 * `requires: ['watch']` used to seed a Watchtower **address and nothing else**, so every
 * capability declaring one got a watch that was configured and permanently Dark. That is a
 * real state and the wrong one to test against: a control gated on the watch being reachable
 * could never be exercised, and "What the watch wrote" sat undeclared for exactly as long.
 */
async function liveWatch() {
  const { finalizeEvent, generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
  const { buildWatchStateEvent } = await import('@navcom/core');
  const secret = generateSecretKey();
  const now = Math.floor(Date.now() / 1000);
  const event = finalizeEvent(
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
    secret
  );
  return { pubkey: getPublicKey(secret), event };
}


/**
 * Whether this browser can be woken at all.
 *
 * iOS supports Web Push only for an installed PWA, so in a Safari tab there is no
 * registration control to operate — correctly. A capability that declares `needsPush` is
 * checked against what the screen actually offers instead.
 */
async function canBeWoken(page: import('@playwright/test').Page) {
  return page.evaluate(
    () => typeof Notification !== 'undefined' && 'PushManager' in globalThis
  );
}

/** The screen has to be legible as unavailable, which is the standard everywhere else here. */
async function saysItCannotBeWoken(page: import('@playwright/test').Page) {
  await expect(page.getByText(/cannot be woken/i)).toBeVisible();
  await expect(page.getByText(/add to home screen/i)).toBeVisible();
  // Said twice on that screen — the readout sub-line and the paragraph — so .first().
  await expect(page.getByText(/legitimate choice/i).first()).toBeVisible();
}

async function seedFor(capability: Capability) {
  const watch = capability.requires.includes('watch') ? await liveWatch() : null;
  return {
    ...(capability.requires.includes('identity') ? { callsign: 'Wren' } : {}),
    ...(watch
      ? {
          watchtower: { pubkey: watch.pubkey, relays: ['wss://relay.example'] },
          relayEvents: [watch.event]
        }
      : {}),
    ...(capability.requires.includes('peers')
      ? { peers: [{ pubkey: NOBODY, callsign: 'Raven', since: 0 }] }
      : {}),
    // A `tel:`/`sms:` control only exists once somebody has been saved to call.
    ...(capability.requires.includes('contact')
      ? { contact: { label: 'Sam', number: '+15550100' } }
      : {})
  };
}

for (const capability of CAPABILITIES) {
  test(`${capability.name} works with only what it declares`, async ({ page }) => {
    await seedDevice(page, await seedFor(capability));
    await open(page, `/${capability.screen}`);

    // The screen renders at all. A capability whose page errors with its declared state is
    // not a capability.
    await expect(page.locator('h1')).toBeVisible();

    if (capability.needsPush && !(await canBeWoken(page))) {
      await saysItCannotBeWoken(page);
      return;
    }

    if (capability.control) {
      // `.first()` because a control can legitimately name a *class* of controls rather than
      // one element — sixty-seven region links, twenty-one report buttons — and the claim
      // being checked is that a person has one to operate, not that there is exactly one.
      const control = page.locator(capability.control).first();
      await expect(control, `${capability.control} is not on ${capability.screen}`).toBeVisible();
      await expect(control, `${capability.control} is not operable`).toBeEnabled();
    }
  });
}

test('a capability that declares no watch does not quietly need one', async ({ browser }) => {
  // One test, one fresh browser context per capability, and there are now seventeen. That
  // is a minute of real work under parallel load and it outgrew the default 30s timeout as
  // the manifest filled up -- surfacing as a flake rather than as "this test got bigger".
  // Scaled off the manifest so it keeps up on its own.
  test.setTimeout(20_000 + CAPABILITIES.length * 8_000);

  // Stated as one assertion over the whole set, because the failure it guards was not
  // specific to a screen -- it was a shared module reaching for the Watchtower config, and
  // every capability that touched it inherited the dependency.
  //
  // **A fresh context per capability**, which this did not have until the card screen
  // exposed it. `seedDevice` deliberately seeds once and then leaves the device alone, so
  // reusing one page meant every iteration after the first ran against the *first*
  // capability's state -- an empty device. It was quietly asserting "works with no setup at
  // all", which is a different and much weaker claim than the one in its name. Screens that
  // happen not to gate on identity passed it for the wrong reason.
  const withoutWatch = CAPABILITIES.filter((c) => !c.requires.includes('watch'));
  expect(withoutWatch.length).toBeGreaterThan(0);

  for (const capability of withoutWatch) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await seedDevice(page, await seedFor(capability));
      await open(page, `/${capability.screen}`);

      // Nothing on the page may tell an operator to go and get a Watchtower first.
      const text = (await page.locator('body').innerText()).toLowerCase();
      expect(text, `${capability.name} demands a watch`).not.toContain('not configured');

      if (capability.control && !(capability.needsPush && !(await canBeWoken(page)))) {
        await expect(
          page.locator(capability.control).first(),
          `${capability.name}: ${capability.control} is not operable without a watch`
        ).toBeEnabled();
      }
    } finally {
      await context.close();
    }
  }
});
