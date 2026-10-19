import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { open, seedDevice } from './device';
import { serveNws } from './hazards';
import { admit, mission, resign, standInKey, type StandIn } from './registry';

/**
 * Weather warnings on a mission's screen [docs/design/map.md, Weather warnings on a mission], against the
 * build that deploys, on the phone, with the NWS served by route from a recorded fixture in the shape
 * measured on 2026-10-19. No test asks the live service.
 *
 * Held here: nothing is asked before the tap, and the screen says before it what the tap tells
 * weather.gov; the tap asks one URL, for the mission's state; only warnings the NWS issued are shown,
 * each in its words and with its age; a failure reads *NWS not read: unknown*; outside the US nothing
 * is asked and the screen says so; and taking part is exactly as it was before and after, because a
 * warning informs and never gates [invariants 8 and 9].
 */

test.use({ serviceWorkers: 'block' });

const HEAT_KEY = standInKey();
const HEAT_DESK: StandIn = { id: 'heat-desk', name: 'Heat Desk', agent: true, inbox: ['wss://nos.lol', 'wss://relay.primal.net'], keys: [HEAT_KEY] };
const HEAT = resign(
  JSON.parse(readFileSync(new URL('../../packages/core/test/fixtures/mission-packages.json', import.meta.url), 'utf8'))[0],
  HEAT_KEY
);
const HEAT_D = 'starcom_mission_package_field-heat_relief-CA-2026-10-02';
const KENYA_D = 'field-water-nairobi-test';
const KENYA = mission(HEAT_KEY, KENYA_D, { title: 'Water at the depot', jurisdiction: 'ke' });
/** Inside the campaign, and five minutes after the fixture's Tornado Warning was sent. */
const DURING = new Date('2026-10-06T20:00:00Z');

test.beforeEach(async ({ page }) => void (await admit(page, [HEAT_DESK])));

async function toMission(page: Page, d: string, events: unknown[] = [HEAT, KENYA]) {
  await page.clock.setFixedTime(DURING);
  await seedDevice(page, { relayEvents: events, callsign: 'kestrel' });
  await open(page, '/');
  await expect(page.locator('[data-missions="open"]')).toContainText('Open missions · live', { timeout: 15_000 });
  await page.locator('[data-missions="open"]').click();
  await page.locator(`[data-mission="${d}"]`).click();
  const screen = page.locator(`[data-screen="mission"][data-mission="${d}"]`);
  await expect(screen).toBeVisible();
  return screen;
}

/** What taking part offers, as a person would see it: its label, and whether it can be pressed. */
const takePart = async (page: Page) => {
  const button = page.getByRole('button', { name: 'Take part' });
  return { count: await button.count(), enabled: (await button.count()) > 0 && (await button.isEnabled()) };
};

test('asks nothing before the tap, says what the tap tells weather.gov, and then shows only the warnings it issued, as issued', async ({ page }) => {
  const asked = await serveNws(page);
  const screen = await toMission(page, HEAT_D);
  const nws = screen.locator('[data-nws="state"]');
  await expect(nws.locator('[data-nws-check]')).toContainText('Check NWS warnings for California');
  const ask = nws.locator('[data-nws-ask]');
  await expect(ask).toContainText('Asks api.weather.gov for the warnings it has issued for California');
  await expect(ask).toContainText('which state');
  // An address is not where the map looks, and it is not nowhere either: it says so, and what else goes.
  await expect(ask).toContainText('which can place it roughly, often to a city; its browser; the time');
  await expect(ask).toContainText('the emergencies it relays that ask people to act now, such as an evacuation');
  await expect(ask).toContainText('Whether you take this mission stays yours');
  expect(asked, 'asked before the tap').toEqual([]);
  const before = await takePart(page);
  expect(before.count, 'taking part is not offered on this mission').toBe(1);

  await nws.locator('[data-nws-check]').click();
  const list = nws.locator('[data-nws-warnings]');
  await expect(list).toBeVisible();
  expect(asked).toEqual(['https://api.weather.gov/alerts/active?area=CA']);
  await expect(list.locator('li')).toHaveCount(3);
  const tornado = list.locator('[data-nws-warning="Tornado Warning"]');
  await expect(tornado).toContainText('Tornado Warning issued October 6 at 12:55PM PDT until October 6 at 1:30PM PDT by NWS Sacramento CA');
  // The area each names, as issued: a statewide answer covers places far apart.
  await expect(tornado.locator('[data-nws-area]')).toHaveText('Sacramento; Yolo');
  await expect(tornado).toContainText('from NWS Sacramento CA');
  await expect(tornado).toContainText('ends 2026-10-06T13:30:00-07:00');
  await expect(tornado).toContainText('issued 5 min ago');
  const redFlag = list.locator('[data-nws-warning="Red Flag Warning"]');
  await expect(redFlag).toContainText('no end issued · expires 2026-10-07T18:00:00-07:00');
  await expect(redFlag.locator('[data-nws-area]')).toHaveText('Northern Sacramento Valley; Northern San Joaquin Valley');
  // An evacuation order is not called a warning, and is shown with them, as issued.
  const evacuate = list.locator('[data-nws-warning="Evacuation Immediate"]');
  await expect(evacuate).toContainText('Evacuation Immediate issued October 6 at 12:40PM PDT by NWS Sacramento CA');
  await expect(evacuate.locator('[data-nws-area]')).toHaveText('Butte');
  await expect(evacuate).toContainText('issued 20 min ago');
  // What it leaves out is counted, so none shown never reads as nothing out.
  await expect(nws.locator('[data-nws-others]')).toHaveText(
    '2 other alerts out for California, such as watches, advisories and statements, are not shown here.'
  );
  // Watches, advisories, a cancellation and a test are not warnings it issued.
  await expect(nws).not.toContainText('Tornado Watch');
  await expect(nws).not.toContainText('Wind Advisory');
  await expect(nws).not.toContainText('This is a test.');
  await expect(nws).not.toContainText('has been cancelled');
  await expect(nws.locator('[data-slot="read"]')).toContainText('by this phone at 20:00 UTC');

  // A warning is a fact on the page, not an alarm, and it gates nothing.
  expect(await screen.locator('[role="alert"], [aria-live="assertive"]').count()).toBe(0);
  expect(await takePart(page)).toEqual(before);

  // A second tap inside a minute reuses the answer.
  await nws.locator('[data-nws-check]').click();
  await expect(nws.locator('[data-nws-check]')).toContainText('Check again');
  expect(asked).toHaveLength(1);
});

test('a failed ask reads NWS not read: unknown, never none issued', async ({ page }) => {
  await serveNws(page, { fail: true });
  const screen = await toMission(page, HEAT_D);
  await screen.locator('[data-nws-check]').click();
  await expect(screen.locator('[data-nws-failed]')).toContainText('NWS not read: unknown');
  await expect(screen.locator('[data-nws-none]')).toHaveCount(0);
});

test('none issued says so, and that the NWS does not say a place is safe', async ({ page }) => {
  await serveNws(page, { empty: true });
  const screen = await toMission(page, HEAT_D);
  await screen.locator('[data-nws-check]').click();
  await expect(screen.locator('[data-nws-none]')).toContainText('No warnings or emergencies issued for California as of 20:00 UTC');
  await expect(screen.locator('[data-nws-others]')).toHaveCount(0);
  await expect(screen.locator('[data-nws-none]')).toContainText('it does not say a place is safe');
});

test('outside the US no warning service is asked, and the screen says so', async ({ page }) => {
  const asked = await serveNws(page);
  const screen = await toMission(page, KENYA_D);
  await expect(screen.locator('[data-nws-elsewhere]')).toHaveText('No warning service is read for Kenya. NavCom reads only the US National Weather Service.');
  await expect(screen.locator('[data-nws-check]')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(asked).toEqual([]);
});
