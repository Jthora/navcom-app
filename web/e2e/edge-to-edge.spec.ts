import { expect, test, type Page } from '@playwright/test';
import { open, openFind, seedDevice } from './device';
import { frame, mapReady, screenAt } from './map';

/*
 * The landing page draws edge to edge (viewport-fit=cover, hooks.server.ts; com.md §3): the map paints
 * under the system bars and a camera's cutout, and nothing on it that is read or tapped goes there. Held
 * sideways, the installed app had kept the whole page out of them, grey bands 82 of a Redmi A3's 825 px
 * of width (2026-11-05).
 *
 * The safe areas are the ones the devices gave, in CSS px: the owner's Redmi A3 upright and sideways (a
 * status bar, three-button navigation, a waterdrop cutout), their Galaxy Tab A7 sideways (navigation at
 * the foot in both orientations), and an iPhone held sideways (the notch's side and the home indicator).
 * Chromium emulates them over DevTools; a browser does that only for a page that asks for cover, which the
 * build test holds to the landing page alone (src/lib/edge-to-edge.test.ts).
 */
const DEVICES = [
  { name: 'a Redmi A3 upright', viewport: { width: 360, height: 825 }, scale: 2, safe: { top: 34, right: 0, bottom: 48, left: 0 } },
  { name: 'a Redmi A3 held sideways', viewport: { width: 825, height: 360 }, scale: 2, safe: { top: 24, right: 48, bottom: 0, left: 34 } },
  { name: 'a Galaxy Tab A7 held sideways', viewport: { width: 1333, height: 800 }, scale: 1.5, safe: { top: 24, right: 0, bottom: 48, left: 0 } },
  { name: 'an iPhone held sideways', viewport: { width: 844, height: 390 }, scale: 3, safe: { top: 0, right: 47, bottom: 21, left: 47 } }
] as const;

type Safe = (typeof DEVICES)[number]['safe'];
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The Earth's farthest points each way, and a city near each of its edges. */
const EDGES = [
  ['80°N', 0, 80], ['the South Pole', 30, -89.5], ['the date line at the Equator, west', -179.5, 0], ['the date line at the Equator, east', 179.5, 0],
  ['Anchorage', -149.9, 61.2], ['Wellington', 174.78, -41.29], ['Reykjavík', -21.9, 64.1]
] as const;

/** What of a box is outside the safe area, by side, in px; empty when it is all inside. */
function outside(box: Box, safe: Safe, size: { width: number; height: number }): string[] {
  const out: string[] = [];
  if (box.x < safe.left - 0.5) out.push(`left by ${Math.round(safe.left - box.x)}`);
  if (box.y < safe.top - 0.5) out.push(`top by ${Math.round(safe.top - box.y)}`);
  if (box.x + box.width > size.width - safe.right + 0.5) out.push(`right by ${Math.round(box.x + box.width - (size.width - safe.right))}`);
  if (box.y + box.height > size.height - safe.bottom + 0.5) out.push(`bottom by ${Math.round(box.y + box.height - (size.height - safe.bottom))}`);
  return out;
}

/**
 * Each control and line of words shown in the scope, with what of it is outside the safe area. In a list
 * that scrolls, what is further down passes under the foot's bar on its way up, as on any edge-to-edge
 * page; that its end scrolls clear of it is checked apart, so only its sides and top are held here.
 */
async function strays(page: Page, scope: string, safe: Safe, size: { width: number; height: number }, scrolls = false) {
  const boxes = await page.evaluate((scope) => {
    const shown = (e: Element) => {
      const s = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
    };
    return [...document.querySelectorAll(`${scope} :is(button, a, input, select, h1, h2, h3, p, label)`)]
      .filter(shown)
      .filter((e) => !e.closest('[aria-hidden="true"]') && getComputedStyle(e).clipPath === 'none')
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { what: `${e.tagName.toLowerCase()} “${(e.textContent ?? '').trim().slice(0, 40)}”`, box: { x: r.x, y: r.y, width: r.width, height: r.height } };
      });
  }, scope);
  expect(boxes.length, `nothing found to check in ${scope}`).toBeGreaterThan(0);
  return boxes.flatMap(({ what, box }) => {
    const sides = outside(box, safe, size).filter((side) => !(scrolls && side.startsWith('bottom')));
    return sides.length ? [`${what}: ${sides.join(', ')}`] : [];
  });
}

for (const device of DEVICES) {
  test.describe(`the landing page on ${device.name}`, () => {
    test.use({ viewport: device.viewport, deviceScaleFactor: device.scale, isMobile: true, hasTouch: true });

    for (const signedOn of [false, true]) {
      test(`${signedOn ? 'signed on' : 'not signed on'}: the map to every edge, the Earth and every corner inside the safe area, and Com too once a corner opens`, async ({ page }) => {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: device.safe });
        await seedDevice(page, signedOn ? { callsign: 'kestrel', relayEvents: [] } : { __noStorage: true });
        await open(page, '/');
        await mapReady(page);
        await frame(page);
        const size = device.viewport;
        const safe = device.safe;

        // Distress, for an operator: inside the safe area, at the thumb floor, and the strip to the screen's foot.
        let foot: number = size.height;
        const distress = page.locator('.distress-layer:not([hidden])');
        if (signedOn) {
          await expect(distress).toBeVisible();
          const strip = (await distress.boundingBox())!;
          expect(strip.y + strip.height, 'the Distress strip stops short of the screen’s foot').toBeGreaterThanOrEqual(size.height - 0.5);
          const control = (await distress.locator('[data-act]').boundingBox())!;
          expect(outside(control, safe, size), 'Distress under a system bar or the cutout').toEqual([]);
          expect(control.height, 'Distress squeezed below the thumb floor by the safe area').toBeGreaterThanOrEqual(48);
          foot = strip.y;
        } else {
          await expect(distress).toHaveCount(0);
        }

        // The map paints under the bars and the cutout: the canvas reaches every edge the page has.
        const canvas = (await page.locator('.grid canvas').boundingBox())!;
        expect(canvas.x).toBeLessThanOrEqual(0.5);
        expect(canvas.y).toBeLessThanOrEqual(0.5);
        expect(canvas.x + canvas.width).toBeGreaterThanOrEqual(size.width - 0.5);
        expect(canvas.y + canvas.height).toBeGreaterThanOrEqual(foot - 0.5);

        // And its opening view is the whole Earth inside the safe area, above Distress.
        for (const [name, lon, lat] of EDGES) {
          const at = await screenAt(page, lon, lat);
          const off = outside({ x: at.x, y: at.y, width: 0, height: 0 }, safe, { width: size.width, height: foot + (signedOn ? safe.bottom : 0) });
          expect(off, `${name} is under a system bar or the cutout at the opening view`).toEqual([]);
          expect(at.y, `${name} is under Distress`).toBeLessThanOrEqual(foot);
        }

        // Every corner, and every word and control in it.
        await expect(page.locator('[data-corner]')).toHaveCount(4);
        expect(await strays(page, '[data-corner]', safe, size)).toEqual([]);

        // A corner opened at each side: Com's head, what it holds and its foot stay inside, and so do the
        // corners still showing beside it or above it.
        for (const opening of ['map', 'find'] as const) {
          if (opening === 'map') await page.getByRole('button', { name: 'Map layers' }).click();
          else await openFind(page);
          const com = page.locator('[data-com]');
          await expect(com).not.toHaveAttribute('data-detent', 'closed');
          await page.waitForTimeout(300);
          expect(await strays(page, '[data-com] .com-head', safe, size), `the head, with ${opening} open`).toEqual([]);
          expect(await strays(page, '[data-com] .com-body', safe, size, true), `what Com holds, with ${opening} open`).toEqual([]);
          // Its foot: scrolled to the end, the last of what it holds ends above the bars and above Distress.
          await page.locator('[data-com] .com-body').evaluate((b) => (b.scrollTop = b.scrollHeight));
          await frame(page);
          const last = await page.locator('[data-com] .com-body').evaluate((b) => {
            const all = [...b.querySelectorAll('button, a, input, select, p')].filter((e) => e.getClientRects().length > 0);
            return Math.max(...all.map((e) => e.getBoundingClientRect().bottom));
          });
          expect(last, `the end of what Com holds is under a bar or Distress, with ${opening} open`).toBeLessThanOrEqual(Math.min(foot, size.height - safe.bottom) + 0.5);
          expect(await strays(page, '.bridge > [data-corner]', safe, size), `the corners, with ${opening} open`).toEqual([]);
          await page.locator('[data-back]').click();
          await expect(com).toHaveAttribute('data-detent', 'closed');
        }
      });
    }
  });
}
