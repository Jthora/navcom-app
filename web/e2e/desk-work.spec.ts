import { expect, test, type Page } from '@playwright/test';
import { finalizeEvent } from 'nostr-tools/pure';
import { open, seedDevice } from './device';
import { admit, mission, standInKey, type StandInKey } from './registry';

/**
 * Desk work beside the field work [missions/live.ts, `watchMissions`], against the build as it is
 * served: every kind of mission by default (the owner, 2026-11-01), narrowed to field work by the
 * missions list's own filter, listed under the field work, never taken here, and kept on the
 * device only as the choice.
 *
 * The publisher is a stand-in with a key trusted to sign [registry.ts], so what is shown is decided by
 * the reader's rules and not by Mecha Jono's frozen key.
 */

test.use({ serviceWorkers: 'block' });

const DURING = new Date('2026-10-06T20:00:00Z');
const secs = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

/** A package handed to NavCom that is not field work: no `navcom_mission`, and here no end. */
function desk(key: StandInKey, d: string, o: { title: string; family?: string; extra?: string[][] }) {
  return finalizeEvent(
    {
      kind: 30079,
      created_at: secs('2026-10-05T16:00:00Z'),
      content: JSON.stringify({ name: o.title, objectives: [{ id: `${d}#read`, ask: 'Read the filing, and say what it shows.' }] }),
      tags: [
        ['d', d], ['t', 'starcom_mission_package'], ['t', 'navcom_handoff'], ['mission_state', 'open'],
        ['mission_family', o.family ?? 'revocation'], ['jurisdiction', 'us-tx'], ...(o.extra ?? [])
      ]
    },
    key.secret
  );
}

async function landed(page: Page) {
  const key = standInKey();
  const events = [
    mission(key, 'water-run', { title: 'Water run' }),
    desk(key, 'longview', { title: 'Longview, TX' }),
    desk(key, 'grant', { title: 'A grant notice', family: 'grant' }),
    desk(key, 'excluded', { title: 'A party on an exclusion list', family: 'exclusion' })
  ];
  await page.clock.setFixedTime(DURING);
  const { admitted } = await admit(page, [{ id: 'stand-in', name: 'Test Desk', agent: true, keys: [key] }]);
  await seedDevice(page, { relayEvents: events, __noStorage: true } as Parameters<typeof seedDevice>[1]);
  await open(page, '/');
  await expect(page.locator('[data-missions="open"]')).toBeVisible({ timeout: 15_000 });
  expect(admitted(), 'the registry was not in what the server sent').toBe(true);
}

async function openList(page: Page) {
  await page.locator('[data-missions="open"]').click();
  await expect(page.locator('[data-screen="missions"]')).toBeVisible();
}

const ids = (page: Page) => page.locator('[data-screen="missions"] [data-mission]').evaluateAll((els) => els.map((el) => el.getAttribute('data-mission')!));

async function listed(page: Page): Promise<string[]> {
  await openList(page);
  return ids(page);
}

/** The missions list's filter: every kind of mission, or field work only. */
async function scope(page: Page, which: 'All' | 'Field only') {
  await page.locator('[data-mission-scope]').getByRole('button', { name: which, exact: true }).click();
}

test('every kind of mission by default: desk work is listed under the field work, without the grant notice, and the exclusion is said and not shown', async ({ page }) => {
  await landed(page);
  await openList(page);
  const screen = page.locator('[data-screen="missions"]');
  await expect(screen.locator('[data-mission]')).toHaveCount(2, { timeout: 15_000 });
  expect(await ids(page)).toEqual(['water-run', 'longview']);
  await expect(screen.locator('[data-mission-scope] [aria-pressed="true"]')).toHaveText('All');
  await expect(screen.locator('[data-desk-work]')).toContainText('1 from anywhere');
  await expect(screen.locator('[data-mission="longview"]')).toContainText('no end given, posted 1 day ago');
  await expect(screen.locator('[data-refused]')).toContainText('nobody who did not choose it');
  await expect(page.locator('[data-refused-count]')).toContainText('1 not read');
});

test('a desk mission says what it is and that it is taken up in Starcom, and offers no Take part', async ({ page }) => {
  await landed(page);
  await openList(page);
  await page.locator('[data-screen="missions"] [data-mission="longview"]').click({ timeout: 15_000 });
  const screen = page.locator('[data-screen="mission"][data-mission="longview"]');
  await expect(screen.locator('[data-desk]')).toContainText('Desk work');
  await expect(screen.locator('[data-refusal="desk"]')).toContainText('taken up in Starcom');
  await expect(screen.getByRole('button', { name: 'Take part' })).toHaveCount(0);
  await expect(screen).toContainText('No end given');
});

test('Field only narrows the list to field work, and a reload keeps the choice', async ({ page }) => {
  await landed(page);
  await openList(page);
  await expect(page.locator('[data-screen="missions"] [data-mission]')).toHaveCount(2, { timeout: 15_000 });
  await scope(page, 'Field only');
  await expect(page.locator('[data-screen="missions"] [data-mission]')).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem('navcom.desk'))).toBe('0');
  await page.reload();
  await expect(page.locator('[data-missions="open"]')).toBeVisible({ timeout: 15_000 });
  expect(await listed(page)).toEqual(['water-run']);
  await scope(page, 'All');
  await expect(page.locator('[data-screen="missions"] [data-mission="longview"]')).toBeVisible({ timeout: 15_000 });
});
