import { test, expect } from '@playwright/test';
import { seedDevice, open } from './device';

/**
 * A control must not say two things at once.
 *
 * This shipped carrying `aria-pressed={sig === 'low'}` while its visible label named the
 * *destination*, so at rest in low signature a screen reader announced **"DOCUMENT, toggle
 * button, pressed"** — the label naming one mode, the state naming the other, and the pair
 * together asserting that document mode was on when it was not.
 *
 * Both halves were individually valid, which is why axe-core could not see it and why this
 * needs a test of its own. The same defect existed on the root console, copied.
 *
 * Asserted in both directions because a toggle is only half-tested in one.
 */
test.describe('the signature toggle', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('names what a tap does, and never claims a state that could disagree', async ({ page }) => {
    await seedDevice(page, { callsign: 'Wren' });
    await open(page, '/terminal/');
    const button = page.locator('button.signature');

    for (const pass of ['at rest', 'after toggling']) {
      const mode = await page.evaluate(() =>
        document.documentElement.getAttribute('data-signature')
      );
      const name = (await button.getAttribute('aria-label')) ?? '';

      expect(
        await button.getAttribute('aria-pressed'),
        `${pass}: a button whose label names its destination must not also carry a pressed state`
      ).toBeNull();

      expect(
        name.toLowerCase(),
        `${pass}: in ${mode} mode the accessible name should offer the other one`
      ).toContain(mode === 'low' ? 'document' : 'low signature');

      await button.click();
      await page.waitForTimeout(120);
    }
  });
});

test.describe('and covers nothing a person has to reach', () => {
  /*
   * The toggle is `position: fixed` in the bottom-right with `z-index: 5`, so it permanently
   * owns a corner of the viewport. `card-profile.spec` already guards one screen against it,
   * asserting the **centre** of the Add button — written after a compact Add landed fully
   * underneath, and right that a thumb goes to the centre.
   *
   * A corner is a different defect and needed a different measurement. Swept across every
   * terminal screen at 390x700, scrolled to the bottom where no further scrolling can free
   * anything, **ten screens clipped their last button by 7% of its area** and not one of them
   * put a centre under the toggle. So the existing guard passed on all ten, correctly, and
   * this is the half it does not cover.
   *
   * The cause was one number: the column's bottom padding was 2rem against a toggle occupying
   * 3.25rem of viewport. Fixed there rather than screen by screen, which is why this asserts
   * every screen rather than the ones that happened to show it.
   */
  const SCREENS = [
    '/', '/terminal/', '/terminal/setup/', '/terminal/distress/', '/terminal/watch/',
    '/terminal/peers/', '/terminal/card/', '/terminal/standing/', '/terminal/backup/',
    '/terminal/on-call/', '/terminal/find/', '/terminal/patrols/', '/terminal/wipe/',
    '/terminal/sign-on/', '/terminal/log/', '/terminal/query/', '/terminal/assist/',
    '/terminal/resupply/', '/terminal/funding/', '/terminal/directory/',
    '/terminal/directory/st-louis/'
  ];

  for (const path of SCREENS) {
    test(`nothing on ${path} rests under the toggle`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 700 });
      await seedDevice(page, {
        callsign: 'Wren',
        contact: { label: 'Sam', number: '+1 555 0100' },
        watchtower: { pubkey: 'e'.repeat(64), relays: ['wss://relay.example'] }
      });
      await open(page, path);
      // The bottom of the page: the one scroll position a person cannot get out of.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(200);

      const covered = await page.evaluate(() => {
        const sigEl = document.querySelector('.signature');
        if (!sigEl) return [] as string[];
        const s = sigEl.getBoundingClientRect();
        const out: string[] = [];
        for (const el of document.querySelectorAll('button, a, input, select, textarea, summary')) {
          if (el === sigEl || sigEl.contains(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const ox = Math.min(r.right, s.right) - Math.max(r.left, s.left);
          const oy = Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top);
          if (ox <= 0 || oy <= 0) continue;
          const pct = Math.round((100 * ox * oy) / (r.width * r.height));
          const name = (el.textContent || (el as HTMLInputElement).id || el.tagName)
            .trim()
            .slice(0, 30);
          out.push(`${name} (${pct}% under it)`);
        }
        return out;
      });

      expect(covered, `the toggle covers part of: ${covered.join(', ')}`).toEqual([]);
    });
  }
});
