import { expect, test, type Page } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { open, seedDevice } from './device';
import { admit, mission, standInKey, type StandIn, type StandInKey } from './registry';

/**
 * **The adversary's pass, against the build as it is served** [decided 2026-10-18; interchange spec
 * rev 7]. As the holder of Mecha Jono's old secret, and of its next one if that leaked too: each test
 * is something a stolen key may not do on a phone, and does.
 *
 * Stand-in keys are added to the served registry as in key-compromise.spec.ts; the first two tests
 * need none, because the real registry's own entries are the point.
 */

test.use({ serviceWorkers: 'block' });

const DURING = new Date('2026-10-06T20:00:00Z');
const INBOX = ['wss://nos.lol', 'wss://relay.primal.net'];
const MECHA_OLD = '6301c4d09a014909e5a48b7d0c9aa859eec18804c2fc87eab4e414aa5a319692';
const MECHA_NEXT = '86f824c3f1e67c60b1dc15ce110648c4de5c3fb879022fbbcc5e8deb720e402c';
const secs = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

const contact = generateSecretKey();
const me = getPublicKey(contact);
const card = { contact_secret: Buffer.from(contact).toString('hex') };

const desk = (keys: StandInKey[], over: Partial<StandIn> = {}): StandIn => ({ id: 'stand-in', name: 'Test Desk', agent: true, inbox: INBOX, keys, ...over });

async function phone(page: Page, events: unknown[], standIns: StandIn[], o: { at?: Date; seed?: Parameters<typeof seedDevice>[1] } = {}) {
  await page.clock.setFixedTime(o.at ?? DURING);
  const { admitted } = await admit(page, standIns);
  await seedDevice(page, { relayEvents: events, __noStorage: true, ...o.seed } as Parameters<typeof seedDevice>[1]);
  await open(page, '/');
  await expect(page.locator('[data-missions]')).not.toHaveAttribute('data-missions', 'connecting', { timeout: 15_000 });
  expect(admitted(), 'the registry was not in what the server sent, so the stand-in changed nothing').toBe(true);
}

async function listed(page: Page): Promise<string[]> {
  if ((await page.locator('[data-missions="none"]').count()) > 0) return [];
  await page.locator('[data-missions="open"]').click();
  await expect(page.locator('[data-screen="missions"]')).toBeVisible();
  return (await page.locator('[data-screen="missions"] [data-mission]').evaluateAll((els) => els.map((el) => el.getAttribute('data-mission')!))).sort();
}

/**
 * A mission as a phone's history holds it after an earlier bundle took part in it [claims.ts,
 * `remember`]: parsed, with no event and no id. The deployed bundle trusted Mecha Jono's next key at
 * once (3516b7ee), and every earlier bundle kept anything the old key signed.
 */
function remembered(poster: string, d: string, publishedAt: number) {
  return {
    address: `30079:${poster}:${d}`,
    d,
    publisher: { pubkey: poster, name: 'Mecha Jono', agent: true },
    title: 'Water at the depot',
    summary: 'Meet at the loading dock behind the depot.',
    state: 'open',
    claims: 'many',
    validUntil: secs('2099-12-31T00:00:00Z'),
    placement: { jurisdiction: 'us-ca', point: { lat: 36.77, lon: -119.41, precision: '1km', coarsened: false } },
    family: null,
    categories: [],
    variant: null,
    checks: [],
    citizenSafe: false,
    priority: null,
    objectives: [{ id: 'handout:water', ask: 'Hand out water.', limits: [], effortMinutes: null, for: null, done: false, tier: null, presence: null }],
    clock: [],
    effect: [],
    omittedPeopleCounts: 0,
    takingPart: null,
    publishedAt
  };
}

test.describe('a phone that ran an earlier bundle', () => {
  const AT = new Date('2026-10-20T20:00:00Z');
  const t = Math.floor(AT.getTime() / 1000);

  for (const [who, key, d] of [
    ['the key with no start', MECHA_NEXT, 'planted-under-the-next-key'],
    ['the old key, at a d not on its frozen list', MECHA_OLD, 'planted-under-the-old-key']
  ] as const) {
    test(`is not asked to report on a mission it took part in under ${who}`, async ({ page }) => {
      await page.clock.setFixedTime(AT);
      await seedDevice(page, {
        callsign: 'kestrel',
        accruing: card,
        wipeable: { mission_history: [{ mission: remembered(key, d, t - 5 * 86_400), since: t - 3 * 86_400 }] }
      } as Parameters<typeof seedDevice>[1]);
      await open(page, '/');
      await page.locator('[data-yours]').click();
      await expect(page.locator('[data-screen="yours"]')).toBeVisible();
      // Today it is listed under "To report", with the planted words, and an open report on it goes
      // to public relays, where whoever signed it reads which card did the work.
      await expect(page.locator(`[data-report-mission="${d}"]`)).toHaveCount(0);
    });
  }
});

test.describe('labels under a key whose secret leaked', () => {
  test('a report this phone sent in the open is not shown settled by a witness signed with the leaked key', async ({ page }) => {
    const leaked = standInKey({ exposed: '2026-09-28' });
    const pkg = mission(leaked, 'leaked-key', { title: 'Water run', at: '2026-10-01T00:00:00Z' });
    leaked.frozen = { confirmed: true, packages: [{ id: pkg.id, d: 'leaked-key' }] };
    const address = `30079:${leaked.pubkey}:leaked-key`;
    const report = 'c'.repeat(64);
    const t = Math.floor(DURING.getTime() / 1000);
    const witnessed = finalizeEvent(
      {
        kind: 1985,
        created_at: t - 3_600,
        content: '',
        tags: [['L', 'navcom.mission'], ['l', 'witnessed', 'navcom.mission'], ['e', report], ['a', address]]
      },
      leaked.secret
    );
    await phone(page, [pkg, witnessed], [desk([leaked])], {
      seed: {
        callsign: 'kestrel',
        __noStorage: false,
        accruing: card,
        wipeable: {
          mission_reports: [
            { id: report, address, title: 'Water run', jurisdiction: 'us-ca', poster: leaked.pubkey, date: '2026-10-05', at: t - 86_400, visibility: 'open', relays: ['wss://relay.damus.io'], signer: me }
          ]
        }
      }
    });
    await page.locator('[data-yours]').click();
    const row = page.locator(`[data-sent="${report}"]`);
    await expect(row).toBeVisible();
    await expect(row).not.toContainText('Checking', { timeout: 15_000 });
    // Today: "Settled — by a witness, Test Desk (…, an agent)": the leaked key's label counted, under
    // the publisher's own name, and kept as final once its seven days are up.
    await expect(row).not.toContainText('by a witness');
    await expect(row).toContainText('Waiting');
  });
});

test.describe('a second-generation version at a frozen d', () => {
  test('replaces the frozen version even when it is no longer field work', async ({ page }) => {
    const one = standInKey({ exposed: '2026-09-28' });
    const listedPkg = mission(one, 'one-mission', { title: 'First generation', at: '2026-10-02T00:00:00Z' });
    one.frozen = { confirmed: true, packages: [{ id: listedPkg.id, d: 'one-mission' }] };
    const two = standInKey({ generation: 2, notBefore: '2026-10-01T00:00:00Z' });
    // The publisher's own successor at the same d, moved to its desk: no `navcom_mission` tag. A
    // version the publisher signed that NavCom will not show still supersedes the older one [11.E].
    const desked = finalizeEvent(
      {
        kind: 30079,
        created_at: secs('2026-10-05T00:00:00Z'),
        content: JSON.stringify({ name: 'Moved to the desk', objectives: [{ id: 'one-mission#do', ask: 'Hand out water.' }] }),
        tags: [
          ['d', 'one-mission'], ['t', 'starcom_mission_package'], ['t', 'navcom_handoff'],
          ['mission_state', 'open'], ['valid_until', String(secs('2026-12-31T00:00:00Z'))], ['jurisdiction', 'us-ca']
        ]
      },
      two.secret
    );
    await phone(page, [listedPkg, desked], [desk([one, two])]);
    // Today the frozen version stays on the map: the second generation is asked only for field work,
    // the frozen key by id, so the version that replaces it is never heard.
    expect(await listed(page)).toEqual([]);
  });
});
