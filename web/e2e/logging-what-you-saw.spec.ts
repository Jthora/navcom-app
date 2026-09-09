import { expect, test, type Page } from '@playwright/test';
import { seedDevice, open } from './device';

/**
 * Filing an observation from the field.
 *
 * One note on the assertions: the success check is `toHaveText('Filed.')` and not a regex.
 * The first version matched `/filed/i`, which the refusal *"Nothing can be filed against a
 * place with no position on record"* also matches — so a test written to prove an
 * observation was published passed on the message saying it was not.
 *
 * `observation.ts` and its 39 tests existed for a day with nothing that could produce one —
 * the object was complete and unreachable, which is the exact shape this project names: a
 * mechanism nobody can reach is not built. So these drive the screen and then read what
 * actually went to the relay, rather than asserting on state.
 *
 * The assertions that matter most are the two refusals. An observation with a free-text field
 * would be a system for describing people, and one carrying a fine position would tell a
 * watcher an operator is standing somewhere right now.
 */

/*
 * `relayEvents: []` on every seed, deliberately.
 *
 * Without it `seedDevice` hands the page a socket that never opens -- the right default,
 * because most tests here are about a phone with no signal. The first version of this file
 * omitted it and every publish correctly reported *"No relay took it"*, which looked like a
 * bug in the screen and was the screen being honest.
 */

/** Everything the app handed to a relay, as the stub recorded it. */
const published = (page: Page) =>
  page.evaluate(() => (window as unknown as { __navcomPublished?: Record<string, unknown>[] }).__navcomPublished ?? []);

const observations = async (page: Page) => (await published(page)).filter((e) => e.kind === 1911);

async function openLog(page: Page) {
  await page.locator('[data-log-open]').first().click();
  await expect(page.locator('[data-log-observation]')).toBeVisible();
}

test('a person can reach it and file one', async ({ page }) => {
  await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
  await open(page, '/terminal/directory/st-louis/');
  await openLog(page);

  await page.getByRole('button', { name: 'Locked', exact: true }).click();
  await page.getByRole('button', { name: /you saw it yourself/i }).click();
  await page.getByRole('button', { name: /^File it$/ }).click();

  await expect(page.locator('[data-outcome]')).toHaveText('Filed.', { timeout: 10_000 });

  const [obs] = await observations(page);
  expect(obs, 'nothing of kind 1911 reached the relay').toBeTruthy();
  const content = JSON.parse(obs!.content as string) as Record<string, unknown>;
  expect(content.tags).toEqual(['locked']);
  expect(content.method).toBe('saw');
  expect(content.callsign).toBe('Wren');
});

test('publishes a coarse cell and never a fine one', async ({ page }) => {
  /*
   * The one field whose whole job is preventing an operator from being located. Four
   * characters is ±20 km; five is ±2.4 km, and an earlier draft of the spec disagreed with
   * its own example by that factor.
   */
  await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
  await open(page, '/terminal/directory/st-louis/');
  await openLog(page);
  await page.getByRole('button', { name: 'Locked', exact: true }).click();
  await page.getByRole('button', { name: /^File it$/ }).click();
  await expect(page.locator('[data-outcome]')).toHaveText('Filed.', { timeout: 10_000 });

  const content = JSON.parse((await observations(page))[0]!.content as string) as Record<string, unknown>;
  expect(content.precision).toBe('area');
  expect(content.area, 'a coarse area must be exactly four characters').toMatch(/^[0-9bcdefghjkmnpqrstuvwxyz]{4}$/);
  // And no exact position anywhere in it.
  expect(content.lat).toBeUndefined();
  expect(content.lon).toBeUndefined();
});

test('carries no free text, because there is nowhere to type any', async ({ page }) => {
  await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
  await open(page, '/terminal/directory/st-louis/');
  await openLog(page);

  // The mechanism, checked as an absence of controls rather than as a claim.
  const panel = page.locator('[data-log-observation]');
  await expect(panel.locator('input[type="text"], textarea')).toHaveCount(0);

  await page.getByRole('button', { name: 'Locked', exact: true }).click();
  await page.getByRole('button', { name: /^File it$/ }).click();
  await expect(page.locator('[data-outcome]')).toHaveText('Filed.', { timeout: 10_000 });

  const content = JSON.parse((await observations(page))[0]!.content as string) as Record<string, unknown>;
  for (const key of Object.keys(content)) {
    expect(key, `${key} is not a field an observation may carry`).toMatch(
      /^(anchor|observed_at|tags|method|callsign|precision|area|supersedes)$/
    );
  }
});

test('anonymous omits the name, and says it does not omit the history', async ({ page }) => {
  await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
  await open(page, '/terminal/directory/st-louis/');
  await openLog(page);

  await page.getByRole('button', { name: /under your callsign/i }).click();
  // The sentence `raw-intel.md` §2 says an operator must actually see.
  await expect(page.getByText(/anonymous means no name\. it does not mean no history\./i)).toBeVisible();

  await page.getByRole('button', { name: 'Locked', exact: true }).click();
  await page.getByRole('button', { name: /^File it$/ }).click();
  await expect(page.locator('[data-outcome]')).toHaveText('Filed.', { timeout: 10_000 });

  const obs = (await observations(page))[0]!;
  const content = JSON.parse(obs.content as string) as Record<string, unknown>;
  expect(content.callsign).toBe('anonymous');
  // Still one signing key, which is what stops an anonymous set corroborating itself.
  expect(obs.pubkey).toMatch(/^[0-9a-f]{64}$/);
});

test('records when it was seen, distinctly from when it was sent', async ({ page }) => {
  await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
  await open(page, '/terminal/directory/st-louis/');
  await openLog(page);
  await page.getByRole('button', { name: 'Locked', exact: true }).click();
  await page.getByRole('button', { name: /^File it$/ }).click();
  await expect(page.locator('[data-outcome]')).toHaveText('Filed.', { timeout: 10_000 });

  const obs = (await observations(page))[0]!;
  const content = JSON.parse(obs.content as string) as Record<string, unknown>;
  // Two separate timestamps, because an observation stays true and a publish time does not
  // describe when anybody saw anything.
  expect(typeof content.observed_at).toBe('number');
  expect(typeof obs.created_at).toBe('number');
});

test('is a different control from reporting a problem, because they are different objects', async ({ page }) => {
  /*
   * A correction says what *is* and rots. An observation says what somebody *saw* and stays
   * true. `raw-intel.md` §1: conflating them produces a system that either forgets its
   * evidence or trusts stale claims. One control each.
   */
  await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
  await open(page, '/terminal/directory/st-louis/');

  await expect(page.locator('[data-report-open]').first()).toBeVisible();
  await expect(page.locator('[data-log-open]').first()).toBeVisible();

  // Opening one closes the other, so nobody is filling in both at once.
  await page.locator('[data-log-open]').first().click();
  await expect(page.locator('[data-log-observation]')).toBeVisible();
  await expect(page.locator('[data-clock-dates-this]')).toHaveCount(0);
});

test('caps how much one observation may claim', async ({ page }) => {
  await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
  await open(page, '/terminal/directory/st-louis/');
  await openLog(page);

  const panel = page.locator('[data-log-observation]');
  // Scoped to the tag row: the method and anonymous controls are also aria-pressed, and the
  // first version of this counted `saw` among the tags and read 9 where it wanted 8.
  const pressed = () => panel.locator('[data-tags] button[aria-pressed="true"]');
  const names = ['Locked', 'Fenced', 'Blocked', 'Closed', 'Moved', 'Reopened', 'Demolished', 'Rebuilt'];
  for (const n of names) await page.getByRole('button', { name: n, exact: true }).click();

  // Eight is the cap; a ninth is unreachable rather than silently ignored.
  await expect(pressed()).toHaveCount(8);
  await expect(page.getByRole('button', { name: 'Light out', exact: true })).toBeDisabled();
});

test('a report that reached nothing never looks like one that landed', async ({ page }) => {
  /*
   * The default state of this app is a phone with no signal, so this is the ordinary case
   * rather than the edge one. `seedDevice` with no `relayEvents` gives a socket that never
   * opens, which is exactly that phone.
   */
  await seedDevice(page, { callsign: 'Wren' });
  await open(page, '/terminal/directory/st-louis/');
  await openLog(page);
  await page.getByRole('button', { name: 'Locked', exact: true }).click();
  await page.getByRole('button', { name: /^File it$/ }).click();

  await expect(page.locator('[data-outcome]')).toHaveText(/nothing was published/i, { timeout: 10_000 });
  expect(await observations(page), 'nothing should have gone out').toEqual([]);
});

test('what somebody filed comes back on the record', async ({ page }) => {
  /*
   * The loop, closed. Raw Intel shipped with a complete write path and no read path at all --
   * an operator filed an observation, saw "Filed.", reloaded, and nothing anywhere showed it
   * had happened. Not even to them.
   *
   * This seeds an observation as a relay would serve it and asserts the record shows it,
   * which is the only assertion that distinguishes filed from lost.
   */
  const { generateSecretKey } = await import('nostr-tools/pure');
  const { buildObservation, anchorFromRecord } = await import('@navcom/core');

  // The record the region screen shows first that can actually be anchored.
  const anchor = { id: 'st-louis-osm-22823de9', region: 'st-louis' };
  const event = buildObservation(
    generateSecretKey(),
    {
      anchor: anchor.id,
      observed_at: Math.floor(Date.now() / 1000) - 3 * 86400,
      tags: ['locked'],
      method: 'saw',
      callsign: 'Raven',
      precision: 'area'
    },
    { precision: 'area', geohash: '9yzg' },
    Math.floor(Date.now() / 1000),
    anchor.region
  );

  await seedDevice(page, { callsign: 'Wren', relayEvents: [event] });
  await open(page, '/terminal/directory/st-louis/');

  const seen = page.locator('[data-seen]').first();
  await expect(seen).toBeVisible({ timeout: 10_000 });
  await expect(seen).toContainText('locked');
  // Invariant 9: a claim about a moment shows how long ago that moment was.
  await expect(seen).toContainText(/3 days ago/i);
  await expect(seen).toContainText('Raven');
  await expect(seen).toContainText('saw');
});

test('and is shown apart from the record’s own fields, not merged into them', async ({ page }) => {
  /*
   * §1: a correction says what *is* and decays; an observation says what somebody *saw* and
   * stays true. Rendering them as one list would conflate exactly what the spec separates.
   */
  const { generateSecretKey } = await import('nostr-tools/pure');
  const { buildObservation } = await import('@navcom/core');
  const event = buildObservation(
    generateSecretKey(),
    { anchor: 'st-louis-osm-22823de9', observed_at: Math.floor(Date.now() / 1000),
      tags: ['light_out'], method: 'told', callsign: 'anonymous', precision: 'area' },
    { precision: 'area', geohash: '9yzg' },
    Math.floor(Date.now() / 1000),
    'st-louis'
  );
  await seedDevice(page, { callsign: 'Wren', relayEvents: [event] });
  await open(page, '/terminal/directory/st-louis/');

  const seen = page.locator('[data-seen]').first();
  await expect(seen).toBeVisible({ timeout: 10_000 });
  // Its own labelled region, not a row among the record's fields.
  await expect(seen).toContainText(/reported here/i);
  await expect(seen).toContainText('light out');
});
