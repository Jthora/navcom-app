import { expect, test } from '@playwright/test';
import { blankDevice, open } from './device';

/**
 * Finding one place among a hundred, on a phone, at 2am.
 *
 * Los Angeles carries 113 records grouped by type, and until now the only way to reach one you
 * could already name was to scroll. The failing is worst in the best-covered areas, which is
 * the wrong way round.
 *
 * **This is not the search box the anti-pattern table forbids.** That rule is about `Query` —
 * asking the watch, because "someone with both hands free does the lookup, that *is* the
 * product". Nothing here asks anybody anything: it narrows a list already carried on the
 * device, offline, and the root console has had exactly this control since it shipped. The
 * screen says so in as many words, and these tests hold it to that.
 */

const LA = '/terminal/directory/los-angeles/';

test('narrows a long list to the place you can already name', async ({ page }) => {
  await blankDevice(page);
  await open(page, LA);

  const records = page.locator('[data-record]');
  const before = await records.count();
  expect(before, 'Los Angeles should be the crowded case').toBeGreaterThan(50);

  // Taken from the page rather than hardcoded, so this cannot rot when the data is reseeded.
  const named = ((await page.locator('[data-record] h3').first().textContent()) ?? '').trim();
  expect(named.length, 'no record name resolved, so the filter below proves nothing').toBeGreaterThan(4);

  await page.locator('[data-narrow]').fill(named.slice(0, 12));
  await expect(records).not.toHaveCount(before);
  await expect(records.first()).toContainText(named.slice(0, 12));
  expect(await records.count()).toBeLessThan(before);
});

test('says so when nothing matches, and offers the way back', async ({ page }) => {
  /*
   * An empty list with no explanation reads as a broken screen. It also has to be honest about
   * what it does not know: a place may be in this area and spelled differently, and the filter
   * cannot tell that from not carried at all.
   */
  await blankDevice(page);
  await open(page, LA);
  await page.locator('[data-narrow]').fill('zzz-nothing-like-this-zzz');

  const empty = page.locator('[data-narrow-empty]');
  await expect(empty).toBeVisible();
  // \s+ not a space: the source line-wraps between the two words, and a raw newline in
  // textContent is not a space to a regex. Third time this session.
  await expect(empty).toContainText(/spelled\s+differently/i);
  await expect(page.locator('[data-record]')).toHaveCount(0);

  await empty.getByRole('button', { name: /show all/i }).click();
  await expect(page.locator('[data-record]').first()).toBeVisible();
});

test('and it says plainly that it is not Query', async ({ page }) => {
  // The sentence that resolves the doctrine question, on the screen rather than in a comment.
  await blankDevice(page);
  await open(page, LA);
  const note = page.locator('section.narrowing');
  await expect(note).toContainText(/nothing is sent and nobody is asked/i);
  await expect(note.locator('a[href="/terminal/query/"]')).toBeVisible();
});

test('and is absent where there is nothing to narrow', async ({ page }) => {
  // A filter over a handful of records costs a tap and saves none.
  await blankDevice(page);
  await open(page, '/terminal/directory/belfast/');
  await expect(page.locator('[data-narrow]')).toHaveCount(0);
});
