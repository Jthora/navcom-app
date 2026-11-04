import { expect, test, type Browser, type Page } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { liveDevice, open } from './device';
import { hermetic, publish, RelayNet, type Hermetic } from './journey-harness';

/**
 * The joint night's edges: what happens to several teams under two holders when something goes
 * wrong in the middle of it, each walked on phones over relays on this machine.
 *
 * `journey.spec.ts` walks the night as it is meant to go. These are the ways it goes otherwise:
 * a holder's laptop reloads, both holders answer at once, a phone is in a tunnel when the watch
 * says something, somebody raises a Distress without ever signing on, thirty operators and six
 * teams on one board. Each is a story somebody on the Knicks night will live (2026-11-02), and each
 * crosses more than one screen, which is where a rule that holds on every screen can still fail.
 *
 * Phones here start seeded rather than walked through Setup, since the walk is the other file's;
 * what is real is everything after: real NIP-01 over a relay per address, real signing, real
 * sealing, and nothing reaching a public relay [journey-harness.ts]. `npm run test:journeys`.
 */

const DAMUS = 'wss://relay.damus.io';
const NOW = () => Math.floor(Date.now() / 1000);
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const bytes = (h: string) => Uint8Array.from((h.match(/../g) ?? []).map((x) => parseInt(x, 16)));

let net: RelayNet;
test.beforeEach(() => {
  net = new RelayNet();
});
test.afterEach(async () => {
  await net?.close();
});

/** One watch for the night: its key, and the two holders' own keys named in its code. */
function watchFor(...holders: string[]) {
  const watch = generateSecretKey();
  const keys = holders.map(() => generateSecretKey());
  return {
    secret: hex(watch),
    pubkey: getPublicKey(watch),
    holderSecrets: keys.map(hex),
    holderKeys: keys.map((k) => getPublicKey(k)),
    config() {
      return { pubkey: this.pubkey, relays: [DAMUS], holders: this.holderKeys };
    }
  };
}
type Watch = ReturnType<typeof watchFor>;

/** A phone holding the watch's key, on a page carried to this machine's relays. */
async function holderPhone(browser: Browser, watch: Watch, i: number, callsign: string): Promise<Hermetic> {
  const h = await hermetic(browser, net, { timezoneId: 'America/New_York' });
  await liveDevice(h.page, DAMUS, { callsign, secret: watch.holderSecrets[i], watchSecret: watch.secret, watchtower: watch.config() });
  await open(h.page, '/terminal/watch/');
  return h;
}

/** Holds the threshold control down as a finger does. */
async function take(page: Page) {
  const button = page.getByRole('button', { name: /hold to take the watch/i });
  await button.scrollIntoViewIfNeeded();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1500);
  await page.mouse.up();
  await expect(page.getByRole('button', { name: /^stand down$/i })).toBeVisible({ timeout: 15_000 });
}

/** An operator's phone that scanned the watch's code, and nothing more. */
async function operatorPhone(browser: Browser, watch: Watch, callsign: string, at?: [number, number]): Promise<Hermetic> {
  const where = at ? { permissions: ['geolocation'], geolocation: { latitude: at[0], longitude: at[1] } } : {};
  const h = await hermetic(browser, net, { timezoneId: 'America/New_York', ...where });
  await liveDevice(h.page, DAMUS, { callsign, secret: hex(generateSecretKey()), watchtower: watch.config() });
  return h;
}

/** Signs on from the screen, as an operator does. */
async function signOn(page: Page, area: string, team?: string, share?: 'exact' | 'rough') {
  await open(page, '/terminal/sign-on/');
  await page.locator('#area').fill(area);
  if (team) await page.locator('#team').fill(team);
  if (share) await page.locator('#share').selectOption(share);
  await page.getByRole('button', { name: /^sign on$/i }).click();
  await page.waitForURL('**/terminal/');
}

/** The newest watch state the relay holds, as an operator signing on now would read it. */
async function stateOnRelay(watch: Watch): Promise<{ state: string; holder: string | null } | null> {
  const relay = await net.of(DAMUS);
  const states = relay.received.filter((e) => e.kind === 10910 && e.pubkey === watch.pubkey);
  const newest = states.sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1))[0];
  return newest ? (JSON.parse(newest.content) as { state: string; holder: string | null }) : null;
}

test.describe('two holders on station at once', () => {
  test('one standing down leaves the other on station, and only the last one down says Dark', async ({ browser }) => {
    /*
     * running-a-night.md tells two holders to keep both Watch screens open, and a Watch screen only
     * sounds a Distress while it holds the watch, so on the joint night both hold it. Watch state is
     * one replaceable event under the shared key, and each heartbeat replaces the other's: whoever
     * took it last finds their own claim newest when they stand down, and the guard that keeps a
     * handover from saying Dark over the incoming holder read that as nobody else holding.
     */
    test.setTimeout(180_000);
    const watch = watchFor('Lighthouse', 'Relief');
    const a = await holderPhone(browser, watch, 0, 'Lighthouse');
    const r = await holderPhone(browser, watch, 1, 'Relief');
    const k = await operatorPhone(browser, watch, 'Kite');

    await take(a.page);
    await take(r.page);
    await expect.poll(async () => (await stateOnRelay(watch))?.holder, { timeout: 15_000 }).toBe('Relief');
    // Each sees the other keeping it too: the reading that would say if one of them went quiet.
    await expect(a.page.locator('[data-also-holding]')).toContainText('Relief', { timeout: 15_000 });
    await expect(a.page.locator('[data-also-holding]')).toContainText('claiming it too');
    await expect(r.page.locator('[data-also-holding]')).toContainText('Lighthouse', { timeout: 15_000 });

    // Relief goes home first, while Lighthouse holds on.
    await r.page.getByRole('button', { name: /^stand down$/i }).click();
    await expect(r.page.locator('[data-start-watch], button:has-text("take the watch")').first()).toBeVisible({ timeout: 15_000 });
    // Lighthouse's own beat is two minutes off: only her hearing Relief go puts her back this soon.
    await expect
      .poll(async () => JSON.stringify(await stateOnRelay(watch)), { timeout: 15_000, message: 'Relief left the watch reading Dark while Lighthouse holds it' })
      .toMatch(/"state":"station".*"holder":"Lighthouse"|"holder":"Lighthouse".*"state":"station"/);
    await open(k.page, '/terminal/');
    await expect(k.page.locator('[data-capability]')).toContainText(/on station/i, { timeout: 20_000 });

    // Then Lighthouse, the last holder: now the watch is honestly Dark.
    await a.page.getByRole('button', { name: /^stand down$/i }).click();
    await expect.poll(async () => (await stateOnRelay(watch))?.state, { timeout: 15_000 }).toBe('dark');

    for (const h of [a, r, k]) await h.context.close();
  });
});

/** Somebody out whom the test speaks for: an on-station signal signed and sealed in Node, as a phone would. */
async function outFromNode(watch: Watch, callsign: string, team: string, at: [number, number] | null = null) {
  const { buildSignal } = await import('@navcom/core');
  const key = generateSecretKey();
  const event = finalizeEvent(
    buildSignal(key, { pubkey: watch.pubkey, holders: watch.holderKeys }, 'on-station', {
      callsign, team, area: 'Midtown', expected_duration: 7200, routine_interval: null,
      share_position: at !== null, position: at ? { lat: at[0], lon: at[1], precision_m: 10 } : null
    } as never, NOW()),
    key
  );
  await publish(await net.of(DAMUS), event);
  return key;
}

/** Holds the Distress control down, as a finger does. */
async function raiseDistress(page: Page) {
  await open(page, '/terminal/distress/');
  const button = page.locator('button.raise');
  await button.scrollIntoViewIfNeeded();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1500);
  await page.mouse.up();
}

/** A holder telling the operator their Distress is heard. */
async function haveIt(page: Page) {
  await page.getByRole('button', { name: /tell them you are awake/i }).first().click({ timeout: 25_000 });
  const send = page.getByRole('button', { name: /^send$/i }).first();
  if (await send.isVisible()) await send.click();
}

test.describe('a holder’s laptop reloads in the middle of the night', () => {
  test('the relief has the Distress raised meanwhile, and the reloaded holder neither loses it nor says Dark over her', async ({ browser }) => {
    test.setTimeout(240_000);
    const watch = watchFor('Lighthouse', 'Relief');
    const r = await holderPhone(browser, watch, 1, 'Relief');
    const a = await holderPhone(browser, watch, 0, 'Lighthouse');
    const k = await operatorPhone(browser, watch, 'Kite');
    await take(r.page);
    await take(a.page);
    await signOn(k.page, 'Herald Sq', 'Rescue Rangers');
    await expect(a.page.locator('.nc-floor-row', { hasText: 'Kite' })).toBeVisible({ timeout: 25_000 });

    // Lighthouse's browser reloads, and Kite raises a Distress before her page is back.
    const reloading = a.page.reload();
    await raiseDistress(k.page);
    await reloading;
    await a.page.waitForSelector('html[data-hydrated="true"]');

    // Relief, still holding, has it and says so. Kite's phone names her.
    await expect(r.page).toHaveTitle(/^Distress · Watch/, { timeout: 25_000 });
    await haveIt(r.page);
    await expect(k.page.locator('body')).toContainText(/relief has it/i, { timeout: 25_000 });

    // Lighthouse's page came back off watch, still named on the relays: it says so, and the
    // Distress it missed is on her board, answered rather than waiting on her.
    await expect(a.page.locator('[data-orphaned]')).toBeVisible({ timeout: 25_000 });
    await expect(a.page.locator('[data-distress-answered]')).toBeVisible({ timeout: 25_000 });

    // The Stand down her screen offers is pressed, as somebody tidying up would: Relief is still
    // holding, so the watch must not read Dark to the operators out.
    await a.page.locator('[data-orphaned] button').click();
    await expect
      .poll(async () => JSON.stringify(await stateOnRelay(watch)), { timeout: 20_000, message: 'a reloaded holder tidying up left the watch reading Dark over the relief' })
      .toMatch(/"holder":"Relief"/);
    await open(k.page, '/terminal/');
    await expect(k.page.locator('[data-capability]')).toContainText(/on station/i, { timeout: 20_000 });

    // And she takes it back from the same screen.
    await take(a.page);
    await expect.poll(async () => (await stateOnRelay(watch))?.state, { timeout: 15_000 }).toBe('station');

    for (const h of [a, r, k]) await h.context.close();
  });
});

test.describe('both holders answer the same question at once', () => {
  test('the operator has an answer, nothing on their screen breaks, and it is off both boards', async ({ browser }) => {
    test.setTimeout(180_000);
    const watch = watchFor('Lighthouse', 'Relief');
    const a = await holderPhone(browser, watch, 0, 'Lighthouse');
    const r = await holderPhone(browser, watch, 1, 'Relief');
    const k = await operatorPhone(browser, watch, 'Kite');
    await take(a.page);
    await take(r.page);
    await signOn(k.page, 'Herald Sq', 'Rescue Rangers');

    await open(k.page, '/terminal/query/');
    await k.page.locator('#q').fill('Is the drop-in on 30th open?');
    await k.page.getByRole('button', { name: /^ask$/i }).click();

    // Each opens it and writes, neither seeing the other's yet; both press Send together.
    for (const [page, words] of [[a.page, 'Yes, all night.'], [r.page, 'Open until 6am.']] as const) {
      await page.getByRole('button', { name: /^answer$/i }).first().click({ timeout: 25_000 });
      await page.locator('textarea[id^="a-"]').first().fill(words);
    }
    await Promise.all([a.page, r.page].map((p) => p.getByRole('button', { name: /^send$/i }).first().click()));

    await expect(k.page.locator('[data-answer]')).toContainText(/all night|until 6am/, { timeout: 25_000 });
    await expect(k.page.locator('.error, [role="alert"]')).toHaveCount(0);
    for (const board of [a.page, r.page]) await expect(board.getByRole('button', { name: /^answer$/i })).toHaveCount(0, { timeout: 20_000 });

    for (const h of [a, r, k]) await h.context.close();
  });
});

test.describe('a phone in a tunnel when the watch says something', () => {
  test('is told it once it is heard again, and puts it down when the watch clears it', async ({ browser }) => {
    test.setTimeout(240_000);
    const watch = watchFor('Lighthouse');
    const a = await holderPhone(browser, watch, 0, 'Lighthouse');
    const v = await operatorPhone(browser, watch, 'Raven', [40.7506, -73.9935]);
    const k = await operatorPhone(browser, watch, 'Kite');
    await take(a.page);
    await signOn(v.page, 'Penn Station', 'Zone Guardians', 'exact');
    await signOn(k.page, 'Herald Sq', 'Rescue Rangers');
    await expect(a.page.locator('.nc-floor-row')).toHaveCount(2, { timeout: 25_000 });

    // Raven goes underground: her page is gone while the watch speaks.
    await v.page.close();
    await a.page.getByRole('button', { name: /^tell everyone out$/i }).click();
    await a.page.getByLabel(/^to everyone out$/i).fill('Police line across 8th Ave at 33rd. Go round by 9th.');
    await a.page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(a.page.locator('[data-told]')).toContainText('Police line', { timeout: 25_000 });
    await expect(k.page.locator('[data-notice-line], [data-notice-text]').first()).toContainText('Police line', { timeout: 25_000 });

    // She comes up again: the phone picks up where it was, and the notice reaches her.
    const back = await v.context.newPage();
    await open(back, '/terminal/');
    await expect(back.locator('[data-notice-text]')).toContainText('Police line', { timeout: 45_000 });
    await expect(back.locator('[data-station]')).toBeVisible();
    // Still one Raven on the board, not a second for the phone that came back.
    await expect(a.page.locator('.nc-floor-row', { hasText: 'Raven' })).toHaveCount(1);

    // The police line lifts; the watch clears it and both phones put it down.
    await a.page.locator('[data-tell-clear]').click();
    await expect(a.page.locator('[data-told-cleared]')).toBeVisible({ timeout: 25_000 });
    for (const page of [back, k.page]) {
      await open(page, '/terminal/');
      await expect(page.locator('[data-notice-text]')).toHaveCount(0, { timeout: 25_000 });
    }

    for (const h of [a, v, k]) await h.context.close();
  });
});

test.describe('a Distress from somebody who scanned the code and never signed on', () => {
  test('is on the board by the callsign it carries, first, and sounding', async ({ browser }) => {
    test.setTimeout(180_000);
    const watch = watchFor('Lighthouse');
    const a = await holderPhone(browser, watch, 0, 'Lighthouse');
    const o = await operatorPhone(browser, watch, 'Owl');
    await take(a.page);
    await outFromNode(watch, 'Kite', 'Rescue Rangers');
    await expect(a.page.locator('.nc-floor-row', { hasText: 'Kite' })).toBeVisible({ timeout: 25_000 });

    await raiseDistress(o.page);
    await expect(a.page).toHaveTitle(/^Distress · Watch/, { timeout: 25_000 });
    const first = a.page.locator('li.distress').first();
    await expect(first).toContainText('Owl', { timeout: 20_000 });
    // Never a key fragment standing in for a name the Distress itself carries.
    await expect(first.locator('.name')).not.toHaveText(/^[0-9a-f]{6,}/);
    await haveIt(a.page);
    await expect(o.page.locator('body')).toContainText(/lighthouse has it/i, { timeout: 25_000 });

    for (const h of [a, o]) await h.context.close();
  });
});

test.describe('thirty out, six teams, one board', () => {
  test('every one of them is on the board and the map, and narrowing to one team keeps up', async ({ browser }) => {
    /*
     * The Knicks night is four teams of about five; this is half again, so a board that copes with it
     * copes with the night. Thirty phones the test speaks for, in Midtown, each sharing where they are.
     */
    test.setTimeout(300_000);
    const watch = watchFor('Lighthouse');
    const a = await holderPhone(browser, watch, 0, 'Lighthouse');
    await take(a.page);
    // The watch held on a phone, and not a fast one: Chromium's CPU slowed four times, about a
    // prepaid Android against this machine.
    if (browser.browserType().name() === 'chromium') await (await a.context.newCDPSession(a.page)).send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const TEAMS = ['Rescue Rangers', 'Zone Guardians', 'Night Owls', 'Bronx Watch', 'Queens Guard', 'Visitors'];
    const callsigns: string[] = [];
    const started = Date.now();
    for (let i = 0; i < 30; i++) {
      const callsign = `Unit ${String(i + 1).padStart(2, '0')}`;
      callsigns.push(callsign);
      await outFromNode(watch, callsign, TEAMS[i % TEAMS.length]!, [40.745 + (i % 6) * 0.002, -73.995 + Math.floor(i / 6) * 0.002]);
    }

    await expect(a.page.locator('.nc-floor-row')).toHaveCount(30, { timeout: 60_000 });
    console.log(`[night] thirty signed on and on the board in ${Date.now() - started} ms`);
    for (const t of TEAMS) await expect(a.page.locator(`[data-teams] [data-team="${t}"]`)).toBeVisible();

    // One team chosen: its five, and nobody else's, in well under a second.
    const tapped = Date.now();
    await a.page.locator('[data-teams] [data-team="Night Owls"]').click();
    await expect(a.page.locator('.nc-floor-row')).toHaveCount(5, { timeout: 5_000 });
    expect(Date.now() - tapped, 'narrowing thirty to five took too long').toBeLessThan(2_000);
    await a.page.locator('[data-teams] button', { hasText: 'All' }).click();
    await expect(a.page.locator('.nc-floor-row')).toHaveCount(30);

    // The live map lists all thirty, each with their team.
    await a.page.locator('[data-live-map-link]').click();
    await a.page.waitForURL('**/terminal/map/');
    await a.page.locator('[data-view="radar"]').click();
    await expect(a.page.locator('[data-blip-list] [data-listed]')).toHaveCount(30, { timeout: 30_000 });
    await expect(a.page.locator('[data-radar] [data-blip]')).toHaveCount(30);

    await a.context.close();
  });
});

test.describe('a notice given before anybody is out', () => {
  test('stands for whoever signs on, and reaches them when they do', async ({ browser }) => {
    test.setTimeout(180_000);
    const watch = watchFor('Lighthouse');
    const a = await holderPhone(browser, watch, 0, 'Lighthouse');
    await take(a.page);
    // Eight o'clock, nobody out yet: the rally point for nine.
    await a.page.getByRole('button', { name: /^tell everyone out$/i }).click();
    await a.page.getByLabel(/^to everyone out$/i).fill('Rally at Herald Sq, 9pm, by the north entrance.');
    await a.page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(a.page.locator('[data-told]')).toContainText('to whoever signs on', { timeout: 15_000 });
    await expect(a.page.locator('[data-tell-failed]')).toHaveCount(0);

    const k = await operatorPhone(browser, watch, 'Kite');
    await signOn(k.page, 'Herald Sq', 'Rescue Rangers');
    await expect(k.page.locator('[data-notice-text]')).toContainText('Rally at Herald Sq', { timeout: 30_000 });
    for (const h of [a, k]) await h.context.close();
  });
});
