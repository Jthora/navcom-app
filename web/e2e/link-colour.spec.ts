import { expect, test } from '@playwright/test';
import { seedDevice, open } from './device';

/**
 * No screen renders a link at the browser's default colour.
 *
 * `screen.css` styled only `.eyebrow a`, so every other link in the terminal came out at
 * `rgb(158, 158, 255)` — measured on the card, find and status screens, and shipped that way
 * for as long as those screens have existed. Found by screenshotting a *new* screen and
 * noticing its links looked wrong; the old ones had looked wrong the whole time and nobody
 * had put a screenshot beside the palette.
 *
 * It matters most in low signature, whose entire purpose is an amber-dominant screen with no
 * white and luminance at the floor, for an operator who does not want to be lit up at 2am. A
 * browser-blue link is the brightest, bluest thing on that screen.
 */

/** Chromium's default link colours, light and dark. Neither is in this palette. */
const BROWSER_DEFAULT = [
  'rgb(158, 158, 255)',
  'rgb(0, 0, 238)',
  'rgb(85, 26, 139)',
  'rgb(153, 51, 153)'
];

const SCREENS = ['/terminal/', '/terminal/card/', '/terminal/find/', '/terminal/backup/', '/terminal/who/'];

test('no terminal screen renders a browser-default link', async ({ page }) => {
  await seedDevice(page, { callsign: 'Wren' });
  const offenders: string[] = [];
  let checked = 0;

  for (const route of SCREENS) {
    await open(page, route);
    for (const a of await page.locator('a').all()) {
      if (!(await a.isVisible())) continue;
      checked++;
      const colour = await a.evaluate((e) => getComputedStyle(e).color);
      if (BROWSER_DEFAULT.includes(colour)) {
        offenders.push(`${route} "${(await a.innerText()).slice(0, 24)}" ${colour}`);
      }
    }
  }

  // Make silence fail: a selector that matched nothing would pass this beautifully.
  expect(checked, 'no links were examined, so this test proved nothing').toBeGreaterThan(6);
  expect(offenders, 'links at the browser default colour').toEqual([]);
});
