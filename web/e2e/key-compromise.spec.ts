import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { open, seedDevice } from './device';
import { admit, mission, standInKey, type StandIn, type StandInKey } from './registry';

/**
 * **What a stolen key can still do, against the build as it is served** [interchange spec rev 7].
 *
 * Mecha Jono's old key `6301c4d0…` had its secret exposed on 2026-09-28, and its next key is not to
 * sign anything before the cut-over. Each test here is one of the decisions of 2026-10-18 the way a
 * phone meets it: a key nobody trusts yet, a key whose end has passed on a clock set back, a frozen
 * key flooding the relay with packages dated ahead, a successor outranking it, a mission that may
 * have been planted, and the sealed choice on a mission whose key leaked.
 *
 * No test holds Mecha Jono's secrets, so the keys in each state are stand-ins added to the served
 * registry [registry.ts]. Two things need no stand-in: what this phone already sealed to the real old
 * key, and the registry file NavCom publishes.
 */

// The worker would serve the build's own code past the registry splice.
test.use({ serviceWorkers: 'block' });

const DURING = new Date('2026-10-06T20:00:00Z');
const INBOX = ['wss://nos.lol', 'wss://relay.primal.net'];
const MECHA_OLD = '6301c4d09a014909e5a48b7d0c9aa859eec18804c2fc87eab4e414aa5a319692';
const MECHA_NEXT = '86f824c3f1e67c60b1dc15ce110648c4de5c3fb879022fbbcc5e8deb720e402c';
const settle = (page: Page) => page.waitForTimeout(450);
const dOf = (e: { tags: string[][] }) => e.tags.find((t) => t[0] === 'd')![1]!;

/** The card this phone signs claims and reports with, so what it kept is its own. */
const contact = generateSecretKey();
const me = getPublicKey(contact);
const card = { contact_secret: Buffer.from(contact).toString('hex') };

const desk = (keys: StandInKey[], over: Partial<StandIn> = {}): StandIn => ({ id: 'stand-in', name: 'Test Desk', agent: true, inbox: INBOX, keys, ...over });

/** The phone at `at`, its relays serving `events`, with `standIns` in the registry it was sent. */
async function phone(page: Page, events: unknown[], standIns: StandIn[], o: { at?: Date; seed?: Parameters<typeof seedDevice>[1] } = {}) {
  await page.clock.setFixedTime(o.at ?? DURING);
  const { admitted } = await admit(page, standIns);
  await seedDevice(page, { relayEvents: events, __noStorage: true, ...o.seed } as Parameters<typeof seedDevice>[1]);
  await open(page, '/');
  await expect(page.locator('[data-missions]')).not.toHaveAttribute('data-missions', 'connecting', { timeout: 15_000 });
  expect(admitted(), 'the registry was not in what the server sent, so the stand-in changed nothing').toBe(true);
}

/** The missions the list shows, by `d`. */
async function listed(page: Page): Promise<string[]> {
  if ((await page.locator('[data-missions="none"]').count()) > 0) return [];
  await page.locator('[data-missions="open"]').click();
  await expect(page.locator('[data-screen="missions"]')).toBeVisible();
  return (await page.locator('[data-screen="missions"] [data-mission]').evaluateAll((els) => els.map((el) => el.getAttribute('data-mission')!))).sort();
}

const published = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __navcomPublished?: { kind: number; tags: string[][] }[] }).__navcomPublished ?? []);

test.describe('which keys a phone believes', () => {
  test('nothing a key with no start signs is shown, beside what the same publisher’s trusted key signs', async ({ page }) => {
    const now = standInKey();
    const next = standInKey({ generation: 2, notBefore: undefined });
    await phone(page, [mission(now, 'from-the-trusted-key'), mission(next, 'from-the-key-with-no-start')], [desk([now, next])]);
    expect(await listed(page)).toEqual(['from-the-trusted-key']);
  });

  test('with the clock set back, a key that ended before the build shows nothing, even a mission dated before its end', async ({ page }) => {
    // The phone says 20 September; the build it runs was made in October, after the key ended.
    const ended = standInKey({ notAfter: '2026-10-01T00:00:00Z' });
    await phone(page, [mission(ended, 'before-its-end', { at: '2026-09-15T00:00:00Z' })], [desk([ended])], { at: new Date('2026-09-20T12:00:00Z') });
    await expect(page.locator('[data-missions="none"]')).toBeVisible();
  });

  test('a second-generation package dated before its key’s start is dropped, and the first generation’s stands', async ({ page }) => {
    const one = standInKey();
    const two = standInKey({ generation: 2, notBefore: '2026-10-01T00:00:00Z' });
    await phone(
      page,
      [mission(one, 'one-mission', { title: 'First generation', at: '2026-09-29T00:00:00Z' }), mission(two, 'one-mission', { title: 'Dated before its start', at: '2026-09-30T00:00:00Z' })],
      [desk([one, two])]
    );
    expect(await listed(page)).toEqual(['one-mission']);
    await expect(page.locator('[data-screen="missions"] [data-mission="one-mission"]')).toContainText('First generation');
  });

  test('a second-generation version outranks the first at the same d, whatever date the first carries', async ({ page }) => {
    const one = standInKey();
    const two = standInKey({ generation: 2, notBefore: '2026-10-01T00:00:00Z' });
    await phone(
      page,
      [mission(two, 'one-mission', { title: 'Second generation', at: '2026-10-02T00:00:00Z' }), mission(one, 'one-mission', { title: 'First, dated later', at: '2026-10-05T00:00:00Z' })],
      [desk([one, two])]
    );
    expect(await listed(page)).toEqual(['one-mission']);
    await expect(page.locator('[data-screen="missions"] [data-mission="one-mission"]')).toContainText('Second generation');
  });
});

test.describe('a frozen key', () => {
  /** A key whose secret leaked, frozen on `packages`. */
  function frozenOn(key: StandInKey, packages: { id: string; tags: string[][] }[], confirmed: boolean) {
    key.frozen = { confirmed, packages: packages.map((p) => ({ id: p.id, d: dOf(p) })) };
    return key;
  }
  const flood = (key: StandInKey) =>
    Array.from({ length: 150 }, (_, i) => mission(key, `flood-${i}`, { title: `Lure ${i}`, at: `2027-01-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z` }));

  test('150 packages dated ahead at fresh d’s, served before 3 on its list: the 3 show, and none of the 150', async ({ page }) => {
    const key = standInKey({ exposed: '2026-09-28' });
    const genuine = [1, 2, 3].map((i) => mission(key, `genuine-${i}`, { title: `Genuine ${i}`, at: `2026-10-05T1${i}:00:00Z` }));
    frozenOn(key, genuine, true);
    // And one newer version of a listed mission that closes nothing: it may not replace the genuine one.
    const forged = mission(key, 'genuine-1', { title: 'Forged', at: '2026-10-06T00:00:00Z' });
    await phone(page, [...flood(key), forged, ...genuine], [desk([key])]);
    expect(await listed(page)).toEqual(['genuine-1', 'genuine-2', 'genuine-3']);
    await expect(page.locator('[data-screen="missions"] [data-mission="genuine-1"]')).toContainText('Genuine 1');
  });

  test('a copy on the device holding the 150 loads without them', async ({ page }) => {
    const key = standInKey({ exposed: '2026-09-28' });
    const genuine = [1, 2, 3].map((i) => mission(key, `genuine-${i}`, { title: `Genuine ${i}`, at: `2026-10-05T1${i}:00:00Z` }));
    frozenOn(key, genuine, true);
    await page.addInitScript((events) => {
      localStorage.setItem('navcom.wipeable', JSON.stringify({ missions: { at: '2026-10-06T19:00:00.000Z', events } }));
    }, [...flood(key), ...genuine]);
    // No relay answers: what is drawn is the copy on the device.
    await page.clock.setFixedTime(DURING);
    const { admitted } = await admit(page, [desk([key])]);
    await seedDevice(page, { __noStorage: true } as Parameters<typeof seedDevice>[1]);
    // Installed last, so it wins: a socket that never opens.
    await page.addInitScript(() => {
      class Dead extends EventTarget {
        readyState = 0;
        constructor(readonly url: string) {
          super();
        }
        send(): void {}
        close(): void {}
      }
      (globalThis as unknown as { WebSocket: unknown }).WebSocket = Dead;
    });
    await open(page, '/');
    await expect(page.locator('[data-missions="open"][data-feed="cached"]')).toBeVisible({ timeout: 15_000 });
    expect(admitted()).toBe(true);
    expect(await listed(page)).toEqual(['genuine-1', 'genuine-2', 'genuine-3']);
  });

  test('a version not on its list is kept only when it closes one of the list’s missions', async ({ page }) => {
    const key = standInKey({ exposed: '2026-09-28' });
    const closing = mission(key, 'closed-since', { at: '2026-10-04T00:00:00Z' });
    const staying = mission(key, 'still-open', { at: '2026-10-04T00:00:00Z' });
    frozenOn(key, [closing, staying], true);
    // Neither is on the list: one closes a mission that is, one is new.
    const closes = mission(key, 'closed-since', { at: '2026-10-05T00:00:00Z', state: 'closed' });
    const stray = mission(key, 'not-on-the-list', { at: '2026-10-05T00:00:00Z' });
    await phone(page, [closing, staying, closes, stray], [desk([key])]);
    expect(await listed(page)).toEqual(['still-open']);
  });

  test('until the publisher confirms its list, a mission on it cannot be taken, and says it may have been replaced', async ({ page }) => {
    const key = standInKey({ exposed: '2026-09-28' });
    const pkg = mission(key, 'unconfirmed', {
      title: 'Water run',
      extra: [['geo', 'lat:36.77,lon:-119.41'], ['geo_kind', 'subject_location'], ['geo_precision', '1km']]
    });
    frozenOn(key, [pkg], false);
    await phone(page, [pkg], [desk([key])], { seed: { callsign: 'kestrel', __noStorage: false } });
    await page.locator('[data-missions="open"]').click();
    await page.locator('[data-screen="missions"] [data-mission="unconfirmed"]').click();
    const screen = page.locator('[data-screen="mission"][data-mission="unconfirmed"]');
    await expect(screen.locator('[data-retiring]')).toContainText('posted under a retiring key');
    await expect(screen.locator('[data-retiring]')).toContainText('may have been replaced');
    await expect(screen.getByRole('button', { name: 'Take part' })).toHaveCount(0);
    await expect(screen.locator('[data-refusal="retiring"]')).toContainText('cannot be taken');
  });
});

test.describe('sealed sending to a key whose secret leaked', () => {
  test('is off on the take-part screen, with its reason, before anything can be sent; taking part in the open still works', async ({ page }) => {
    const leaked = standInKey({ exposed: '2026-09-28' });
    await phone(page, [mission(leaked, 'leaked-key', { title: 'Water run' })], [desk([leaked])], { seed: { callsign: 'kestrel', __noStorage: false } });
    await page.locator('[data-missions="open"]').click();
    await page.locator('[data-screen="missions"] [data-mission="leaked-key"]').click();
    await page.getByRole('button', { name: 'Take part' }).click();
    const sealed = page.locator('[data-visibility="sealed"]');
    await expect(sealed).toBeDisabled();
    await expect(sealed).toContainText('Sealed sending to Test Desk is paused');
    await expect(sealed).toContainText('Nothing is kept on this phone');
    await settle(page);
    await page.locator('[data-visibility="open"]').click();
    await expect(page.locator('[data-slot="you"]')).toContainText('Taking part');
    expect((await published(page)).filter((e) => e.kind === 1059), 'something was sealed').toEqual([]);
  });

  test('is off on the report screen, with its reason, and the report goes in the open', async ({ page }) => {
    const leaked = standInKey({ exposed: '2026-09-28' });
    const events = [mission(leaked, 'leaked-key', { title: 'Water run' })];
    await phone(page, events, [desk([leaked])], { seed: { callsign: 'kestrel', __noStorage: false } });
    await page.locator('[data-missions="open"]').click();
    await page.locator('[data-screen="missions"] [data-mission="leaked-key"]').click();
    await page.getByRole('button', { name: 'Take part' }).click();
    await settle(page);
    await page.locator('[data-visibility="open"]').click();
    await expect(page.locator('[data-slot="you"]')).toContainText('Taking part');

    // The next day, on the same phone.
    await page.clock.setFixedTime(new Date(DURING.getTime() + 86_400_000));
    await open(page, '/');
    await expect(page.locator('[data-missions="open"]')).toContainText('Open missions · live', { timeout: 15_000 });
    await page.locator('[data-yours]').click();
    await page.locator('[data-report-mission="leaked-key"]').click();
    const report = page.locator('[data-screen="report"]');
    await report.locator('[data-day]').selectOption({ index: 1 });
    await report.locator('[data-ask]').first().check();
    await report.getByRole('button', { name: 'Send report' }).click();
    const sealed = report.locator('[data-visibility="sealed"]');
    await expect(sealed).toBeDisabled();
    await expect(sealed).toContainText('Sealed sending to Test Desk is paused');
    await settle(page);
    await report.locator('[data-visibility="open"]').click();
    await expect(page.locator('[data-screen="yours"] [data-sent]')).toHaveCount(1);
    expect((await published(page)).filter((e) => e.kind === 1059)).toEqual([]);
  });

  test('letting go of a sealed claim taken before sends nothing sealed, and says the claim ends by itself', async ({ page }) => {
    const leaked = standInKey({ exposed: '2026-09-28' });
    const pkg = mission(leaked, 'leaked-key', { title: 'Water run' });
    const address = `30079:${leaked.pubkey}:leaked-key`;
    const t = Math.floor(DURING.getTime() / 1000);
    await phone(page, [pkg], [desk([leaked])], {
      seed: {
        callsign: 'kestrel',
        __noStorage: false,
        accruing: card,
        wipeable: { mission_claims: [{ address, title: 'Water run', visibility: 'sealed', ends: t + 80_000, claimId: null, relays: INBOX, signer: me }] }
      }
    });
    await page.locator('[data-missions="open"]').click();
    await page.locator('[data-screen="missions"] [data-mission="leaked-key"]').click();
    await page.locator('[data-letgo]').click();
    await expect(page.locator('[data-takepart]')).toContainText('ends by itself within a day');
    expect((await published(page)).filter((e) => e.kind === 1059), 'a release was sealed to the leaked key').toEqual([]);
    await expect(page.getByRole('button', { name: 'Take part' })).toBeVisible();
  });
});

test.describe('what this phone already sealed to Mecha Jono’s old key', () => {
  test('each sealed row in its mission history says whoever holds the leaked key can read it, and a report says the second it went', async ({ page }) => {
    const address = `30079:${MECHA_OLD}:starcom_mission_package_field-heat_relief-CA-2026-10-02`;
    const sentAt = Math.floor(new Date('2026-10-08T03:14:15Z').getTime() / 1000);
    await page.clock.setFixedTime(new Date('2026-10-08T20:00:00Z'));
    await seedDevice(page, {
      callsign: 'kestrel',
      accruing: card,
      wipeable: {
        mission_reports: [
          { id: 'a'.repeat(64), address, title: 'Heat relief', jurisdiction: 'us-ca', poster: MECHA_OLD, date: '2026-10-07', at: sentAt, visibility: 'sealed', relays: INBOX, signer: me },
          { id: 'b'.repeat(64), address, title: 'Heat relief', jurisdiction: 'us-ca', poster: MECHA_OLD, date: '2026-10-06', at: sentAt - 86_400, visibility: 'open', relays: ['wss://relay.damus.io'], signer: me }
        ],
        mission_claims: [{ address, title: 'Heat relief', visibility: 'sealed', ends: sentAt + 80_000, claimId: null, relays: INBOX, signer: me }]
      }
    } as Parameters<typeof seedDevice>[1]);
    await open(page, '/');
    await page.locator('[data-yours]').click();
    const sealedReport = page.locator(`[data-sent="${'a'.repeat(64)}"]`);
    await expect(sealedReport.locator('[data-leaked]')).toContainText("Sealed to Mecha Jono's old key");
    await expect(sealedReport.locator('[data-leaked]')).toContainText('whoever holds it can open this report');
    await expect(sealedReport.locator('[data-leaked]')).toContainText('03:14:15 UTC');
    // An open report was never sealed: nothing to say about the leak on its row.
    await expect(page.locator(`[data-sent="${'b'.repeat(64)}"] [data-leaked]`)).toHaveCount(0);
    const claim = page.locator(`[data-held="${address}"]`);
    await expect(claim.locator('[data-leaked]')).toContainText('whoever holds it can see that your card took part in this mission');
  });

  test('Status says it in one sentence, for every phone, before anybody asks', async ({ page }) => {
    await seedDevice(page, { __noStorage: true } as Parameters<typeof seedDevice>[1]);
    await open(page, '/terminal/');
    await expect(page.locator('[data-sealed-exposed]')).toContainText(
      'Sealed claims and reports sent to Mecha Jono from 6 October can be opened by whoever holds its old key’s leaked secret'
    );
  });
});

test('the registry NavCom pins is published as a file, with its digest in the interchange block', async ({ request }) => {
  const file = await request.get('/.well-known/navcom-publishers.json');
  expect(file.status()).toBe(200);
  const bytes = await file.body();
  const intel = await (await request.get('/.well-known/navcom-intel.json')).json();
  expect(intel.interchange.publishers.url).toBe('/.well-known/navcom-publishers.json');
  expect(intel.interchange.publishers.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  const doc = JSON.parse(bytes.toString('utf8'));
  const mecha = doc.publishers.find((p: { id: string }) => p.id === 'mecha-jono');
  expect(mecha.inbox).toEqual(INBOX);
  expect(mecha.keys.map((k: { pubkey: string; notBefore: string | null }) => [k.pubkey, k.notBefore])).toEqual([
    [MECHA_OLD, '2025-01-01T00:00:00Z'],
    [MECHA_NEXT, null]
  ]);
  expect(mecha.keys[0].notAfter).toBe('2026-11-13T00:00:00Z');
});
