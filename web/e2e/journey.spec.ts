import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { hermetic, publish, RelayNet, shots } from './journey-harness';
import { admit, mission, resign, standInKey, type StandIn } from './registry';
import { screenAt } from './map';
import { openYou } from './device';

/**
 * Journeys: what a person does from a first visit, walked on a phone's screen, end to end.
 *
 * Every other spec here holds one screen to one rule. These hold the whole of a flow to whether a
 * person can get through it: from navcom.app to a callsign, a card, a mission taken, reported and
 * settled; a watch held on one phone and joined from another, a question and a `Distress` answered
 * across it; two strangers pairing from a city's board; Distress with no watch; a backup restored on
 * a new phone; panic wipe and burn; the directory and a place added from the field.
 *
 * Written after the first walk through them found what no screen-by-screen test had: the watch
 * screen handed operators an address that could not reach a phone holding the watch, every sign-on
 * under a working phone-held watch read "Failed", Status called a Distress addressed to the person
 * on station "No addressee", and finding somebody on a board was two words of a paragraph
 * [journey, 2026-10-28].
 *
 * Nothing in the page is faked. It keeps its own `WebSocket`, and every socket it opens, to any
 * address, is carried to a relay on this machine [journey-harness.ts] — so it speaks real NIP-01,
 * signs real events, and nothing it sends reaches a public relay. Missions come from a stand-in desk
 * admitted in what the test server sends [registry.ts]; the first journey's is Mecha Jono's own heat
 * package of 2 October, re-signed.
 *
 * Not in the deploy gate: a journey is minutes, not seconds, and two phones on one relay is a
 * sequence. `npm run test:journeys`. With `JOURNEY_OUT=<dir>` each step is also screenshotted and
 * what the screen says is printed, for walking a flow by eye.
 */

const OUT = process.env['JOURNEY_OUT'];
const NOW = Math.floor(Date.now() / 1000);
const iso = (s: number) => new Date(s * 1000).toISOString();

/** A desk that posts field missions, admitted in what the test server sends and nowhere else. */
const deskKey = standInKey();
const DESK: StandIn = { id: 'riverside-desk', name: 'Riverside Desk', agent: true, inbox: ['wss://nos.lol', 'wss://relay.primal.net'], keys: [deskKey] };
const LIBRARY = 'riverside-library-water-2026-10-28';

/** Mecha Jono's heat package of 2 October, word for word, under the desk's key and dated now. */
function heat() {
  const [HEAT] = JSON.parse(readFileSync(new URL('../../packages/core/test/fixtures/mission-packages.json', import.meta.url), 'utf8'));
  const tags = (HEAT.tags as string[][]).map((t) => (t[0] === 'valid_until' ? ['valid_until', String(NOW + 3 * 86_400)] : t));
  return resign({ ...HEAT, tags, created_at: NOW - 3_600 }, deskKey);
}

/** A field mission in Philadelphia, at a place on public record, naming its city and the place. */
function library() {
  return mission(deskKey, LIBRARY, {
    title: 'Water table outside the Parkway Central Library',
    at: iso(NOW - 1_800),
    ends: iso(NOW + 2 * 86_400),
    jurisdiction: 'us-pa',
    objectives: [
      { id: 'riverside#handout:water', ask: 'Hand out bottled water at the library steps, 6–8pm.' },
      { id: 'riverside#report:counts', ask: 'Count the bottles handed out.' }
    ],
    extra: [
      ['geo', 'lat:39.9596,lon:-75.1712'], ['geo_kind', 'subject_location'], ['geo_precision', '1km'],
      ['city', 'Philadelphia', 'us-pa'], ['poi', 'Parkway Central Library'], ['t', 'where:field']
    ]
  });
}

/*
 * Each journey on relays of its own, one per address, as separate as the real ones: a phone that
 * publishes to one relay while the other reads another fails here as it would out there. One
 * journey's card on a city's board is not another's stranger.
 */
let net: RelayNet;
test.beforeEach(() => {
  net = new RelayNet();
});
test.afterEach(async () => {
  await net?.close();
});

/** Where Mecha Jono publishes packages and settles reports: The Record, and the mirror that copies it. */
const RECORD = ['wss://record.cosmiccodex.app', 'wss://blackpi.cosmiccodex.app'];
async function onRecord(event: { id: string }) {
  for (const url of RECORD) await publish(await net.of(url), event);
}

/** What the relays hold now, to tell what arrived after. */
async function mark(): Promise<Set<string>> {
  return new Set((await net.received()).map((r) => `${r.host} ${r.event.id}`));
}
/** What arrived since `before`, on which host. */
async function since(before: Set<string>) {
  return (await net.received()).filter((r) => !before.has(`${r.host} ${r.event.id}`));
}

/** What a person can read and press on the screen now, printed when walking by eye. */
async function screen(page: Page, label: string) {
  if (!OUT) return;
  const text = await page.locator('body').evaluate((b) => {
    const c = b.cloneNode(true) as HTMLElement;
    c.querySelectorAll('select, option, script, style').forEach((x) => x.remove());
    return c.innerText ?? c.textContent ?? '';
  });
  const controls = await page
    .locator('a:visible, button:visible, input:visible, select:visible, textarea:visible')
    .evaluateAll((els) =>
      els.map((e) => {
        const el = e as HTMLElement & { name?: string; type?: string };
        const tag = el.tagName.toLowerCase();
        const words = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || '').replace(/\s+/g, ' ').trim();
        const data = [...el.attributes].filter((a) => a.name.startsWith('data-') || a.name === 'id' || a.name === 'name').map((a) => `${a.name}=${a.value}`).join(' ');
        return `${tag}${el.type ? `[${el.type}]` : ''}${tag === 'a' ? ` → ${el.getAttribute('href')}` : ''} «${words.slice(0, 70)}» ${data}`;
      })
    );
  console.log(`\n===== ${label} (${page.url()})\n${text.replace(/\n{3,}/g, '\n\n').slice(0, 2500)}\n--- controls\n${controls.join('\n')}`);
}

/** A screenshot per step, only when walking by eye. */
function steps(name: string) {
  if (!OUT) return async () => {};
  const shot = shots(`${OUT}/${name}`);
  return async (page: Page, step: string, fullPage = false) => {
    await shot(page, step, fullPage);
    await screen(page, `${name}: ${step}`);
  };
}

/** Opens a path and waits until the page is wired: a tap before hydration is lost. */
async function go(page: Page, path: string) {
  await page.goto(path);
  await page.waitForSelector('html[data-hydrated="true"]', { timeout: 15_000 });
}

/**
 * Taps a link and waits for the screen it opens. Waiting on `data-hydrated` alone resolved on the
 * screen being left, which already had it, and a choice made before the next one mounted was lost.
 */
async function follow(page: Page, link: Locator, path: string) {
  await link.click();
  await page.waitForURL(`**${path}`);
  await page.waitForSelector('html[data-hydrated="true"]');
  await page.waitForLoadState('networkidle').catch(() => {});
}

/** A callsign, made the way a newcomer makes one. */
async function newcomer(page: Page, callsign: string) {
  await go(page, '/terminal/setup/#watch');
  await page.locator('#callsign').fill(callsign);
  await page.getByRole('button', { name: /create profile/i }).click();
  await expect(page.locator('#rename')).toBeVisible();
}

/** Holds a control down with a finger, as a person does, for `ms`. */
async function hold(page: Page, target: Locator, ms: number) {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

/** A card on a city's board, published from the card screen. */
async function boardCard(page: Page, city: RegExp, doing: string) {
  await go(page, '/terminal/card/');
  await page.locator('[data-card-where] input[value="city"]').check();
  const value = await page.locator('#region option').evaluateAll((os, re) => (os as HTMLOptionElement[]).find((o) => new RegExp(re, 'i').test(o.text))?.value ?? null, city.source);
  await page.locator('#region').selectOption(value!);
  await page.locator('input[name="visibility"][value="board"]').check();
  await page.locator('#doing').fill(doing);
  await page.getByRole('button', { name: 'Publish your card' }).click();
  await expect(page.locator('[data-card-sent]')).toContainText(/published/i, { timeout: 15_000 });
}

const kinds = async (before: Set<string>) => (await since(before)).map((r) => r.event.kind);

test('a newcomer: from navcom.app to a callsign, a card, and a mission taken, reported and settled', async ({ browser }) => {
  test.setTimeout(180_000);
  const step = steps('newcomer');
  const { page, dialled, context } = await hermetic(browser, net, { serviceWorkers: 'block', timezoneId: 'America/New_York' });
  await page.clock.install({ time: new Date() });
  const splice = await admit(context, [DESK]);
  await onRecord(heat());
  await onRecord(library());

  // The landing page, and its one call to action for somebody new: Create profile.
  await go(page, '/');
  await step(page, 'landing');
  const into = page.locator('[data-create-profile]');
  await into.scrollIntoViewIfNeeded();
  await follow(page, into, '/terminal/setup/');
  await step(page, 'setup');
  await expect(page.locator('[data-elsewhere]')).toBeVisible();
  await page.locator('#callsign').fill('Kestrel');
  await page.getByRole('button', { name: /create profile/i }).click();
  await expect(page.locator('[data-setup-done]')).toBeVisible();
  await step(page, 'callsign-made');
  await follow(page, page.locator('[data-setup-done]'), '/terminal/');
  await expect(page.locator('body')).toContainText(/ready/i);
  await step(page, 'status');

  // A card on Philadelphia's board.
  await follow(page, page.getByRole('link', { name: /^your card$/i }), '/terminal/card/');
  await step(page, 'card');
  const sent = await mark();
  await boardCard(page, /philadelphia/, 'Water and socks, Thursdays.');
  expect(await kinds(sent)).toContain(10911);
  await step(page, 'card-published');

  // The missions on the map, and the one in Philadelphia.
  expect(splice.admitted()).toBe(true);
  await go(page, '/terminal/');
  await follow(page, page.getByRole('link', { name: /missions and the map/i }), '/');
  await expect(page.locator('[data-missions="open"]')).toBeVisible({ timeout: 20_000 });
  await step(page, 'map');
  await page.locator('[data-missions]').click();
  const row = page.locator(`[data-mission="${LIBRARY}"]`);
  await expect(row).toContainText('Philadelphia, Pennsylvania');
  await step(page, 'missions');
  const canvas = page.locator('.grid canvas');
  const wholeEarth = Number(((await canvas.getAttribute('data-view')) ?? '').split(' ')[2]);
  await row.click();
  await expect(page.locator('[data-screen="mission"]')).toContainText('Parkway Central Library');
  // The map comes to it: closer than the whole Earth, and its ring in view above the sheet.
  await expect.poll(async () => Number(((await canvas.getAttribute('data-view')) ?? '').split(' ')[2])).toBeGreaterThan(wholeEarth * 4);
  expect((await screenAt(page, -75.1712, 39.9596)).uncovered, 'the mission’s ring is on screen and uncovered').toBe(true);
  await step(page, 'mission');

  // Taking part, in the open.
  await page.getByRole('button', { name: /^take part$/i }).click();
  // A tap in the first 400 ms after the choice appears is a bounce, and ignored: a person reads first.
  await page.waitForTimeout(600);
  const claimed = await mark();
  await page.locator('[data-visibility="open"]').click();
  await expect(page.locator('[data-takepart]')).toContainText(/taking part/i, { timeout: 15_000 });
  await expect(page.locator('[data-report-where]')).toContainText(/your missions/i);
  expect(await kinds(claimed)).toContain(1985);
  await step(page, 'taking-part');

  // The next morning in Philadelphia: a report tells of a day that is over.
  const d = new Date();
  await page.clock.setSystemTime(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 15, 0)));
  await page.reload();
  await page.waitForSelector('html[data-hydrated="true"]');
  await openYou(page);
  await page.locator('[data-yours]').click();
  await page.locator(`[data-report-mission="${LIBRARY}"]`).click();
  await expect(page.locator('[data-screen="report"]')).toBeVisible();
  const day = await page.locator('[data-day] option').nth(1).getAttribute('value');
  await page.locator('[data-day]').selectOption(day!);
  for (const box of await page.locator('[data-ask]').all()) await box.check();
  await step(page, 'report');
  await page.getByRole('button', { name: /send report/i }).click();
  await page.waitForTimeout(600);
  const reported = await mark();
  await page.locator('[data-visibility="open"]').click();
  await expect.poll(() => kinds(reported), { timeout: 15_000 }).toContain(1912);
  // Where the report went: the relays the desk reads operators' work on.
  console.log('report went to: ' + (await since(reported)).filter((r) => r.event.kind === 1912).map((r) => r.host).join(', '));
  await step(page, 'reported');

  // The desk reads it and settles it, as Mecha Jono's reader does.
  const report = (await net.received()).find((r) => r.event.kind === 1912)!.event;
  const address = report.tags.find((t) => t[0] === 'a')![1]!;
  await onRecord(
    finalizeEvent(
      { kind: 1985, created_at: Math.floor(Date.now() / 1000) + 30 * 3600, content: '', tags: [['L', 'navcom.mission'], ['l', 'settled', 'navcom.mission'], ['e', report.id], ['a', address]] },
      deskKey.secret
    )
  );
  await page.reload();
  await page.waitForSelector('html[data-hydrated="true"]');
  await openYou(page);
  await page.locator('[data-yours]').click();
  await expect(page.locator(`[data-sent="${report.id}"]`)).toContainText(/settled/i, { timeout: 20_000 });
  await step(page, 'settled');

  // Every socket the app opened was carried here, the public relays it dials among them.
  expect([...dialled]).toEqual(expect.arrayContaining(['wss://record.cosmiccodex.app/', 'wss://relay.damus.io/']));
  await context.close();
});

test('a watch held on one phone, joined from another by its code, answering a question and a Distress', async ({ browser }) => {
  test.setTimeout(240_000);
  const step = steps('watch');
  const a = await hermetic(browser, net, { timezoneId: 'America/New_York' });
  const b = await hermetic(browser, net, { timezoneId: 'America/New_York' });
  const A = a.page;
  const B = b.page;

  // Lighthouse takes the watch on her phone.
  await newcomer(A, 'Lighthouse');
  await go(A, '/terminal/watch/');
  await A.locator('[data-start-watch]').click();
  await hold(A, A.getByRole('button', { name: /hold to take the watch/i }), 1500);
  await expect(A.getByRole('button', { name: /^stand down$/i })).toBeVisible();
  await step(A, 'holding');

  // The code her screen gives operators, copied as a person copies it. What the button wrote is kept
  // beside the clipboard, since WebKit under test grants no clipboard permission and a phone needs none.
  await A.evaluate(() => {
    const write = navigator.clipboard?.writeText?.bind(navigator.clipboard);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        ...navigator.clipboard,
        writeText: async (text: string) => {
          (window as unknown as { __copied?: string }).__copied = text;
          return write ? write(text).catch(() => undefined) : undefined;
        }
      }
    });
  });
  await A.locator('[data-watch-code]').scrollIntoViewIfNeeded();
  await expect(A.locator('[data-code-qr] svg')).toBeVisible();
  await step(A, 'code');
  await A.getByRole('button', { name: /copy the code/i }).click();
  await expect(A.getByRole('button', { name: /^copied$/i })).toBeVisible();
  const code = await A.evaluate(() => (window as unknown as { __copied: string }).__copied);
  const holder = await A.evaluate(() => JSON.parse(localStorage.getItem('navcom.accruing') ?? '{}').secret as string);
  const holderKey = getPublicKey(Uint8Array.from((holder.match(/../g) ?? []).map((x) => parseInt(x, 16))));
  expect(code).toContain(`h=${holderKey}`);

  // Kestrel pastes it into Setup.
  await newcomer(B, 'Kestrel');
  await B.locator('#code').fill(code);
  await B.getByRole('button', { name: /fill in from the code/i }).click();
  await expect(B.locator('#holders')).toHaveValue(new RegExp(holderKey));
  await B.getByRole('button', { name: /^connect$/i }).click();
  await step(B, 'connected');

  // What is behind him, before he goes: the watch, and his Distress reaching it.
  await go(B, '/terminal/');
  await expect(B.locator('[data-capability]')).toContainText(/on station/i, { timeout: 20_000 });
  await expect(B.locator('[data-capability]')).toContainText(/to the watch/i);
  await expect(B.locator('[data-capability]')).not.toContainText(/no addressee/i);
  await step(B, 'status');

  // He signs on, and her board has him; nothing on his phone calls that a failure.
  await follow(B, B.getByRole('link', { name: /^sign on$/i }), '/terminal/sign-on/');
  await B.locator('#area').fill('north riverfront');
  await B.getByRole('button', { name: /^sign on$/i }).click();
  await B.waitForURL('**/terminal/');
  await expect(B.locator('[data-station]')).toBeVisible({ timeout: 15_000 });
  await expect(A.locator('.nc-floor-row')).toContainText('Kestrel', { timeout: 20_000 });
  await expect(B.getByText(/no response from watchtower/i)).toHaveCount(0);
  await step(B, 'out');
  await step(A, 'board');

  // A question, answered by a person.
  await follow(B, B.getByRole('link', { name: /^query$/i }), '/terminal/query/');
  await B.locator('#q').fill('Is the shelter on 5th taking people tonight? Has a dog.');
  await B.getByRole('button', { name: /^ask$/i }).click();
  await A.getByRole('button', { name: /^answer$/i }).first().click({ timeout: 20_000 });
  await A.locator('textarea[id^="a-"]').first().fill('Yes until 11pm, dogs in the side yard. Ask for Marcus.');
  await A.getByRole('button', { name: /^send$/i }).first().click();
  await expect(B.locator('[data-answer]')).toContainText('Ask for Marcus', { timeout: 20_000 });
  await step(B, 'answered');

  // A Distress, and the person on station saying she has it.
  await go(B, '/terminal/distress/');
  await hold(B, B.locator('button.raise'), 1500);
  await A.getByRole('button', { name: /tell them you are awake/i }).first().click({ timeout: 20_000 });
  const send = A.getByRole('button', { name: /^send$/i }).first();
  if (await send.isVisible()) await send.click();
  await expect(B.locator('body')).toContainText(/lighthouse has it/i, { timeout: 20_000 });
  await step(B, 'distress-answered');

  // Her phone reloads, as phones do. Relays like damus keep ephemeral events five minutes and hand
  // them to the new board [live check, 2026-10-28]: what she answered must not come back as waiting.
  await A.reload();
  await A.waitForSelector('html[data-hydrated="true"]');
  await expect(A.locator('[data-distress-answered]')).toBeVisible({ timeout: 20_000 });
  // And said to be from before she opened this, not raised a moment ago.
  await expect(A.locator('[data-earlier]').first()).toBeVisible();
  await expect(A.getByRole('button', { name: /^answer$/i })).toHaveCount(0);
  await step(A, 'reloaded');
  // She is off watch now, and the relays still name her: said, with a way to make it true.
  await expect(A.locator('[data-orphaned]')).toBeVisible({ timeout: 20_000 });
  await A.locator('[data-orphaned] button').click();
  await expect(A.locator('[data-orphaned]')).toHaveCount(0, { timeout: 20_000 });
  await go(B, '/terminal/');
  await expect(B.locator('[data-capability]')).toContainText(/dark/i, { timeout: 20_000 });
  await step(B, 'reads-dark');

  await a.context.close();
  await b.context.close();
});

test('two strangers in one city find each other on its board, pair, and see each other go out', async ({ browser }) => {
  test.setTimeout(240_000);
  const step = steps('peers');
  const w = await hermetic(browser, net, { timezoneId: 'America/New_York' });
  const r = await hermetic(browser, net, { timezoneId: 'America/New_York' });
  const Wren = w.page;
  const Raven = r.page;

  await newcomer(Wren, 'Wren');
  await boardCard(Wren, /philadelphia/, 'Night patrol, Kensington. Water and socks.');
  await newcomer(Raven, 'Raven');

  // Where a newcomer looks for people: Peers, and a way from it to somebody not met yet.
  await go(Raven, '/terminal/peers/');
  await step(Raven, 'peers');
  await follow(Raven, Raven.locator('[data-find-link]'), '/terminal/find/');
  const area = await Raven.locator('#area option').evaluateAll((os) => (os as HTMLOptionElement[]).find((o) => /philadelphia/i.test(o.text))?.value ?? null);
  await Raven.locator('#area').selectOption(area!);
  const card = Raven.locator('li').filter({ hasText: 'Night patrol, Kensington' });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await step(Raven, 'board');
  await card.getByRole('button', { name: /ask to pair/i }).click();
  await card.locator('#note').fill('Raven here — I do Thursdays near Fairmount.');
  await card.getByRole('button', { name: /^send$/i }).click();
  await expect(card.locator('[data-asked]')).toContainText(/appear on peers/i, { timeout: 15_000 });
  await step(Raven, 'asked');

  // Wren accepts on Peers.
  await go(Wren, '/terminal/peers/');
  await Wren.getByRole('button', { name: /^accept$/i }).first().click({ timeout: 20_000 });
  await expect(Wren.locator('ul.paired')).toContainText('Raven', { timeout: 15_000 });
  await step(Wren, 'accepted');

  // Her acceptance carries Raven's own request back, so Raven's phone pairs on it: no second accept.
  await go(Raven, '/terminal/peers/');
  await expect(Raven.locator('ul.paired')).toContainText('Wren', { timeout: 20_000 });
  await expect(Raven.locator('[data-answered-us]')).toContainText(/wren accepted your request/i);
  await expect(Raven.getByRole('button', { name: /^accept$/i })).toHaveCount(0);
  await step(Raven, 'paired');

  // Her card, opened from Find on the map, knows they are paired: Raven wrote to it, so this phone
  // learned which peer it belongs to, and there is nobody left to write to.
  await go(Raven, '/');
  await openYou(Raven);
  await Raven.locator('[data-yours]').click();
  await Raven.locator('[data-open-find]').click();
  // The cities arrive after the screen does, from the file the landing page searches.
  await expect(Raven.locator('#find-region option', { hasText: /philadelphia/i }).first()).toBeAttached({ timeout: 20_000 });
  const city = await Raven.locator('#find-region option').evaluateAll((os) => (os as HTMLOptionElement[]).find((o) => /philadelphia/i.test(o.text))?.value ?? null);
  await Raven.locator('#find-region').selectOption(city!);
  await Raven.locator('[data-load-board]').click();
  await Raven.locator('#people-q').fill('wren');
  await Raven.locator('[data-hits="cards"] [data-hit-card]').filter({ hasText: 'Wren' }).click({ timeout: 20_000 });
  const profile = Raven.locator('[data-screen="profile"]');
  await expect(profile.locator('[data-with-you="paired"]')).toContainText(/you call them wren/i);
  await expect(profile.locator('[data-write]')).toHaveCount(0);
  await step(Raven, 'her-profile');

  // Wren goes out; Raven, on Status, sees it from what Wren's phone sent her.
  await go(Raven, '/terminal/');
  await go(Wren, '/terminal/sign-on/');
  await Wren.locator('#area').fill('Kensington');
  await Wren.getByRole('button', { name: /^sign on$/i }).click();
  await Wren.waitForURL('**/terminal/');
  await expect(Raven.locator('[data-peers]')).toContainText(/wren/i, { timeout: 30_000 });
  await expect(Raven.locator('[data-peers]')).toContainText(/kensington/i);
  await step(Raven, 'sees-wren');

  await w.context.close();
  await r.context.close();
});

test('alone: somebody to call, and a Distress that says there is no watch to send it to', async ({ browser }) => {
  test.setTimeout(120_000);
  const step = steps('alone');
  const { page, context } = await hermetic(browser, net, { timezoneId: 'America/New_York' });
  await newcomer(page, 'Heron');
  await page.locator('[data-person-open]').click();
  await page.locator('#clabel').fill('Sam');
  await page.locator('#cnumber').fill('+1 555 0100');
  await page.getByRole('button', { name: /^save$/i }).click();
  await go(page, '/terminal/');
  await follow(page, page.getByRole('link', { name: /^distress$/i }).first(), '/terminal/distress/');
  await expect(page.locator('[data-contact] a').first()).toContainText(/sam/i);
  await expect(page.locator('[data-no-watch]')).toBeVisible();
  await step(page, 'distress');
  await context.close();
});

test('a backup made on one phone, restored on a new one from its first screen', async ({ browser }) => {
  test.setTimeout(120_000);
  const step = steps('backup');
  const one = await hermetic(browser, net, { timezoneId: 'America/New_York' });
  await newcomer(one.page, 'Ibis');
  await go(one.page, '/terminal/backup/');
  await one.page.locator('#pass').fill('lantern harbour copper mist');
  await one.page.getByRole('button', { name: /^make a backup$/i }).click();
  const blob = (await one.page.locator('pre.blob').innerText()).trim();
  await step(one.page, 'made');
  await one.context.close();

  const two = await hermetic(browser, net, { timezoneId: 'America/New_York' });
  await go(two.page, '/terminal/');
  await follow(two.page, two.page.locator('[data-restore-link]'), '/terminal/backup/#restore');
  await two.page.locator('#rblob').fill(blob);
  await two.page.locator('#rpass').fill('lantern harbour copper mist');
  await two.page.getByRole('button', { name: /^restore$/i }).click();
  await expect(two.page.locator('[data-restored]')).toBeVisible();
  await go(two.page, '/terminal/setup/#watch');
  await expect(two.page.locator('body')).toContainText('Ibis');
  await step(two.page, 'restored');
  await two.context.close();
});

test('panic wipe keeps the callsign; burn takes it, and the phone starts over', async ({ browser }) => {
  test.setTimeout(120_000);
  const step = steps('wipe');
  const { page, context } = await hermetic(browser, net, { timezoneId: 'America/New_York' });
  await newcomer(page, 'Jay');
  await go(page, '/terminal/sign-on/');
  await page.locator('#area').fill('Fishtown');
  await page.getByRole('button', { name: /^sign on$/i }).click();
  await page.waitForURL('**/terminal/');
  await follow(page, page.getByRole('link', { name: /wipe this device/i }), '/terminal/wipe/');
  await hold(page, page.getByRole('button', { name: /hold to wipe tonight/i }), 1200);
  await page.waitForURL('**/terminal/');
  await expect(page.locator('body')).toContainText(/ready/i);
  await step(page, 'wiped');
  await go(page, '/terminal/wipe/');
  await page.locator('#confirm').fill('Jay');
  await page.getByRole('button', { name: /burn this device/i }).click();
  await expect(page.getByRole('link', { name: /create your profile/i })).toBeVisible({ timeout: 15_000 });
  await step(page, 'burned');
  await context.close();
});

test('the directory with no callsign: a region carried, narrowed, and a place added from the field', async ({ browser }) => {
  test.setTimeout(120_000);
  const step = steps('directory');
  const { page, context } = await hermetic(browser, net, { timezoneId: 'America/New_York' });
  await go(page, '/terminal/directory/');
  const philly = page.locator('a.area', { hasText: /philadelphia/i }).first();
  await philly.scrollIntoViewIfNeeded();
  await follow(page, philly, '/terminal/directory/philadelphia/');
  await expect(page.locator('[data-record]').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('#narrow').fill('shelter');
  await step(page, 'narrowed');
  await page.locator('#narrow').fill('');
  const added = await mark();
  await page.locator('[data-add-place]').scrollIntoViewIfNeeded();
  await page.locator('[data-add-place]').click();
  await page.locator('#pl-name').fill('St. Malachy Community Pantry');
  await page.locator('#pl-addr').fill('1429 N 11th St, Philadelphia, PA');
  const type = await page.locator('#pl-type option').nth(1).getAttribute('value');
  if (type) await page.locator('#pl-type').selectOption(type);
  const how = await page.locator('#pl-how option').nth(1).getAttribute('value');
  if (how) await page.locator('#pl-how').selectOption(how);
  await page.locator('[data-add-save]').click();
  await expect.poll(() => kinds(added), { timeout: 15_000 }).toContain(30915);
  await step(page, 'added');
  await context.close();
});

test('a joint night: two teams, two holders, a Distress beside an Assist passed on, a notice to one team', async ({ browser }) => {
  /*
   * The night the RLSH teams patrol one crowd in New York (2026-11-02), walked whole. Each feature it
   * touches has its own spec; this is where they meet, which is where today's bugs were: an Assist
   * passed on beside a live Distress marked it answered on the watch and stopped its sound, and no
   * feature's own test could see that.
   */
  test.setTimeout(360_000);
  const step = steps('joint-night');
  const at = (latitude: number, longitude: number) => ({ timezoneId: 'America/New_York', permissions: ['geolocation'], geolocation: { latitude, longitude } });
  const a = await hermetic(browser, net, { timezoneId: 'America/New_York' });
  const r = await hermetic(browser, net, { timezoneId: 'America/New_York' });
  const k = await hermetic(browser, net, at(40.7497, -73.9877));
  const v = await hermetic(browser, net, at(40.7506, -73.9935));
  const [A, R, K, V] = [a.page, r.page, k.page, v.page];

  // Lighthouse takes the watch, and names tonight's teams.
  await newcomer(A, 'Lighthouse');
  await go(A, '/terminal/watch/');
  await A.locator('[data-start-watch]').click();
  await hold(A, A.getByRole('button', { name: /hold to take the watch/i }), 1500);
  await expect(A.getByRole('button', { name: /^stand down$/i })).toBeVisible();
  await A.locator('[data-teams-tonight]').fill('Rescue Rangers, Zone Guardians');

  // Relief joins with the watch key, and goes into the code beside her.
  await A.getByRole('button', { name: /show the watch key/i }).click();
  const watchKeyHex = (await A.locator('[data-watch-key]').innerText()).trim();
  await newcomer(R, 'Relief');
  await go(R, '/terminal/watch/');
  await R.locator('#key').fill(watchKeyHex);
  await R.getByRole('button', { name: /^join$/i }).click();
  await R.locator('summary', { hasText: /this phone's holder key/i }).click();
  const reliefKey = (await R.locator('[data-holder-key]').innerText()).replace(/\s+/g, '');
  expect(reliefKey).toMatch(/^[0-9a-f]{64}$/);
  await A.locator('summary', { hasText: /other holders/i }).click();
  await A.locator('#other-holders').fill(reliefKey);

  await A.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => void ((window as unknown as { __copied?: string }).__copied = text) }
    });
  });
  await A.getByRole('button', { name: /copy the code/i }).click();
  const code = await A.evaluate(() => (window as unknown as { __copied: string }).__copied);
  expect(code).toMatch(/#watch=2&/);
  expect(code).toContain(`h=${reliefKey}`);
  await step(A, 'code');

  // Kite and Raven join from the code, and sign on with a team each, sharing where they are.
  for (const [page, callsign, area, team] of [[K, 'Kite', 'Herald Sq', 'Rescue Rangers'], [V, 'Raven', 'Penn Station', 'Zone Guardians']] as const) {
    await newcomer(page, callsign);
    await page.locator('#code').fill(code);
    await page.getByRole('button', { name: /fill in from the code/i }).click();
    await page.getByRole('button', { name: /^connect$/i }).click();
    await go(page, '/terminal/sign-on/');
    await page.locator('#area').fill(area);
    await page.locator('#team').fill(team);
    await page.locator('#share').selectOption('exact');
    await page.getByRole('button', { name: /^sign on$/i }).click();
    await page.waitForURL('**/terminal/');
  }

  // Owl, out with Zone Guardians, is a third phone the test speaks for: signed on to the same watch.
  const { buildSignal, parseWatchCode } = await import('@navcom/core');
  const { generateSecretKey } = await import('nostr-tools/pure');
  const named = parseWatchCode(code);
  const owl = generateSecretKey();
  const out = finalizeEvent(
    buildSignal(owl, { pubkey: named.pubkey, holders: named.holders }, 'on-station', {
      callsign: 'Owl', team: 'Zone Guardians', area: 'Bryant Park', expected_duration: 7200, routine_interval: null, share_position: false, position: null
    } as never, Math.floor(Date.now() / 1000)),
    owl
  );
  for (const url of named.relays) await publish(await net.of(url), out);

  // Both holders' boards have all three, each with their team, and nobody on an older build.
  for (const board of [A, R]) {
    await expect(board.locator('.nc-floor-row')).toHaveCount(3, { timeout: 30_000 });
    await expect(board.locator('.nc-floor-row', { hasText: 'Kite' }).locator('[data-floor-team]')).toHaveText('Rescue Rangers');
  }
  await expect(A.locator('.nc-floor-row', { hasText: 'Kite' }).locator('[data-floor-build]')).toHaveCount(0);
  await step(A, 'board');

  // The holders split the night: Lighthouse takes Zone Guardians. Kite's question waits on Relief,
  // named under Also waiting on Lighthouse's screen, and Relief's answer clears it on both.
  await A.locator('[data-teams] button', { hasText: 'Zone Guardians' }).click();
  await go(K, '/terminal/query/');
  await K.locator('#q').fill('Somewhere warm near Herald Sq?');
  await K.getByRole('button', { name: /^ask$/i }).click();
  await expect(A.locator('[data-also-waiting]')).toContainText('Kite (Rescue Rangers)', { timeout: 20_000 });
  await R.getByRole('button', { name: /^answer$/i }).first().click({ timeout: 20_000 });
  await R.locator('textarea[id^="a-"]').first().fill('The drop-in on 30th is open all night.');
  await R.getByRole('button', { name: /^send$/i }).first().click();
  await expect(K.locator('[data-answer]')).toContainText('open all night', { timeout: 20_000 });
  await expect(A.locator('[data-also-waiting]')).toHaveCount(0, { timeout: 20_000 });

  // Raven raises a Distress, and while it is live Kite asks for somebody now, which Lighthouse
  // passes on. It goes to Owl, never to Raven, and Raven's Distress is still nobody's.
  await go(V, '/terminal/distress/');
  await hold(V, V.locator('button.raise'), 1500);
  await expect(A).toHaveTitle(/^Distress · Watch/, { timeout: 20_000 });
  await go(K, '/terminal/assist/');
  // The label is what a thumb taps; the radio inside it is hidden.
  await K.locator('label.choice', { hasText: 'Now' }).click();
  await K.locator('#a').fill('Second pair of hands, Herald Sq');
  await K.getByRole('button', { name: /assist — now/i }).click();
  await A.locator('[data-teams] button', { hasText: 'All' }).click();
  await A.locator('[data-pass-on]').first().click({ timeout: 20_000 });
  await A.getByRole('button', { name: 'Pass on', exact: true }).click();
  await expect(A.locator('[data-passed]')).toContainText('Owl', { timeout: 20_000 });
  await expect(A.locator('[data-passed]')).not.toContainText('Raven');
  await A.waitForTimeout(2_000);
  await expect(A.locator('[data-distress-answered]')).toHaveCount(0);
  await expect(A).toHaveTitle(/^Distress · Watch/);
  await expect(V.locator('body')).not.toContainText(/has it|may have you/i);
  await step(A, 'distress-beside-pass-on');

  // A notice to Zone Guardians: on Raven's screen, whatever it is, and not on Kite's.
  await A.locator('[data-teams] button', { hasText: 'Zone Guardians' }).click();
  await A.getByRole('button', { name: 'Tell Zone Guardians' }).click();
  await A.getByLabel('To Zone Guardians').fill('Police line across 8th Ave at 33rd. Go round by 9th.');
  await A.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(A.locator('[data-told]')).toContainText('Police line', { timeout: 20_000 });
  await expect(V.locator('[data-notice-line]')).toContainText('Police line', { timeout: 20_000 });
  await go(K, '/terminal/');
  await K.waitForTimeout(1_500);
  await expect(K.locator('[data-notice-text]')).toHaveCount(0);

  // Relief answers Raven's Distress with her own key: Raven's phone says she has it, and
  // Lighthouse's board says it was answered and stops sounding.
  await R.getByRole('button', { name: /tell them you are awake/i }).first().click({ timeout: 20_000 });
  const send = R.getByRole('button', { name: /^send$/i }).first();
  if (await send.isVisible()) await send.click();
  await expect(V.locator('body')).toContainText(/relief has it/i, { timeout: 30_000 });
  await expect(A.locator('[data-distress-answered]')).toBeVisible({ timeout: 20_000 });
  await expect(A).not.toHaveTitle(/^Distress · /, { timeout: 20_000 });
  await step(V, 'answered');

  for (const h of [a, r, k, v]) await h.context.close();
});
