import { expect, test } from '@playwright/test';
import { seedDevice, open } from './device';

/**
 * The cold start, driven the way an operator would drive it.
 *
 * *"A mechanism nobody can reach is not built."* — `verification.md`, earned three times.
 * `panicWipe` had no button for weeks and passed every test; the position control was absent
 * while sign-on still wrote the setting. Both were correct code nobody could operate.
 *
 * This is the path that matters most for that rule, because it is the only one an operator in
 * an empty region has. Thirty-five of sixty-eight regions ship with zero records, and until
 * now their page **did not exist** — `entries()` prerendered only regions that already had
 * something in them, so the person with the local knowledge got a 404.
 *
 * So the first test here is not about the form. It is about whether Nashville answers at all.
 */

const EMPTY = '/terminal/directory/nashville/';

test.describe('an area nobody has put anything in', () => {
  test('has a page at all, which is the whole cold start', async ({ page }) => {
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await open(page, EMPTY);
    // Not a 404, and not a redirect to somewhere with data.
    await expect(page).toHaveURL(new RegExp('nashville'));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('says it is empty rather than looking broken', async ({ page }) => {
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await open(page, EMPTY);
    // Rule 6: silence is a positive readout. "Nothing yet" is a state; a blank screen is a bug.
    await expect(page.getByText(/nothing yet/i).first()).toBeVisible();
  });

  test('is listed on the index, so somebody can find their own city', async ({ page }) => {
    /*
     * The index used to filter empty regions out — "listing it would promise a fallback that
     * is an empty page", which was right until an operator could add one. Hidden, the person
     * who knows a city is the one person who cannot reach it.
     */
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await open(page, '/terminal/directory/');
    const link = page.locator('a[href="/terminal/directory/nashville/"]');
    await expect(link).toBeVisible();
    await expect(link).toContainText(/nothing yet/i);
  });

  test('offers a way in, and it can be operated one-handed', async ({ page }) => {
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await open(page, EMPTY);

    await page.locator('[data-add-place]').click();
    await page.locator('#pl-name').fill('Room In The Inn');
    await page.locator('#pl-addr').fill('705 Drexel St');
    await page.locator('#pl-type').selectOption('shelter');
    await page.locator('#pl-how').selectOption('in_person');
    await page.locator('[data-add-save]').click();

    // Held on this device immediately, whether or not a relay took it — the same promise a
    // correction makes, and for the same reason: the operator standing at a door has the
    // worst signal and the best knowledge.
    const record = page.locator('[data-record]').first();
    await expect(record).toBeVisible({ timeout: 10_000 });
    await expect(record).toContainText(/room in the inn/i);
  });

  test('and the row says an operator added it, not the directory', async ({ page }) => {
    /*
     * The record-level version of the honesty every field already carries. An added place has
     * never been through a maintainer, and a row that looked curated would be the one place
     * this whole design lies.
     */
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await open(page, EMPTY);

    await page.locator('[data-add-place]').click();
    await page.locator('#pl-name').fill('Room In The Inn');
    await page.locator('#pl-addr').fill('705 Drexel St');
    await page.locator('[data-add-save]').click();

    const marker = page.locator('[data-added]').first();
    await expect(marker).toBeVisible({ timeout: 10_000 });
    await expect(marker).toContainText(/not in the published directory/i);
    // Provenance by name, as everywhere else.
    await expect(marker).toContainText(/wren/i);
  });

  test('never invents a decisive field', async ({ page }) => {
    /*
     * The rule this whole feature had to be designed around. A form that asked for `pets`
     * would collect a guess with an operator's callsign attached, and the confidence rules
     * would then rank that guess *above* a scraped value. Blank must survive the round trip
     * and render as unknown.
     */
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await open(page, EMPTY);

    await page.locator('[data-add-place]').click();
    // The form does not offer them at all — checked here rather than in a unit test, because
    // "the schema refuses it" and "nobody can type it in" are different claims.
    await expect(page.locator('#pl-pets')).toHaveCount(0);
    await expect(page.locator('#pl-id-required')).toHaveCount(0);
    await expect(page.locator('#pl-sobriety')).toHaveCount(0);
    await expect(page.locator('#pl-curfew')).toHaveCount(0);

    await page.locator('#pl-name').fill('Room In The Inn');
    await page.locator('#pl-addr').fill('705 Drexel St');
    await page.locator('[data-add-save]').click();

    const record = page.locator('[data-record]').first();
    await expect(record).toBeVisible({ timeout: 10_000 });
    await expect(record).toContainText(/unknown/i);
  });

  test('refuses a place with nowhere to walk to, in words a person can act on', async ({ page }) => {
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await open(page, EMPTY);

    await page.locator('[data-add-place]').click();
    await page.locator('#pl-name').fill('Somewhere');
    await page.locator('[data-add-save]').click();

    const err = page.locator('[data-add-error]');
    await expect(err).toBeVisible({ timeout: 10_000 });
    await expect(err).toContainText(/walk to/i);
    // And nothing was added on the strength of a refusal.
    await expect(page.locator('[data-record]')).toHaveCount(0);
  });

  test('does not offer a way to add a place somebody only read about', async ({ page }) => {
    /*
     * The design position that answers this kind's new failure mode — a wrong field sends
     * somebody to the wrong hours, a wrong place sends them to an address that is not there.
     * `website` and `secondhand` are rankable everywhere else in this system and are refused
     * here, so they must not be offerable here either.
     */
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await open(page, EMPTY);

    await page.locator('[data-add-place]').click();
    const how = page.locator('#pl-how');
    await expect(how).toBeVisible();
    const values = await how.locator('option').evaluateAll((os) =>
      os.map((o) => (o as HTMLOptionElement).value)
    );
    expect(values).not.toContain('website');
    expect(values).not.toContain('secondhand');
    expect(values.sort()).toEqual(['in_person', 'phone', 'staff_confirmed']);
  });
});

test.describe('an area that already has records', () => {
  test('still offers the path, because a directory is never complete', async ({ page }) => {
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await open(page, '/terminal/directory/st-louis/');
    await expect(page.locator('[data-add-place]')).toBeVisible();
  });

  test('and a published record is not marked as added', async ({ page }) => {
    // The marker has to mean something. If it appeared on curated rows it would be noise, and
    // an operator would stop reading it exactly when it started mattering.
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await open(page, '/terminal/directory/st-louis/');
    await page.locator('section.group > button.head').first().click();
    await expect(page.locator('[data-added]')).toHaveCount(0);
  });
});
