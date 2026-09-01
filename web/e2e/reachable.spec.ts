import { expect, test } from '@playwright/test';
import { readDevice, seedDevice, serviceWorkerReady, open, TEST_SECRET , holdUntil } from './device';

/**
 * Every control an operator is told about is on the screen and operable.
 *
 * This is the file that would have caught the position control. It was fully wired — the
 * module existed, the setting was imported, `setPrecision` ran on every sign-on — and the
 * `<select>` was simply not on the page, because one string in an edit did not match. 113
 * tests passed. Signing on quietly reset a setting the operator had no way to set.
 *
 * **A mechanism nobody can reach is not built**, and until this file existed nothing said so.
 */

const OUT = { callsign: 'Wren' };

test.describe('setup', () => {
  test('a first visit can create an identity and nothing else is required', async ({ page }) => {
    await seedDevice(page);
    await open(page, '/terminal/setup/');

    await expect(page.locator('#callsign')).toBeVisible();

    // Inert until there is a callsign, which is what `makeIdentity` requires anyway — it
    // refuses an empty one with an error. Disabled removes a tap whose only outcome is that
    // error, and makes the form inert before hydration, where a native submit used to reload
    // the page and throw away what was typed.
    const generate = page.getByRole('button', { name: /generate keypair/i });
    await expect(generate).toBeDisabled();
    await page.locator('#callsign').fill('Wren');
    await expect(generate).toBeEnabled();

    // The watch section must read as optional. An operator who knows nobody is the common
    // case, and telling them setup is unfinished is telling them the app is broken.
    await expect(page.getByText(/skip this/i)).toBeVisible();
  });

  test('somebody you would call can be added and removed', async ({ page }) => {
    await seedDevice(page, OUT);
    await open(page, '/terminal/setup/');

    await page.locator('#clabel').fill('Sam');
    await page.locator('#cnumber').fill('+1 555 0100');
    await page.getByRole('button', { name: /^save$/i }).click();

    await expect(page.getByText('+1 555 0100')).toBeVisible();
    await page.getByRole('button', { name: /remove/i }).click();
    await expect(page.getByText('+1 555 0100')).toHaveCount(0);
  });
});

test.describe('a squad-held watch', () => {
  test('who holds it can be listed, and is empty by default', async ({ page }) => {
    // Empty is the common case: a box holds its own key. The field exists because a squad
    // with no box is the arrangement this project expects most, and until now it had no
    // way to say so.
    await seedDevice(page, OUT);
    await open(page, '/terminal/setup/');

    const holders = page.locator('#holders');
    await expect(holders).toBeVisible();
    await expect(holders).toHaveValue('');
  });

  test('a key that is not a key is refused rather than silently dropped', async ({ page }) => {
    // A wrong entry here means somebody silently cannot read signals, which surfaces as an
    // unanswered Distress rather than as an error.
    await seedDevice(page, OUT);
    await open(page, '/terminal/setup/');

    await page.locator('#pubkey').fill('b'.repeat(64));
    await page.locator('#holders').fill('not-a-key');
    await page.getByRole('button', { name: /^connect$/i }).click();

    await expect(page.getByText(/is not a pubkey/i)).toBeVisible();
  });

  test('holders are saved and read back', async ({ page }) => {
    await seedDevice(page, OUT);
    await open(page, '/terminal/setup/');

    const one = 'c'.repeat(64);
    const two = 'd'.repeat(64);
    await page.locator('#pubkey').fill('b'.repeat(64));
    await page.locator('#holders').fill(`${one}\n${two}`);
    await page.getByRole('button', { name: /^connect$/i }).click();

    const device = await readDevice(page);
    expect(device.accruing['watch_holders']).toEqual([one, two]);
  });
});

test.describe('sign-on', () => {
  test('every choice an operator makes is on the page', async ({ page }) => {
    await seedDevice(page, OUT);
    await open(page, '/terminal/sign-on/');

    await expect(page.locator('#area')).toBeVisible();
    await expect(page.locator('#hours')).toBeVisible();
    await expect(page.locator('#routine')).toBeVisible();
    // The one that shipped missing.
    await expect(page.locator('#share')).toBeVisible();
  });

  test('position sharing offers off, coarse and exact, and nothing public', async ({ page }) => {
    await seedDevice(page, OUT);
    await open(page, '/terminal/sign-on/');

    const values = await page.locator('#share option').evaluateAll((els) =>
      els.map((e) => (e as HTMLOptionElement).value)
    );
    expect(values).toEqual(['off', 'coarse', 'exact']);
    // Not "do not add a public option" — there must be nowhere to put one.
    expect(values).not.toContain('network');
    expect(values).not.toContain('public');
  });

  test('signing on is refused without an area, since it travels with a Distress', async ({ page }) => {
    await seedDevice(page, OUT);
    await open(page, '/terminal/sign-on/');
    await expect(page.getByRole('button', { name: /sign on/i })).toBeDisabled();
    await page.locator('#area').fill('Downtown');
    await expect(page.getByRole('button', { name: /sign on/i })).toBeEnabled();
  });
});

test.describe('distress', () => {
  test('the hold control is present and never disabled', async ({ page }) => {
    // A prerendered page must render some default and both are wrong: armed briefly
    // promises what it cannot do, disarmed briefly REFUSES a real emergency during
    // hydration. So the press always registers.
    await seedDevice(page, OUT);
    await open(page, '/terminal/distress/');

    const hold = page.locator('button.raise');
    await expect(hold).toBeVisible();
    await expect(hold).toBeEnabled();
  });

  test('your own person is offered first, above everything', async ({ page }) => {
    await seedDevice(page, { ...OUT, contact: { label: 'Sam', number: '+15550100' } });
    await open(page, '/terminal/distress/');

    const text = page.getByRole('link', { name: /text sam/i });
    const call = page.getByRole('link', { name: /call sam/i });
    await expect(text).toBeVisible();
    await expect(call).toBeVisible();

    // Opens the messaging app with it written. The operator still presses send, and the
    // page says so — a web app cannot do that for them.
    await expect(text).toHaveAttribute('href', /^sms:/);
    await expect(call).toHaveAttribute('href', /^tel:/);
  });
});

test.describe('distress before the app has loaded', () => {
  /**
   * The gap the bundle budget was standing in for.
   *
   * Every terminal screen is readable in about half a second and wired seconds later — three
   * on a congested cell, ten on a throttled plan. On Distress that meant the page said "Hold
   * to send" and holding did nothing, with no working `tel:` link either.
   *
   * These block the module bundle entirely, which is the same state as "it has not arrived
   * yet" and is strictly harsher than any real network.
   */
  const withoutTheApp = async (page: import('@playwright/test').Page) => {
    await page.route('**/_app/immutable/**/*.js', (route) => route.abort());
  };

  test('the person you would call is reachable with no application at all', async ({ page }) => {
    await seedDevice(page, { ...OUT, contact: { label: 'Sam', number: '+15550100' } });
    await withoutTheApp(page);
    await page.goto('/terminal/distress/', { waitUntil: 'commit' });

    const text = page.getByRole('link', { name: /text sam/i });
    const call = page.getByRole('link', { name: /call sam/i });
    await expect(text).toBeVisible();
    await expect(call).toBeVisible();
    await expect(text).toHaveAttribute('href', 'sms:+15550100');
    await expect(call).toHaveAttribute('href', 'tel:+15550100');
  });

  test('says nothing at all when there is no contact to offer', async ({ page }) => {
    // An empty "Your person" heading would be worse than no heading: it reads as a safety
    // net that exists and is broken, rather than one that was never set up.
    await seedDevice(page, OUT);
    await withoutTheApp(page);
    await page.goto('/terminal/distress/', { waitUntil: 'commit' });

    await expect(page.getByRole('heading', { name: /your person/i })).toHaveCount(0);
  });

  test('does not survive as a duplicate once the app is running', async ({ page }) => {
    // Two "Text Sam" links would be the fallback outliving its purpose. Svelte's version
    // carries the written message; this one is deliberately plainer.
    await seedDevice(page, { ...OUT, contact: { label: 'Sam', number: '+15550100' } });
    await open(page, '/terminal/distress/');

    await expect(page.getByRole('link', { name: /text sam/i })).toHaveCount(1);
    await expect(page.locator('#reach-early')).toHaveCount(0);
    // And the surviving one is the app's, which pre-writes the message.
    await expect(page.getByRole('link', { name: /text sam/i })).toHaveAttribute('href', /body=/);
  });

  test('a broken or foreign storage blob does not take the page down', async ({ page }) => {
    // A fallback that throws would break the screen it exists to protect.
    await page.addInitScript(() => localStorage.setItem('navcom.accruing', 'not json'));
    await withoutTheApp(page);
    await page.goto('/terminal/distress/', { waitUntil: 'commit' });

    await expect(page.locator('h1')).toBeVisible();
    await expect(page.getByRole('heading', { name: /your person/i })).toHaveCount(0);
  });
});

test.describe('wipe', () => {
  test('panic wipe is a hold and burn asks for the callsign', async ({ page }) => {
    // Opposite shapes on purpose: a wipe costs an evening and speed wins; a burn costs
    // everything and nothing about seizure makes typing impossible.
    await seedDevice(page, OUT);
    await open(page, '/terminal/wipe/');

    await expect(page.getByRole('button', { name: /hold to wipe tonight/i })).toBeVisible();

    const burn = page.getByRole('button', { name: /burn this device/i });
    await expect(burn).toBeDisabled();
    await page.locator('#confirm').fill('Wren');
    await expect(burn).toBeEnabled();
  });

  test('the wrong callsign does not arm the burn', async ({ page }) => {
    await seedDevice(page, OUT);
    await open(page, '/terminal/wipe/');
    await page.locator('#confirm').fill('wren');
    await expect(page.getByRole('button', { name: /burn this device/i })).toBeDisabled();
  });

  test('says plainly where a wipe does not reach', async ({ page }) => {
    // An operator who believes a wipe is total is worse off than one who knows exactly
    // where it stops — the watch's own board entry, and the accountability log, survive
    // both a panic wipe and a burn, and the screen must say so before either is used.
    await seedDevice(page, OUT);
    await open(page, '/terminal/wipe/');

    await expect(page.getByText(/the watch still has your board entry/i)).toBeVisible();
    await expect(page.getByText(/the accountability log is outside both tiers/i)).toBeVisible();
    await expect(page.getByText(/not yours to delete/i)).toBeVisible();
    await expect(page.getByText(/unlinks it rather than/i)).toBeVisible();
  });
});

test.describe('peers', () => {
  test('your code is shown as something scannable', async ({ page }) => {
    await seedDevice(page, OUT);
    await open(page, '/terminal/peers/');

    const qr = page.locator('[data-qr] svg');
    await expect(qr).toBeVisible();
  });

  test('pairing needs a code and a name for them', async ({ page }) => {
    await seedDevice(page, OUT);
    await open(page, '/terminal/peers/');

    await page.locator('#code').fill('b'.repeat(64));
    await page.locator('#name').fill('Raven');
    await page.getByRole('button', { name: /^pair$/i }).click();

    await expect(page.getByText('Raven')).toBeVisible();
    await expect(page.getByRole('button', { name: /remove/i })).toBeVisible();
  });

  test('a bad code is refused with a reason rather than ignored', async ({ page }) => {
    await seedDevice(page, OUT);
    await open(page, '/terminal/peers/');

    await page.locator('#code').fill('not-a-code');
    await page.locator('#name').fill('Raven');
    await page.getByRole('button', { name: /^pair$/i }).click();

    await expect(page.getByText(/not a navcom code/i)).toBeVisible();
  });
});

test.describe('watching for somebody', () => {
  test('is taken on and put down in one tap, from the peer list', async ({ page }) => {
    await seedDevice(page, OUT);
    await open(page, '/terminal/peers/');

    await page.locator('#code').fill('b'.repeat(64));
    await page.locator('#name').fill('Raven');
    await page.getByRole('button', { name: /^pair$/i }).click();

    // Pairing alone does not make you responsible for anybody.
    await expect(page.getByText('watching', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: /watch for them/i }).click();
    await expect(page.getByText('watching', { exact: true })).toBeVisible();

    // Putting it down is as unceremonious as taking it up. Somebody who has to justify
    // stopping keeps a commitment they cannot keep, which is worse for the person relying
    // on it than an honest end.
    await page.getByRole('button', { name: /stop watching/i }).click();
    await expect(page.getByText('watching', { exact: true })).toHaveCount(0);
  });
});

test.describe('your card', () => {
  test('publishing needs an area chosen deliberately', async ({ page }) => {
    await seedDevice(page, OUT);
    await open(page, '/terminal/card/');

    const publish = page.getByRole('button', { name: /publish your card/i });
    await expect(publish).toBeDisabled();
    await page.locator('#region').selectOption('st-louis');
    await expect(publish).toBeEnabled();
  });

  test('there is nothing to withdraw and nothing to list until a card exists', async ({ page }) => {
    // Being listed as out is meaningless without a card to resolve the name against, and a
    // switch you can arm before it does anything is a switch that will be on by surprise.
    await seedDevice(page, OUT);
    await open(page, '/terminal/card/');

    await expect(page.getByRole('button', { name: /withdraw my card/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /not listed|listed while out/i })).toHaveCount(0);
  });

  test('publishing is offered, and withdrawing takes a second deliberate tap', async ({ page }) => {
    await seedDevice(page, OUT);
    await open(page, '/terminal/card/');

    await page.locator('#region').selectOption('st-louis');
    await page.getByRole('button', { name: /publish your card/i }).click();

    // Stored on this device even though no relay could be reached -- the card is the
    // operator's, not the network's.
    await expect(page.getByRole('button', { name: /replace your card/i })).toBeVisible();

    // Off by default. Publishing a card must not sign anybody up to being listed nightly.
    await expect(page.getByRole('button', { name: /^not listed$/i })).toBeVisible();

    await page.getByRole('button', { name: /withdraw my card/i }).click();
    await expect(page.getByRole('button', { name: /throw the key away/i })).toBeVisible();
    await page.getByRole('button', { name: /keep my card/i }).click();
    await expect(page.getByRole('button', { name: /replace your card/i })).toBeVisible();
  });

  test('withdrawing discards the key rather than claiming to unpublish', async ({ page }) => {
    await seedDevice(page, OUT);
    await open(page, '/terminal/card/');
    await page.locator('#region').selectOption('st-louis');
    await page.getByRole('button', { name: /publish your card/i }).click();

    const before = await readDevice(page);
    expect(before.accruing['contact_secret'], 'a card has a key of its own').toBeTruthy();
    expect(before.accruing['contact_secret']).not.toBe(before.accruing['secret']);

    await page.getByRole('button', { name: /withdraw my card/i }).click();
    await page.getByRole('button', { name: /throw the key away/i }).click();

    const after = await readDevice(page);
    expect(after.accruing['contact_secret']).toBeUndefined();
    expect(after.accruing['card']).toBeUndefined();
    // The operational identity is untouched. Withdrawing a card is not leaving.
    expect(after.accruing['secret']).toBe(before.accruing['secret']);
  });
});

test.describe('finding somebody', () => {
  test('an area is chosen, and nothing is shown until one is', async ({ page }) => {
    await seedDevice(page, OUT);
    await open(page, '/terminal/find/');

    await expect(page.locator('#area')).toBeVisible();
    await expect(page.locator('.board')).toHaveCount(0);
  });

  test('an empty area says so rather than looking broken', async ({ page }) => {
    // The ordinary case early on, and in most metros for a long time. It is not an error.
    await seedDevice(page, OUT);
    await open(page, '/terminal/find/');
    await page.locator('#area').selectOption('st-louis');

    await expect(page.getByText(/nobody has published a card here/i)).toBeVisible();
  });
});

test.describe('holding the watch', () => {
  test('a watch can be started on this phone, and taking it is a separate act', async ({ page }) => {
    // Starting a watch and being ON it are different. A key on the device promises nothing;
    // publishing that a named human is watching is the promise.
    await seedDevice(page, OUT);
    await open(page, '/terminal/watch/');

    await page.getByRole('button', { name: /start a watch on this phone/i }).click();
    await expect(page.getByRole('heading', { name: /off watch/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /take the watch/i })).toBeVisible();
  });

  test('the watch key is its own key, not the operator identity', async ({ page }) => {
    await seedDevice(page, OUT);
    await open(page, '/terminal/watch/');
    await page.getByRole('button', { name: /start a watch on this phone/i }).click();

    const device = await readDevice(page);
    expect(device.accruing['watch_secret']).toBeTruthy();
    expect(device.accruing['watch_secret']).not.toBe(device.accruing['secret']);
  });

  test('a key that is not a key is refused with a reason', async ({ page }) => {
    await seedDevice(page, OUT);
    await open(page, '/terminal/watch/');

    await page.locator('#key').fill('nonsense');
    await page.getByRole('button', { name: /^join$/i }).click();
    await expect(page.getByText(/not a watch key/i)).toBeVisible();
  });

  test('giving up the watch takes a second deliberate tap and says what it does not do', async ({ page }) => {
    await seedDevice(page, OUT);
    await open(page, '/terminal/watch/');
    await page.getByRole('button', { name: /start a watch on this phone/i }).click();

    // The limit stated before the button, not after: other holders keep the same key and
    // nothing here can reach their devices.
    //
    // `\s+` rather than a space: getByText does not normalise whitespace when given a
    // regex, and this phrase spans a line break in the markup. A literal space here fails
    // for a formatting reason that has nothing to do with what is being asserted.
    await expect(page.getByText(/it does not end the\s+watch/i)).toBeVisible();

    await page.getByRole('button', { name: /give up this watch/i }).click();
    await page.getByRole('button', { name: /remove it from this phone/i }).click();

    const device = await readDevice(page);
    expect(device.accruing['watch_secret']).toBeUndefined();
    // Giving up a watch is not leaving. The operator identity is untouched.
    expect(device.accruing['secret']).toBeTruthy();
  });

  test('there is no control anywhere that closes a Distress', async ({ page }) => {
    // Invariant 2: a Distress terminates in a human. A watch screen that could clear one
    // would let it terminate in a tap instead.
    await seedDevice(page, OUT);
    await open(page, '/terminal/watch/');
    await page.getByRole('button', { name: /start a watch on this phone/i }).click();

    for (const name of [/close/i, /resolve/i, /clear/i, /dismiss/i, /stand.*down.*distress/i]) {
      await expect(page.getByRole('button', { name })).toHaveCount(0);
    }
  });
});

test.describe('saying no to an assist', () => {
  test('the operator is told a refusal is possible before they send', async ({ page }) => {
    // It changes whether somebody sends an assist at all, or goes straight to their own
    // person -- so it cannot wait until a refusal arrives.
    await seedDevice(page, { ...OUT, watchtower: { pubkey: 'e'.repeat(64), relays: ['wss://relay.example'] } });
    await open(page, '/terminal/assist/');

    await expect(page.getByText(/will say so/i)).toBeVisible();
  });

  test('no control offers to decline a Distress', async ({ page }) => {
    // Invariant 2. The rule lives in core so every client inherits it, and this checks the
    // one surface that could offer the button anyway.
    await seedDevice(page, OUT);
    await open(page, '/terminal/watch/');
    await page.getByRole('button', { name: /start a watch on this phone/i }).click();

    await expect(page.getByRole('button', { name: /nobody can come/i })).toHaveCount(0);
  });
});

test.describe('post-quantum cover', () => {
  test('says so, calmly, when a message goes without it', async ({ page }) => {
    // State-dependent on purpose: showing this while cover IS hybrid would be a lie. A peer
    // with no cached key is exactly the fallback the policy allows.
    await seedDevice(page, { ...OUT, peers: [{ pubkey: 'f'.repeat(64), callsign: 'Raven', since: 0 }] });
    await open(page, '/terminal/');

    const notice = page.getByText(/standard encryption tonight/i);
    await expect(notice).toBeVisible();
    // What is missing, and what is not.
    await expect(page.getByText(/unreadable by anyone now/i)).toBeVisible();
    await expect(page.getByText(/open the app once/i)).toBeVisible();
  });

  test('is a note, not an alarm', async ({ page }) => {
    // The whole point of the wording decision. An orange bar saying "insecure" would be
    // alarming and also wrong -- the message is encrypted and nobody can read it today.
    await seedDevice(page, { ...OUT, peers: [{ pubkey: 'f'.repeat(64), callsign: 'Raven', since: 0 }] });
    await open(page, '/terminal/');

    const body = (await page.locator('body').innerText()).toLowerCase();
    for (const word of ['insecure', 'unsafe', 'danger', 'vulnerable', 'at risk']) {
      expect(body, word).not.toContain(word);
    }

    // Rendered in the same muted colour as every other cost on the screen, not an alert one.
    const colour = await page
      .getByText(/standard encryption tonight/i)
      .evaluate((el) => getComputedStyle(el).color);
    const alarm = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--t-alarm').trim()
    );
    expect(colour).not.toBe(alarm);
  });
});

test.describe('being on call', () => {
  /*
   * Skipped on WebKit, and the reason is the platform rather than the app: iOS supports
   * Web Push only for an installed PWA, so in a Safari tab this screen correctly has no
   * registration control at all. What it shows instead — "cannot be woken", and the Add to
   * Home Screen route out of it — is asserted in `capabilities.spec.ts`, which now declares
   * the dependency with `needsPush` rather than leaving four red tests for an app that is
   * behaving properly.
   */
  test.skip(
    () => test.info().project.name === 'iphone',
    'Web Push is unavailable in an iOS browser tab; the fallback is asserted in capabilities.spec.ts'
  );

  test('the sender key is pasted in, because nothing discovers it', async ({ page }) => {
    await seedDevice(page, OUT);
    await open(page, '/terminal/on-call/');

    await expect(page.locator('#sender')).toBeVisible();
    await expect(page.getByRole('button', { name: /let this device be woken/i })).toBeDisabled();
    await page.locator('#sender').fill('x');
    await expect(page.getByRole('button', { name: /let this device be woken/i })).toBeEnabled();
  });

  test('a key that is not a key is refused before anything is asked for', async ({ page }) => {
    // The permission prompt is the expensive part -- an operator who is prompted and then
    // told the key was wrong has been interrupted for nothing.
    await seedDevice(page, OUT);
    await open(page, '/terminal/on-call/');

    await page.locator('#sender').fill('nonsense');
    await page.getByRole('button', { name: /let this device be woken/i }).click();
    await expect(page.getByText(/sender key is 65 bytes|does not look like a sender key/i)).toBeVisible();
  });

  test('says this is the only notification the app sends', async ({ page }) => {
    // The rule the rest of the app is built on, stated on its one exception.
    await seedDevice(page, OUT);
    await open(page, '/terminal/on-call/');

    await expect(page.getByText(/only notification navcom ever sends/i)).toBeVisible();
    await expect(page.getByText(/field terminal is silent/i)).toBeVisible();
  });
});

test.describe('resupply', () => {
  const WATCHED = { ...OUT, watchtower: { pubkey: 'e'.repeat(64), relays: ['wss://relay.example'] } };

  test('says plainly that nothing counts what you handed out', async ({ page }) => {
    // The decision, stated where somebody would otherwise expect a tally.
    await seedDevice(page, WATCHED);
    await open(page, '/terminal/resupply/');

    await expect(page.getByText(/nothing counts what you handed out/i)).toBeVisible();
    await expect(page.getByText(/a request, not a report/i)).toBeVisible();
  });

  test('guides away from writing about a person', async ({ page }) => {
    await seedDevice(page, WATCHED);
    await open(page, '/terminal/resupply/');
    await expect(page.getByText(/write about the supply, not the person/i)).toBeVisible();
  });

  test('an operator with no watch is told nothing is missing', async ({ page }) => {
    // Somebody patrolling alone has no quartermaster either. This must not read as
    // incomplete setup.
    await seedDevice(page, OUT);
    await open(page, '/terminal/resupply/');
    await expect(page.getByText(/nothing here is missing/i)).toBeVisible();
  });

  test('the restock list on the watch is separate from what people are waiting on', async ({ page }) => {
    // Putting it in "Waiting on you" would make it compete with "I need someone" -- the
    // alarm-fatigue problem in a quieter dress.
    await seedDevice(page, OUT);
    await open(page, '/terminal/watch/');
    await page.getByRole('button', { name: /start a watch on this phone/i }).click();

    await expect(page.getByRole('heading', { name: /^restock$/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /waiting on you/i })).toBeVisible();
    await expect(page.getByText(/nothing has run out/i)).toBeVisible();
  });
});

test.describe('reporting a problem with a record', () => {
  const AREA = '/terminal/directory/st-louis/';

  test('says what a report can and cannot do, before anybody makes one', async ({ page }) => {
    await seedDevice(page, OUT);
    await open(page, AREA);

    await expect(page.getByText(/cannot delete this listing or\s+overrule anybody/i)).toBeVisible();
    await expect(page.getByText(/nobody has to approve it/i)).toBeVisible();
  });

  test('is one tap from the record, with no form and no account', async ({ page }) => {
    // Display rule 4: "reporting must always be easier than fixing". Until now the app could
    // render a flag and not set one, so reporting was impossible while fixing needed a pull
    // request.
    await seedDevice(page, OUT);
    await open(page, AREA);

    await page.getByRole('button', { name: /report a problem/i }).first().click();
    await expect(page.getByRole('button', { name: /^closed$/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^wrong$/i }).first()).toBeVisible();
  });

  test('a report adds a note and never removes the listing', async ({ page }) => {
    // The abuse answer, end to end. Nobody adjudicates between operators, so the shape of
    // the data has to be what makes a hostile report survivable.
    await seedDevice(page, OUT);
    await open(page, AREA);

    const before = await page.locator('[data-record]').count();
    await page.getByRole('button', { name: /report a problem/i }).first().click();
    await page.getByRole('button', { name: /^closed$/i }).first().click();

    await expect(page.locator('[data-report]').first()).toBeVisible();
    await expect(page.locator('[data-report]').first()).toContainText(/reported this/i);
    // The listing is still there, and still says so.
    expect(await page.locator('[data-record]').count()).toBe(before);
    await expect(page.getByText(/the published listing is still underneath/i).first()).toBeVisible();
  });

  test('says what nobody knows, so contributing is an errand rather than an audit', async ({ page }) => {
    // "Contribute something" asks an operator to audit a database. "You are there, ask them
    // one thing" gets done. The schema already knows which fields are blank.
    await seedDevice(page, OUT);
    await open(page, AREA);

    const asks = page.locator('[data-asks]').first();
    await expect(asks).toBeVisible();
    await expect(asks).toContainText(/nobody knows/i);
    await expect(asks).toContainText(/if you are there, ask/i);
  });

  test('stops asking once somebody has answered', async ({ page }) => {
    // Continuing to ask is how a contribution list becomes noise.
    await seedDevice(page, OUT);
    await open(page, AREA);

    const first = page.locator('[data-record]').first();
    const before = await first.locator('[data-asks]').innerText();
    // Correct the first thing it asked about.
    await first.getByRole('button', { name: /report a problem/i }).click();
    await first.getByRole('button', { name: /^intake$/i }).click();
    await first.locator('input.fix').fill('19:00-20:30');
    await first.getByRole('button', { name: /^send$/i }).click();

    await expect(first.locator('[data-asks]')).not.toHaveText(before);
  });

  test('most corrections are a tap, because the schema is enums', async ({ page }) => {
    // The difference between a correction made standing outside in the cold and one meant
    // for later that never happens.
    await seedDevice(page, OUT);
    await open(page, AREA);

    const first = page.locator('[data-record]').first();
    await first.getByRole('button', { name: /report a problem/i }).click();
    await first.getByRole('button', { name: /^pets$/i }).click();
    // Options, not a text box.
    await expect(first.locator('input.fix')).toHaveCount(0);
    // Options rendered as buttons, whatever the schema calls them.
    await expect(first.getByRole('button', { name: /^no$/i })).toBeVisible();
  });

  test('guides away from writing about a person, only where text is possible', async ({ page }) => {
    await seedDevice(page, OUT);
    await open(page, AREA);

    const first = page.locator('[data-record]').first();
    await first.getByRole('button', { name: /report a problem/i }).click();
    await first.getByRole('button', { name: /^open$/i }).click();
    await expect(first.getByText(/write about the place, not the person/i)).toBeVisible();
  });

  test('a note can be scribbled one-handed and stays on the phone', async ({ page }) => {
    // You learn a shelter shut intake at 20:30 standing outside it in the rain. You cannot
    // pick a field and choose an enum in that moment, and a correction meant for later is a
    // correction that never happens.
    await seedDevice(page, OUT);
    await open(page, AREA);

    const first = page.locator('[data-record]').first();
    await first.getByRole('button', { name: /note for later/i }).click();
    await first.locator('input.fix').fill('shut intake 20:30');
    await first.getByRole('button', { name: /^keep$/i }).click();

    await expect(first.locator('[data-note]')).toContainText('shut intake 20:30');

    // Survives a reload, because "later" is later.
    await open(page, AREA);
    await expect(page.locator('[data-note]').first()).toContainText('shut intake 20:30');
  });

  test('a note is destroyed by a panic wipe, unlike the directory itself', async ({ page }) => {
    // The riskiest free text in the system is written here -- in a hurry, about something
    // that just happened, which is exactly where a line about a PERSON gets written despite
    // every rule. So it lives in the tier a wipe destroys.
    await seedDevice(page, OUT);
    await open(page, AREA);
    const first = page.locator('[data-record]').first();
    await first.getByRole('button', { name: /note for later/i }).click();
    await first.locator('input.fix').fill('note that should not survive');
    await first.getByRole('button', { name: /^keep$/i }).click();

    const before = await readDevice(page);
    expect(JSON.stringify(before.wipeable)).toContain('note that should not survive');
    expect(JSON.stringify(before.accruing)).not.toContain('note that should not survive');
  });

  test('a note goes nowhere — it is not a correction', async ({ page }) => {
    await seedDevice(page, OUT);
    await open(page, AREA);
    const first = page.locator('[data-record]').first();
    await first.getByRole('button', { name: /note for later/i }).click();
    await first.locator('input.fix').fill('private scribble');
    await first.getByRole('button', { name: /^keep$/i }).click();

    // Nothing published, and no report appears beside the listing.
    await expect(first.locator('[data-report]')).toHaveCount(0);
    const device = await readDevice(page);
    expect(JSON.stringify(device.accruing['corrections'] ?? {})).not.toContain('private scribble');
  });

  test('a correction shows who said it, which is what standing is', async ({ page }) => {
    // 7.6. Not a profile page and not a total -- your standing is that your callsign is on
    // records people rely on. There is nothing here to compare between two operators.
    await seedDevice(page, OUT);
    await open(page, AREA);

    const first = page.locator('[data-record]').first();
    await first.getByRole('button', { name: /report a problem/i }).click();
    await first.getByRole('button', { name: /^pets$/i }).click();
    await first.getByRole('button', { name: /^no$/i }).click();

    const by = first.locator('[data-said-by="pets"]');
    await expect(by).toBeVisible();
    await expect(by).toContainText('Wren');
    await expect(by).toContainText(/in person/i);
  });

  test('a fresh correction over a stale record reads as fresh, not as call first', async ({ page }) => {
    // The bug this closed: a merged record carries one set of attestation fields, so every
    // corrected field was being read with the BASE record's age. A correction made just now,
    // in person, rendered as `call first` -- display rule 2 blanking a value because of an
    // age that was not its own, which made corrections invisible on the records they fix.
    await seedDevice(page, OUT);
    await open(page, AREA);

    const first = page.locator('[data-record]').first();
    await first.getByRole('button', { name: /report a problem/i }).click();
    await first.getByRole('button', { name: /^intake$/i }).click();
    await first.locator('input.fix').fill('19:00-20:30');
    await first.getByRole('button', { name: /^send$/i }).click();

    const row = first.locator('[data-field="intake_hours"]');
    await expect(row).toContainText('19:00-20:30');
    await expect(row).not.toContainText(/call first/i);
  });

  test('a report survives losing the network, because the directory does', async ({ page, context }) => {
    /*
     * `context.setOffline(true)` plus a navigation crashes the WebKit driver — the same
     * Playwright limitation `offline.spec.ts` documents. Not a fact about this app: WebKit
     * runs the rest of this suite, and `offline-webkit.spec.ts` proves the worker serves
     * every terminal route from cache there.
     */
    test.skip(
      test.info().project.name === 'iphone',
      'WebKit driver crashes on navigation while offline'
    );
    await seedDevice(page, OUT);
    await open(page, AREA);
    // Nothing is served offline until the worker is actually running.
    await serviceWorkerReady(page);
    await page.getByRole('button', { name: /report a problem/i }).first().click();
    await page.getByRole('button', { name: /^closed$/i }).first().click();
    await expect(page.locator('[data-report]').first()).toBeVisible();

    // The region page is cached ON VISIT, not precached -- "only what you open is kept" --
    // so cutting the network before the worker has it tests the race rather than the
    // feature. Same wait the offline spec uses.
    await page.waitForFunction(async () => {
      for (const name of await caches.keys()) {
        if (await (await caches.open(name)).match('/terminal/directory/st-louis/')) return true;
      }
      return false;
    }, undefined, { timeout: 15_000 });

    await context.setOffline(true);
    // Reload rather than navigate, which is the pattern offline.spec.ts already proves: a
    // fresh `goto` offline has to re-resolve the whole route, and what this test is about is
    // whether the correction survived, not whether routing does.
    await page.reload();
    await page.waitForSelector('html[data-hydrated="true"]', { timeout: 20_000 });
    await expect(page.locator('[data-report]').first()).toBeVisible();
  });
});

test.describe('standing', () => {
  test('a credential can be written and taken up, with no network and no approval', async ({ page }) => {
    // The whole exchange is two people and two devices. Nothing is published, looked up, or
    // approved by anybody.
    await seedDevice(page, OUT);
    await open(page, '/terminal/standing/');

    await page.getByRole('button', { name: /^can take watch$/i }).click();
    const blob = await page.locator('pre.blob').innerText();
    expect(blob).toContain('"sig"');

    await page.locator('#cred').fill(blob);
    await page.getByRole('button', { name: /take it up/i }).click();
    await expect(page.locator('[data-endorsement="can-take-watch"]')).toBeVisible();
  });

  test('a credential names nobody', async ({ page }) => {
    // The property everything else follows from. A subject here would be the social graph.
    await seedDevice(page, OUT);
    await open(page, '/terminal/standing/');
    await page.getByRole('button', { name: /^medic$/i }).click();

    const blob = JSON.parse(await page.locator('pre.blob').innerText());
    expect(blob.tags).toEqual([]);
    expect(JSON.stringify(blob)).not.toContain('p2p');
    // The only key in it is the endorser's own.
    const device = await readDevice(page);
    expect(blob.pubkey).toBeTruthy();
    expect(JSON.stringify(blob)).not.toContain(String(device.accruing['contact_secret'] ?? 'none'));
  });

  test('the same credential cannot be taken up twice', async ({ page }) => {
    await seedDevice(page, OUT);
    await open(page, '/terminal/standing/');
    await page.getByRole('button', { name: /^reliable$/i }).click();
    const blob = await page.locator('pre.blob').innerText();

    await page.locator('#cred').fill(blob);
    await page.getByRole('button', { name: /take it up/i }).click();
    await page.locator('#cred').fill(blob);
    await page.getByRole('button', { name: /take it up/i }).click();
    await expect(page.getByText(/already hold that one/i)).toBeVisible();
  });

  test('refuses something that is not a credential', async ({ page }) => {
    await seedDevice(page, OUT);
    await open(page, '/terminal/standing/');
    await page.locator('#cred').fill('not a credential');
    await page.getByRole('button', { name: /take it up/i }).click();
    await expect(page.getByText(/not a credential|not signed/i)).toBeVisible();
  });
});

test.describe('who may hold a watch', () => {
  test('whoever started it can, because founding needs nobody', async ({ page }) => {
    // 7.2. Gating on an endorsement alone would brick a new squad: nobody has standing, so
    // nobody can take watch, so the watch is unusable.
    await seedDevice(page, OUT);
    await open(page, '/terminal/watch/');
    await page.getByRole('button', { name: /start a watch on this phone/i }).click();

    await expect(page.getByRole('button', { name: /take the watch/i })).toBeVisible();
    await expect(page.getByText(/you started this watch/i)).toBeVisible();
  });

  test('somebody handed the key cannot, until somebody says they can', async ({ page }) => {
    // 7.3, and the spec violation it closes: the-watch.md specifies `can take watch` as the
    // qualification and Milestone 4 shipped a watch anybody could take.
    await seedDevice(page, OUT);
    await open(page, '/terminal/watch/');
    await page.locator('#key').fill('c'.repeat(64));
    await page.getByRole('button', { name: /^join$/i }).click();

    await expect(page.locator('[data-ungated]')).toBeVisible();
    await expect(page.getByRole('button', { name: /take the watch/i })).toHaveCount(0);
  });

  test('and can once they hold the credential, which names who vouched', async ({ page }) => {
    await seedDevice(page, OUT);
    // Write and take up a `can take watch` credential first.
    await open(page, '/terminal/standing/');
    await page.getByRole('button', { name: /^can take watch$/i }).click();
    const blob = await page.locator('pre.blob').innerText();
    await page.locator('#cred').fill(blob);
    await page.getByRole('button', { name: /take it up/i }).click();

    await open(page, '/terminal/watch/');
    await page.locator('#key').fill('c'.repeat(64));
    await page.getByRole('button', { name: /^join$/i }).click();

    const vouchers = page.locator('[data-vouchers]');
    await expect(vouchers).toBeVisible();
    // Provenance by name, never a count.
    await expect(vouchers).toContainText('Wren');
    // 7.4: the claim and its limit together.
    await expect(vouchers).toContainText(/not a\s+promise that you will stay awake/i);
    await expect(page.getByRole('button', { name: /take the watch/i })).toBeVisible();
  });
});

test.describe('patrols', () => {
  test('whether the history survives a wipe is a control, not a setting somebody has to find', async ({ page }) => {
    await seedDevice(page, OUT);
    await open(page, '/terminal/patrols/');

    const toggle = page.getByRole('button', { name: /panic wipe/i });
    await expect(toggle).toBeVisible();

    // Off by default: the Protest Medic needs a phone that is useless to whoever takes it.
    await expect(page.getByText(/are destroyed by a panic wipe/i)).toBeVisible();
    await toggle.click();
    await expect(page.getByText(/survive a panic wipe/i)).toBeVisible();
  });

  /**
   * The export's note switch — the exact failure this whole file exists for.
   *
   * `includeNotes` was declared in `ExportOptions` and honoured by `exportPatrols` from the
   * start, and no screen ever bound it. Every unit test passed, because the logic was right.
   * It read as permanently on, so the riskiest free text in the system had no reachable
   * switch in the one artifact built to be pasted somewhere public.
   */
  test('the note switch is on the page, off by default, and actually changes what would go', async ({ page }) => {
    const note = 'two handouts at the underpass';
    await seedDevice(page, {
      ...OUT,
      keepPatrolHistory: true,
      accruing: {
        patrols: [
          { started: 1_800_000_000, ended: 1_800_009_000, area: 'Downtown', note }
        ]
      }
    });
    await open(page, '/terminal/patrols/');

    await page.getByRole('button', { name: /show what would be shared/i }).click();
    const shared = page.locator('[data-export]');
    await expect(shared).toBeVisible();

    // Default: the night is there and the operator's own words are not.
    await expect(shared).toContainText('Downtown');
    await expect(shared).not.toContainText(note);

    const notes = page.getByRole('checkbox', { name: /include your notes/i });
    await expect(notes).toBeVisible();
    await expect(notes).not.toBeChecked();

    await notes.check();
    await expect(shared).toContainText(note);

    // And back, so this is a control rather than a one-way door.
    await notes.uncheck();
    await expect(shared).not.toContainText(note);
    await expect(shared).toContainText('Downtown');
  });
});

test.describe('a phone that has run out of room', () => {
  /**
   * The failure that is invisible by construction.
   *
   * Nothing throws, the screen does exactly what it was going to do, and the operator finds
   * out later by looking for something that is not there. It was reported on one screen,
   * read once at mount — so an operator anywhere else was told nothing at all.
   */
  const refuseWrites = (page: import('@playwright/test').Page) =>
    page.addInitScript(() => {
      /*
       * Patched on `Storage.prototype`, not on the `localStorage` instance.
       *
       * Assigning to the instance works on Chromium and **silently does not stick on
       * WebKit**, so this shim quietly stopped simulating anything there: no quota error, no
       * banner, and a failure that reads exactly like the app not reporting. Which matters
       * more than the tidiness, because iOS is the platform with the tighter quota — the one
       * where running out of room is least hypothetical.
       */
      const proto = Storage.prototype;
      const real = proto.setItem;
      let armed = false;
      // Armed after the seed lands, so the device still starts as a configured operator.
      queueMicrotask(() => {
        armed = true;
      });
      proto.setItem = function (key: string, value: string) {
        if (armed && key.startsWith('navcom.')) {
          const e = new Error('exceeded the quota');
          e.name = 'QuotaExceededError';
          throw e;
        }
        return real.call(this, key, value);
      };
    });

  test('says so on the screen the operator is actually looking at', async ({ page }) => {
    await seedDevice(page, OUT);
    await refuseWrites(page);
    await open(page, '/terminal/setup/');

    // Any write will do — the point is that the report does not depend on which screen it
    // happened on, or on the operator going to Status to ask.
    await page.locator('#clabel').fill('Sam');
    await page.locator('#cnumber').fill('+1 555 0100');
    await page.getByRole('button', { name: /^save$/i }).click();

    await expect(page.locator('[data-storage-full]')).toBeVisible();
    await expect(page.locator('[data-storage-full]')).toContainText(/out of storage/i);
  });

  test('and says what would free some, rather than only that it failed', async ({ page }) => {
    await seedDevice(page, OUT);
    await refuseWrites(page);
    await open(page, '/terminal/setup/');

    await page.locator('#clabel').fill('Sam');
    await page.locator('#cnumber').fill('+1 555 0100');
    await page.getByRole('button', { name: /^save$/i }).click();

    // An error that names no action is a notification that something is wrong.
    await expect(page.locator('[data-storage-full]')).toContainText(/clearing an area/i);
  });
});

test.describe('being flooded with pairing requests', () => {
  /**
   * The one place a stranger's traffic reaches the operator's screen without consent — the
   * contact key is published, because that is what a card is for.
   *
   * This is also the first browser test in the suite that needed anything to *arrive*.
   * Until the harness could replay relay traffic, everything a peer or a watch sends was
   * reachable only in unit tests with the pool mocked out.
   */
  test('says it is being flooded, and the way out is a control on the screen', async ({ page }) => {
    const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const { buildInvite } = await import('@navcom/core');
    const mine = Uint8Array.from(
      (TEST_SECRET.match(/../g) ?? []).map((b) => parseInt(b, 16))
    );
    const myPubkey = getPublicKey(mine);

    const events = [];
    for (let i = 0; i < 60; i++) {
      events.push(buildInvite(generateSecretKey(), myPubkey, { callsign: `Stranger${i}` }, 1_800_000_000 + i));
    }
    await seedDevice(page, { callsign: 'Wren', relayEvents: events });
    await open(page, '/terminal/peers/');

    const banner = page.locator('[data-invites-flooded]');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText(/turned away/i);

    // A cap the operator cannot clear would be worse than the flood.
    const clear = page.locator('[data-ignore-all]');
    await expect(clear).toBeVisible();
    await clear.click();
    await expect(banner).toHaveCount(0);
  });
});

test.describe('pairing when the reply cannot be sent', () => {
  /**
   * Pairing is two halves and only one of them is local. The publish result was discarded,
   * so an operator accepting with no signal — the ordinary state of a field terminal —
   * added the peer to their own list, sent nothing, and was told nothing.
   *
   * For a buddy that means nobody is watching while they believe somebody is.
   */
  test('says the pairing is one-sided instead of looking finished', async ({ page }) => {
    const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const { buildInvite } = await import('@navcom/core');
    const mine = Uint8Array.from((TEST_SECRET.match(/../g) ?? []).map((b) => parseInt(b, 16)));

    const raven = generateSecretKey();
    const ask = buildInvite(raven, getPublicKey(mine), { callsign: 'Raven' }, 1_800_000_000);

    await seedDevice(page, { callsign: 'Wren', relayEvents: [ask], refusePublish: true });
    await open(page, '/terminal/peers/');

    await expect(page.getByText('Raven')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /^accept$/i }).click();

    const warning = page.locator('[data-half-paired]');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(/they do not have you/i);
    await expect(warning).toContainText(/will not see your patrols/i);

    // And the request is still there, because tapping Accept again is the retry.
    await expect(page.getByRole('button', { name: /^accept$/i })).toBeVisible();
  });
});

test.describe('a region board with more cards than it can show', () => {
  /**
   * The region tag is public — that is what a board is for — so anybody may publish a card
   * into somebody else's area. Unbounded, each arrival copied the whole map: the same
   * quadratic intake the pairing inbox had, on the screen with the wider door.
   */
  test('says it is partial, so a missing name is not read as an absence', async ({ page }) => {
    const { generateSecretKey } = await import('nostr-tools/pure');
    const { buildCard } = await import('@navcom/core');

    const events = [];
    for (let i = 0; i < 240; i++) {
      events.push(buildCard(generateSecretKey(), {
        callsign: `Op${i}`, region: 'st-louis', doing: null, lightning: null
      }, 1_800_000_000 + i));
    }

    await seedDevice(page, { callsign: 'Wren', relayEvents: events });
    await open(page, '/terminal/find/');
    await page.locator('select').selectOption('st-louis');

    const notice = page.locator('[data-board-partial]');
    await expect(notice).toBeVisible({ timeout: 10_000 });
    await expect(notice).toContainText(/part of the board/i);
    // And it points at the thing that does work.
    await expect(notice).toContainText(/ask them for their code/i);
  });
});

test.describe('a watch board under a flood', () => {
  /**
   * `20911` is a separate kind precisely so a client can prioritise it independently of
   * routine traffic, and `buildDistress` says so in as many words: *"Distress gets its own
   * kind so it is never queued behind routine traffic."* The board put it in one queue
   * sorted by arrival, coloured red and otherwise equal.
   *
   * Red is not prioritisation if you have to scroll past a hundred queries to find it.
   */
  test('shows Distress above the routine traffic, not somewhere inside it', async ({ page }) => {
    const { generateSecretKey, finalizeEvent, getPublicKey } = await import('nostr-tools/pure');
    const { buildSignal, buildDistress } = await import('@navcom/core');
    const mine = Uint8Array.from((TEST_SECRET.match(/../g) ?? []).map((b) => parseInt(b, 16)));

    // The watch this phone holds. Signals are addressed to the watch and sealed to the
    // members' own keys — one key for a box, one per phone for a squad.
    const watchSecret = 'b'.repeat(63) + '2';
    const watchPub = getPublicKey(
      Uint8Array.from((watchSecret.match(/../g) ?? []).map((b) => parseInt(b, 16)))
    );
    const to = { pubkey: watchPub, holders: [getPublicKey(mine)] };

    const events = [];
    for (let i = 0; i < 40; i++) {
      const sender = generateSecretKey();
      events.push(finalizeEvent(
        buildSignal(sender, to, 'query', { text: `where is a bed ${i}`, area: 'north' }, 1_800_000_000 + i),
        sender
      ));
    }
    const hurt = generateSecretKey();
    events.push(finalizeEvent(
      buildDistress(hurt, to, { position: null, area: 'north side' }, 1_800_009_999),
      hurt
    ));

    await seedDevice(page, { callsign: 'Wren', watchSecret, relayEvents: events });
    await open(page, '/terminal/watch/');

    const distressHeading = page.getByRole('heading', { name: 'Distress' });
    await expect(distressHeading).toBeVisible({ timeout: 10_000 });

    // Above "Waiting on you" in the document, which is what "prioritise" has to mean on a
    // screen somebody reads at 2am.
    const waitingHeading = page.getByRole('heading', { name: /waiting on you/i });
    const order = await distressHeading.evaluate(
      (d, w) => d.compareDocumentPosition(w as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
      await waitingHeading.elementHandle()
    );
    expect(order).toBeTruthy();
  });
});

test.describe('a watch that cannot reach a relay', () => {
  /**
   * Being on station is a claim made to other people. A holder whose screen says "On
   * station" while nothing was published is covering nobody, and the publish result was
   * discarded, so they had no way to find out.
   */
  test('says nobody can see it, rather than showing a watch nobody is reading', async ({ page }) => {
    const watchSecret = 'c'.repeat(63) + '3';
    await seedDevice(page, { callsign: 'Wren', watchSecret, refusePublish: true });
    await open(page, '/terminal/watch/');

    await holdUntil(page, 'button:has-text("take the watch")');

    const warning = page.locator('[data-unannounced]');
    await expect(warning).toBeVisible({ timeout: 10_000 });
    await expect(warning).toContainText(/nobody can see this watch/i);
    // And it says what an operator signing on will actually read.
    await expect(warning).toContainText(/will read Dark/i);
  });
});

test.describe('being shown Dark, and being told why', () => {
  /**
   * `readWatchStateAt` distinguishes four reasons for Dark and the screen explained two of
   * them. The two it skipped are exactly the cases where an operator **has** a watch
   * configured and is being shown Dark — which is when they most need to know why, because
   * the fixes are different and neither is guessable.
   */
  const watch = { pubkey: 'e'.repeat(63) + '5', relays: ['wss://fake.relay'] };

  test('says when the relays have nothing at all from a configured watch', async ({ page }) => {
    // Distinct from "no watch", which is somebody who chose to work alone.
    await seedDevice(page, { callsign: 'Wren', watchtower: watch, relayEvents: [] });
    await open(page, '/terminal/');

    const said = page.locator('[data-watch-absent]');
    await expect(said).toBeVisible({ timeout: 10_000 });
    await expect(said).toContainText(/not serving anything/i);
    // Both fixes named, because neither is guessable from "Dark".
    await expect(said).toContainText(/relay list/i);
    await expect(said).toContainText(/not running/i);
  });

  test('says when the watch is publishing something it cannot read', async ({ page }) => {
    const { finalizeEvent, generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    // A generated key, not a hand-written one: `ffff…` is above the curve order.
    const secret = generateSecretKey();
    const garbled = finalizeEvent(
      { kind: 10910, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'not json at all' },
      secret
    );

    await seedDevice(page, {
      callsign: 'Wren',
      watchtower: { pubkey: getPublicKey(secret), relays: ['wss://fake.relay'] },
      relayEvents: [garbled]
    });
    await open(page, '/terminal/');

    const said = page.locator('[data-watch-corrupt]');
    await expect(said).toBeVisible({ timeout: 10_000 });
    await expect(said).toContainText(/none of it can be read/i);
    await expect(said).toContainText(/safe answer/i);
  });

  /*
   * The other two of the four.
   *
   * `absent` and `corrupt` above were added because the screen did not explain them.
   * `clock` and `stale` it did explain — and nothing anywhere, unit or browser, ever
   * checked that the explanation renders. Explained-but-undriven is the state this project
   * keeps finding on the wrong side of "a mechanism nobody can reach is not built", and
   * `clock` is the one that matters most off the network: a phone hours out is ordinary on
   * a cheap handset that has been off, and every staleness judgement in the app is
   * arithmetic on the difference.
   */
  async function stateAt(secondsFromNow: number) {
    const { finalizeEvent, generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const { buildWatchStateEvent } = await import('@navcom/core');
    const secret = generateSecretKey();
    const at = Math.floor(Date.now() / 1000) + secondsFromNow;
    const event = finalizeEvent(
      buildWatchStateEvent(
        { state: 'station', since: at - 60, holder: 'Watchtower', holder_kind: 'node',
          oncall: [], agent_health: 'ok', last_drill: null, now: at } as never,
        at
      ),
      secret
    );
    return { pubkey: getPublicKey(secret), event };
  }

  test('says the phone is what is wrong when the watch is stamped in its future', async ({ page }) => {
    // An hour ahead — far past CLOCK_TOLERANCE_SECONDS (120), which is deliberately
    // generous so relay delivery and an unsynced wake do not trip it.
    const w = await stateAt(3600);
    await seedDevice(page, {
      callsign: 'Wren',
      watchtower: { pubkey: w.pubkey, relays: ['wss://fake.relay'] },
      relayEvents: [w.event]
    });
    await open(page, '/terminal/');

    const said = page.locator('[data-clock-skew]');
    await expect(said).toBeVisible({ timeout: 10_000 });
    // The fix, which is on the phone and nowhere in this app.
    await expect(page.getByText(/automatic date and time/i)).toBeVisible();
    // And that Dark here is the safe answer rather than the true one — an operator who
    // reads it as "my watch is down" would go and fix the wrong thing.
    await expect(page.getByText(/safe answer rather than the true one/i)).toBeVisible();
  });

  test('says how old the last word is when a watch has stopped saying anything', async ({ page }) => {
    // Older than STALE_AFTER_SECONDS (300). The relay is still serving the last message,
    // which is exactly why this cannot be left reading as a live watch.
    const w = await stateAt(-900);
    await seedDevice(page, {
      callsign: 'Wren',
      watchtower: { pubkey: w.pubkey, relays: ['wss://fake.relay'] },
      relayEvents: [w.event]
    });
    await open(page, '/terminal/');

    await expect(page.getByText(/last word was \d+s ago/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/old is treated as dark/i)).toBeVisible();
  });
});

test.describe('the post-quantum cover notice', () => {
  test('names who has to open the app, rather than counting them', async ({ page }) => {
    // The sentence asks the operator to get somebody to open the app, and a number does not
    // say who to ask. This project's rule is provenance by name for exactly that reason.
    const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const raven = getPublicKey(generateSecretKey());

    await seedDevice(page, {
      callsign: 'Wren',
      peers: [{ pubkey: raven, callsign: 'Raven', since: 1_800_000_000 }]
    });
    await open(page, '/terminal/');

    const notice = page.locator('p.cover');
    await expect(notice).toBeVisible({ timeout: 10_000 });
    await expect(notice).toContainText('Raven');
    await expect(notice).not.toContainText(/\d+ people you send to/);
    // Still a note about what is missing, not a warning that something is broken.
    await expect(notice).toContainText(/Unreadable by anyone now/i);
  });
});

test.describe('a correction made where there is no signal', () => {
  /**
   * The operator with the best knowledge is the one standing at the door, and standing at
   * the door is where the signal is worst. The correction was held locally and published
   * once; if that failed it was never sent again — while appearing in the operator's own
   * directory, so they had positive evidence it had worked.
   */
  test('tells the operator it has not reached anybody yet', async ({ page }) => {
    const { generateSecretKey } = await import('nostr-tools/pure');
    const { buildCorrection } = await import('@navcom/core');
    const stuck = buildCorrection(generateSecretKey(), {
      record: 'st-louis-0001', verified_by: 'Wren', method: 'in_person',
      last_verified: '2026-08-21', fields: { hours: '24/7' }
    }, 1_800_000_000);

    // Started in the state rather than driven to it: what is under test is whether the
    // operator is told, not whether a form works.
    await seedDevice(page, {
      callsign: 'Wren',
      refusePublish: true,
      accruing: { corrections_unsent: { [stuck.id]: stuck } }
    });
    await open(page, '/terminal/directory/st-louis/');

    const notice = page.locator('[data-corrections-unsent]');
    await expect(notice).toBeVisible({ timeout: 10_000 });
    await expect(notice).toContainText(/has not reached a relay yet/i);
    // And says what happens next, because a notice you cannot act on is just worry.
    await expect(notice).toContainText(/go out on their own/i);
  });
});

test.describe('taking back an endorsement', () => {
  /**
   * `revoke` and `isRevokedBy` were both in core, `identity.md` said endorsers publish a
   * revocation checked when online, and the client neither published one nor ever looked.
   * An endorser who learned somebody was unsafe had no way to take it back — and
   * `can take watch` is the gate on who may hold a board.
   */
  test('is a control an endorser can actually reach', async ({ page }) => {
    await seedDevice(page, { callsign: 'Wren' });
    await open(page, '/terminal/standing/');

    // Vouch for somebody, which is what creates something to take back.
    await page.getByRole('button', { name: /can take watch/i }).first().click();
    await expect(page.getByRole('heading', { name: /what you have vouched for/i }))
      .toBeVisible({ timeout: 10_000 });

    const takeBack = page.locator('[data-withdraw]').first();
    await expect(takeBack).toBeVisible();
    await takeBack.click();

    // Gone from the list, because it is no longer something this operator stands behind.
    await expect(page.locator('[data-withdraw]')).toHaveCount(0);
  });

  test('says when the withdrawal has not reached anybody else yet', async ({ page }) => {
    // Honoured on this device either way — the endorser has decided — but everybody else
    // still sees the credential until it publishes.
    await seedDevice(page, { callsign: 'Wren', refusePublish: true });
    await open(page, '/terminal/standing/');

    await page.getByRole('button', { name: /can take watch/i }).first().click();
    await page.locator('[data-withdraw]').first().click();

    const notice = page.locator('[data-withdrawal-unsent]');
    await expect(notice).toBeVisible({ timeout: 10_000 });
    await expect(notice).toContainText(/stopped honouring what you took back/i);
    await expect(notice).toContainText(/did not reach a relay/i);
  });
});

test.describe('standing that was taken back', () => {
  /**
   * One of these is the gate on holding a board. Filtering a withdrawn endorsement out of
   * `held` is correct and, on its own, silent — an operator who could take the watch
   * yesterday and cannot today would find out at the moment they tried.
   */
  test('is named on the screen, with who took it back', async ({ page }) => {
    const { generateSecretKey } = await import('nostr-tools/pure');
    const { writeCredential, revoke, claimCredential } = await import('@navcom/core');
    const mine = Uint8Array.from((TEST_SECRET.match(/../g) ?? []).map((b) => parseInt(b, 16)));

    const raven = generateSecretKey();
    const credential = writeCredential(
      raven, { scope: 'can-take-watch', endorser: 'Raven', at: '2026-08-01' }, 1_800_000_000
    );
    const claim = claimCredential(mine, credential, 1_800_000_001);
    const withdrawal = revoke(raven, credential.id, 1_800_009_999);

    await seedDevice(page, {
      callsign: 'Wren',
      accruing: {
        endorsements: [{ credential, claim }],
        revocations: [withdrawal]
      }
    });
    await open(page, '/terminal/standing/');

    const list = page.locator('[data-withdrawn]');
    await expect(list).toBeVisible({ timeout: 10_000 });
    await expect(list).toContainText('Raven');
    await expect(list).toContainText(/no longer counts/i);
  });

  test('and the watch gate closes with it', async ({ page }) => {
    // The consequence that matters: holding a board means operators go out believing a named
    // human is reading what they send.
    const { generateSecretKey } = await import('nostr-tools/pure');
    const { writeCredential, revoke, claimCredential } = await import('@navcom/core');
    const mine = Uint8Array.from((TEST_SECRET.match(/../g) ?? []).map((b) => parseInt(b, 16)));

    const raven = generateSecretKey();
    const credential = writeCredential(
      raven, { scope: 'can-take-watch', endorser: 'Raven', at: '2026-08-01' }, 1_800_000_000
    );
    const claim = claimCredential(mine, credential, 1_800_000_001);

    await seedDevice(page, {
      callsign: 'Wren',
      watchSecret: 'd'.repeat(63) + '7',
      accruing: {
        endorsements: [{ credential, claim }],
        revocations: [revoke(raven, credential.id, 1_800_009_999)],
        // Joined rather than founded, so the gate is what decides.
        watch_founded: false
      }
    });
    await open(page, '/terminal/watch/');

    await expect(page.locator('[data-ungated]')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /take the watch/i })).toHaveCount(0);
  });
});

test.describe('an endorsement dated in the future', () => {
  /**
   * The screen had its own age arithmetic with a `Math.max(0, …)` clamp, so a credential
   * dated 2099 rendered "0 days ago" — the freshest possible — and never aged. That defeats
   * the one mechanism this design uses instead of expiry: show the age and let the reader
   * weigh it.
   */
  test('says it is not an age you can weigh, rather than showing it as fresh', async ({ page }) => {
    const { generateSecretKey } = await import('nostr-tools/pure');
    const { writeCredential, claimCredential } = await import('@navcom/core');
    const mine = Uint8Array.from((TEST_SECRET.match(/../g) ?? []).map((b) => parseInt(b, 16)));

    const raven = generateSecretKey();
    const credential = writeCredential(
      raven, { scope: 'medic', endorser: 'Raven', at: '2099-01-01' }, 1_800_000_000
    );
    const claim = claimCredential(mine, credential, 1_800_000_001);

    await seedDevice(page, {
      callsign: 'Wren',
      accruing: { endorsements: [{ credential, claim }] }
    });
    await open(page, '/terminal/standing/');

    const said = page.locator('[data-unweighable]');
    await expect(said).toBeVisible({ timeout: 10_000 });
    await expect(said).toContainText(/not an age you can weigh/i);
    await expect(page.getByText('0 days ago')).toHaveCount(0);
  });
});

test.describe('whether this operator has a backup', () => {
  /**
   * The screen stated the rule — *"a backup you never made does not exist"* — and the app had
   * no way to tell an operator which of those two people they were, nor that a backup made
   * before they had any standing does not hold it.
   */
  test('says plainly when they have never made one', async ({ page }) => {
    await seedDevice(page, { callsign: 'Wren' });
    await open(page, '/terminal/backup/');

    const said = page.locator('[data-never-backed-up]');
    await expect(said).toBeVisible({ timeout: 10_000 });
    await expect(said).toContainText(/not made one on this phone/i);
    await expect(said).toContainText(/lost phone is a lost persona/i);
  });

  test('says how old the one they have is', async ({ page }) => {
    // Standing is built over years and peers accumulate, so a backup made before any of that
    // does not hold it — a safety net for a version of themselves that no longer exists.
    await seedDevice(page, {
      callsign: 'Wren',
      accruing: { backup_made: '2026-03-14' }
    });
    await open(page, '/terminal/backup/');

    const said = page.locator('[data-backup-age]');
    await expect(said).toBeVisible({ timeout: 10_000 });
    await expect(said).toContainText(/days ago/i);
    await expect(said).toContainText(/is\s+not\s+in\s+it/i);
    await expect(page.locator('[data-never-backed-up]')).toHaveCount(0);
  });
});

test.describe('lines jotted at a door', () => {
  /**
   * The warm half of *capture cold, correct warm*.
   *
   * `notes.ts` designs the loop explicitly: jot the line standing in the rain, turn it into a
   * correction somewhere with light and both hands. The cold half shipped. The warm half had
   * **no prompt at all** — `notes()` was read by exactly one screen, the region page where the
   * note was written, so an operator had to remember unaided that they had anything waiting.
   *
   * This matters past tidiness: a field-captured correction is the only thing that improves
   * the directory without waiting on a maintainer, and the directory's thin half is what
   * gates Milestone 8.
   */
  const JOTTED = {
    'st-louis-our-ladys-inn': 'intake shut at 20:30, not 22:00 like the listing says',
    'st-louis-example-shelter': 'side door only after 9'
  };

  test('are counted where the operator will see them, not only where they were written', async ({ page }) => {
    await seedDevice(page, OUT);
    await page.addInitScript((n) => {
      const w = JSON.parse(localStorage.getItem('navcom.wipeable') ?? '{}');
      w.record_notes = n;
      localStorage.setItem('navcom.wipeable', JSON.stringify(w));
    }, JOTTED);
    await open(page, '/terminal/');

    const slot = page.locator('[data-notes-waiting]');
    await expect(slot).toBeVisible();
    await expect(slot).toContainText('2 waiting');
    // A count of your own unfinished errands, never a score. Nothing chases it.
    await expect(slot).not.toContainText(/streak|keep it up|well done/i);
  });

  test('and nothing is shown when there are none', async ({ page }) => {
    // The guard for the rule above: a slot that renders unconditionally would tell every
    // operator they have work waiting, which is a nag rather than a state.
    await seedDevice(page, OUT);
    await open(page, '/terminal/');
    await expect(page.locator('[data-notes-waiting]')).toHaveCount(0);
  });

  test('and coming home is where the app actually asks for them', async ({ page }) => {
    /*
     * The moment `notes.ts` names. Standing down is the operator arriving somewhere with
     * light and both hands, and it is deliberately not asked for mid-patrol -- chasing
     * somebody who is still out would be the app tasking them, which nothing here does.
     */
    const now = Math.floor(Date.now() / 1000);
    await seedDevice(page, OUT);
    await page.addInitScript(
      (s) => {
        localStorage.setItem('navcom.wipeable', JSON.stringify({ signon: s.on, record_notes: s.n }));
      },
      { on: { at: now - 3600, area: 'Downtown', expectedUntil: now + 3600, toldAtSignOn: 'nobody is on call', routineInterval: null }, n: JOTTED }
    );
    await open(page, '/terminal/');

    await page.getByRole('button', { name: /stand down/i }).click();
    await page.getByRole('button', { name: /i'm home/i }).click();

    const home = page.locator('[data-came-home]');
    await expect(home).toBeVisible({ timeout: 15_000 });
    await expect(home.locator('[data-notes-home]')).toBeVisible();
    await expect(home.locator('[data-notes-home]')).toContainText('2 notes');
    // The honest limit, said where it changes what somebody does tonight.
    await expect(home).toContainText(/panic wipe destroys them/i);
  });
});

test.describe('what you contributed, as something you can hand over', () => {
  /**
   * `propagation.md` §2 and the brief's 2.2 / 5.4 / 7.1 all converge on one artifact: a
   * readable account of the work, for a grant committee or for somebody sneering that none of
   * it is real. It is deliberately **not** "export everything" — the accruing tier also holds
   * peers and endorsements, and a readable file of those is an association graph.
   */
  const CORRECTION = {
    record: 'st-louis-our-ladys-inn',
    verified_by: 'Wren',
    method: 'in_person',
    last_verified: '2026-03-14',
    fields: { intake_hours: '20:30' },
    by: 'MINE'
  };
  const THEIRS = { ...CORRECTION, record: 'st-louis-not-mine', by: 'c'.repeat(64) };

  /**
   * Seeds storage the way the app writes it, with this device's own key as the author.
   *
   * The pubkey is derived here rather than read from storage: only the secret is persisted,
   * and `loadIdentity` computes the public half on every call.
   */
  async function withWork(page: import('@playwright/test').Page, patrols: unknown[]) {
    const { getPublicKey } = await import('nostr-tools/pure');
    const mine = getPublicKey(
      Uint8Array.from((TEST_SECRET.match(/../g) ?? []).map((b) => parseInt(b, 16)))
    );
    await seedDevice(page, OUT);
    await page.addInitScript(
      (d) => {
        const me = JSON.parse(localStorage.getItem('navcom.accruing') ?? '{}');
        const fix = (c: Record<string, unknown>) => ({ ...c, by: c.by === 'MINE' ? d.mine : c.by });
        me.corrections = { a: fix(d.correction), b: fix(d.theirs) };
        me.patrols = d.patrols;
        localStorage.setItem('navcom.accruing', JSON.stringify(me));
      },
      { correction: CORRECTION, theirs: THEIRS, patrols, mine }
    );
    await open(page, '/terminal/patrols/');
    await page.getByRole('button', { name: /show what would be shared/i }).click();
    return page.locator('[data-export]');
  }

  test('gathers the corrections this operator actually wrote', async ({ page }) => {
    /*
     * This is the test that catches the bug this feature nearly shipped with. `corrections.all`
     * reads a `$state` that is empty until `start()` runs, and `start()` opens relay
     * subscriptions -- so on a screen that never calls it, the export rendered perfectly and
     * said "nothing yet" forever.
     */
    const shared = await withWork(page, [{ started: 1_800_000_000, ended: 1_800_012_600, area: 'Downtown' }]);
    await expect(shared).toBeVisible();
    await expect(shared).toContainText('st-louis-our-ladys-inn');
    await expect(shared).toContainText('1 correction');
  });

  test('and never somebody else’s, even held on the same phone', async ({ page }) => {
    // A device caches every correction it hears over a relay. Publishing a stranger's work
    // under your own callsign is both a false claim and a disclosure about somebody who
    // agreed to nothing.
    const shared = await withWork(page, [{ started: 1_800_000_000, ended: 1_800_012_600, area: 'Downtown' }]);
    await expect(shared).not.toContainText('st-louis-not-mine');
  });

  test('and an operator who only ever corrected records can still show it', async ({ page }) => {
    // The share section was gated on having recorded a patrol, so the person who fixes
    // listings from a phone and never logs a night was told they had nothing.
    const shared = await withWork(page, []);
    await expect(shared).toBeVisible();
    await expect(shared).toContainText('st-louis-our-ladys-inn');
    await expect(shared).toContainText('none recorded');
  });
});

test.describe('who nudges you when a check-in is missed', () => {
  /**
   * A sentence my own change made half-true.
   *
   * Sign-on read *"a missed check-in gets you a nudge"*, written when nothing sent one at
   * all. The watch now does — `watch-state.spec.md` requires the node to attempt contact with
   * an overdue operator — which made it true for somebody with a watch and left it false for
   * somebody without. **The operator without a watch is the default case**, and letting them
   * believe a nudge is coming is invariant 4 at the scale of one person.
   */
  test('with no watch, says plainly that nothing will send anything', async ({ page }) => {
    await seedDevice(page, OUT);
    await open(page, '/terminal/sign-on/');
    await expect(page.getByText(/nothing will send you anything/i)).toBeVisible();
    await expect(page.getByText(/your watch may send you one/i)).toHaveCount(0);
    // The half true for everybody, and the claim capabilities.ts checks against prerendered
    // HTML -- so it must not have moved behind the conditional.
    await expect(page.getByText(/never counts as distress/i)).toBeVisible();
  });

  test('with a watch, says the nudge is the only thing it ever sends unasked', async ({ page }) => {
    await seedDevice(page, {
      ...OUT,
      watchtower: { pubkey: 'b'.repeat(64), relays: ['wss://relay.example'] }
    });
    await open(page, '/terminal/sign-on/');
    await expect(page.getByText(/only thing it ever sends unasked/i)).toBeVisible();
    await expect(page.getByText(/nothing will send you anything/i)).toHaveCount(0);
    await expect(page.getByText(/never counts as distress/i)).toBeVisible();
  });

});

test.describe('finding which of these is closest', () => {
  /**
   * The one useful thing this screen can answer **without waiting on 6.9**.
   *
   * An address is enough to order by, so it works on the scraped skeletons whose intake rules
   * nobody has filled in — which is most of the directory, and the reason Milestone 8 is
   * gated. Not a map: the device floor is a prepaid Android 8, and `CLAUDE.md` refuses a map
   * outright. A sort.
   */
  const REGION = '/terminal/directory/st-louis/';

  test('is offered as a tap, never applied on arrival', async ({ page }) => {
    // Sorting on arrival would fire a permission prompt nobody asked for and reorder a list
    // somebody may have learned. Both are things that happen *to* an operator.
    await seedDevice(page, OUT);
    await open(page, REGION);
    const control = page.locator('[data-nearest]');
    await expect(control).toBeVisible();
    await expect(control).toContainText(/nearest first/i);
    await expect(page.locator('[data-nearest-on]')).toHaveCount(0);
  });

  test('says so plainly when the phone will not give a location', async ({ page }) => {
    /*
     * The console uses the same helper ambiently, where silence on refusal is right. Here the
     * operator tapped a button, and a button that does nothing without saying why is the worst
     * of both -- so this diverges from that module's own default deliberately.
     */
    await seedDevice(page, OUT);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: { getCurrentPosition: (_ok: unknown, err: (e: unknown) => void) => err({ code: 1 }) }
      });
    });
    await open(page, REGION);
    await page.locator('[data-nearest]').click();
    await expect(page.locator('[data-nearest-refused]')).toBeVisible();
    await expect(page.locator('[data-nearest-refused]')).toContainText(/order is unchanged/i);
  });

  test('reorders within each kind, and says the fix went nowhere', async ({ page }) => {
    await seedDevice(page, OUT);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition: (ok: (p: unknown) => void) =>
            ok({ coords: { latitude: 38.627, longitude: -90.199 } })
        }
      });
    });
    await open(page, REGION);

    // The grouping by type is how somebody navigates at a door. It must survive the sort.
    const groupsBefore = await page.locator('section.group').count();
    expect(groupsBefore).toBeGreaterThan(0);

    await page.locator('[data-nearest]').click();
    await expect(page.locator('[data-nearest-on]')).toBeVisible();
    await expect(page.locator('[data-nearest-on]')).toContainText(/sent nowhere/i);
    // Rounded to ~500m before it is ever held, so the page must not imply more precision.
    await expect(page.locator('[data-nearest-on]')).toContainText(/500m/i);
    expect(await page.locator('section.group').count()).toBe(groupsBefore);

    // And it is reversible -- the listed order is theirs to get back.
    await page.locator('[data-nearest]').click();
    await expect(page.locator('[data-nearest-on]')).toHaveCount(0);
  });
});

test.describe('what a Distress reaches when there is no watch', () => {
  /**
   * A belief gap, not a broken mechanism.
   *
   * `sendDistress` is addressed to the Watchtower and nothing else — it never reaches paired
   * peers, and `Assist` requires a watch. The screen already said "holding the button would
   * raise nobody", which is true and which the operator most likely to read past is exactly
   * the one who has paired with somebody: they have a person on their screen, and no reason
   * to know that pairing is visibility rather than a channel.
   *
   * Invariant 4 is about belief. This is the belief.
   */
  test('says peers are not told either, and says it to somebody who has one', async ({ page }) => {
    await seedDevice(page, {
      ...OUT,
      peers: [{ pubkey: 'c'.repeat(64), callsign: 'Raven', since: 1 }]
    });
    await open(page, '/terminal/distress/');

    const notice = page.locator('[data-no-watch]');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/raise nobody/i);
    await expect(notice).toContainText(/peers you have paired with are not told/i);
    // And why, rather than only that: pairing is visibility, and there is no channel back.
    await expect(notice).toContainText(/nothing here can reach them for you/i);
  });

  test('and says it before anybody has paired, not after', async ({ page }) => {
    // The same reason unpairing is explained above the pairing form: a limit learned after
    // you relied on it is a limit that already cost something.
    await seedDevice(page, OUT);
    await open(page, '/terminal/distress/');
    await expect(page.locator('[data-no-watch]')).toContainText(/peers you have paired with are not told/i);
  });

  test('and none of it appears once a watch exists', async ({ page }) => {
    // The guard against the notice becoming permanent furniture: with somewhere to send it,
    // this whole section is wrong and must be gone.
    await seedDevice(page, {
      ...OUT,
      watchtower: { pubkey: 'b'.repeat(64), relays: ['wss://relay.example'] }
    });
    await open(page, '/terminal/distress/');
    await expect(page.locator('[data-no-watch]')).toHaveCount(0);
  });
});
